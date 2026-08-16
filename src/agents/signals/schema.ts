import { z } from "zod";

export const signalSchema = z.object({
  /** Human-readable, e.g. "AI platform expansion". */
  name: z.string(),
  /** Machine-ish key, e.g. "ai_platform_expansion". */
  key: z
    .string()
    .describe("snake_case identifier, e.g. rapid_ai_hiring, platform_modernization"),
  description: z
    .string()
    .describe("What pattern was observed, in terms of the underlying observations."),
  /** The independent observations that add up to the signal. */
  observations: z
    .array(z.string())
    .min(1)
    .describe("e.g. '14 ML job postings', '10-K discusses AI investment'"),
  direction: z
    .enum(["increasing", "steady", "decreasing"])
    
    .describe("Direction of travel implied by the evidence."),
  evidenceIds: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
});

export const signalsSchema = z.object({
  signals: z.array(signalSchema),
});

export type Signal = z.infer<typeof signalSchema>;
export type SignalsResult = z.infer<typeof signalsSchema>;
