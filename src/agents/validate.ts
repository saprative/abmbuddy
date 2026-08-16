import type { Evidence } from "../models/evidence.js";

/**
 * Provenance enforcement. Models occasionally cite an evidence id that was
 * never collected; when that happens the claim is not a fact, it is a guess
 * wearing a citation. Unknown ids are stripped and anything left without a
 * single real source is dropped before it can reach the user or HubSpot.
 */

export type PruneReport = {
  /** Ids the model cited that do not exist. */
  invented: string[];
  /** Human-readable notes about what was removed, for the run's warnings. */
  removed: string[];
};

export function createPruneReport(): PruneReport {
  return { invented: [], removed: [] };
}

export function knownIds(evidence: Evidence[]): Set<string> {
  return new Set(evidence.map((item) => item.id));
}

/** Keeps only ids that exist, recording the ones that did not. */
export function filterIds(ids: string[] | undefined, known: Set<string>, report: PruneReport): string[] {
  const kept: string[] = [];
  for (const id of ids ?? []) {
    if (known.has(id)) {
      if (!kept.includes(id)) kept.push(id);
    } else if (!report.invented.includes(id)) {
      report.invented.push(id);
    }
  }
  return kept;
}

/**
 * Prunes a list of evidence-backed items: unknown ids removed, items with no
 * surviving evidence dropped entirely.
 */
export function pruneList<T extends { evidenceIds: string[] }>(
  items: T[] | undefined,
  known: Set<string>,
  report: PruneReport,
  label: string,
): T[] {
  const out: T[] = [];
  for (const item of items ?? []) {
    const evidenceIds = filterIds(item.evidenceIds, known, report);
    if (!evidenceIds.length) {
      report.removed.push(`${label}: dropped an entry with no verifiable evidence`);
      continue;
    }
    out.push({ ...item, evidenceIds });
  }
  return out;
}

/** Summarises the report as warnings a user should actually see. */
export function reportWarnings(report: PruneReport, stage: string): string[] {
  const warnings: string[] = [];
  if (report.invented.length) {
    warnings.push(
      `${stage}: ignored ${report.invented.length} citation(s) to evidence that was never collected (${report.invented
        .slice(0, 5)
        .join(", ")}${report.invented.length > 5 ? ", …" : ""})`,
    );
  }
  const dropped = report.removed.length;
  if (dropped) warnings.push(`${stage}: dropped ${dropped} unsupported item(s)`);
  return warnings;
}
