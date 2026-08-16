import { loadConfig, type Config } from "../config/index.js";
import { createLLMProvider, type LLMProvider } from "../llm/provider.js";
import { createSearchProvider, type SearchProvider } from "../search/provider.js";
import { setHttpCacheEnabled } from "../util/http.js";

/**
 * Assembles the replaceable pieces for a run. Everything the pipeline touches
 * from the outside world arrives through one of these three interfaces.
 */
export type Runtime = {
  config: Config;
  llm: LLMProvider;
  search: SearchProvider;
};

export async function buildRuntime(overrides: Partial<Config["research"]> = {}): Promise<Runtime> {
  const stored = await loadConfig(true);
  const config: Config = { ...stored, research: { ...stored.research, ...overrides } };
  setHttpCacheEnabled(config.research.cache);
  const [llm, search] = await Promise.all([createLLMProvider(config), createSearchProvider(config)]);
  return { config, llm, search };
}
