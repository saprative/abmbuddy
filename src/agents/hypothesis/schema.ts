import { z } from "zod";

export const hypothesisSchema = z.object({
  title: z.string().describe("Short label for the potential bottleneck, e.g. 'ML deployment overhead'"),
  hypothesis: z
    .string()
    .describe(
      "The potential operational problem, stated as a possibility ('may', 'appears to', 'could'), never as a known fact.",
    ),
  /** The explicit chain that got us here — this is what makes the output auditable. */
  reasoning: z.object({
    observedChange: z.string(),
    strategicInitiative: z.string(),
    resourcesCommitted: z.string(),
    operationalImplication: z.string(),
    potentialBottleneck: z.string(),
  }),
  /** What would confirm or kill this in a first conversation. */
  validationQuestions: z.array(z.string()).min(1).max(3),
  signalKeys: z.array(z.string()).default([]).describe("Keys of the signals this builds on."),
  evidenceIds: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
});

export const hypothesesSchema = z.object({
  hypotheses: z
    .array(hypothesisSchema)
    .max(3)
    .describe("The three strongest hypotheses, strongest first. Fewer if evidence is thin."),
});

export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type HypothesesResult = z.infer<typeof hypothesesSchema>;
