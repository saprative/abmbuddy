import { z } from "zod";

const evidenceIds = z
  .array(z.string())
  .min(1)
  .describe("Ids of the evidence items that directly support this. Never empty, never invented.");

const confidence = z
  .number()
  .min(0)
  .max(1)
  .describe("0-1. How well the cited evidence supports the statement.");

const finding = z.object({
  statement: z.string().describe("One sentence, factual, no sales framing."),
  evidenceIds,
  confidence,
});

export const extractionSchema = z.object({
  /** Where the company says it is going. */
  strategicInitiatives: z.array(finding).default([]),
  /** Things that happened recently: launches, acquisitions, funding, exec changes. */
  recentDevelopments: z.array(finding).default([]),
  /** What the company is actively working on operationally right now. */
  operationalPriorities: z.array(finding).default([]),
  /** Named technologies observed in evidence (job posts, engineering blog, filings). */
  technologyStack: z
    .array(
      z.object({
        technology: z.string(),
        evidenceIds,
        mentions: z.number().int().min(1).describe("How many distinct evidence items mention it."),
      }),
    )
    .default([]),
  /** Observable investment in engineering: team growth, platform work, tooling. */
  engineeringInvestment: z.array(finding).default([]),
  /** Patterns across job postings, not summaries of individual listings. */
  hiringPatterns: z
    .array(
      z.object({
        pattern: z.string().describe("e.g. 'Concentrated hiring for ML platform roles'"),
        roleCount: z.number().int().min(0).describe("Roles observed supporting this pattern."),
        functions: z.array(z.string()).default([]),
        seniority: z.array(z.string()).default([]),
        evidenceIds,
        confidence,
      }),
    )
    .default([]),
  /** Direct, quotable public statements from named leaders. */
  leadershipStatements: z
    .array(
      z.object({
        speaker: z.string(),
        role: z.string().optional(),
        quote: z.string().describe("Verbatim or near-verbatim from the evidence."),
        topic: z.string(),
        evidenceIds,
      }),
    )
    .default([]),
  /** Numbers the company itself published. */
  metrics: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        period: z.string().optional(),
        evidenceIds,
      }),
    )
    .default([]),
  /** Problems the company or its filings openly acknowledge. */
  knownProblems: z.array(finding).default([]),
  /** What the evidence did NOT cover, so later stages know their blind spots. */
  coverageGaps: z.array(z.string()).default([]),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
