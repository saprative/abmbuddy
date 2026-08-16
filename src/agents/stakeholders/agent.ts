import type { Company } from "../../models/company.js";
import { renderContacts, type Contact } from "../../models/contact.js";
import type { Evidence } from "../../models/evidence.js";
import type { Product } from "../../models/product.js";
import type { ExtractionResult } from "../extraction/schema.js";
import type { Hypothesis } from "../hypothesis/schema.js";
import type { Signal } from "../signals/schema.js";
import { defineAgent, type AgentContext, type AgentDefinition } from "../agent.js";
import { renderCompany, renderEvidenceCatalog, renderJson } from "../context.js";
import { readPrompt } from "../prompt.js";
import { createPruneReport, filterIds, knownIds, reportWarnings } from "../validate.js";
import { stakeholderMapSchema, type Stakeholder, type StakeholderMap } from "./schema.js";

export type StakeholderInput = {
  company: Company;
  extraction: ExtractionResult;
  signals: Signal[];
  hypothesis: Hypothesis;
  evidence: Evidence[];
  /** People already on the account. Identity and role only — never contact details. */
  contacts: Contact[];
  product?: Product;
};

export function createStakeholderAgent(ctx: AgentContext): AgentDefinition<StakeholderInput, StakeholderMap> {
  return defineAgent(
    {
      name: "stakeholders",
      instructions: readPrompt(import.meta.url, "stakeholders"),
      schema: stakeholderMapSchema,
      temperature: 0.2,
      maxOutputTokens: 5000,
      buildPrompt: ({ company, extraction, signals, hypothesis, evidence, contacts, product }) =>
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
          "# Named people and functions found in public evidence",
          renderJson({
            leadershipStatements: extraction.leadershipStatements,
            hiringPatterns: extraction.hiringPatterns,
            engineeringInvestment: extraction.engineeringInvestment.slice(0, 5),
          }),
          "",
          "# Contacts already on this account in the CRM",
          renderContacts(contacts),
          "",
          "# Evidence catalogue (cite these ids)",
          renderEvidenceCatalog(evidence),
          ...(product ? ["", "# What the user sells (context only)", product.name] : []),
          "",
          "# Task",
          "Map who would feel, fund, evaluate or block this specific problem.",
        ].join("\n"),
    },
    ctx,
  );
}

/**
 * Enforces the two standards of proof: a CRM stakeholder must point at a real
 * contact, and a public or inferred one must cite real evidence. Anything that
 * satisfies neither is a name the model made up, and is dropped.
 */
export function pruneStakeholders(
  result: StakeholderMap,
  evidence: Evidence[],
  contacts: Contact[],
): { map: StakeholderMap; warnings: string[] } {
  const known = knownIds(evidence);
  const contactIds = new Set(contacts.map((contact) => contact.id));
  const report = createPruneReport();
  const kept: Stakeholder[] = [];

  for (const stakeholder of result.stakeholders ?? []) {
    const evidenceIds = filterIds(stakeholder.evidenceIds, known, report);
    const crmContactId =
      stakeholder.crmContactId && contactIds.has(stakeholder.crmContactId)
        ? stakeholder.crmContactId
        : undefined;

    if (stakeholder.crmContactId && !crmContactId) {
      report.removed.push("stakeholder: referenced a CRM contact that does not exist");
      continue;
    }
    if (stakeholder.source === "crm") {
      if (!crmContactId) {
        report.removed.push("stakeholder: claimed to be a CRM contact but named no record");
        continue;
      }
    } else if (!evidenceIds.length) {
      report.removed.push(`stakeholder: dropped ${stakeholder.name ?? "an unnamed entry"} with no evidence`);
      continue;
    }

    kept.push({
      ...stakeholder,
      evidenceIds,
      ...(crmContactId ? { crmContactId } : { crmContactId: null }),
    });
  }

  return {
    map: {
      stakeholders: kept.sort((a, b) => b.confidence - a.confidence),
      entryPoint: result.entryPoint ?? null,
      gaps: result.gaps ?? [],
    },
    warnings: reportWarnings(report, "stakeholders"),
  };
}
