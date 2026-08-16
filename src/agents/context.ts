import type { Company } from "../models/company.js";
import type { Evidence } from "../models/evidence.js";

/**
 * Rendering helpers shared by the agents. Every evidence item is presented
 * with its id on the first line, because the id is what downstream findings
 * must cite — a finding that cannot name its evidence does not survive.
 */

/** Total characters of evidence text handed to a single model call. */
export const DEFAULT_EVIDENCE_BUDGET = 140_000;

export function renderCompany(company: Company): string {
  const facts = [
    `Name: ${company.name}`,
    company.domain || company.website ? `Website: ${company.domain ?? company.website}` : "",
    company.industry ? `Industry: ${company.industry}` : "",
    [company.city, company.country].filter(Boolean).length
      ? `Location: ${[company.city, company.country].filter(Boolean).join(", ")}`
      : "",
    company.employeeCount ? `Employees (per CRM): ${company.employeeCount}` : "",
    company.annualRevenue ? `Annual revenue (per CRM): ${company.annualRevenue}` : "",
    company.ticker ? `Ticker: ${company.ticker}` : "",
    company.description ? `CRM description: ${company.description}` : "",
  ].filter(Boolean);
  return facts.join("\n");
}

/**
 * Full evidence with content, fair-shared across items so one enormous 10-K
 * cannot crowd out twelve job postings. Small items keep their whole text and
 * hand their unused allowance back to the large ones.
 */
export function renderEvidence(evidence: Evidence[], budget = DEFAULT_EVIDENCE_BUDGET): string {
  if (!evidence.length) return "(no evidence collected)";
  const overhead = evidence.length * 160;
  const shares = allocate(
    evidence.map((item) => item.content.length),
    Math.max(2000, budget - overhead),
  );
  return evidence
    .map((item, index) => {
      const header = [
        `[${item.id}] ${item.sourceType.toUpperCase()} — ${item.title}`,
        `url: ${item.url}`,
        item.publishedAt ? `published: ${item.publishedAt}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const share = shares[index] ?? 0;
      const body =
        item.content.length <= share
          ? item.content
          : `${item.content.slice(0, share).trimEnd()}\n[truncated]`;
      return `${header}\n\n${body}`;
    })
    .join("\n\n----------------------------------------\n\n");
}

/**
 * Id, type, title, date and URL only. Given to the later agents so they can
 * cite evidence they are not re-reading in full.
 */
export function renderEvidenceCatalog(evidence: Evidence[]): string {
  if (!evidence.length) return "(no evidence collected)";
  return evidence
    .map((item) => {
      const date = item.publishedAt ? ` · ${item.publishedAt}` : "";
      return `[${item.id}] ${item.sourceType}${date} · ${item.title} · ${item.url}`;
    })
    .join("\n");
}

/** Pretty-prints an agent result for the next agent's prompt. */
export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Water-filling: everyone gets an equal share, whatever they do not use is
 * redistributed to those still over their share, repeated until stable.
 */
function allocate(sizes: number[], budget: number): number[] {
  const shares = new Array<number>(sizes.length).fill(0);
  let remaining = budget;
  let open = sizes.map((_, index) => index);

  while (open.length && remaining > 0) {
    const share = Math.floor(remaining / open.length);
    if (share <= 0) break;
    const next: number[] = [];
    let used = 0;
    for (const index of open) {
      const size = sizes[index] as number;
      if (size <= share) {
        shares[index] = size;
        used += size;
      } else {
        next.push(index);
      }
    }
    if (!next.length || next.length === open.length) {
      for (const index of next) shares[index] = share;
      remaining = 0;
      break;
    }
    remaining -= used;
    open = next;
  }
  return shares;
}
