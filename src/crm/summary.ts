import type { AccountResearch } from "../models/research.js";
import { evidenceIndex } from "../models/evidence.js";

/**
 * What goes back to HubSpot: a short, readable brief a rep can act on, with
 * source URLs so any claim can be checked. Never the scraped documents — the
 * CRM is not a document store, and the raw evidence is disposable by design.
 */

export const PROPERTY_GROUP = {
  name: "abmbuddy",
  label: "ABMBuddy",
} as const;

export type PropertyDefinition = {
  name: string;
  label: string;
  type: "string" | "number" | "datetime";
  fieldType: "textarea" | "text" | "number" | "date";
  description: string;
};

export const PROPERTIES: PropertyDefinition[] = [
  {
    name: "abmbuddy_last_scan",
    label: "ABMBuddy Last Scan",
    type: "datetime",
    fieldType: "date",
    description: "When ABMBuddy last researched this account.",
  },
  {
    name: "abmbuddy_strategic_initiatives",
    label: "ABMBuddy Strategic Initiatives",
    type: "string",
    fieldType: "textarea",
    description: "Publicly stated strategic initiatives found during research.",
  },
  {
    name: "abmbuddy_signals",
    label: "ABMBuddy Signals",
    type: "string",
    fieldType: "textarea",
    description: "Patterns observed across public evidence.",
  },
  {
    name: "abmbuddy_top_hypothesis",
    label: "ABMBuddy Top Hypothesis",
    type: "string",
    fieldType: "textarea",
    description: "The strongest evidence-backed hypothesis about an operational bottleneck.",
  },
  {
    name: "abmbuddy_hypothesis_confidence",
    label: "ABMBuddy Hypothesis Confidence",
    type: "number",
    fieldType: "number",
    description: "Confidence in the top hypothesis, 0-100.",
  },
  {
    name: "abmbuddy_outreach_angle",
    label: "ABMBuddy Outreach Angle",
    type: "string",
    fieldType: "textarea",
    description: "The observation and angle a first message should open with.",
  },
  {
    name: "abmbuddy_stakeholders",
    label: "ABMBuddy Stakeholders",
    type: "string",
    fieldType: "textarea",
    description: "Who would feel, fund, evaluate or block the top hypothesis.",
  },
  {
    name: "abmbuddy_approach",
    label: "ABMBuddy Approach",
    type: "string",
    fieldType: "textarea",
    description: "Entry point and the planned approach sequence.",
  },
  {
    name: "abmbuddy_product",
    label: "ABMBuddy Product",
    type: "string",
    fieldType: "text",
    description: "The product this research was positioned around.",
  },
];

/** Builds the property payload for one completed research run. */
export function buildProperties(research: AccountResearch): Record<string, string> {
  const index = evidenceIndex(research.evidence);
  const sources = (ids: string[]): string =>
    ids
      .map((id) => index.get(id)?.url)
      .filter((url): url is string => Boolean(url))
      .slice(0, 3)
      .join(" ");

  const initiatives = research.extraction.strategicInitiatives
    .slice(0, 5)
    .map((item) => `• ${item.statement}`)
    .join("\n");

  const signals = research.signals
    .slice(0, 8)
    .map((signal) => `• ${signal.name} (${pct(signal.confidence)}%) — ${signal.description}`)
    .join("\n");

  const top = research.hypotheses[0];
  const topHypothesis = top
    ? [
        top.title,
        "",
        top.hypothesis,
        "",
        `Why: ${top.reasoning.observedChange} → ${top.reasoning.operationalImplication} → ${top.reasoning.potentialBottleneck}`,
        top.validationQuestions.length ? `Ask: ${top.validationQuestions.join(" / ")}` : "",
        `Evidence: ${sources(top.evidenceIds)}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const outreach = research.outreach
    ? [
        `Observation: ${research.outreach.observation}`,
        `Angle: ${research.outreach.angle}`,
        `Opener: ${research.outreach.conversationOpener}`,
        `Subject: ${research.outreach.subject}`,
        `Evidence: ${sources(research.outreach.evidenceIds)}`,
      ].join("\n")
    : "";

  const stakeholders = research.stakeholders?.stakeholders.length
    ? research.stakeholders.stakeholders
        .slice(0, 6)
        .map((person) => {
          const who = person.name ?? person.title ?? "Unnamed role";
          const role = person.role.replace(/_/g, " ");
          const origin = person.source === "crm" ? " [CRM contact]" : "";
          return `• ${who}${person.name && person.title ? `, ${person.title}` : ""} — ${role}${origin}: ${person.rationale}`;
        })
        .join("\n")
    : "";

  const approach = research.strategy
    ? [
        research.strategy.summary,
        "",
        `Entry point: ${research.strategy.entryPoint.who} — ${research.strategy.entryPoint.rationale}`,
        ...research.strategy.sequence.map(
          (step) => `${step.step}. [${step.channel}] ${step.audience}: ${step.objective} (${step.timing})`,
        ),
        research.strategy.disqualifiers.length
          ? `Walk away if: ${research.strategy.disqualifiers.join(" / ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const properties: Record<string, string> = {
    abmbuddy_last_scan: research.finishedAt,
  };
  if (stakeholders) properties.abmbuddy_stakeholders = clamp(stakeholders);
  if (approach) properties.abmbuddy_approach = clamp(approach);
  if (research.product?.name) properties.abmbuddy_product = clamp(research.product.name, 200);
  if (initiatives) properties.abmbuddy_strategic_initiatives = clamp(initiatives);
  if (signals) properties.abmbuddy_signals = clamp(signals);
  if (topHypothesis) properties.abmbuddy_top_hypothesis = clamp(topHypothesis);
  if (top) properties.abmbuddy_hypothesis_confidence = String(pct(top.confidence));
  if (outreach) properties.abmbuddy_outreach_angle = clamp(outreach);
  return properties;
}

function pct(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

/** HubSpot accepts long text, but a CRM field nobody can read is not useful. */
function clamp(value: string, max = 2000): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
