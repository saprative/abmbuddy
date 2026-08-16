import type { Config } from "../../config/index.js";
import type { Company } from "../../models/company.js";
import type { Evidence } from "../../models/evidence.js";
import { describeProduct, type Product } from "../../models/product.js";
import type { Hypothesis } from "../hypothesis/schema.js";
import type { Signal } from "../signals/schema.js";
import type { StakeholderMap } from "../stakeholders/schema.js";
import { defineAgent, type AgentContext, type AgentDefinition } from "../agent.js";
import { renderCompany, renderEvidenceCatalog, renderJson } from "../context.js";
import { readPrompt } from "../prompt.js";
import { createPruneReport, filterIds, knownIds, reportWarnings } from "../validate.js";
import { strategySchema, type AccountStrategy } from "./schema.js";

export type StrategyInput = {
  company: Company;
  hypothesis: Hypothesis;
  signals: Signal[];
  stakeholders: StakeholderMap;
  evidence: Evidence[];
  product?: Product;
  sender: Config["outreach"];
};

export function createStrategyAgent(ctx: AgentContext): AgentDefinition<StrategyInput, AccountStrategy> {
  return defineAgent(
    {
      name: "strategy",
      instructions: readPrompt(import.meta.url, "strategy"),
      schema: strategySchema,
      temperature: 0.3,
      maxOutputTokens: 5000,
      buildPrompt: ({ company, hypothesis, signals, stakeholders, evidence, product, sender }) =>
        [
          "# Company",
          renderCompany(company),
          "",
          "# The hypothesis being pursued",
          renderJson(hypothesis),
          "",
          "# Signals",
          signals.length ? renderJson(signals.slice(0, 5)) : "(none)",
          "",
          "# Stakeholder map",
          renderJson(stakeholders),
          "",
          "# Evidence catalogue (cite these ids)",
          renderEvidenceCatalog(evidence),
          "",
          "# What is being positioned",
          describeProduct(product, sender.valueProposition) ??
            "(not specified — plan the approach around learning, and make no product claims)",
          `Tone: ${sender.tone}`,
          "",
          "# Task",
          "Plan how to approach this account: entry point, a short sequence, and what would call it off.",
        ].join("\n"),
    },
    ctx,
  );
}

export function pruneStrategy(
  result: AccountStrategy,
  evidence: Evidence[],
): { strategy: AccountStrategy; warnings: string[] } {
  const known = knownIds(evidence);
  const report = createPruneReport();
  // A step without a citation is still a legitimate plan — only the citations
  // themselves have to be real.
  const sequence = (result.sequence ?? [])
    .map((step) => ({ ...step, evidenceIds: filterIds(step.evidenceIds, known, report) }))
    .sort((a, b) => a.step - b.step);
  return {
    strategy: { ...result, sequence },
    warnings: reportWarnings(report, "strategy"),
  };
}
