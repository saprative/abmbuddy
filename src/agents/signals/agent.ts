import type { Company } from "../../models/company.js";
import type { Evidence } from "../../models/evidence.js";
import type { ExtractionResult } from "../extraction/schema.js";
import { defineAgent, type AgentContext, type AgentDefinition } from "../agent.js";
import { renderCompany, renderEvidenceCatalog, renderJson } from "../context.js";
import { readPrompt } from "../prompt.js";
import { createPruneReport, knownIds, pruneList, reportWarnings } from "../validate.js";
import { signalsSchema, type Signal, type SignalsResult } from "./schema.js";

export type SignalInput = {
  company: Company;
  extraction: ExtractionResult;
  evidence: Evidence[];
};

export function createSignalAgent(ctx: AgentContext): AgentDefinition<SignalInput, SignalsResult> {
  return defineAgent(
    {
      name: "signals",
      instructions: readPrompt(import.meta.url, "signals"),
      schema: signalsSchema,
      temperature: 0.2,
      maxOutputTokens: 6000,
      buildPrompt: ({ company, extraction, evidence }) =>
        [
          "# Company",
          renderCompany(company),
          "",
          "# Structured findings",
          renderJson(extraction),
          "",
          "# Evidence catalogue (cite these ids)",
          renderEvidenceCatalog(evidence),
          "",
          "# Task",
          "Identify the patterns visible across these findings. Multi-source patterns first.",
        ].join("\n"),
    },
    ctx,
  );
}

export function pruneSignals(
  result: SignalsResult,
  evidence: Evidence[],
): { signals: Signal[]; warnings: string[] } {
  const known = knownIds(evidence);
  const report = createPruneReport();
  const signals = pruneList(result.signals, known, report, "signal").sort(
    (a, b) => b.confidence - a.confidence,
  );
  return { signals, warnings: reportWarnings(report, "signals") };
}
