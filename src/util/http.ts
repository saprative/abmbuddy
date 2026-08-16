import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log } from "./logger.js";
import { RateLimiter, sleep } from "./pool.js";

export const USER_AGENT =
  process.env.ABMBUDDY_USER_AGENT ??
  "abmbuddy/0.1 (+https://github.com/abmbuddy/abmbuddy; open-source account research CLI)";

/** One request per host at a time, spaced out. Keeps us a polite crawler. */
const limiter = new RateLimiter(Number(process.env.ABMBUDDY_HOST_GAP_MS ?? 350));

/** Deduplicates identical in-flight requests inside a single run. */
const inflight = new Map<string, Promise<FetchTextResult>>();

const CACHE_DIR = join(tmpdir(), "abmbuddy-cache");
const CACHE_TTL_MS = Number(process.env.ABMBUDDY_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);

let cacheEnabled = true;

/**
 * Temporary HTTP cache. Exists only to avoid re-fetching the same page within
 * or across nearby runs — it is not application state and can be deleted at
 * any time.
 */
export function setHttpCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled;
}

export type FetchTextResult = {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: string;
  fromCache: boolean;
};

export type FetchOptions = {
  timeoutMs?: number;
  headers?: Record<string, string>;
  retries?: number;
  /** Bytes to read before giving up on a very large document. */
  maxBytes?: number;
  method?: "GET" | "POST";
  body?: string;
  /** Skip the on-disk cache for this request (used for auth'd API calls). */
  noCache?: boolean;
  signal?: AbortSignal;
};

function cacheKey(url: string, options: FetchOptions): string {
  const hash = createHash("sha256")
    .update(`${options.method ?? "GET"} ${url} ${options.body ?? ""}`)
    .digest("hex");
  return join(CACHE_DIR, `${hash}.json`);
}

async function readCache(file: string): Promise<FetchTextResult | undefined> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { at: number; value: FetchTextResult };
    if (Date.now() - parsed.at > CACHE_TTL_MS) return undefined;
    return { ...parsed.value, fromCache: true };
  } catch {
    return undefined;
  }
}

async function writeCache(file: string, value: FetchTextResult): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify({ at: Date.now(), value }), "utf8");
  } catch {
    // A cache that cannot be written is not an error worth surfacing.
  }
}

/**
 * Fetch a URL as text: polite, retried, size-capped, optionally cached.
 * Never throws for HTTP errors — callers decide what a 404 means for them.
 */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<FetchTextResult> {
  const key = `${options.method ?? "GET"} ${url} ${options.body ?? ""}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = doFetchText(url, options).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function doFetchText(url: string, options: FetchOptions): Promise<FetchTextResult> {
  const useCache = cacheEnabled && !options.noCache && (options.method ?? "GET") === "GET";
  const file = cacheKey(url, options);
  if (useCache) {
    const hit = await readCache(file);
    if (hit) {
      log.debug("http", `cache hit ${url}`);
      return hit;
    }
  }

  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxBytes = options.maxBytes ?? 2_000_000;

  let host = "unknown";
  try {
    host = new URL(url).host;
  } catch {
    return { url, status: 0, ok: false, contentType: "", body: "", fromCache: false };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.acquire(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        redirect: "follow",
        signal: controller.signal,
        body: options.body,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          ...options.headers,
        },
      });

      const contentType = response.headers.get("content-type") ?? "";
      const body = await readCapped(response, maxBytes);
      const result: FetchTextResult = {
        url: response.url || url,
        status: response.status,
        ok: response.ok,
        contentType,
        body,
        fromCache: false,
      };

      // 429/5xx are worth another go; 4xx are not.
      if (!response.ok && (response.status === 429 || response.status >= 500) && attempt < retries) {
        const wait = 600 * 2 ** attempt;
        log.debug("http", `retry ${response.status} in ${wait}ms ${url}`);
        await sleep(wait);
        continue;
      }

      if (useCache && response.ok) await writeCache(file, result);
      log.debug("http", `${response.status} ${url} (${body.length}b)`);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  log.debug("http", `failed ${url}: ${String(lastError)}`);
  return { url, status: 0, ok: false, contentType: "", body: "", fromCache: false };
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  text += decoder.decode();
  return text;
}

/** Convenience wrapper for JSON endpoints. Returns undefined on any failure. */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T | undefined> {
  const result = await fetchText(url, {
    ...options,
    headers: { accept: "application/json", ...options.headers },
  });
  if (!result.ok || !result.body) return undefined;
  try {
    return JSON.parse(result.body) as T;
  } catch {
    return undefined;
  }
}
