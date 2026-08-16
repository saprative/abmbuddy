import { z } from "zod";

const piece = z.object({
  title: z.string(),
  /** Who this is written for, e.g. "VP Platform Engineering". */
  audience: z.string(),
  /** One line on when a rep should send it. */
  useWhen: z.string(),
  /** The actual document, in plain Markdown. Not an outline — the real thing. */
  body: z.string(),
});

export const collateralSchema = z.object({
  /**
   * Written for this account: references its own public situation and the
   * hypothesis, and must cite the evidence it leans on.
   */
  personalized: piece.extend({
    evidenceIds: z.array(z.string()).min(1),
  }),
  /**
   * The same argument with every account-specific fact removed, so it can be
   * reused across similar accounts. Cites nothing, because it claims nothing
   * about any particular company.
   */
  general: piece.extend({
    /** The segment this version holds true for. */
    appliesTo: z.string(),
  }),
});

export type CollateralResult = z.infer<typeof collateralSchema>;
