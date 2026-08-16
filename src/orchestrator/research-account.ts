import { createCollateralAgent, pruneCollateral } from "../agents/collateral/agent.js";
import { createExtractionAgent, pruneExtraction } from "../agents/extraction/agent.js";
import { createHypothesisAgent, pruneHypotheses } from "../agents/hypothesis/agent.js";
import { createOutreachAgent, pruneOutreach } from "../agents/outreach/agent.js";
import { createSignalAgent, pruneSignals } from "../agents/signals/agent.js";
import { createStakeholderAgent, pruneStakeholders } from "../agents/stakeholders/agent.js";
import { createStrategyAgent, pruneStrategy } from "../agents/strategy/agent.js";
import type { AgentContext } from "../agents/agent.js";
import { createSources } from "../collectors/index.js";
import { CollectorSkip, type CollectorContext, type ResearchSource } from "../collectors/types.js";
import type { Config } from "../config/index.js";
import type { LLMProvider } from "../llm/provider.js";
import type { Company } from "../models/company.js";
import type { Contact } from "../models/contact.js";
import { describeProduct, type Product } from "../models/product.js";
import type { Evidence } from "../models/evidence.js";
import type { AccountResearch, CollectorReport } from "../models/research.js";
import type { SearchProvider } from "../search/provider.js";
import { errorMessage, log } from "../util/logger.js";
import { accountKey, type ProgressHandler } from "./events.js";
import { resolveIdentity } from "./identity.js";

/**
 * The orchestrator. It owns execution order and nothing else: collectors fetch,
 * agents reason, and neither of them decides what runs next. Read this file top
 * to bottom and you have read the whole product.
 */

export type ResearchOptions = {
  config: Config;
  llm: LLMProvider;
  search: SearchProvider;
  signal?: AbortSignal;
  onProgress?: ProgressHandler;
  /** Skip the outreach stage (research-only runs). */
  skipOutreach?: boolean;
  /** Skip stakeholder mapping, approach strategy or collateral. */
  skipStakeholders?: boolean;
  skipStrategy?: boolean;
  skipCollateral?: boolean;
  /** The product this run is positioned around. */
  product?: Product;
  /** Supplies CRM contacts for stakeholder mapping. Optional by design. */
  loadContacts?: (company: Company) => Promise<Contact[]>;
  /** Override the collector set — used by tests and by embedders. */
  sources?: ResearchSource[];
};

export class ResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchError";
  }
}

export async function researchAccount(input: Company, options: ResearchOptions): Promise<AccountResearch> {
  const { config, llm, search, signal, onProgress } = options;
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const key = accountKey(input);
  const report = (
    step: string,
    label: string,
    status: Parameters<ProgressHandler>[0]["status"],
    company: Company,
    detail?: string,
  ) => onProgress?.({ account: key, company, step, label, status, ...(detail ? { detail } : {}) });

  // 1. Identity ------------------------------------------------------------
  report("identity", "Resolve identity", "running", input);
  const identity = await resolveIdentity(input, {
    search,
    ...(signal ? { signal } : {}),
    includeSec: config.research.includeSec,
    ...(config.research.secContact ? { secContact: config.research.secContact } : {}),
  });
  const company = identity.company;
  warnings.push(...identity.warnings);
  report(
    "identity",
    "Resolve identity",
    identity.warnings.length ? "warn" : "ok",
    company,
    company.domain ?? "no website found",
  );

  // 2. Collect public evidence --------------------------------------------
  const collectorCtx: CollectorContext = { config, search, ...(signal ? { signal } : {}) };
  const sources = options.sources ?? createSources(collectorCtx);
  const collectors: CollectorReport[] = [];
  const evidence: Evidence[] = [];

  const websiteSource = sources.find((s) => s.name === "website");
  const otherSources = sources.filter((s) => s.name !== "website");

  const runSource = async (source: ResearchSource) => {
    report(source.name, source.label, "running", company);
    const startedMs = Date.now();
    try {
      const collected = await source.collect(company);
      const durationMs = Date.now() - startedMs;
      if (!collected.length) {
        collectors.push({ name: source.name, status: "empty", evidenceCount: 0, durationMs });
        report(source.name, source.label, "warn", company, "nothing found");
        return;
      }
      evidence.push(...collected);
      collectors.push({
        name: source.name,
        status: "ok",
        evidenceCount: collected.length,
        durationMs,
      });
      report(source.name, source.label, "ok", company, `${collected.length} items`);
    } catch (error) {
      const durationMs = Date.now() - startedMs;
      const note = errorMessage(error);
      if (error instanceof CollectorSkip) {
        collectors.push({ name: source.name, status: "skipped", evidenceCount: 0, durationMs, note });
        report(source.name, source.label, "skipped", company, note);
        return;
      }
      // One collector failing never fails the account.
      log.debug("orchestrator", `${source.name} failed for ${company.name}: ${note}`);
      collectors.push({ name: source.name, status: "failed", evidenceCount: 0, durationMs, note });
      report(source.name, source.label, "failed", company, note);
      warnings.push(`${source.label} failed: ${note}`);
    }
  };

  if (websiteSource) {
    await runSource(websiteSource);
  }

  await Promise.all(otherSources.map(runSource));

  if (!evidence.length) {
    throw new ResearchError(
      "No public evidence could be collected for this account (no reachable website, filings, news or job postings).",
    );
  }

  const agentCtx: AgentContext = { model: llm.model(), ...(signal ? { signal } : {}) };
  const product = options.product;
  const sellerContext = describeProduct(product, config.outreach.valueProposition);

  // 3. Extraction — what facts did we discover? ---------------------------
  report("extraction", "Extract evidence", "running", company);
  const extractionAgent = createExtractionAgent(agentCtx);
  const rawExtraction = await extractionAgent.run({ company, evidence });
  const { extraction, warnings: extractionWarnings } = pruneExtraction(rawExtraction, evidence);
  warnings.push(...extractionWarnings);
  report(
    "extraction",
    "Extract evidence",
    extractionWarnings.length ? "warn" : "ok",
    company,
    `${countFindings(extraction)} findings`,
  );

  // 4. Signals — what patterns are visible? -------------------------------
  report("signals", "Detect signals", "running", company);
  let signals: AccountResearch["signals"] = [];
  try {
    const raw = await createSignalAgent(agentCtx).run({ company, extraction, evidence });
    const pruned = pruneSignals(raw, evidence);
    signals = pruned.signals;
    warnings.push(...pruned.warnings);
    report("signals", "Detect signals", "ok", company, `${signals.length} signals`);
  } catch (error) {
    warnings.push(`Signal detection failed: ${errorMessage(error)}`);
    report("signals", "Detect signals", "failed", company, errorMessage(error));
  }

  // 5. Hypotheses — what problem might this indicate? ---------------------
  report("hypothesis", "Generate hypotheses", "running", company);
  let hypotheses: AccountResearch["hypotheses"] = [];
  try {
    const raw = await createHypothesisAgent(agentCtx).run({
      company,
      extraction,
      signals,
      evidence,
      ...(sellerContext ? { sellerContext } : {}),
    });
    const pruned = pruneHypotheses(raw, evidence, signals);
    hypotheses = pruned.hypotheses;
    warnings.push(...pruned.warnings);
    report(
      "hypothesis",
      "Generate hypotheses",
      hypotheses.length ? "ok" : "warn",
      company,
      `${hypotheses.length} hypotheses`,
    );
  } catch (error) {
    warnings.push(`Hypothesis generation failed: ${errorMessage(error)}`);
    report("hypothesis", "Generate hypotheses", "failed", company, errorMessage(error));
  }

  const top = hypotheses[0];

  // 6. Stakeholders — who would feel, fund, evaluate or block it? ---------
  let stakeholders: AccountResearch["stakeholders"];
  let contacts: Contact[] = [];
  if (top && !options.skipStakeholders) {
    report("stakeholders", "Map stakeholders", "running", company);
    try {
      // CRM contacts are optional context, but a portal that *cannot* be read
      // is a blind spot the user has to know about — reporting "no contacts"
      // for a permissions failure would state a fact we never established.
      if (options.loadContacts && company.id) {
        try {
          contacts = await options.loadContacts(company);
        } catch (error) {
          warnings.push(
            `CRM contacts unavailable, so the stakeholder map is public-only: ${errorMessage(error)}`,
          );
        }
      }
      const raw = await createStakeholderAgent(agentCtx).run({
        company,
        extraction,
        signals,
        hypothesis: top,
        evidence,
        contacts,
        ...(product ? { product } : {}),
      });
      const pruned = pruneStakeholders(raw, evidence, contacts);
      stakeholders = pruned.map;
      warnings.push(...pruned.warnings);
      report(
        "stakeholders",
        "Map stakeholders",
        "ok",
        company,
        `${stakeholders.stakeholders.length} people${contacts.length ? ` · ${contacts.length} from CRM` : ""}`,
      );
    } catch (error) {
      warnings.push(`Stakeholder mapping failed: ${errorMessage(error)}`);
      report("stakeholders", "Map stakeholders", "failed", company, errorMessage(error));
    }
  } else if (!options.skipStakeholders) {
    report("stakeholders", "Map stakeholders", "skipped", company, "no hypothesis to map against");
  }

  // 7. Strategy — how should we approach the account? ---------------------
  let strategy: AccountResearch["strategy"];
  if (top && stakeholders && !options.skipStrategy) {
    report("strategy", "Plan approach", "running", company);
    try {
      const raw = await createStrategyAgent(agentCtx).run({
        company,
        hypothesis: top,
        signals,
        stakeholders,
        evidence,
        ...(product ? { product } : {}),
        sender: config.outreach,
      });
      const pruned = pruneStrategy(raw, evidence);
      strategy = pruned.strategy;
      warnings.push(...pruned.warnings);
      report("strategy", "Plan approach", "ok", company, `${strategy.sequence.length} steps`);
    } catch (error) {
      warnings.push(`Approach planning failed: ${errorMessage(error)}`);
      report("strategy", "Plan approach", "failed", company, errorMessage(error));
    }
  } else if (!options.skipStrategy && top) {
    report("strategy", "Plan approach", "skipped", company, "no stakeholder map");
  }

  // 8. Outreach — how should we start the conversation? -------------------
  let outreach: AccountResearch["outreach"];
  if (options.skipOutreach) {
    report("outreach", "Generate outreach", "skipped", company, "disabled for this run");
  } else if (!top) {
    report("outreach", "Generate outreach", "skipped", company, "no hypothesis to write about");
  } else {
    report("outreach", "Generate outreach", "running", company);
    try {
      // Address whoever the approach plan chose to start with.
      const entry = strategy?.entryPoint?.who ?? stakeholders?.entryPoint?.who;
      const matched = stakeholders?.stakeholders.find(
        (person) => entry && (person.name === entry || person.title === entry),
      );
      const raw = await createOutreachAgent(agentCtx).run({
        company,
        extraction,
        signals,
        hypothesis: top,
        evidence,
        sender: config.outreach,
        ...(entry
          ? {
              recipient: {
                who: entry,
                ...(matched?.title ? { role: matched.title } : {}),
                ...(matched?.caresAbout?.length ? { caresAbout: matched.caresAbout } : {}),
              },
            }
          : {}),
        ...(product ? { product } : {}),
      });
      const pruned = pruneOutreach(raw, evidence);
      outreach = pruned.outreach;
      warnings.push(...pruned.warnings);
      report("outreach", "Generate outreach", outreach ? "ok" : "warn", company);
    } catch (error) {
      warnings.push(`Outreach generation failed: ${errorMessage(error)}`);
      report("outreach", "Generate outreach", "failed", company, errorMessage(error));
    }
  }

  // 9. Collateral — what can we actually send? ---------------------------
  let collateral: AccountResearch["collateral"];
  if (top && !options.skipCollateral) {
    report("collateral", "Generate collateral", "running", company);
    try {
      const raw = await createCollateralAgent(agentCtx).run({
        company,
        extraction,
        signals,
        hypothesis: top,
        stakeholders: stakeholders ?? { stakeholders: [], gaps: [], entryPoint: null },
        evidence,
        ...(product ? { product } : {}),
        sender: config.outreach,
      });
      const pruned = pruneCollateral(raw, evidence);
      collateral = pruned.collateral;
      warnings.push(...pruned.warnings);
      report("collateral", "Generate collateral", collateral ? "ok" : "warn", company);
    } catch (error) {
      warnings.push(`Collateral generation failed: ${errorMessage(error)}`);
      report("collateral", "Generate collateral", "failed", company, errorMessage(error));
    }
  } else if (!options.skipCollateral) {
    report("collateral", "Generate collateral", "skipped", company, "no hypothesis to write about");
  }

  return {
    company,
    startedAt,
    finishedAt: new Date().toISOString(),
    collectors,
    evidence,
    extraction,
    signals,
    hypotheses,
    ...(stakeholders ? { stakeholders } : {}),
    ...(strategy ? { strategy } : {}),
    ...(outreach ? { outreach } : {}),
    ...(collateral ? { collateral } : {}),
    ...(product ? { product } : {}),
    ...(contacts.length ? { contacts } : {}),
    warnings,
  };
}

function countFindings(extraction: AccountResearch["extraction"]): number {
  return (
    extraction.strategicInitiatives.length +
    extraction.recentDevelopments.length +
    extraction.operationalPriorities.length +
    extraction.engineeringInvestment.length +
    extraction.hiringPatterns.length +
    extraction.leadershipStatements.length +
    extraction.knownProblems.length
  );
}
