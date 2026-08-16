import type { Company } from "../models/company.js";

/**
 * The orchestrator reports progress through these events; the CLI renders
 * them. Nothing in the pipeline writes to the terminal directly, which is what
 * keeps `--json` and `--verbose` honest.
 */
export type StepStatus = "running" | "ok" | "warn" | "skipped" | "failed";

export type ProgressEvent = {
  /** Stable key for the account within a run (id, domain, or name). */
  account: string;
  company: Company;
  /** "identity", a collector name, "extraction", "signals", "hypothesis", "outreach". */
  step: string;
  label: string;
  status: StepStatus;
  detail?: string;
};

export type ProgressHandler = (event: ProgressEvent) => void;

export function accountKey(company: Company): string {
  return company.id ?? company.domain ?? company.website ?? company.name;
}
