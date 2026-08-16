import { companySlug, normalizeDomain, type Company } from "../models/company.js";
import { makeEvidence, truncateContent, type Evidence } from "../models/evidence.js";
import { fetchJson, fetchText } from "../util/http.js";
import { collapse, htmlToText } from "../util/html.js";
import { log } from "../util/logger.js";
import { CollectorSkip, type CollectorContext, type ResearchSource } from "./types.js";

/**
 * EDGAR requires a User-Agent that identifies you and contains a contact
 * address, and it rejects anything that looks like a crawler or carries a
 * source-repository URL. Set a real address — `abmbuddy config`, or
 * ABMBUDDY_SEC_USER_AGENT — if you query it regularly.
 */
const FALLBACK_SEC_CONTACT = "abmbuddy@users.noreply.local";

export function secHeaders(contact?: string): Record<string, string> {
  const custom = process.env.ABMBUDDY_SEC_USER_AGENT;
  const address = contact?.trim() || FALLBACK_SEC_CONTACT;
  return {
    "user-agent": custom || `ABMBuddy/0.1 ${address}`,
    accept: "application/json,text/html;q=0.9",
  };
}

/** Sections of a filing that actually say something about how a business runs. */
const SECTION_PATTERNS: Array<[string, RegExp]> = [
  ["Business", /item\s*1\s*[.:—-]?\s*business/i],
  ["Risk Factors", /item\s*1a\s*[.:—-]?\s*risk\s*factors/i],
  ["MD&A", /item\s*[27]\s*[.:—-]?\s*management'?s?\s*discussion/i],
];

const PRIORITY_TERMS = [
  "strategic",
  "strategy",
  "priorit",
  "invest",
  "initiativ",
  "efficien",
  "cost reduction",
  "cost savings",
  "restructur",
  "automation",
  "artificial intelligence",
  " ai ",
  "machine learning",
  "data platform",
  "cloud",
  "modernizat",
  "engineering",
  "technology",
  "platform",
  "supply chain",
  "expansion",
  "international",
  "headcount",
  "hiring",
  "talent",
  "security",
  "compliance",
  "integration",
  "migrat",
  "scalab",
  "capacity",
  "bottleneck",
  "manual process",
];

type CompanyTickerEntry = { cik_str: number; ticker: string; title: string };

type SubmissionsResponse = {
  cik?: string;
  name?: string;
  tickers?: string[];
  sicDescription?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      reportDate?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
};

export function createSecSource(ctx: CollectorContext): ResearchSource {
  return {
    name: "sec",
    label: "SEC filings",
    async collect(company: Company): Promise<Evidence[]> {
      if (!ctx.config.research.includeSec) throw new CollectorSkip("SEC collection disabled in config");

      const SEC_HEADERS = secHeaders(ctx.config.research.secContact);
      const cik = company.cik ?? (await resolveCik(company, ctx.config.research.secContact));
      if (!cik) throw new CollectorSkip("no SEC filer found (likely not a US public company)");

      const submissions = await fetchJson<SubmissionsResponse>(
        `https://data.sec.gov/submissions/CIK${cik}.json`,
        { headers: SEC_HEADERS },
      );
      const recent = submissions?.filings?.recent;
      if (!recent?.form?.length) throw new CollectorSkip(`no filings listed for CIK ${cik}`);

      const filings = selectFilings(recent);
      if (!filings.length) throw new CollectorSkip("no recent 10-K/10-Q/8-K filings");

      const evidence: Evidence[] = [];
      for (const filing of filings) {
        const url = filingUrl(cik, filing.accession, filing.document);
        const response = await fetchText(url, { headers: SEC_HEADERS, maxBytes: 12_000_000, signal: ctx.signal });
        if (!response.ok || !response.body) {
          log.debug("sec", `could not fetch ${url}`);
          continue;
        }
        const text = collapse(htmlToText(response.body));
        const excerpt = excerptFiling(text, filing.form);
        if (!excerpt) continue;
        evidence.push(
          makeEvidence({
            sourceType: "sec",
            title: `${submissions?.name ?? company.name} ${filing.form} (filed ${filing.filingDate})`,
            url,
            publishedAt: filing.filingDate,
            content: excerpt,
            meta: { collector: "sec", form: filing.form, cik, accession: filing.accession },
          }),
        );
      }

      if (!evidence.length) throw new CollectorSkip("filings found but no readable content");
      return evidence;
    },
  };
}

/**
 * Resolves a company to a CIK using EDGAR's ticker file. Matching is
 * conservative: an exact normalized-name or ticker hit only. A wrong CIK is
 * far worse than no SEC evidence at all.
 */
export async function resolveCik(company: Company, contact?: string): Promise<string | undefined> {
  const tickers = await fetchJson<Record<string, CompanyTickerEntry>>(
    "https://www.sec.gov/files/company_tickers.json",
    { headers: secHeaders(contact), maxBytes: 8_000_000 },
  );
  if (!tickers) return undefined;

  const wanted = companySlug(company.name);
  const wantedTicker = company.ticker?.toUpperCase();
  if (!wanted && !wantedTicker) return undefined;

  for (const entry of Object.values(tickers)) {
    if (!entry?.cik_str) continue;
    if (wantedTicker && entry.ticker?.toUpperCase() === wantedTicker) return pad(entry.cik_str);
    if (wanted && companySlug(entry.title ?? "") === wanted) return pad(entry.cik_str);
  }
  return undefined;
}

/** Enriches a company record with ticker/CIK when EDGAR knows it. */
export async function resolveSecIdentity(
  company: Company,
  contact?: string,
): Promise<{ cik?: string; ticker?: string }> {
  const cik = await resolveCik(company, contact);
  if (!cik) return {};
  const submissions = await fetchJson<SubmissionsResponse>(
    `https://data.sec.gov/submissions/CIK${cik}.json`,
    { headers: secHeaders(contact) },
  );
  // Guard against a same-name match on a different business.
  const filerSite = normalizeDomain((submissions as { website?: string } | undefined)?.website);
  const recordSite = normalizeDomain(company.domain ?? company.website);
  if (filerSite && recordSite && filerSite !== recordSite) return {};
  return { cik, ticker: submissions?.tickers?.[0] };
}

function pad(cik: number | string): string {
  return String(cik).padStart(10, "0");
}

type SelectedFiling = { form: string; accession: string; document: string; filingDate: string };

function selectFilings(recent: NonNullable<NonNullable<SubmissionsResponse["filings"]>["recent"]>): SelectedFiling[] {
  const forms = recent.form ?? [];
  const rows: SelectedFiling[] = forms.map((form, i) => ({
    form,
    accession: (recent.accessionNumber?.[i] ?? "").replace(/-/g, ""),
    document: recent.primaryDocument?.[i] ?? "",
    filingDate: recent.filingDate?.[i] ?? "",
  }));

  const usable = rows.filter((r) => r.accession && r.document);
  const annual = usable.find((r) => r.form === "10-K" || r.form === "20-F");
  const quarterly = usable.find((r) => r.form === "10-Q");
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const current = usable.filter((r) => r.form === "8-K" && r.filingDate >= cutoff).slice(0, 3);

  return [annual, quarterly, ...current].filter((r): r is SelectedFiling => Boolean(r));
}

function filingUrl(cik: string, accession: string, document: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${document}`;
}

/**
 * A 10-K can be a million characters. Keep the sections that describe how the
 * business operates, then, inside those, the paragraphs that mention something
 * operationally interesting.
 */
function excerptFiling(text: string, form: string): string | undefined {
  if (text.length < 500) return undefined;
  const budget = form === "8-K" ? 6000 : 18000;
  if (text.length <= budget) return text;

  const sections = sliceSections(text);
  const pool = sections.length ? sections : [{ name: form, body: text }];

  const chunks: string[] = [];
  let used = 0;
  for (const section of pool) {
    const paragraphs = section.body
      .split(/\n{2,}|(?<=\.)\s{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 180);
    const scored = paragraphs
      .map((p) => ({ p, score: scoreParagraph(p) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const share = Math.floor(budget / pool.length);
    let sectionUsed = 0;
    const picked: string[] = [];
    for (const { p } of scored) {
      if (sectionUsed + p.length > share) continue;
      picked.push(p);
      sectionUsed += p.length;
    }
    if (!picked.length) continue;
    chunks.push(`## ${section.name}\n\n${picked.join("\n\n")}`);
    used += sectionUsed;
    if (used >= budget) break;
  }

  if (!chunks.length) return truncateContent(text, budget);
  return truncateContent(chunks.join("\n\n"), budget);
}

function sliceSections(text: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  for (const [name, pattern] of SECTION_PATTERNS) {
    // Filings repeat item headings in the table of contents; the real section
    // is the last occurrence, which is followed by actual prose.
    const matches = [...text.matchAll(new RegExp(pattern.source, "gi"))];
    const start = matches.at(-1)?.index;
    if (start === undefined) continue;
    out.push({ name, body: text.slice(start, start + 120_000) });
  }
  return out;
}

function scoreParagraph(paragraph: string): number {
  const lower = ` ${paragraph.toLowerCase()} `;
  let score = 0;
  for (const term of PRIORITY_TERMS) {
    if (lower.includes(term)) score += 1;
  }
  return score;
}
