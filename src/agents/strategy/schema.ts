import { z } from "zod";

export const strategyStepSchema = z.object({
  step: z.number().int().min(1),
  channel: z.enum(["email", "linkedin", "call", "event", "referral", "community", "other"]),
  /** Who this step is aimed at — a named stakeholder or a role. */
  audience: z.string(),
  /** What this step is trying to achieve. One outcome, not three. */
  objective: z.string(),
  /** The angle, not the full copy. The outreach agent writes the words. */
  message: z.string(),
  /** When to do it, relative to the previous step or to an external trigger. */
  timing: z.string(),
  evidenceIds: z.array(z.string()),
});

export const strategySchema = z.object({
  /** The approach in one or two sentences: why this account, why now, via whom. */
  summary: z.string(),
  entryPoint: z.object({
    who: z.string(),
    rationale: z.string(),
  }),
  sequence: z
    .array(strategyStepSchema)
    .max(5)
    .describe("A short, ordered plan. Three steps beats five."),
  /** Public facts that make the approach credible when challenged. */
  proofPoints: z.array(z.string()),
  /** What could make this land badly, and what to do about it. */
  risks: z.array(z.string()),
  /**
   * What would show this account is not worth pursuing. A strategy that cannot
   * be abandoned is a wish, not a plan.
   */
  disqualifiers: z.array(z.string()),
  /** What to confirm before investing more time. */
  validationQuestions: z.array(z.string()),
});

export type AccountStrategy = z.infer<typeof strategySchema>;
