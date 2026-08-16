import type { Config } from "../config/index.js";
import type { Company } from "../models/company.js";
import type { Evidence } from "../models/evidence.js";
import type { SearchProvider } from "../search/provider.js";

/**
 * Collectors are deterministic modules, not agents. They fetch public pages
 * and turn them into Evidence. They never call a model and never draw a
 * conclusion.
 */
export interface ResearchSource {
  /** Stable key: "website", "sec", "news", "jobs", "leadership". */
  name: string;
  /** What the CLI shows while it runs. */
  label: string;
  collect(company: Company): Promise<Evidence[]>;
}

export type CollectorContext = {
  config: Config;
  search: SearchProvider;
  signal?: AbortSignal;
};

export type SourceFactory = (ctx: CollectorContext) => ResearchSource;

/**
 * Thrown by a collector when it has nothing to do for this company — a private
 * company has no SEC filings, a company with no domain has no website to read.
 * The orchestrator renders these as "not applicable", not as failures.
 */
export class CollectorSkip extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CollectorSkip";
  }
}
