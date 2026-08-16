import { confirm, input, password, select } from "@inquirer/prompts";
import {
  DEFAULT_MODELS,
  configFile,
  isCrmConnected,
  isLlmConfigured,
  loadConfig,
  updateConfig,
  type Config,
  type LlmProviderName,
  type SearchProviderName,
} from "../config/index.js";
import { SecretKey, getSecret, maskSecret, setSecret, usingKeychain } from "../config/secrets.js";
import { PROVIDER_LABELS, resolveApiKey } from "../llm/provider.js";
import { SEARCH_LABELS } from "../search/provider.js";
import { promptOverrideDir } from "../agents/prompt.js";
import { createHubSpotProvider } from "../crm/hubspot.js";
import { pc, rule, symbols } from "./ui/theme.js";

/** `abmbuddy config` — inspect and change everything that is not a secret in code. */
export async function runConfigCommand(): Promise<void> {
  while (true) {
    const config = await loadConfig(true);
    await showConfig(config);
    const action = await select({
      message: "Configuration",
      choices: [
        { name: "AI provider", value: "llm" },
        { name: "Web search provider", value: "search" },
        { name: "Outreach identity (who the emails come from)", value: "outreach" },
        { name: "Research settings", value: "research" },
        { name: "Done", value: "done" },
      ],
    });
    if (action === "done") return;
    if (action === "llm") await configureLlm();
    if (action === "search") await configureSearch();
    if (action === "outreach") await configureOutreach();
    if (action === "research") await configureResearch();
  }
}

export async function showConfig(config: Config): Promise<void> {
  const key = config.llm.provider ? await resolveApiKey(config.llm.provider) : undefined;
  const lines = [
    "",
    pc.bold("Configuration"),
    rule(),
    `${label("CRM")} ${
      isCrmConnected(config)
        ? `${pc.green(symbols.ok)} HubSpot — ${await createHubSpotProvider(config).describe()}`
        : pc.dim("not connected")
    }`,
    `${label("AI provider")} ${
      isLlmConfigured(config)
        ? `${PROVIDER_LABELS[config.llm.provider as LlmProviderName]} · ${config.llm.model}`
        : pc.dim("not configured")
    }`,
    `${label("AI key")} ${pc.dim(maskSecret(key))}`,
    config.llm.baseUrl ? `${label("Base URL")} ${config.llm.baseUrl}` : "",
    `${label("Web search")} ${SEARCH_LABELS[config.search.provider]}`,
    `${label("Concurrency")} ${config.research.concurrency} accounts`,
    `${label("Pages/site")} ${config.research.maxPages}`,
    `${label("SEC filings")} ${config.research.includeSec ? "on" : "off"}${
      config.research.includeSec && !config.research.secContact
        ? pc.dim("  (set a contact email — EDGAR requires one)")
        : config.research.secContact
          ? pc.dim(`  contact: ${config.research.secContact}`)
          : ""
    }`,
    `${label("HTTP cache")} ${config.research.cache ? "on (temp dir)" : "off"}`,
    `${label("Sender")} ${config.outreach.senderName ?? pc.dim("not set")}${
      config.outreach.senderCompany ? ` · ${config.outreach.senderCompany}` : ""
    }`,
    `${label("Value prop")} ${config.outreach.valueProposition ?? pc.dim("not set")}`,
    `${label("Secrets in")} ${(await usingKeychain()) ? "OS keychain" : "0600 file in config dir"}`,
    `${label("Config file")} ${pc.dim(configFile())}`,
    `${label("Prompt edits")} ${pc.dim(promptOverrideDir())}`,
    "",
  ].filter(Boolean);
  process.stdout.write(`${lines.join("\n")}\n`);
}

function label(text: string): string {
  return pc.dim(text.padEnd(14));
}

export async function configureLlm(): Promise<Config> {
  const current = await loadConfig(true);
  const provider = await select<LlmProviderName>({
    message: "AI Provider",
    default: current.llm.provider,
    choices: (Object.keys(PROVIDER_LABELS) as LlmProviderName[]).map((name) => ({
      name: PROVIDER_LABELS[name],
      value: name,
    })),
  });

  let baseUrl: string | undefined = current.llm.baseUrl;
  let displayName: string | undefined = current.llm.name;
  if (provider === "openai-compatible") {
    baseUrl = await input({
      message: "Base URL (OpenAI-compatible endpoint)",
      default: current.llm.baseUrl ?? "http://localhost:11434/v1",
      validate: (value) => (/^https?:\/\//.test(value.trim()) ? true : "Enter a URL starting with http(s)://"),
    });
    displayName = await input({ message: "Name for this endpoint", default: current.llm.name ?? "Local model" });
  }

  const model = await input({
    message: "Model",
    default: current.llm.model || DEFAULT_MODELS[provider] || "",
    validate: (value) => (value.trim() ? true : "A model id is required"),
  });

  const envKey = await resolveApiKeyFromEnv(provider);
  if (envKey) {
    process.stdout.write(pc.dim(`Using the API key already present in your environment.\n`));
  } else {
    const optional = provider === "openai-compatible";
    const entered = await password({
      message: optional ? "API key (leave blank if the endpoint needs none)" : "API key",
      mask: true,
    });
    if (entered.trim()) {
      await setSecret(SecretKey.llmApiKey, entered.trim());
    } else if (!optional) {
      process.stdout.write(pc.yellow(`${symbols.warn} No key stored — research will fail until one is set.\n`));
    }
  }

  return updateConfig({
    llm: {
      provider,
      model: model.trim(),
      ...(baseUrl ? { baseUrl } : {}),
      ...(displayName ? { name: displayName } : {}),
    },
  });
}

export async function configureSearch(): Promise<Config> {
  const current = await loadConfig(true);
  const provider = await select<SearchProviderName>({
    message: "Web search provider (improves news and leadership coverage)",
    default: current.search.provider,
    choices: (Object.keys(SEARCH_LABELS) as SearchProviderName[]).map((name) => ({
      name: SEARCH_LABELS[name],
      value: name,
    })),
  });

  if (provider !== "none" && provider !== "duckduckgo") {
    const existing = await getSecret(SecretKey.searchApiKey);
    const entered = await password({
      message: existing ? `API key (blank keeps ${maskSecret(existing)})` : "API key",
      mask: true,
    });
    if (entered.trim()) await setSecret(SecretKey.searchApiKey, entered.trim());
  }

  return updateConfig({ search: { provider } });
}

export async function configureOutreach(): Promise<Config> {
  const current = await loadConfig(true);
  const senderName = await input({ message: "Your name", default: current.outreach.senderName ?? "" });
  const senderCompany = await input({ message: "Your company", default: current.outreach.senderCompany ?? "" });
  const valueProposition = await input({
    message: "What you sell, in a sentence or two",
    default: current.outreach.valueProposition ?? "",
  });
  const tone = await select<Config["outreach"]["tone"]>({
    message: "Tone",
    default: current.outreach.tone,
    choices: [
      { name: "Direct", value: "direct" },
      { name: "Consultative", value: "consultative" },
      { name: "Casual", value: "casual" },
    ],
  });
  return updateConfig({
    outreach: {
      ...(senderName.trim() ? { senderName: senderName.trim() } : {}),
      ...(senderCompany.trim() ? { senderCompany: senderCompany.trim() } : {}),
      ...(valueProposition.trim() ? { valueProposition: valueProposition.trim() } : {}),
      tone,
    },
  });
}

export async function configureResearch(): Promise<Config> {
  const current = await loadConfig(true);
  const concurrency = await numberInput("Accounts researched in parallel", current.research.concurrency, 1, 20);
  const maxPages = await numberInput("Pages crawled per company website", current.research.maxPages, 1, 60);
  const maxJobs = await numberInput("Job postings analysed per company", current.research.maxJobs, 0, 200);
  const includeSec = await confirm({ message: "Read SEC filings for US public companies?", default: current.research.includeSec });
  // EDGAR requires a contact address in the User-Agent and blocks requests
  // that do not carry one.
  const secContact = includeSec
    ? await input({
        message: "Contact email to send to SEC EDGAR (their fair-access policy requires one)",
        default: current.research.secContact ?? "",
        validate: (value) =>
          !value.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()) ? true : "Enter an email address, or leave blank",
      })
    : (current.research.secContact ?? "");
  const cache = await confirm({ message: "Cache HTTP responses in the temp directory?", default: current.research.cache });
  const useBrowserFallback = await confirm({
    message: "Use Playwright for pages that render empty over plain HTTP? (requires playwright installed)",
    default: current.research.useBrowserFallback,
  });
  return updateConfig({
    research: {
      concurrency,
      maxPages,
      maxJobs,
      includeSec,
      cache,
      useBrowserFallback,
      ...(secContact.trim() ? { secContact: secContact.trim() } : {}),
    },
  });
}

async function numberInput(message: string, current: number, min: number, max: number): Promise<number> {
  const answer = await input({
    message: `${message} (${min}-${max})`,
    default: String(current),
    validate: (value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) return `Enter a whole number between ${min} and ${max}`;
      return true;
    },
  });
  return Number(answer);
}

/** Walks a first-time user through AI setup; returns the usable config. */
export async function ensureLlmConfigured(): Promise<Config> {
  const config = await loadConfig(true);
  if (isLlmConfigured(config) && (await resolveApiKey(config.llm.provider as LlmProviderName))) return config;
  if (isLlmConfigured(config)) {
    process.stdout.write(pc.yellow(`${symbols.warn} No API key found for ${PROVIDER_LABELS[config.llm.provider as LlmProviderName]}.\n`));
  }
  return configureLlm();
}

async function resolveApiKeyFromEnv(provider: LlmProviderName): Promise<string | undefined> {
  const before = await getSecret(SecretKey.llmApiKey);
  const resolved = await resolveApiKey(provider);
  // Only report an environment key, not one we previously stored.
  return resolved && resolved !== before ? resolved : undefined;
}
