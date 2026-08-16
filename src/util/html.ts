import * as cheerio from "cheerio";

const STRIP = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "nav",
  "footer",
  "header",
  "form",
  "template",
  "[aria-hidden='true']",
  "[role='navigation']",
].join(",");

export type PageText = {
  title: string;
  /** og:site_name / application-name — the brand, where the page declares one. */
  siteName?: string;
  description?: string;
  publishedAt?: string;
  text: string;
};

/** HTML -> readable plain text, with the obvious chrome removed. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $(STRIP).remove();
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const text = root.text();
  return collapse(text);
}

export function collapse(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extracts the useful parts of an HTML page in one pass. */
export function parsePage(html: string): PageText {
  const $ = cheerio.load(html);
  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "Untitled page";
  const description =
    $("meta[name='description']").attr("content")?.trim() ||
    $("meta[property='og:description']").attr("content")?.trim() ||
    undefined;
  const siteName =
    $("meta[property='og:site_name']").attr("content")?.trim() ||
    $("meta[name='application-name']").attr("content")?.trim() ||
    undefined;
  const publishedAt =
    $("meta[property='article:published_time']").attr("content")?.trim() ||
    $("time[datetime]").first().attr("datetime")?.trim() ||
    undefined;

  $(STRIP).remove();
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  // Keep headings visually distinct so the model can see document structure.
  root.find("h1,h2,h3").each((_, el) => {
    const node = $(el);
    node.replaceWith(`\n\n## ${node.text().trim()}\n`);
  });
  root.find("li").each((_, el) => {
    const node = $(el);
    node.replaceWith(`\n- ${node.text().trim()}`);
  });

  return { title, siteName, description, publishedAt, text: collapse(root.text()) };
}

export type PageLink = { url: string; text: string };

/** All same-origin links on a page, absolutized and de-duplicated. */
export function extractLinks(html: string, baseUrl: string, sameHostOnly = true): PageLink[] {
  const $ = cheerio.load(html);
  const base = safeUrl(baseUrl);
  if (!base) return [];
  const seen = new Map<string, PageLink>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const resolved = safeUrl(href, base);
    if (!resolved) return;
    if (sameHostOnly && resolved.host !== base.host) return;
    if (!/^https?:$/.test(resolved.protocol)) return;
    resolved.hash = "";
    const key = resolved.toString();
    if (seen.has(key)) return;
    seen.set(key, { url: key, text: collapse($(el).text()).slice(0, 120) });
  });
  return [...seen.values()];
}

export function safeUrl(input: string, base?: URL): URL | undefined {
  try {
    return new URL(input, base);
  } catch {
    return undefined;
  }
}

/** True when a fetched document is HTML we can parse. */
export function isHtml(contentType: string, body: string): boolean {
  if (contentType.includes("html")) return true;
  return /^\s*<(?:!doctype|html)/i.test(body);
}

/**
 * A page that fetched fine but contains almost no text is usually a client-side
 * rendered shell — the signal we use to decide whether Playwright is worth it.
 */
export function looksEmpty(text: string): boolean {
  return text.replace(/\s+/g, " ").trim().length < 350;
}
