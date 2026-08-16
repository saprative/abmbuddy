import type { CollateralResult } from "../agents/collateral/schema.js";
import type { ExtractionResult } from "../agents/extraction/schema.js";
import type { HypothesesResult } from "../agents/hypothesis/schema.js";
import type { OutreachResult } from "../agents/outreach/schema.js";
import type { SignalsResult } from "../agents/signals/schema.js";
import type { StakeholderMap } from "../agents/stakeholders/schema.js";
import type { AccountStrategy } from "../agents/strategy/schema.js";
import type { Company } from "./company.js";
import type { Contact } from "./contact.js";
import type { Evidence } from "./evidence.js";
import type { Product } from "./product.js";

export type CollectorStatus = "ok" | "empty" | "skipped" | "failed";

export type CollectorReport = {
  name: string;
  status: CollectorStatus;
  evidenceCount: number;
  durationMs: number;
  /** Why it was skipped or how it failed — surfaced in the CLI, never fed to agents as fact. */
  note?: string;
};

/** The complete output for one account. Held in memory; nothing is persisted locally. */
export type AccountResearch = {
  company: Company;
  startedAt: string;
  finishedAt: string;
  collectors: CollectorReport[];
  evidence: Evidence[];
  extraction: ExtractionResult;
  signals: SignalsResult["signals"];
  hypotheses: HypothesesResult["hypotheses"];
  /** Who would feel, fund, evaluate or block the top hypothesis. */
  stakeholders?: StakeholderMap;
  /** How to approach the account: entry point, sequence, disqualifiers. */
  strategy?: AccountStrategy;
  outreach?: OutreachResult;
  /** A personalized one-pager plus a reusable version. */
  collateral?: CollateralResult;
  /** The product this run was positioned around, when one was selected. */
  product?: Product;
  /** CRM contacts used for stakeholder mapping. Never includes contact details. */
  contacts?: Contact[];
  /** Non-fatal problems worth telling the user about. */
  warnings: string[];
};

export type ResearchFailure = {
  company: Company;
  error: string;
};

export type ResearchOutcome =
  | { ok: true; research: AccountResearch }
  | { ok: false; failure: ResearchFailure };
