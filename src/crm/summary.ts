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

  const properties: Record<string, string> = {
    abmbuddy_last_scan: research.finishedAt,
  };
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
