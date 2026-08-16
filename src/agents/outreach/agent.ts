import type { Config } from "../../config/index.js";
import type { Company } from "../../models/company.js";
import type { Evidence } from "../../models/evidence.js";
import type { ExtractionResult } from "../extraction/schema.js";
import type { Hypothesis } from "../hypothesis/schema.js";
import type { Signal } from "../signals/schema.js";
import { defineAgent, type AgentContext, type AgentDefinition } from "../agent.js";
import { renderCompany, renderEvidenceCatalog, renderJson } from "../context.js";
import { readPrompt } from "../prompt.js";
import { createPruneReport, filterIds, knownIds, reportWarnings } from "../validate.js";
import { outreachSchema, type OutreachResult } from "./schema.js";

export type OutreachInput = {
  company: Company;
  extraction: ExtractionResult;
  signals: Signal[];
  hypothesis: Hypothesis;
  evidence: Evidence[];
  sender: Config["outreach"];
};

export function createOutreachAgent(ctx: AgentContext): AgentDefinition<OutreachInput, OutreachResult> {
  return defineAgent(
    {
      name: "outreach",
      instructions: readPrompt(import.meta.url, "outreach"),
      schema: outreachSchema,
      temperature: 0.5,
      maxOutputTokens: 3000,
      buildPrompt: ({ company, extraction, signals, hypothesis, evidence, sender }) =>
        [
          "# Company",
          renderCompany(company),
          "",
          "# The hypothesis this message is about",
          renderJson(hypothesis),
          "",
          "# Supporting signals",
          signals.length ? renderJson(signals.slice(0, 5)) : "(none)",
          "",
          "# Strategic initiatives and leadership statements",
          renderJson({
            strategicInitiatives: extraction.strategicInitiatives,
            recentDevelopments: extraction.recentDevelopments.slice(0, 5),
            leadershipStatements: extraction.leadershipStatements.slice(0, 5),
          }),
          "",
          "# Evidence catalogue (cite these ids)",
          renderEvidenceCatalog(evidence),
          "",
          "# Sender",
          renderSender(sender),
          "",
          "# Task",
          "Write the outreach. Observation, possible implication, question.",
        ].join("\n"),
    },
    ctx,
  );
}

function renderSender(sender: Config["outreach"]): string {
  const lines = [
    sender.senderName ? `Name: ${sender.senderName}` : "Name: (not provided — do not sign the message)",
    sender.senderCompany ? `Company: ${sender.senderCompany}` : "",
    sender.valueProposition
      ? `What they sell: ${sender.valueProposition}`
      : "What they sell: (not provided — end on the question, make no product claim)",
    `Tone: ${sender.tone}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function pruneOutreach(
  result: OutreachResult,
  evidence: Evidence[],
): { outreach: OutreachResult | undefined; warnings: string[] } {
  const known = knownIds(evidence);
  const report = createPruneReport();
  const evidenceIds = filterIds(result.evidenceIds, known, report);
  if (!evidenceIds.length) {
    return {
      outreach: undefined,
      warnings: [
        ...reportWarnings(report, "outreach"),
        "outreach: discarded because the observation it opened with could not be traced to collected evidence",
      ],
    };
  }
  return { outreach: { ...result, evidenceIds }, warnings: reportWarnings(report, "outreach") };
}
