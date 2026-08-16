import type { Company } from "../models/company.js";
import type { AccountResearch } from "../models/research.js";

/**
 * The CRM boundary. HubSpot is the only implementation today; a Salesforce or
 * Pipedrive provider is a new file that satisfies this interface and nothing
 * in the research pipeline needs to know it exists.
 */
export interface CRMProvider {
  /** Stable key, e.g. "hubspot". */
  readonly name: string;
  /** Shown in the CLI, e.g. "HubSpot". */
  readonly label: string;
  /** Verifies stored credentials, refreshing them if the provider supports it. */
  connect(): Promise<void>;
  /** Every company the connected account can see, paginated internally. */
  getCompanies(options?: ListCompaniesOptions): Promise<Company[]>;
  /** Writes a concise summary of a completed research run back to the record. */
  updateCompany(companyId: string, result: AccountResearch): Promise<void>;
  /** Human-readable connection detail for `abmbuddy config`. */
  describe(): Promise<string>;
}

export type ListCompaniesOptions = {
  /** Stop after this many records. Undefined means "everything". */
  limit?: number;
  /** Server-side name/domain search. Undefined means "all companies". */
  query?: string;
  /** Called after each page so the CLI can show progress on large portals. */
  onPage?: (loaded: number) => void;
  signal?: AbortSignal;
};

export class CrmAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmAuthError";
  }
}
