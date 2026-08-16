import * as cheerio from "cheerio";
import type { Config, SearchProviderName } from "../config/index.js";
import { SecretKey, getSecret } from "../config/secrets.js";
import { fetchJson, fetchText } from "../util/http.js";
import { collapse } from "../util/html.js";
import { log } from "../util/logger.js";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};

export type SearchOptions = {
  limit?: number;
  /** Hint to the provider that only recent results are useful. */
  freshnessDays?: number;
};

/**
 * Web search is pluggable because every user has a different key situation.
 * Collectors treat "no search provider" as a normal, non-fatal condition.
 */
export interface SearchProvider {
  readonly name: SearchProviderName;
  readonly label: string;
  /** True when this provider can actually run (has a key, etc). */
  readonly enabled: boolean;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

export const SEARCH_LABELS: Record<SearchProviderName, string> = {
  tavily: "Tavily",
  brave: "Brave Search",
  serper: "Serper (Google)",
  duckduckgo: "DuckDuckGo HTML (no key, best effort)",
  none: "None (skip web search)",
};

const ENV_KEYS: Record<SearchProviderName, string[]> = {
  tavily: ["ABMBUDDY_SEARCH_API_KEY", "TAVILY_API_KEY"],
  brave: ["ABMBUDDY_SEARCH_API_KEY", "BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY"],
  serper: ["ABMBUDDY_SEARCH_API_KEY", "SERPER_API_KEY"],
  duckduckgo: [],
  none: [],
};

export async function createSearchProvider(config: Config): Promise<SearchProvider> {
  const name = (process.env.ABMBUDDY_SEARCH_PROVIDER as SearchProviderName | undefined) ?? config.search.provider;
  if (name === "none") return nullProvider();
  if (name === "duckduckgo") return duckDuckGoProvider();

  const key = ENV_KEYS[name].map((k) => process.env[k]).find(Boolean) ?? (await getSecret(SecretKey.searchApiKey));
  if (!key) {
    log.warn("search", `${SEARCH_LABELS[name]} selected but no API key found; skipping web search.`);
    return nullProvider();
  }
  if (name === "tavily") return tavilyProvider(key);
  if (name === "brave") return braveProvider(key);
  return serperProvider(key);
}

function nullProvider(): SearchProvider {
  return {
    name: "none",
    label: SEARCH_LABELS.none,
    enabled: false,
    async search() {
      return [];
    },
  };
}

function tavilyProvider(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    label: SEARCH_LABELS.tavily,
    enabled: true,
    async search(query, options = {}) {
      type TavilyResponse = {
        results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>;
      };
      const data = await fetchJson<TavilyResponse>("https://api.tavily.com/search", {
        method: "POST",
        noCache: false,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query,
          max_results: options.limit ?? 8,
          search_depth: "basic",
          include_answer: false,
          ...(options.freshnessDays ? { days: options.freshnessDays, topic: "news" } : {}),
        }),
      });
      return (data?.results ?? [])
        .filter((r) => r.url)
        .map((r) => ({
          title: r.title ?? r.url ?? "",
          url: r.url as string,
          snippet: collapse(r.content ?? "").slice(0, 600),
          publishedAt: r.published_date,
        }));
    },
  };
}

function braveProvider(apiKey: string): SearchProvider {
  return {
    name: "brave",
    label: SEARCH_LABELS.brave,
    enabled: true,
    async search(query, options = {}) {
      type BraveResponse = {
        web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
        news?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
      };
      const params = new URLSearchParams({ q: query, count: String(options.limit ?? 8) });
      if (options.freshnessDays) {
        params.set("freshness", options.freshnessDays <= 7 ? "pw" : options.freshnessDays <= 31 ? "pm" : "py");
      }
      const data = await fetchJson<BraveResponse>(
        `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        { headers: { "x-subscription-token": apiKey, accept: "application/json" } },
      );
      const results = [...(data?.web?.results ?? []), ...(data?.news?.results ?? [])];
      return results
        .filter((r) => r.url)
        .map((r) => ({
          title: stripTags(r.title ?? ""),
          url: r.url as string,
          snippet: stripTags(r.description ?? "").slice(0, 600),
          publishedAt: r.age,
        }));
    },
  };
}

function serperProvider(apiKey: string): SearchProvider {
  return {
    name: "serper",
    label: SEARCH_LABELS.serper,
    enabled: true,
    async search(query, options = {}) {
      type SerperResponse = {
        organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
        news?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
      };
      const useNews = Boolean(options.freshnessDays);
      const data = await fetchJson<SerperResponse>(
        useNews ? "https://google.serper.dev/news" : "https://google.serper.dev/search",
        {
          method: "POST",
          headers: { "x-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify({ q: query, num: options.limit ?? 8 }),
        },
      );
      const results = [...(data?.organic ?? []), ...(data?.news ?? [])];
      return results
        .filter((r) => r.link)
        .map((r) => ({
          title: r.title ?? "",
          url: r.link as string,
          snippet: (r.snippet ?? "").slice(0, 600),
          publishedAt: r.date,
        }));
    },
  };
}

/**
 * Keyless fallback. Scrapes the DuckDuckGo HTML endpoint, which is fine for
 * light use but is rate limited and can change shape without notice — hence
 * "best effort" in the label.
 */
function duckDuckGoProvider(): SearchProvider {
  return {
    name: "duckduckgo",
    label: SEARCH_LABELS.duckduckgo,
    enabled: true,
    async search(query, options = {}) {
      const response = await fetchText(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        { headers: { accept: "text/html" }, retries: 1 },
      );
      if (!response.ok) return [];
      const $ = cheerio.load(response.body);
      const results: SearchResult[] = [];
      $(".result").each((_, el) => {
        if (results.length >= (options.limit ?? 8)) return;
        const anchor = $(el).find("a.result__a").first();
        const href = anchor.attr("href");
        if (!href) return;
        const url = unwrapDuckDuckGo(href);
        if (!url) return;
        results.push({
          title: collapse(anchor.text()),
          url,
          snippet: collapse($(el).find(".result__snippet").text()).slice(0, 600),
        });
      });
      return results;
    },
  };
}

function unwrapDuckDuckGo(href: string): string | undefined {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    const resolved = target ? new URL(target) : url;
    return /^https?:$/.test(resolved.protocol) ? resolved.toString() : undefined;
  } catch {
    return undefined;
  }
}

function stripTags(value: string): string {
  return collapse(value.replace(/<[^>]*>/g, ""));
}
