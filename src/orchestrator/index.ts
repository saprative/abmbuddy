import type { Company } from "../models/company.js";
import type { ResearchOutcome } from "../models/research.js";
import { mapWithConcurrency } from "../util/pool.js";
import { errorMessage } from "../util/logger.js";
import { researchAccount, type ResearchOptions } from "./research-account.js";

/**
 * Runs the per-account pipeline across a selection, at a deliberately modest
 * concurrency. One account failing never stops the others.
 */
export async function researchAccounts(
  companies: Company[],
  options: ResearchOptions & {
    /** Receives the outcome plus the *input* record, whose key the progress UI uses. */
    onAccount?: (outcome: ResearchOutcome, input: Company) => void;
  },
): Promise<ResearchOutcome[]> {
  const concurrency = Math.max(1, Math.min(options.config.research.concurrency, 20));
  return mapWithConcurrency(companies, concurrency, async (company): Promise<ResearchOutcome> => {
    let outcome: ResearchOutcome;
    try {
      outcome = { ok: true, research: await researchAccount(company, options) };
    } catch (error) {
      outcome = { ok: false, failure: { company, error: errorMessage(error) } };
    }
    options.onAccount?.(outcome, company);
    return outcome;
  });
}

export { researchAccount, ResearchError, type ResearchOptions } from "./research-account.js";
export { resolveIdentity } from "./identity.js";
export { accountKey, type ProgressEvent, type ProgressHandler, type StepStatus } from "./events.js";
