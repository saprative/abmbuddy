import { z } from "zod";

export const sourceTypeSchema = z.enum([
  "website",
  "sec",
  "press",
  "job",
  "leadership",
  "other",
]);

export type SourceType = z.infer<typeof sourceTypeSchema>;

/**
 * The unit of provenance. Every downstream finding, signal, hypothesis and
 * outreach line has to point back at one of these by id — agents are never
 * allowed to drop the link between a claim and where it came from.
 */
export const evidenceSchema = z.object({
  id: z.string(),
  sourceType: sourceTypeSchema,
  title: z.string(),
  url: z.string(),
  publishedAt: z.string().optional(),
  content: z.string(),
  /** Collector-specific extras (ATS name, filing form type, ...). Never sent as fact. */
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

let counter = 0;

/** Short, stable-within-a-run evidence id: ev_1, ev_2, ... */
export function nextEvidenceId(): string {
  counter += 1;
  return `ev_${counter}`;
}

/** Test/CLI helper so separate runs in one process restart numbering. */
export function resetEvidenceIds(): void {
  counter = 0;
}

export function makeEvidence(input: Omit<Evidence, "id">): Evidence {
  return { id: nextEvidenceId(), ...input };
}

/**
 * Trims evidence text so a full account's evidence fits in one model call.
 * Cuts on a paragraph boundary where possible rather than mid-sentence.
 */
export function truncateContent(text: string, maxChars: number): string {
  const clean = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= maxChars) return clean;
  const head = clean.slice(0, maxChars);
  const lastBreak = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf(". "));
  const cut = lastBreak > maxChars * 0.6 ? head.slice(0, lastBreak) : head;
  return `${cut.trim()}\n\n[truncated]`;
}

/** Index for resolving evidenceIds back to sources when rendering results. */
export function evidenceIndex(evidence: Evidence[]): Map<string, Evidence> {
  return new Map(evidence.map((e) => [e.id, e]));
}
