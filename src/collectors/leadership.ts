import { companyUrl, type Company } from "../models/company.js";
import { makeEvidence, truncateContent, type Evidence } from "../models/evidence.js";
import { fetchText } from "../util/http.js";
import { isHtml, parsePage, safeUrl } from "../util/html.js";
import { log } from "../util/logger.js";
import { mapWithConcurrency } from "../util/pool.js";
import type { SearchResult } from "../search/provider.js";
import { CollectorSkip, type CollectorContext, type ResearchSource } from "./types.js";

/**
 * What executives say in public is the closest thing to hearing the strategy
 * first hand. Only publicly accessible pages are read — no paywalled content,
 * no logged-in sources, nothing behind a registration wall we would have to
 * pretend to be a person to get past.
 */

const QUERIES = (name: string) => [
  `"${name}" CEO OR CTO interview`,
  `"${name}" CTO OR CIO OR "chief data officer" podcast OR keynote`,
  `"${name}" executive "we are investing" OR "our priority" OR "our strategy"`,
  `"${name}" leadership "engineering" OR "platform" OR "AI" transcript`,
];

/** Pages that are almost never a real interview or talk. */
const NOISE =
  /(facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|glassdoor|indeed\.com|zoominfo|rocketreach|signalhire|apollo\.io|crunchbase\.com\/search|\/login|\/signin|\/pricing)/i;

/** Content behind these usually cannot be read without a subscription. */
const PAYWALLED = /(wsj\.com|ft\.com|bloomberg\.com|businessinsider\.com|theinformation\.com|hbr\.org)/i;

const EXEC_TERMS =
  /\b(ceo|cto|cio|ciso|coo|cfo|chief (technology|information|data|executive|operating|product|security) officer|vp of|vice president|head of (engineering|platform|data|product))\b/i;

const SPEECH_TERMS = /\b(said|says|told|explains|we're|we are|our team|i think|according to)\b/i;

export function createLeadershipSource(ctx: CollectorContext): ResearchSource {
  return {
    name: "leadership",
    label: "Leadership content",
    async collect(company: Company): Promise<Evidence[]> {
      if (!ctx.search.enabled) {
        throw new CollectorSkip("no search provider configured — leadership content unavailable");
      }

      const candidates = new Map<string, SearchResult>();
      for (const query of QUERIES(company.name)) {
        const results = await ctx.search.search(query, { limit: 6 });
        for (const result of results) {
          if (NOISE.test(result.url) || PAYWALLED.test(result.url)) continue;
          candidates.set(normalizeKey(result.url), result);
        }
        if (candidates.size >= 12) break;
      }

      if (!candidates.size) throw new CollectorSkip("no public leadership content found");

      const ownHost = safeUrl(companyUrl(company) ?? "")?.host;
      const shortlist = [...candidates.values()]
        .sort((a, b) => rank(b, company, ownHost) - rank(a, company, ownHost))
        .slice(0, 6);

      const collected = await mapWithConcurrency(shortlist, 3, async (result) => {
        const response = await fetchText(result.url, { signal: ctx.signal, retries: 1, maxBytes: 1_200_000 });
        if (!response.ok || !isHtml(response.contentType, response.body)) return undefined;
        const parsed = parsePage(response.body);
        // Require both an executive reference and something that reads like
        // speech, so listicles and SEO pages fall away.
        if (!EXEC_TERMS.test(parsed.text) || !SPEECH_TERMS.test(parsed.text)) {
          log.debug("leadership", `discarded (not a talk/interview) ${result.url}`);
          return undefined;
        }
        if (parsed.text.length < 600) return undefined;
        return makeEvidence({
          sourceType: "leadership",
          title: parsed.title || result.title || result.url,
          url: response.url,
          publishedAt: parsed.publishedAt ?? result.publishedAt,
          content: truncateContent(parsed.text, 5000),
          meta: { collector: "leadership" },
        });
      });

      const evidence = collected.filter((item): item is Evidence => Boolean(item));
      if (!evidence.length) throw new CollectorSkip("candidates found but none were readable public talks");
      return evidence;
    },
  };
}

function rank(result: SearchResult, company: Company, ownHost: string | undefined): number {
  let score = 0;
  const haystack = `${result.title} ${result.snippet}`.toLowerCase();
  if (haystack.includes(company.name.toLowerCase())) score += 2;
  if (EXEC_TERMS.test(haystack)) score += 3;
  if (/\b(interview|podcast|keynote|fireside|transcript|q&a|conversation)\b/i.test(haystack)) score += 3;
  if (ownHost && result.url.includes(ownHost)) score += 1;
  if (result.publishedAt) score += 1;
  return score;
}

function normalizeKey(url: string): string {
  const parsed = safeUrl(url);
  if (!parsed) return url;
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}
