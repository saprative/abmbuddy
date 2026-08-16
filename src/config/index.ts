import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { configDir, configFile } from "./paths.js";
import { log } from "../util/logger.js";

export const llmProviderSchema = z.enum(["openai", "anthropic", "google", "openai-compatible"]);
export type LlmProviderName = z.infer<typeof llmProviderSchema>;

export const searchProviderSchema = z.enum(["tavily", "brave", "serper", "duckduckgo", "none"]);
export type SearchProviderName = z.infer<typeof searchProviderSchema>;

/** Sensible current defaults; every one of these is overridable in config. */
export const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  openai: "gpt-5.5",
  anthropic: "claude-sonnet-5",
  google: "gemini-3.7-flash",
  "openai-compatible": "",
};

export const configSchema = z.object({
  version: z.literal(1).default(1),
  llm: z
    .object({
      provider: llmProviderSchema.optional(),
      model: z.string().optional(),
      /** Required for openai-compatible; optional override for the rest. */
      baseUrl: z.string().optional(),
      name: z.string().optional().describe("Display name for an openai-compatible endpoint."),
    })
    .prefault({}),
  crm: z
    .object({
      provider: z.literal("hubspot").optional(),
      /** "oauth" uses your own HubSpot app; "private-app" uses a pasted token. */
      authMode: z.enum(["oauth", "private-app"]).optional(),
      clientId: z.string().optional(),
      redirectPort: z.number().int().min(1024).max(65535).default(8787),
      portalId: z.string().optional(),
      connectedAt: z.string().optional(),
    })
    .prefault({}),
  search: z
    .object({
      provider: searchProviderSchema.default("none"),
    })
    .prefault({}),
  research: z
    .object({
      /** Accounts researched in parallel. Deliberately conservative. */
      concurrency: z.number().int().min(1).max(20).default(4),
      /** Pages crawled per company site. */
      maxPages: z.number().int().min(1).max(60).default(14),
      maxNewsResults: z.number().int().min(0).max(30).default(8),
      maxJobs: z.number().int().min(0).max(200).default(40),
      includeSec: z.boolean().default(true),
      /** Contact address sent to SEC EDGAR, which requires one in the User-Agent. */
      secContact: z.string().optional(),
      /** Temporary HTTP cache in the OS temp dir. Not application state. */
      cache: z.boolean().default(true),
      /** Use Playwright when a page renders empty over plain HTTP (if installed). */
      useBrowserFallback: z.boolean().default(false),
    })
    .prefault({}),
  outreach: z
    .object({
      senderName: z.string().optional(),
      senderCompany: z.string().optional(),
      /** What you sell, in one or two sentences. Drives relevance of the ask. */
      valueProposition: z.string().optional(),
      tone: z.enum(["direct", "consultative", "casual"]).default("direct"),
    })
    .prefault({}),
  hubspot: z
    .object({
      /** Write results back without asking, for non-interactive runs. */
      autoWriteBack: z.boolean().default(false),
      propertyGroup: z.string().default("abmbuddy"),
    })
    .prefault({}),
});

export type Config = z.infer<typeof configSchema>;

let cached: Config | undefined;

export async function loadConfig(force = false): Promise<Config> {
  if (cached && !force) return cached;
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(configFile(), "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") log.debug("config", `unreadable config: ${String(error)}`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    log.debug("config", `invalid config, using defaults: ${parsed.error.message}`);
    cached = configSchema.parse({});
  } else {
    cached = parsed.data;
  }
  return cached;
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(configFile(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  cached = config;
}

/** Shallow-merges a patch into the stored config and persists it. */
export async function updateConfig(patch: DeepPartial<Config>): Promise<Config> {
  const current = await loadConfig(true);
  const merged = configSchema.parse(deepMerge(current, patch));
  await saveConfig(merged);
  return merged;
}

export async function resetConfig(): Promise<void> {
  await rm(configFile(), { force: true });
  cached = undefined;
}

export function isCrmConnected(config: Config): boolean {
  return config.crm.provider === "hubspot" && Boolean(config.crm.authMode);
}

export function isLlmConfigured(config: Config): boolean {
  return Boolean(config.llm.provider && config.llm.model);
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { configFile, configDir } from "./paths.js";
