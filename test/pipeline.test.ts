import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { configSchema } from "../src/config/index.ts";
import { CollectorSkip, type ResearchSource } from "../src/collectors/types.ts";
import { makeEvidence, resetEvidenceIds } from "../src/models/evidence.ts";
import { researchAccount } from "../src/orchestrator/research-account.ts";
import type { LLMProvider } from "../src/llm/provider.ts";
import type { ProgressEvent } from "../src/orchestrator/events.ts";
import type { SearchProvider } from "../src/search/provider.ts";

/**
 * End-to-end orchestration with a scripted model and stubbed collectors: no
 * network, no API key, but the real ordering, the real schemas and the real
 * provenance rules.
 */

const company = { name: "Acme Robotics", domain: "acme.test", source: "test" };

const config = configSchema.parse({
  research: { includeSec: false, cache: false },
  outreach: { senderName: "Sam", senderCompany: "Toolco", valueProposition: "Deployment tooling." },
});

const search: SearchProvider = {
  name: "none",
  label: "none",
  enabled: false,
  async search() {
    return [];
  },
};

function stubSources(): ResearchSource[] {
  return [
    {
      name: "website",
      label: "Company website",
      async collect() {
        return [
          makeEvidence({
            sourceType: "website",
            title: "Acme Robotics — About",
            url: "https://acme.test/about",
            content: "Acme Robotics builds warehouse automation. We are expanding our platform team.",
          }),
        ];
      },
    },
    {
      name: "jobs",
      label: "Engineering jobs",
      async collect() {
        return [
          makeEvidence({
            sourceType: "job",
            title: "Acme hiring summary (12 roles)",
            url: "https://boards.test/acme",
            content: "12 technical roles. Roles by domain: ml/ai (7), infrastructure (5).",
          }),
        ];
      },
    },
    {
      name: "sec",
      label: "SEC filings",
      async collect(): Promise<never> {
        throw new CollectorSkip("not a US public company");
      },
    },
    {
      name: "news",
      label: "Recent developments",
      async collect(): Promise<never> {
        throw new Error("upstream timeout");
      },
    },
  ];
}

/** Returns the scripted JSON for whichever agent is calling. */
function scriptedModel(responses: Record<string, unknown>): LLMProvider {
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const text = JSON.stringify(prompt);
      const agent = text.includes("Structure the evidence above")
        ? "extraction"
        : text.includes("Identify the patterns")
          ? "signals"
          : text.includes("reasoning chain")
            ? "hypothesis"
            : "outreach";
      return {
        content: [{ type: "text" as const, text: JSON.stringify(responses[agent]) }],
        finishReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        warnings: [],
      };
    },
  });
  return {
    name: "openai",
    modelId: "mock",
    model: () => model,
    describe: () => "mock model",
  };
}

const responses = {
  extraction: {
    strategicInitiatives: [
      { statement: "Expanding the platform team", evidenceIds: ["ev_1"], confidence: 0.8 },
      // Cites evidence that was never collected: must not survive.
      { statement: "Acquiring a competitor", evidenceIds: ["ev_99"], confidence: 0.9 },
    ],
    recentDevelopments: [],
    operationalPriorities: [],
    technologyStack: [{ technology: "kubernetes", evidenceIds: ["ev_2"], mentions: 5 }],
    engineeringInvestment: [],
    hiringPatterns: [
      {
        pattern: "Concentrated ML platform hiring",
        roleCount: 7,
        functions: ["ml"],
        seniority: ["senior"],
        evidenceIds: ["ev_2"],
        confidence: 0.7,
      },
    ],
    leadershipStatements: [],
    metrics: [],
    knownProblems: [],
    coverageGaps: ["no filings"],
  },
  signals: {
    signals: [
      {
        name: "ML platform expansion",
        key: "ml_platform_expansion",
        description: "Hiring concentrated in ML platform roles.",
        observations: ["7 ml/ai roles", "platform team expansion on the website"],
        direction: "increasing",
        evidenceIds: ["ev_1", "ev_2"],
        confidence: 0.82,
      },
    ],
  },
  hypothesis: {
    hypotheses: [
      {
        title: "ML deployment overhead",
        hypothesis: "Rapid ML hiring may be outpacing deployment tooling.",
        reasoning: {
          observedChange: "7 ML roles open",
          strategicInitiative: "Platform team expansion",
          resourcesCommitted: "Senior ML platform headcount",
          operationalImplication: "More models reaching production",
          potentialBottleneck: "Deployment and governance throughput",
        },
        validationQuestions: ["How long does a model take to reach production today?"],
        signalKeys: ["ml_platform_expansion", "invented_key"],
        evidenceIds: ["ev_2"],
        confidence: 0.74,
      },
    ],
  },
  outreach: {
    observation: "Seven open ML platform roles alongside a stated platform expansion.",
    angle: "Hiring pace suggests deployment throughput pressure.",
    subject: "ml platform hiring",
    email: "Saw seven ML platform roles open. Often that shows up as deployment queueing. How long does a model take to reach production today?",
    conversationOpener: "What does it take to get a model into production at Acme today?",
    evidenceIds: ["ev_2"],
  },
};

test("runs the full pipeline and keeps only evidence-backed conclusions", async () => {
  resetEvidenceIds();
  const events: ProgressEvent[] = [];
  const research = await researchAccount(company, {
    config,
    llm: scriptedModel(responses),
    search,
    sources: stubSources(),
    onProgress: (event) => events.push(event),
  });

  // Collector outcomes are reported individually and never fail the account.
  const byName = new Map(research.collectors.map((collector) => [collector.name, collector]));
  assert.equal(byName.get("website")?.status, "ok");
  assert.equal(byName.get("sec")?.status, "skipped");
  assert.equal(byName.get("news")?.status, "failed");
  assert.equal(research.evidence.length, 2);

  // The fabricated citation is dropped, the supported one survives.
  assert.deepEqual(
    research.extraction.strategicInitiatives.map((item) => item.statement),
    ["Expanding the platform team"],
  );
  assert.ok(research.warnings.some((warning) => warning.includes("ev_99")));

  assert.equal(research.signals.length, 1);
  assert.equal(research.hypotheses.length, 1);
  // Signal keys are pruned to signals that actually exist.
  assert.deepEqual(research.hypotheses[0]?.signalKeys, ["ml_platform_expansion"]);
  assert.ok(research.outreach?.subject);

  // Stages run in the documented order.
  const order = events.filter((event) => event.status === "running").map((event) => event.step);
  assert.deepEqual(
    order.filter((step) => ["identity", "extraction", "signals", "hypothesis", "outreach"].includes(step)),
    ["identity", "extraction", "signals", "hypothesis", "outreach"],
  );
});

test("an account with no collectable evidence fails cleanly", async () => {
  resetEvidenceIds();
  await assert.rejects(
    researchAccount(company, {
      config,
      llm: scriptedModel(responses),
      search,
      sources: [
        {
          name: "website",
          label: "Company website",
          async collect(): Promise<never> {
            throw new CollectorSkip("no website");
          },
        },
      ],
    }),
    /No public evidence/,
  );
});

test("outreach is skipped when no hypothesis clears the bar", async () => {
  resetEvidenceIds();
  const research = await researchAccount(company, {
    config,
    llm: scriptedModel({ ...responses, hypothesis: { hypotheses: [] } }),
    search,
    sources: stubSources(),
  });
  assert.equal(research.hypotheses.length, 0);
  assert.equal(research.outreach, undefined);
});
