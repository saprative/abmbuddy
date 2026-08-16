import type { Config } from "../../config/index.js";
import type { Company } from "../../models/company.js";
import type { Evidence } from "../../models/evidence.js";
import { describeProduct, type Product } from "../../models/product.js";
import type { ExtractionResult } from "../extraction/schema.js";
import type { Hypothesis } from "../hypothesis/schema.js";
import type { Signal } from "../signals/schema.js";
import type { StakeholderMap } from "../stakeholders/schema.js";
import { defineAgent, type AgentContext, type AgentDefinition } from "../agent.js";
import { renderCompany, renderEvidenceCatalog, renderJson } from "../context.js";
import { readPrompt } from "../prompt.js";
import { createPruneReport, filterIds, knownIds, reportWarnings } from "../validate.js";
import { collateralSchema, type CollateralResult } from "./schema.js";

export type CollateralInput = {
  company: Company;
  extraction: ExtractionResult;
  signals: Signal[];
  hypothesis: Hypothesis;
  stakeholders: StakeholderMap;
  evidence: Evidence[];
  product?: Product;
  sender: Config["outreach"];
};

export function createCollateralAgent(ctx: AgentContext): AgentDefinition<CollateralInput, CollateralResult> {
  return defineAgent(
    {
      name: "collateral",
      instructions: readPrompt(import.meta.url, "collateral"),
      schema: collateralSchema,
      temperature: 0.4,
      maxOutputTokens: 6000,
      buildPrompt: ({ company, extraction, signals, hypothesis, stakeholders, evidence, product, sender }) =>
        [
          "# Company",
          renderCompany(company),
          "",
          "# The hypothesis this is about",
          renderJson(hypothesis),
          "",
          "# Signals",
          signals.length ? renderJson(signals.slice(0, 5)) : "(none)",
          "",
          "# Who it is for",
          renderJson({
            stakeholders: stakeholders.stakeholders.slice(0, 4),
            entryPoint: stakeholders.entryPoint,
          }),
          "",
          "# Strategic initiatives and leadership statements",
          renderJson({
            strategicInitiatives: extraction.strategicInitiatives.slice(0, 5),
            leadershipStatements: extraction.leadershipStatements.slice(0, 3),
          }),
          "",
          "# Evidence catalogue (cite these ids in the personalized piece)",
          renderEvidenceCatalog(evidence),
          "",
          "# What is being positioned",
          describeProduct(product, sender.valueProposition) ??
            "(nothing specified — omit the product section from both pieces)",
          sender.senderCompany ? `Written on behalf of: ${sender.senderCompany}` : "",
          `Tone: ${sender.tone}`,
          "",
          "# Task",
          "Write the personalized one-pager and the reusable general version.",
        ]
          .filter(Boolean)
          .join("\n"),
    },
    ctx,
  );
}

/**
 * The personalized piece makes claims about a real company, so its citations
 * must resolve. The general piece deliberately cites nothing.
 */
export function pruneCollateral(
  result: CollateralResult,
  evidence: Evidence[],
): { collateral: CollateralResult | undefined; warnings: string[] } {
  const known = knownIds(evidence);
  const report = createPruneReport();
  const evidenceIds = filterIds(result.personalized?.evidenceIds, known, report);
  if (!evidenceIds.length) {
    return {
      collateral: undefined,
      warnings: [
        ...reportWarnings(report, "collateral"),
        "collateral: discarded because the personalized piece cited no verifiable evidence",
      ],
    };
  }
  return {
    collateral: { ...result, personalized: { ...result.personalized, evidenceIds } },
    warnings: reportWarnings(report, "collateral"),
  };
}
