import { companyUrl, type Company } from "../models/company.js";
import { makeEvidence, truncateContent, type Evidence } from "../models/evidence.js";
import { renderPage } from "../util/browser.js";
import { fetchText } from "../util/http.js";
import { extractLinks, isHtml, looksEmpty, parsePage, safeUrl } from "../util/html.js";
import { log } from "../util/logger.js";
import { mapWithConcurrency } from "../util/pool.js";
import { CollectorSkip, type CollectorContext, type ResearchSource } from "./types.js";

/**
 * Pages worth reading, most valuable first. Scores decide crawl order when the
 * page budget is smaller than the number of candidate links.
 */
const PATH_SCORES: Array<[RegExp, number]> = [
  [/\/(about|company|who-we-are)(\/|$)/i, 9],
  [/\/(leadership|team|executives|management|our-people)(\/|$)/i, 9],
  [/\/(investors?|investor-relations|ir)(\/|$)/i, 8],
  [/\/(news|newsroom|press|press-releases|media)(\/|$)/i, 8],
  [/\/(engineering|developers?|tech|technology|architecture)(\/|$)/i, 8],
  [/\/(products?|platform|solutions?|capabilities)(\/|$)/i, 7],
  [/\/(blog|insights|resources\/blog)(\/|$)/i, 6],
  [/\/(customers?|case-studies?|success-stories)(\/|$)/i, 5],
  [/\/(pricing|plans)(\/|$)/i, 4],
  [/\/(careers?|jobs)(\/|$)/i, 4],
  [/\/(security|trust|compliance)(\/|$)/i, 3],
];

const SKIP_PATH = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|mp4|mp3|css|js)(\?|$)|\/(privacy|terms|legal|cookie|login|signin|signup|support\/ticket)/i;

const ANCHOR_HINTS = /(about|company|leadership|team|product|platform|solution|engineering|blog|news|press|investor|technology|customer)/i;

export function createCompanyWebSource(ctx: CollectorContext): ResearchSource {
  return {
    name: "website",
    label: "Company website",
    async collect(company: Company): Promise<Evidence[]> {
      const base = companyUrl(company);
      if (!base) throw new CollectorSkip("no website domain on the record");

      const home = await load(base, ctx);
      if (!home) throw new CollectorSkip(`could not reach ${base}`);

      const budget = ctx.config.research.maxPages;
      const candidates = rankLinks(home.html, home.url).slice(0, Math.max(0, budget - 1));
      const extra = await sitemapCandidates(home.url, ctx, budget);
      const urls = dedupe([...candidates.map((c) => c.url), ...extra]).slice(0, budget - 1);

      log.debug("website", `crawling ${urls.length + 1} pages on ${home.url}`);

      const pages = await mapWithConcurrency(urls, 4, async (url) => load(url, ctx));
      const evidence: Evidence[] = [];

      for (const page of [home, ...pages]) {
        if (!page) continue;
        const parsed = parsePage(page.html);
        const body = parsed.text;
        if (looksEmpty(body)) continue;
        evidence.push(
          makeEvidence({
            sourceType: "website",
            title: parsed.title,
            url: page.url,
            publishedAt: parsed.publishedAt,
            content: truncateContent(
              parsed.description ? `${parsed.description}\n\n${body}` : body,
              6000,
            ),
            meta: { collector: "website" },
          }),
        );
      }

      return evidence;
    },
  };
}

type LoadedPage = { url: string; html: string };

async function load(url: string, ctx: CollectorContext): Promise<LoadedPage | undefined> {
  const response = await fetchText(url, { signal: ctx.signal, maxBytes: 1_500_000 });
  if (response.ok && isHtml(response.contentType, response.body)) {
    const parsed = parsePage(response.body);
    if (!looksEmpty(parsed.text) || !ctx.config.research.useBrowserFallback) {
      return { url: response.url, html: response.body };
    }
    // Client-rendered shell: retry with a real browser if the user has one.
    const rendered = await renderPage(url);
    if (rendered) return { url: response.url, html: rendered };
    return { url: response.url, html: response.body };
  }
  if (!response.ok && ctx.config.research.useBrowserFallback) {
    const rendered = await renderPage(url);
    if (rendered) return { url, html: rendered };
  }
  return undefined;
}

type ScoredLink = { url: string; score: number };

function rankLinks(html: string, baseUrl: string): ScoredLink[] {
  const links = extractLinks(html, baseUrl);
  const scored: ScoredLink[] = [];
  for (const link of links) {
    if (SKIP_PATH.test(link.url)) continue;
    const path = safeUrl(link.url)?.pathname ?? "";
    if (path === "/" || path === "") continue;
    let score = 0;
    for (const [pattern, weight] of PATH_SCORES) {
      if (pattern.test(path)) score = Math.max(score, weight);
    }
    if (score === 0 && ANCHOR_HINTS.test(link.text)) score = 2;
    if (score === 0) continue;
    // Prefer section landing pages over deep permalinks.
    const depth = path.split("/").filter(Boolean).length;
    scored.push({ url: link.url, score: score - Math.max(0, depth - 2) });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/** A sitemap often exposes the newsroom and blog index a homepage hides. */
async function sitemapCandidates(baseUrl: string, ctx: CollectorContext, budget: number): Promise<string[]> {
  const origin = safeUrl(baseUrl)?.origin;
  if (!origin) return [];
  const response = await fetchText(`${origin}/sitemap.xml`, { signal: ctx.signal, retries: 0, maxBytes: 800_000 });
  if (!response.ok || !response.body.includes("<loc")) return [];
  const locs = [...response.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1] as string);
  const interesting = locs.filter((url) => !SKIP_PATH.test(url) && PATH_SCORES.some(([p]) => p.test(url)));
  return interesting.slice(0, Math.max(0, Math.floor(budget / 2)));
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const key = url.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}
