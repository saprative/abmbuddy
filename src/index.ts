/**
 * Library entry point. The CLI is the product, but the pipeline is importable
 * so contributors can embed it, test it, or drive it from their own tooling.
 */
export { researchAccount, researchAccounts, ResearchError } from "./orchestrator/index.js";
export type { ResearchOptions } from "./orchestrator/research-account.js";
export { resolveIdentity } from "./orchestrator/identity.js";
export { accountKey } from "./orchestrator/events.js";
export type { ProgressEvent, ProgressHandler, StepStatus } from "./orchestrator/events.js";

export { createSources, SOURCE_FACTORIES, CollectorSkip } from "./collectors/index.js";
export type { CollectorContext, ResearchSource, SourceFactory } from "./collectors/types.js";

export { createExtractionAgent } from "./agents/extraction/agent.js";
export { createSignalAgent } from "./agents/signals/agent.js";
export { createHypothesisAgent } from "./agents/hypothesis/agent.js";
export { createOutreachAgent } from "./agents/outreach/agent.js";
export { defineAgent, AgentError } from "./agents/agent.js";
export type { AgentContext, AgentDefinition, AgentSpec } from "./agents/agent.js";

export { extractionSchema } from "./agents/extraction/schema.js";
export { signalsSchema } from "./agents/signals/schema.js";
export { hypothesesSchema } from "./agents/hypothesis/schema.js";
export { outreachSchema } from "./agents/outreach/schema.js";

export { HubSpotProvider, createHubSpotProvider } from "./crm/hubspot.js";
export { CrmAuthError } from "./crm/provider.js";
export type { CRMProvider, ListCompaniesOptions } from "./crm/provider.js";
export { PROPERTIES, PROPERTY_GROUP, buildProperties } from "./crm/summary.js";

export { createLLMProvider } from "./llm/provider.js";
export type { LLMProvider } from "./llm/provider.js";
export { createSearchProvider } from "./search/provider.js";
export type { SearchProvider, SearchResult } from "./search/provider.js";

export { loadConfig, saveConfig, updateConfig, configSchema } from "./config/index.js";
export type { Config } from "./config/index.js";

export { companySchema, companyUrl, normalizeDomain } from "./models/company.js";
export type { Company } from "./models/company.js";
export { evidenceSchema, makeEvidence, evidenceIndex } from "./models/evidence.js";
export type { Evidence, SourceType } from "./models/evidence.js";
export type { AccountResearch, CollectorReport, ResearchOutcome } from "./models/research.js";
