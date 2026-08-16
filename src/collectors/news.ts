import { companyUrl, type Company } from "../models/company.js";
import { makeEvidence, truncateContent, type Evidence } from "../models/evidence.js";
import { fetchText } from "../util/http.js";
import { collapse, extractLinks, isHtml, parsePage, safeUrl } from "../util/html.js";
import { log } from "../util/logger.js";
import { mapWithConcurrency } from "../util/pool.js";
import type { SearchResult } from "../search/provider.js";
import { CollectorSkip, type CollectorContext, type ResearchSource } from "./types.js";

const NEWS_QUERIES = (name: string) => [
  `"${name}" announcement OR launches OR partnership`,
  `"${name}" acquisition OR expansion OR restructuring`,
  `"${name}" CTO OR CIO OR "chief technology officer" OR "chief data officer"`,
  `"${name}" AI OR "artificial intelligence" OR modernization initiative`,
];

const NEWSROOM_PATHS = ["/newsroom", "/news", "/press", "/press-releases", "/blog/news", "/company/news", "/about/news"];

const NOISE_HOSTS =
  /(facebook|twitter|x\.com|instagram|youtube|tiktok|pinterest|reddit|glassdoor|indeed|crunchbase\.com\/search)/i;

export function createNewsSource(ctx: CollectorContext): ResearchSource {
  return {
    name: "news",
    label: "Recent developments",
    async collect(company: Company): Promise<Evidence[]> {
      const limit = ctx.config.research.maxNewsResults;
      if (limit === 0) throw new CollectorSkip("news collection disabled in config");

      const candidates = new Map<string, SearchResult>();

      // 1. The company's own newsroom is the highest-signal, lowest-noise source.
      for (const item of await newsroomLinks(company, ctx)) {
        candidates.set(normalizeKey(item.url), item);
      }

      // 2. Whatever the configured search provider knows.
      if (ctx.search.enabled) {
        for (const query of NEWS_QUERIES(company.name)) {
          const results = await ctx.search.search(query, { limit: 6, freshnessDays: 240 });
          for (const result of results) {
            if (NOISE_HOSTS.test(result.url)) continue;
            candidates.set(normalizeKey(result.url), result);
          }
          if (candidates.size >= limit * 3) break;
        }
      } else {
        // 3. Keyless fallback: Google News RSS.
        for (const item of await googleNews(company.name, limit)) {
          candidates.set(normalizeKey(item.url), item);
        }
      }

      if (!candidates.size) throw new CollectorSkip("no recent coverage found");

      const shortlist = [...candidates.values()]
        .sort(byRelevance(company))
        .slice(0, limit);

      const pages = await mapWithConcurrency(shortlist, 4, async (result) => {
        const response = await fetchText(result.url, { signal: ctx.signal, retries: 1, maxBytes: 1_200_000 });
        // A Google News link resolves to a JS redirect shell whose title is
        // "Google News" — the RSS headline we already have is the real content.
        const isRedirectShell = /news\.google\.com/.test(response.url);
        if (isRedirectShell || !response.ok || !isHtml(response.contentType, response.body)) {
          // Keep the snippet: a search summary with a URL is still evidence.
          if (!result.snippet) return undefined;
          return makeEvidence({
            sourceType: "press",
            title: result.title || result.url,
            url: result.url,
            publishedAt: result.publishedAt,
            content: result.snippet,
            meta: { collector: "news", fetched: false },
          });
        }
        const parsed = parsePage(response.body);
        const content = parsed.text.length > 200 ? parsed.text : result.snippet;
        if (!content) return undefined;
        return makeEvidence({
          sourceType: "press",
          title: parsed.title || result.title || result.url,
          url: response.url,
          publishedAt: parsed.publishedAt ?? result.publishedAt,
          content: truncateContent(content, 4500),
          meta: { collector: "news", fetched: true },
        });
      });

      const evidence = pages.filter((e): e is Evidence => Boolean(e));
      if (!evidence.length) throw new CollectorSkip("coverage found but nothing readable");
      return evidence;
    },
  };
}

/** Finds article links on the company's own newsroom/press index. */
async function newsroomLinks(company: Company, ctx: CollectorContext): Promise<SearchResult[]> {
  const base = companyUrl(company);
  if (!base) return [];
  const origin = safeUrl(base)?.origin;
  if (!origin) return [];

  for (const path of NEWSROOM_PATHS) {
    const response = await fetchText(`${origin}${path}`, { signal: ctx.signal, retries: 0 });
    if (!response.ok || !isHtml(response.contentType, response.body)) continue;
    // Only links *inside* the newsroom section count. Without this the site
    // navigation (product pages, pricing, docs) walks in as "news".
    const indexPath = (safeUrl(response.url)?.pathname ?? path).replace(/\/$/, "");
    const links = extractLinks(response.body, response.url)
      .filter((link) => !NOISE_HOSTS.test(link.url))
      .filter((link) => link.text.length > 25)
      .filter((link) => {
        const linkPath = safeUrl(link.url)?.pathname ?? "";
        return linkPath.startsWith(`${indexPath}/`) && linkPath.length > indexPath.length + 1;
      });
    if (links.length >= 3) {
      log.debug("news", `newsroom ${response.url} -> ${links.length} links`);
      return links.slice(0, 12).map((link) => ({ title: link.text, url: link.url, snippet: "" }));
    }
  }
  return [];
}

/** Keyless recent-news fallback. Returns publisher links from the RSS feed. */
async function googleNews(name: string, limit: number): Promise<SearchResult[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}"`)}&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetchText(url, { retries: 1, headers: { accept: "application/rss+xml,text/xml" } });
  if (!response.ok) return [];
  const items = [...response.body.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit * 2);
  const out: SearchResult[] = [];
  for (const [, block = ""] of items) {
    const link = block.match(/<link>([^<]+)<\/link>/)?.[1];
    const title = decodeXml(block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? "");
    const date = block.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
    const publisher = decodeXml(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "");
    if (!link) continue;
    // Google's RSS links are redirect stubs that no longer resolve without a
    // browser, so keep the headline itself as (thin, clearly attributed)
    // evidence rather than dropping the item.
    const headline = collapse(title);
    out.push({
      title: headline,
      url: link.trim(),
      snippet: publisher ? `${headline} — reported by ${collapse(publisher)}` : headline,
      publishedAt: date ? new Date(date).toISOString().slice(0, 10) : undefined,
    });
  }
  return out;
}

function byRelevance(company: Company) {
  const host = safeUrl(companyUrl(company) ?? "")?.host;
  const name = company.name.toLowerCase();
  return (a: SearchResult, b: SearchResult): number => score(b) - score(a);

  function score(item: SearchResult): number {
    let value = 0;
    if (host && item.url.includes(host)) value += 3; // own newsroom
    if (item.title.toLowerCase().includes(name)) value += 2;
    if (item.publishedAt) value += 1;
    return value;
  }
}

function normalizeKey(url: string): string {
  const parsed = safeUrl(url);
  if (!parsed) return url;
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
