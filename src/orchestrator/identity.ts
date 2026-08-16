import { companySlug, normalizeDomain, type Company } from "../models/company.js";
import { resolveSecIdentity } from "../collectors/sec.js";
import type { SearchProvider } from "../search/provider.js";
import { fetchText } from "../util/http.js";
import { isHtml, parsePage, safeUrl } from "../util/html.js";
import { log } from "../util/logger.js";

/**
 * Identity resolution: work out which company on the public internet we are
 * actually researching, before a single collector runs. Getting this wrong
 * poisons everything downstream, so every guess has to be verified against the
 * page it points at.
 */

const NOISE_HOSTS =
  /(linkedin|facebook|twitter|x\.com|instagram|youtube|wikipedia|crunchbase|glassdoor|indeed|bloomberg|zoominfo|pitchbook|owler|dnb\.com|apollo\.io)/i;

const TLDS = ["com", "io", "ai", "co", "net"];

export type IdentityContext = {
  search: SearchProvider;
  signal?: AbortSignal;
  /** Skip the SEC lookup (it costs two requests per company). */
  includeSec?: boolean;
  /** Contact address for EDGAR's required User-Agent. */
  secContact?: string;
};

export type IdentityResult = {
  company: Company;
  warnings: string[];
};

export async function resolveIdentity(input: Company, ctx: IdentityContext): Promise<IdentityResult> {
  const warnings: string[] = [];
  let company: Company = { ...input };

  const known = normalizeDomain(company.domain ?? company.website);
  if (known) {
    company.domain = known;
  } else {
    const found = await discoverDomain(company, ctx);
    if (found) {
      company.domain = found;
      log.debug("identity", `${company.name} -> ${found}`);
    } else {
      warnings.push(
        "No website could be resolved for this account — website, jobs and newsroom collection will be limited.",
      );
    }
  }

  // A CLI target like "stripe.com" arrives with the domain as its name.
  if (company.domain && looksLikeDomainName(company.name)) {
    const better = await siteCompanyName(company.domain, ctx);
    if (better) company = { ...company, name: better };
  }

  if (ctx.includeSec !== false && !company.cik) {
    try {
      const sec = await resolveSecIdentity(company, ctx.secContact);
      if (sec.cik) company = { ...company, cik: sec.cik, ticker: sec.ticker ?? company.ticker };
    } catch (error) {
      log.debug("identity", `SEC identity lookup failed: ${String(error)}`);
    }
  }

  return { company, warnings };
}

/** Search first when a provider is available, then fall back to guessing TLDs. */
async function discoverDomain(company: Company, ctx: IdentityContext): Promise<string | undefined> {
  if (ctx.search.enabled) {
    const results = await ctx.search.search(`"${company.name}" official website`, { limit: 6 });
    for (const result of results) {
      const host = safeUrl(result.url)?.host;
      const domain = normalizeDomain(host);
      if (!domain || NOISE_HOSTS.test(domain)) continue;
      if (await siteMatches(domain, company, ctx)) return domain;
    }
  }

  const slug = companySlug(company.name);
  if (!slug || slug.length < 3) return undefined;
  for (const tld of TLDS) {
    const candidate = `${slug}.${tld}`;
    if (await siteMatches(candidate, company, ctx)) return candidate;
  }
  return undefined;
}

/**
 * A domain only counts if the page it serves actually looks like this company:
 * a guessed domain that belongs to somebody else is worse than no domain.
 */
async function siteMatches(domain: string, company: Company, ctx: IdentityContext): Promise<boolean> {
  const response = await fetchText(`https://${domain}`, { signal: ctx.signal, retries: 0, maxBytes: 900_000 });
  if (!response.ok || !isHtml(response.contentType, response.body)) return false;
  const parsed = parsePage(response.body);
  const haystack = `${parsed.title} ${parsed.description ?? ""} ${parsed.text.slice(0, 4000)}`.toLowerCase();
  const tokens = company.name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  if (!tokens.length) return false;
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length >= 0.6;
}

/**
 * Reads the real company name off its own homepage for domain-only targets.
 * Titles are unreliable in both directions — "Stripe | Financial
 * Infrastructure" leads with the brand, "Cloud Monitoring as a Service |
 * Datadog" trails it — so prefer og:site_name and otherwise pick the segment
 * that matches the domain.
 */
async function siteCompanyName(domain: string, ctx: IdentityContext): Promise<string | undefined> {
  const response = await fetchText(`https://${domain}`, { signal: ctx.signal, retries: 0, maxBytes: 900_000 });
  if (!response.ok || !isHtml(response.contentType, response.body)) return undefined;
  const parsed = parsePage(response.body);

  const declared = clean(parsed.siteName);
  if (declared) return declared;

  const segments = parsed.title
    .split(/[|\-–—:·]|\s{3,}/)
    .map((segment) => clean(segment))
    .filter((segment): segment is string => Boolean(segment));
  if (!segments.length) return undefined;

  // The domain is the strongest hint at which segment is the brand.
  const host = domain.split(".")[0]?.toLowerCase() ?? "";
  const matching = segments.find(
    (segment) => host.length > 2 && segment.toLowerCase().replace(/[^a-z0-9]/g, "").includes(host),
  );
  return matching ?? segments[0];
}

function clean(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text || text.length < 2 || text.length > 60) return undefined;
  if (/^(home|welcome|homepage|official site|untitled page)$/i.test(text)) return undefined;
  return text;
}

function looksLikeDomainName(name: string): boolean {
  return Boolean(normalizeDomain(name)) && !name.includes(" ");
}

const STOP_WORDS = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "company",
  "the",
  "and",
  "group",
  "holdings",
  "technologies",
  "solutions",
]);
