import assert from "node:assert/strict";
import test from "node:test";
import { renderEvidence, renderEvidenceCatalog } from "../src/agents/context.ts";
import { createPruneReport, filterIds, knownIds, pruneList, reportWarnings } from "../src/agents/validate.ts";
import { buildProperties, PROPERTIES } from "../src/crm/summary.ts";
import { companySlug, normalizeDomain } from "../src/models/company.ts";
import { makeEvidence, resetEvidenceIds, truncateContent } from "../src/models/evidence.ts";
import type { AccountResearch } from "../src/models/research.ts";

test("normalizeDomain accepts the shapes a CRM record actually contains", () => {
  assert.equal(normalizeDomain("https://www.Stripe.com/pricing?x=1"), "stripe.com");
  assert.equal(normalizeDomain("stripe.com/"), "stripe.com");
  assert.equal(normalizeDomain("Stripe"), undefined);
  assert.equal(normalizeDomain(""), undefined);
  assert.equal(normalizeDomain(undefined), undefined);
});

test("companySlug strips legal suffixes so board tokens can be guessed", () => {
  assert.equal(companySlug("Acme Corp, Inc."), "acme");
  assert.equal(companySlug("Datadog, Inc."), "datadog");
  assert.equal(companySlug("Snowflake Technologies Limited"), "snowflake");
});

test("evidence pruning removes invented citations and unsupported items", () => {
  resetEvidenceIds();
  const evidence = [
    makeEvidence({ sourceType: "website", title: "About", url: "https://a.test", content: "x" }),
  ];
  const known = knownIds(evidence);
  const report = createPruneReport();

  assert.deepEqual(filterIds(["ev_1", "ev_1", "ev_404"], known, report), ["ev_1"]);
  assert.deepEqual(report.invented, ["ev_404"]);

  const kept = pruneList(
    [
      { statement: "supported", evidenceIds: ["ev_1"] },
      { statement: "invented", evidenceIds: ["ev_777"] },
    ],
    known,
    report,
    "finding",
  );
  assert.deepEqual(
    kept.map((item) => item.statement),
    ["supported"],
  );
  const warnings = reportWarnings(report, "extraction");
  assert.equal(warnings.length, 2);
  assert.match(warnings[0] as string, /ev_404/);
});

test("evidence rendering fair-shares the budget and always shows ids", () => {
  resetEvidenceIds();
  const evidence = [
    makeEvidence({ sourceType: "sec", title: "10-K", url: "https://sec.test", content: "L".repeat(50_000) }),
    makeEvidence({ sourceType: "job", title: "Engineer", url: "https://jobs.test", content: "short posting" }),
  ];
  const rendered = renderEvidence(evidence, 5000);
  assert.ok(rendered.includes("[ev_1]"));
  assert.ok(rendered.includes("[ev_2]"));
  // The small item survives whole; the large one is trimmed, not dropped.
  assert.ok(rendered.includes("short posting"));
  assert.ok(rendered.includes("[truncated]"));
  assert.ok(rendered.length < 12_000);

  const catalog = renderEvidenceCatalog(evidence);
  assert.ok(catalog.includes("[ev_1] sec"));
  assert.ok(!catalog.includes("LLLL"));
});

test("truncateContent cuts on a boundary and marks the cut", () => {
  const text = `${"Sentence one. ".repeat(40)}\n\nTail paragraph.`;
  const cut = truncateContent(text, 200);
  assert.ok(cut.length <= 220);
  assert.ok(cut.endsWith("[truncated]"));
});

test("HubSpot write-back stays concise and only sends known properties", () => {
  resetEvidenceIds();
  const evidence = [
    makeEvidence({ sourceType: "job", title: "ML Engineer", url: "https://jobs.test/1", content: "x" }),
  ];
  const research: AccountResearch = {
    company: { id: "1", name: "Acme", source: "hubspot" },
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:05:00.000Z",
    collectors: [],
    evidence,
    extraction: {
      strategicInitiatives: [{ statement: "Platform expansion", evidenceIds: ["ev_1"], confidence: 0.8 }],
      recentDevelopments: [],
      operationalPriorities: [],
      technologyStack: [],
      engineeringInvestment: [],
      hiringPatterns: [],
      leadershipStatements: [],
      metrics: [],
      knownProblems: [],
      coverageGaps: [],
    },
    signals: [
      {
        name: "ML hiring",
        key: "ml_hiring",
        description: "Concentrated ML hiring.",
        observations: ["7 roles"],
        direction: "increasing",
        evidenceIds: ["ev_1"],
        confidence: 0.9,
      },
    ],
    hypotheses: [
      {
        title: "Deployment overhead",
        hypothesis: "Hiring may be outpacing tooling.",
        reasoning: {
          observedChange: "7 roles",
          strategicInitiative: "Platform expansion",
          resourcesCommitted: "Headcount",
          operationalImplication: "More models in production",
          potentialBottleneck: "Deployment throughput",
        },
        validationQuestions: ["How long to production?"],
        signalKeys: ["ml_hiring"],
        evidenceIds: ["ev_1"],
        confidence: 0.755,
      },
    ],
    warnings: [],
  };

  const properties = buildProperties(research);
  const allowed = new Set(PROPERTIES.map((property) => property.name));
  for (const name of Object.keys(properties)) assert.ok(allowed.has(name), `${name} is not a declared property`);
  assert.equal(properties.abmbuddy_hypothesis_confidence, "76");
  assert.equal(properties.abmbuddy_last_scan, "2026-01-01T00:05:00.000Z");
  assert.ok(properties.abmbuddy_top_hypothesis?.includes("https://jobs.test/1"));
  // Scraped page content never goes to the CRM.
  for (const value of Object.values(properties)) assert.ok(value.length <= 2000);
});
