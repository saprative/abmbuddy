import { log } from "./logger.js";
import { USER_AGENT } from "./http.js";

/**
 * Playwright is an optional escape hatch, not a dependency. It is used only
 * when a plain HTTP fetch comes back as an empty client-rendered shell, and
 * only if the user has actually installed playwright themselves.
 */

type AnyBrowser = {
  newContext(options: unknown): Promise<AnyContext>;
  close(): Promise<void>;
};
type AnyContext = {
  newPage(): Promise<AnyPage>;
  close(): Promise<void>;
};
type AnyPage = {
  goto(url: string, options: unknown): Promise<unknown>;
  content(): Promise<string>;
  close(): Promise<void>;
};

let browserPromise: Promise<AnyBrowser | undefined> | undefined;
let unavailableReason: string | undefined;

async function getBrowser(): Promise<AnyBrowser | undefined> {
  if (unavailableReason) return undefined;
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        // Indirect specifier: playwright is an optional peer the user installs
        // themselves, so it must not become a build-time dependency.
        const specifier = "playwright";
        const mod = (await import(specifier)) as {
          chromium: { launch(options: unknown): Promise<AnyBrowser> };
        };
        return await mod.chromium.launch({ headless: true });
      } catch (error) {
        unavailableReason = error instanceof Error ? error.message : String(error);
        log.debug("browser", `playwright unavailable: ${unavailableReason}`);
        return undefined;
      }
    })();
  }
  return browserPromise;
}

export function browserAvailable(): boolean {
  return unavailableReason === undefined;
}

/** Returns rendered HTML, or undefined if Playwright is not installed/usable. */
export async function renderPage(url: string, timeoutMs = 20_000): Promise<string | undefined> {
  const browser = await getBrowser();
  if (!browser) return undefined;
  let context: AnyContext | undefined;
  try {
    context = await browser.newContext({ userAgent: USER_AGENT, javaScriptEnabled: true });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const html = await page.content();
    await page.close();
    log.debug("browser", `rendered ${url} (${html.length}b)`);
    return html;
  } catch (error) {
    log.debug("browser", `render failed ${url}: ${String(error)}`);
    return undefined;
  } finally {
    await context?.close().catch(() => {});
  }
}

/** Closes the shared browser at the end of a run, if one was ever started. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => undefined);
  await browser?.close().catch(() => {});
  browserPromise = undefined;
}
