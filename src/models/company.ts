import { z } from "zod";

/**
 * A company as ABMBuddy sees it. The CRM (HubSpot) is the system of record —
 * this is only the slice of the record the research pipeline needs, plus
 * whatever the identity-resolution step manages to work out.
 */
export const companySchema = z.object({
  /** CRM record id. Absent for ad-hoc `abmbuddy research stripe.com` runs. */
  id: z.string().optional(),
  name: z.string(),
  domain: z.string().optional(),
  website: z.string().optional(),
  description: z.string().optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  employeeCount: z.number().optional(),
  annualRevenue: z.number().optional(),
  linkedinUrl: z.string().optional(),
  /** Set by identity resolution when the company looks like a US filer. */
  ticker: z.string().optional(),
  cik: z.string().optional(),
  /** Which provider the record came from ("hubspot", "cli", ...). */
  source: z.string().default("cli"),
});

export type Company = z.infer<typeof companySchema>;

/** Normalizes anything that looks like a domain or URL down to a bare host. */
export function normalizeDomain(input: string | undefined): string | undefined {
  if (!input) return undefined;
  let value = input.trim().toLowerCase();
  if (!value) return undefined;
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0] ?? value;
  value = value.split("?")[0] ?? value;
  value = value.replace(/[.,;]+$/, "");
  if (!value.includes(".") || value.includes(" ")) return undefined;
  return value;
}

/** Best-effort https URL for a company's site. */
export function companyUrl(company: Company): string | undefined {
  const domain = normalizeDomain(company.domain ?? company.website);
  return domain ? `https://${domain}` : undefined;
}

/** "Acme Corp, Inc." -> "acme" — used to guess ATS board tokens. */
export function companySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(
      /\b(inc|llc|ltd|limited|corp|corporation|company|co|plc|gmbh|sa|ag|nv|bv|holdings|group|technologies|technology|labs|software)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
