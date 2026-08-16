import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { DEFAULT_MODELS, type Config, type LlmProviderName } from "../config/index.js";
import { SecretKey, getSecret } from "../config/secrets.js";

/**
 * The model layer is one small interface so contributors can add a provider
 * without touching any research or agent code.
 */
export interface LLMProvider {
  readonly name: LlmProviderName;
  readonly modelId: string;
  /** An AI SDK language model, ready to pass to generateText. */
  model(): LanguageModel;
  /** One line for `abmbuddy config`. */
  describe(): string;
}

export const PROVIDER_LABELS: Record<LlmProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  "openai-compatible": "OpenAI Compatible",
};

/** Environment variables checked before the keychain, so CI can run keyless. */
const ENV_KEYS: Record<LlmProviderName, string[]> = {
  openai: ["ABMBUDDY_LLM_API_KEY", "OPENAI_API_KEY"],
  anthropic: ["ABMBUDDY_LLM_API_KEY", "ANTHROPIC_API_KEY"],
  google: ["ABMBUDDY_LLM_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  "openai-compatible": ["ABMBUDDY_LLM_API_KEY", "OPENAI_COMPATIBLE_API_KEY"],
};

export class MissingLlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingLlmConfigError";
  }
}

function envKey(provider: LlmProviderName): string | undefined {
  for (const name of ENV_KEYS[provider]) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

export async function resolveApiKey(provider: LlmProviderName): Promise<string | undefined> {
  return envKey(provider) ?? (await getSecret(SecretKey.llmApiKey));
}

/**
 * Builds the configured provider. Throws MissingLlmConfigError with an
 * actionable message rather than failing deep inside an agent call.
 */
export async function createLLMProvider(config: Config): Promise<LLMProvider> {
  const provider = (process.env.ABMBUDDY_LLM_PROVIDER as LlmProviderName | undefined) ?? config.llm.provider;
  if (!provider) {
    throw new MissingLlmConfigError("No AI provider configured. Run `abmbuddy config` to set one up.");
  }

  const modelId =
    process.env.ABMBUDDY_LLM_MODEL || config.llm.model || DEFAULT_MODELS[provider] || "";
  if (!modelId) {
    throw new MissingLlmConfigError(
      `No model configured for ${PROVIDER_LABELS[provider]}. Run \`abmbuddy config\`.`,
    );
  }

  const baseURL = process.env.ABMBUDDY_LLM_BASE_URL || config.llm.baseUrl;
  const apiKey = await resolveApiKey(provider);
  if (!apiKey && provider !== "openai-compatible") {
    throw new MissingLlmConfigError(
      `No API key found for ${PROVIDER_LABELS[provider]}. Run \`abmbuddy config\` or set ${ENV_KEYS[provider][1]}.`,
    );
  }

  const model = buildModel(provider, modelId, apiKey, baseURL);
  const label = provider === "openai-compatible" ? config.llm.name || "OpenAI Compatible" : PROVIDER_LABELS[provider];

  return {
    name: provider,
    modelId,
    model: () => model,
    describe: () => `${label} · ${modelId}${baseURL ? ` · ${baseURL}` : ""}`,
  };
}

function buildModel(
  provider: LlmProviderName,
  modelId: string,
  apiKey: string | undefined,
  baseURL: string | undefined,
): LanguageModel {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId);
    case "openai-compatible": {
      if (!baseURL) {
        throw new MissingLlmConfigError(
          "An OpenAI-compatible provider needs a base URL. Run `abmbuddy config`.",
        );
      }
      return createOpenAICompatible({
        name: "openai-compatible",
        baseURL,
        ...(apiKey ? { apiKey } : {}),
      })(modelId);
    }
  }
}
