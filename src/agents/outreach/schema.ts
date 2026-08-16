import { z } from "zod";

export const outreachSchema = z.object({
  /** The one public thing the whole message hangs on. */
  observation: z.string().describe("The specific, verifiable public observation being referenced."),
  angle: z.string().describe("One line: why this account, why now."),
  subject: z.string().max(80),
  email: z
    .string()
    .describe("Plain text. Under 120 words. Observation -> possible implication -> question."),
  linkedinMessage: z.string().max(700).nullable(),
  conversationOpener: z
    .string()
    .describe("A single question a rep could open a live call with."),
  /** Evidence backing the observation the message leads with. */
  evidenceIds: z.array(z.string()).min(1),
});

export type OutreachResult = z.infer<typeof outreachSchema>;
