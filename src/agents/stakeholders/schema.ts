import { z } from "zod";

/**
 * Stakeholder mapping has two kinds of source and they are not interchangeable:
 * a CRM contact is a record you already own, while a publicly identified person
 * is an inference from evidence. The schema keeps them distinguishable so the
 * display and the pruning rules can hold each to the right standard.
 */
export const stakeholderRole = z.enum([
  "economic_buyer",
  "champion",
  "technical_evaluator",
  "end_user",
  "influencer",
  "blocker",
  "unknown",
]);

export const stakeholderSchema = z.object({
  /** Omit rather than guess — an unnamed role is more useful than a wrong name. */
  name: z.string().nullable(),
  title: z.string().nullable(),
  role: stakeholderRole,
  /** Where this person came from. Drives how strictly the claim is checked. */
  source: z.enum(["crm", "public", "inferred"]),
  /** Set when this maps to a contact already on the account. */
  crmContactId: z.string().nullable(),
  /** Why they matter to this specific hypothesis, in one sentence. */
  rationale: z.string(),
  /** What this person is measured on, as far as the evidence shows. */
  caresAbout: z.array(z.string()),
  /** The angle that would land with them specifically. */
  angle: z.string().nullable(),
  /** Required for public and inferred entries; may be empty for CRM records. */
  evidenceIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const stakeholderMapSchema = z.object({
  stakeholders: z
    .array(stakeholderSchema)
    .max(8)
    .describe("The people who would decide, evaluate, or block. Most important first."),
  /** Who to approach first, and why them rather than anyone else. */
  entryPoint: z
    .object({
      who: z.string(),
      rationale: z.string(),
    })
    .nullable(),
  /** Roles nobody was found for — a known gap beats a fabricated name. */
  gaps: z
    .array(z.string())
    
    .describe("e.g. 'No economic buyer identified from public sources or the CRM'"),
});

export type Stakeholder = z.infer<typeof stakeholderSchema>;
export type StakeholderMap = z.infer<typeof stakeholderMapSchema>;
