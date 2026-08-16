import type { Company } from "../../models/company.js";
import type { Evidence } from "../../models/evidence.js";
import type { ExtractionResult } from "../extraction/schema.js";
import type { Signal } from "../signals/schema.js";
import { defineAgent, type AgentContext, type AgentDefinition } from "../agent.js";
import { renderCompany, renderEvidenceCatalog, renderJson } from "../context.js";
import { readPrompt } from "../prompt.js";
import { createPruneReport, knownIds, pruneList, reportWarnings } from "../validate.js";
import { hypothesesSchema, type HypothesesResult, type Hypothesis } from "./schema.js";

export type HypothesisInput = {
  company: Company;
  extraction: ExtractionResult;
  signals: Signal[];
  evidence: Evidence[];
  /** What the user sells. Used to rank, never to invent. */
  sellerContext?: string;
};

export function createHypothesisAgent(ctx: AgentContext): AgentDefinition<HypothesisInput, HypothesesResult> {
  return defineAgent(
    {
      name: "hypothesis",
      instructions: readPrompt(import.meta.url, "hypothesis"),
      schema: hypothesesSchema,
      temperature: 0.3,
      maxOutputTokens: 6000,
      buildPrompt: ({ company, extraction, signals, evidence, sellerContext }) =>
        [
          "# Company",
          renderCompany(company),
          "",
          "# Signals",
          signals.length ? renderJson(signals) : "(no signals detected)",
          "",
          "# Structured findings",
          renderJson(extraction),
          "",
          "# Evidence catalogue (cite these ids)",
          renderEvidenceCatalog(evidence),
          ...(sellerContext
            ? [
                "",
                "# Seller context (for ranking relevance only — never mention it)",
                sellerContext,
              ]
            : []),
          "",
          "# Task",
          "Work the reasoning chain and return the strongest evidence-backed hypotheses.",
        ].join("\n"),
    },
    ctx,
  );
}

export function pruneHypotheses(
  result: HypothesesResult,
  evidence: Evidence[],
  signals: Signal[],
): { hypotheses: Hypothesis[]; warnings: string[] } {
  const known = knownIds(evidence);
  const signalKeys = new Set(signals.map((signal) => signal.key));
  const report = createPruneReport();
  const hypotheses = pruneList(result.hypotheses, known, report, "hypothesis")
    .map((hypothesis) => ({
      ...hypothesis,
      signalKeys: (hypothesis.signalKeys ?? []).filter((key) => signalKeys.has(key)),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
  return { hypotheses, warnings: reportWarnings(report, "hypothesis") };
}
