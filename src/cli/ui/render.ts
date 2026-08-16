import { evidenceIndex, type Evidence } from "../../models/evidence.js";
import type { AccountResearch } from "../../models/research.js";
import {
  confidenceColor,
  heading,
  pad,
  pc,
  percent,
  rule,
  symbols,
  truncate,
  width,
  wrap,
} from "./theme.js";

/**
 * The account brief. Every conclusion on screen is followed by where it came
 * from — if a line cannot show its sources, it should not have survived this
 * far.
 */
export function renderResearch(research: AccountResearch): string {
  const index = evidenceIndex(research.evidence);
  const out: string[] = [];

  out.push("");
  out.push(pc.bold(research.company.name.toUpperCase()));
  const meta = [
    research.company.domain,
    research.company.industry,
    research.company.ticker ? `NYSE/NASDAQ: ${research.company.ticker}` : undefined,
    `${research.evidence.length} sources`,
  ].filter(Boolean);
  out.push(pc.dim(meta.join(" · ")));
  out.push(rule());

  const initiatives = research.extraction.strategicInitiatives.slice(0, 6);
  if (initiatives.length) {
    out.push(heading("Strategic initiatives"));
    for (const item of initiatives) {
      out.push(`${symbols.bullet} ${wrap(item.statement, 2).trimStart()}`);
    }
    out.push("");
  }

  if (research.signals.length) {
    out.push(heading("Signals"));
    for (const signal of research.signals.slice(0, 8)) {
      const mark = signal.direction === "decreasing" ? "↓" : signal.direction === "steady" ? "→" : symbols.up;
      out.push(
        pad(
          `${pc.cyan(mark)} ${signal.name}`,
          confidenceColor(signal.confidence)(percent(signal.confidence)),
        ),
      );
      out.push(pc.dim(wrap(truncate(signal.observations.join(" · "), 220), 2)));
    }
    out.push("");
  }

  const tech = research.extraction.technologyStack
    .slice()
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 12);
  if (tech.length) {
    out.push(heading("Technology"));
    out.push(wrap(tech.map((item) => `${item.technology} (${item.mentions})`).join("  ")));
    out.push("");
  }

  const hiring = research.extraction.hiringPatterns.slice(0, 4);
  if (hiring.length) {
    out.push(heading("Hiring patterns"));
    for (const pattern of hiring) {
      out.push(`${symbols.bullet} ${pattern.pattern} ${pc.dim(`(${pattern.roleCount} roles)`)}`);
    }
    out.push("");
  }

  if (research.hypotheses.length) {
    out.push(heading("Potential bottlenecks"));
    research.hypotheses.forEach((hypothesis, position) => {
      out.push(
        pad(
          `${position + 1}. ${pc.bold(hypothesis.title)}`,
          confidenceColor(hypothesis.confidence)(percent(hypothesis.confidence)),
        ),
      );
      out.push(wrap(hypothesis.hypothesis, 3));
      out.push(pc.dim(wrap(`Why: ${hypothesis.reasoning.observedChange} → ${hypothesis.reasoning.operationalImplication} → ${hypothesis.reasoning.potentialBottleneck}`, 3)));
      if (hypothesis.validationQuestions.length) {
        out.push(pc.dim(wrap(`Ask: ${hypothesis.validationQuestions.join(" / ")}`, 3)));
      }
      out.push(pc.dim("   Evidence:"));
      out.push(...evidenceLines(hypothesis.evidenceIds, index, 4));
      out.push("");
    });
  } else {
    out.push(pc.dim("No hypothesis met the evidence bar for this account."));
    out.push("");
  }

  if (research.outreach) {
    out.push(heading("Recommended outreach"));
    out.push(`${pc.dim("Observation:")} ${wrap(research.outreach.observation, 0).trimStart()}`);
    out.push("");
    out.push(`${pc.dim("Subject:")} ${pc.bold(research.outreach.subject)}`);
    out.push("");
    out.push(wrap(research.outreach.email));
    out.push("");
    if (research.outreach.linkedinMessage) {
      out.push(pc.dim("LinkedIn:"));
      out.push(pc.dim(wrap(research.outreach.linkedinMessage, 2)));
      out.push("");
    }
    out.push(`${pc.dim("Opener:")} ${research.outreach.conversationOpener}`);
    out.push("");
  }

  out.push(renderSourceSummary(research));
  if (research.warnings.length) {
    out.push("");
    out.push(pc.yellow(`${symbols.warn} ${research.warnings.length} note(s):`));
    for (const warning of research.warnings.slice(0, 6)) {
      out.push(pc.dim(wrap(`- ${warning}`, 2)));
    }
  }
  out.push("");
  return out.join("\n");
}

function renderSourceSummary(research: AccountResearch): string {
  const parts = research.collectors.map((collector) => {
    const label = `${collector.name}`;
    if (collector.status === "ok") return pc.green(`${label} ${collector.evidenceCount}`);
    if (collector.status === "skipped") return pc.dim(`${label} –`);
    if (collector.status === "failed") return pc.red(`${label} ✗`);
    return pc.yellow(`${label} 0`);
  });
  return pc.dim("Sources: ") + parts.join(pc.dim(" · "));
}

/** Two dim lines per source: what it is, then where to check it. */
function evidenceLines(ids: string[], index: Map<string, Evidence>, limit: number): string[] {
  const lines: string[] = [];
  for (const id of ids.slice(0, limit)) {
    const item = index.get(id);
    if (!item) continue;
    lines.push(pc.dim(`   ${symbols.arrow} ${sourceLabel(item)}: ${truncate(item.title, 60)}`));
    lines.push(pc.dim(`     ${truncate(item.url, Math.max(40, width() - 6))}`));
  }
  return lines;
}

function sourceLabel(evidence: Evidence): string {
  switch (evidence.sourceType) {
    case "job":
      return "Job posting";
    case "sec":
      return "SEC filing";
    case "press":
      return "Press";
    case "leadership":
      return "Leadership";
    case "website":
      return "Company site";
    default:
      return "Source";
  }
}

/** One-line summary used by the progress renderer when an account finishes. */
export function summarize(research: AccountResearch): string {
  const bits = [
    `${research.evidence.length} sources`,
    `${research.signals.length} signals`,
    `${research.hypotheses.length} hypotheses`,
  ];
  if (research.outreach) bits.push("outreach ready");
  return bits.join(", ");
}
