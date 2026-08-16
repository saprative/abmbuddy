import type { Company } from "../../models/company.js";
import type { Evidence } from "../../models/evidence.js";
import { defineAgent, type AgentContext, type AgentDefinition } from "../agent.js";
import { DEFAULT_EVIDENCE_BUDGET, renderCompany, renderEvidence } from "../context.js";
import { readPrompt } from "../prompt.js";
import { createPruneReport, knownIds, pruneList, reportWarnings, type PruneReport } from "../validate.js";
import { extractionSchema, type ExtractionResult } from "./schema.js";

export type ExtractionInput = {
  company: Company;
  evidence: Evidence[];
  /** Characters of evidence text to include. Lower it for cheaper models. */
  evidenceBudget?: number;
};

export function createExtractionAgent(ctx: AgentContext): AgentDefinition<ExtractionInput, ExtractionResult> {
  return defineAgent(
    {
      name: "extraction",
      instructions: readPrompt(import.meta.url, "extraction"),
      schema: extractionSchema,
      temperature: 0.1,
      maxOutputTokens: 12_000,
      buildPrompt: ({ company, evidence, evidenceBudget }) =>
        [
          "# Company",
          renderCompany(company),
          "",
          `# Evidence (${evidence.length} items)`,
          renderEvidence(evidence, evidenceBudget ?? DEFAULT_EVIDENCE_BUDGET),
          "",
          "# Task",
          "Structure the evidence above. Cite evidence ids for every finding.",
        ].join("\n"),
    },
    ctx,
  );
}

/** Strips citations to evidence that does not exist, dropping anything left unsupported. */
export function pruneExtraction(
  result: ExtractionResult,
  evidence: Evidence[],
): { extraction: ExtractionResult; warnings: string[]; report: PruneReport } {
  const known = knownIds(evidence);
  const report = createPruneReport();
  const extraction: ExtractionResult = {
    strategicInitiatives: pruneList(result.strategicInitiatives, known, report, "strategic initiative"),
    recentDevelopments: pruneList(result.recentDevelopments, known, report, "recent development"),
    operationalPriorities: pruneList(result.operationalPriorities, known, report, "operational priority"),
    technologyStack: pruneList(result.technologyStack, known, report, "technology"),
    engineeringInvestment: pruneList(result.engineeringInvestment, known, report, "engineering investment"),
    hiringPatterns: pruneList(result.hiringPatterns, known, report, "hiring pattern"),
    leadershipStatements: pruneList(result.leadershipStatements, known, report, "leadership statement"),
    metrics: pruneList(result.metrics, known, report, "metric"),
    knownProblems: pruneList(result.knownProblems, known, report, "known problem"),
    coverageGaps: result.coverageGaps ?? [],
  };
  return { extraction, warnings: reportWarnings(report, "extraction"), report };
}
