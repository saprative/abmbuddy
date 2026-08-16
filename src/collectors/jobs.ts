import { companySlug, companyUrl, type Company } from "../models/company.js";
import { makeEvidence, truncateContent, type Evidence } from "../models/evidence.js";
import { fetchJson, fetchText } from "../util/http.js";
import { collapse, extractLinks, htmlToText, isHtml, parsePage, safeUrl } from "../util/html.js";
import { log } from "../util/logger.js";
import { mapWithConcurrency } from "../util/pool.js";
import { CollectorSkip, type CollectorContext, type ResearchSource } from "./types.js";

/**
 * Engineering job postings are the highest-signal public source there is: they
 * describe what a company is building before it ships, and in what volume.
 * Everything here is deterministic — pattern matching over public board APIs.
 * Reading the pattern across postings is the Signal Agent's job, not ours.
 */

const CAREERS_PATHS = [
  "/careers",
  "/careers/jobs",
  "/jobs",
  "/company/careers",
  "/about/careers",
  "/en/careers",
  "/careers/open-roles",
  "/work-with-us",
];

/** Public board hosts we can read structurally rather than by scraping. */
const ATS_PATTERNS: Array<{ ats: AtsName; pattern: RegExp }> = [
  { ats: "greenhouse", pattern: /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { ats: "greenhouse", pattern: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i },
  { ats: "lever", pattern: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i },
  { ats: "ashby", pattern: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
];

type AtsName = "greenhouse" | "lever" | "ashby";

/** A role is "technical" if any of these show up in the title. */
const TECHNICAL_TITLE =
  /(engineer|engineering|developer|architect|sre|site reliability|infrastructure|platform|devops|data|machine learning|\bml\b|\bai\b|scientist|security|qa|quality|technical program|technical product|cto|vp.*(engineering|technology)|head of (engineering|platform|data|infrastructure))/i;

/**
 * Checked first: go-to-market titles routinely contain "platform", "data" or
 * "solutions" and would otherwise be counted as engineering hiring.
 */
const NON_TECHNICAL_TITLE =
  /(account (executive|manager|director)|sales|seller|business development|\bbdr\b|\bsdr\b|marketing|recruit|talent|people partner|\bhr\b|customer success|account partner|legal|counsel|paralegal|finance|accounting|controller|payroll|procurement|office manager|executive assistant|communications|public relations|brand|content (writer|marketer)|copywriter|community manager)/i;

/** Technologies worth noticing. Matched as whole words against posting text. */
const TECHNOLOGIES = [
  "kubernetes", "docker", "terraform", "aws", "gcp", "google cloud", "azure", "snowflake",
  "databricks", "kafka", "airflow", "dbt", "spark", "flink", "postgres", "postgresql", "mysql",
  "mongodb", "dynamodb", "redis", "elasticsearch", "clickhouse", "bigquery", "redshift",
  "graphql", "grpc", "rest", "microservices", "serverless", "lambda",
  "go", "golang", "rust", "python", "java", "kotlin", "scala", "ruby", "typescript",
  "javascript", "react", "node.js", "c++", "c#", ".net", "php", "swift",
  "pytorch", "tensorflow", "llm", "llms", "rag", "vector database", "mlops", "sagemaker",
  "vertex ai", "openai", "anthropic", "hugging face", "feature store", "model serving",
  "datadog", "prometheus", "grafana", "opentelemetry", "splunk", "pagerduty",
  "github actions", "jenkins", "circleci", "argocd", "gitops", "helm", "istio", "envoy",
  "salesforce", "sap", "workday", "netsuite", "stripe", "segment", "kubernetes operators",
];

const SENIORITY: Array<[string, RegExp]> = [
  ["executive", /\b(chief|cto|cio|ciso|vp|vice president|head of)\b/i],
  ["director", /\b(director|senior manager)\b/i],
  ["manager", /\b(manager|lead|team lead|tech lead)\b/i],
  ["staff+", /\b(staff|principal|distinguished|fellow)\b/i],
  ["senior", /\b(senior|sr\.?|iii|iv)\b/i],
  ["mid", /\b(ii|mid[- ]level)\b/i],
  ["junior", /\b(junior|jr\.?|associate|graduate|intern|new grad|entry)\b/i],
];

const DOMAINS: Array<[string, RegExp]> = [
  ["ml/ai", /\b(machine learning|ml|ai|deep learning|nlp|llm|model|data scien)/i],
  ["data platform", /\b(data platform|data engineering|analytics engineering|data infrastructure|warehouse|pipeline)/i],
  ["infrastructure", /\b(infrastructure|platform engineering|sre|reliability|cloud|kubernetes|devops)/i],
  ["security", /\b(security|appsec|infosec|compliance|iam|zero trust)/i],
  ["product engineering", /\b(frontend|front-end|backend|back-end|full[- ]stack|mobile|ios|android|product engineer)/i],
  ["integrations", /\b(integration|api|partner engineering|solutions engineer)/i],
];

type Posting = {
  title: string;
  url: string;
  location?: string;
  department?: string;
  updatedAt?: string;
  content: string;
};

export function createJobsSource(ctx: CollectorContext): ResearchSource {
  return {
    name: "jobs",
    label: "Engineering jobs",
    async collect(company: Company): Promise<Evidence[]> {
      const limit = ctx.config.research.maxJobs;
      if (limit === 0) throw new CollectorSkip("job collection disabled in config");

      const board = await findBoard(company, ctx);
      const postings = board
        ? await readBoard(board, ctx)
        : await scrapeCareersPage(company, ctx);

      if (!postings.length) throw new CollectorSkip("no public job board found");

      const technical = postings.filter(
        (p) => TECHNICAL_TITLE.test(p.title) && !NON_TECHNICAL_TITLE.test(p.title),
      );
      // With no clearly technical titles, fall back to everything that is not
      // obviously go-to-market rather than to the whole board.
      const fallback = postings.filter((p) => !NON_TECHNICAL_TITLE.test(p.title));
      const selected = (technical.length ? technical : fallback.length ? fallback : postings).slice(0, limit);
      log.debug("jobs", `${postings.length} postings, ${technical.length} technical, keeping ${selected.length}`);

      const boardUrl = board ? boardHomeUrl(board) : (companyUrl(company) ?? selected[0]?.url ?? "");
      const evidence: Evidence[] = [
        summaryEvidence(company, selected, postings.length, boardUrl, board?.ats),
      ];

      for (const posting of selected) {
        evidence.push(
          makeEvidence({
            sourceType: "job",
            title: posting.title,
            url: posting.url,
            publishedAt: posting.updatedAt,
            content: truncateContent(
              [
                `Title: ${posting.title}`,
                posting.department ? `Department: ${posting.department}` : "",
                posting.location ? `Location: ${posting.location}` : "",
                `Seniority: ${seniorityOf(posting.title)}`,
                `Domain: ${domainOf(`${posting.title} ${posting.content}`)}`,
                `Technologies mentioned: ${technologiesIn(posting.content).join(", ") || "none detected"}`,
                "",
                posting.content,
              ]
                .filter(Boolean)
                .join("\n"),
              2500,
            ),
            meta: {
              collector: "jobs",
              ats: board?.ats ?? "careers-page",
              seniority: seniorityOf(posting.title),
              domain: domainOf(`${posting.title} ${posting.content}`),
            },
          }),
        );
      }

      return evidence;
    },
  };
}

/**
 * A deterministic roll-up of what was collected. Counting postings is not
 * interpretation — but it saves every downstream agent from having to count,
 * and it keeps the numbers honest.
 */
function summaryEvidence(
  company: Company,
  postings: Posting[],
  totalFound: number,
  boardUrl: string,
  ats: AtsName | undefined,
): Evidence {
  const byDomain = tally(postings.map((p) => domainOf(`${p.title} ${p.content}`)));
  const bySeniority = tally(postings.map((p) => seniorityOf(p.title)));
  const byDepartment = tally(postings.map((p) => p.department).filter((d): d is string => Boolean(d)));
  const techCounts = new Map<string, number>();
  for (const posting of postings) {
    for (const tech of technologiesIn(`${posting.title} ${posting.content}`)) {
      techCounts.set(tech, (techCounts.get(tech) ?? 0) + 1);
    }
  }

  const lines = [
    `${postings.length} technical roles analysed out of ${totalFound} public postings for ${company.name}.`,
    ats ? `Applicant tracking system: ${ats}.` : "Source: public careers page.",
    "",
    `Roles by domain: ${format(byDomain)}`,
    `Roles by seniority: ${format(bySeniority)}`,
    byDepartment.size ? `Roles by department: ${format(byDepartment)}` : "",
    "",
    `Technologies by number of postings mentioning them: ${format(techCounts, 25)}`,
    "",
    "Titles:",
    ...postings.map((p) => `- ${p.title}${p.location ? ` (${p.location})` : ""}`),
  ].filter(Boolean);

  return makeEvidence({
    sourceType: "job",
    title: `${company.name} engineering hiring summary (${postings.length} roles)`,
    url: boardUrl,
    content: truncateContent(lines.join("\n"), 5000),
    meta: { collector: "jobs", aggregate: true, roleCount: postings.length, ats: ats ?? "careers-page" },
  });
}

type Board = { ats: AtsName; token: string };

function boardHomeUrl(board: Board): string {
  if (board.ats === "greenhouse") return `https://job-boards.greenhouse.io/${board.token}`;
  if (board.ats === "lever") return `https://jobs.lever.co/${board.token}`;
  return `https://jobs.ashbyhq.com/${board.token}`;
}

/**
 * Careers pages live in three predictable places: a path on the main site, a
 * careers subdomain, or a jobs subdomain. Try all of them before guessing.
 */
function careersUrls(company: Company): string[] {
  const base = companyUrl(company);
  const url = base ? safeUrl(base) : undefined;
  if (!url) return [];
  const host = url.host.replace(/^www\./, "");
  return [
    `${url.origin}/careers`,
    `https://careers.${host}`,
    `https://jobs.${host}`,
    ...CAREERS_PATHS.filter((path) => path !== "/careers").map((path) => `${url.origin}${path}`),
  ];
}

/**
 * Finds the board by following the company's own careers link first — the
 * token is usually right there in the URL — and only then falls back to
 * guessing the token from the company name.
 */
async function findBoard(company: Company, ctx: CollectorContext): Promise<Board | undefined> {
  for (const candidate of careersUrls(company)) {
    const response = await fetchText(candidate, { signal: ctx.signal, retries: 0 });
    if (!response.ok || !isHtml(response.contentType, response.body)) continue;
    const found = matchAts(response.body) ?? matchAts(response.url);
    if (found) {
      log.debug("jobs", `${response.url} -> ${found.ats}/${found.token}`);
      return found;
    }
    for (const link of extractLinks(response.body, response.url, false).slice(0, 60)) {
      const hop = matchAts(link.url);
      if (hop) return hop;
    }
  }

  const slug = companySlug(company.name);
  if (!slug) return undefined;
  for (const guess of [
    { ats: "greenhouse" as const, token: slug },
    { ats: "lever" as const, token: slug },
    { ats: "ashby" as const, token: slug },
  ]) {
    if (await boardExists(guess, ctx)) {
      log.debug("jobs", `guessed board ${guess.ats}/${guess.token}`);
      return guess;
    }
  }
  return undefined;
}

function matchAts(text: string): Board | undefined {
  for (const { ats, pattern } of ATS_PATTERNS) {
    const match = text.match(pattern);
    const token = match?.[1]?.toLowerCase();
    if (token && token !== "embed") return { ats, token };
  }
  return undefined;
}

async function boardExists(board: Board, ctx: CollectorContext): Promise<boolean> {
  const postings = await readBoard(board, ctx, true);
  return postings.length > 0;
}

async function readBoard(board: Board, ctx: CollectorContext, probe = false): Promise<Posting[]> {
  switch (board.ats) {
    case "greenhouse":
      return readGreenhouse(board.token, ctx, probe);
    case "lever":
      return readLever(board.token, ctx);
    case "ashby":
      return readAshby(board.token, ctx);
  }
}

async function readGreenhouse(token: string, ctx: CollectorContext, probe: boolean): Promise<Posting[]> {
  type GreenhouseJob = {
    id: number;
    title?: string;
    absolute_url?: string;
    updated_at?: string;
    content?: string;
    location?: { name?: string };
    departments?: Array<{ name?: string }>;
  };
  const data = await fetchJson<{ jobs?: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=${probe ? "false" : "true"}`,
    { signal: ctx.signal, retries: 1, maxBytes: 6_000_000 },
  );
  return (data?.jobs ?? [])
    .filter((job) => job.title)
    .map((job) => ({
      title: collapse(job.title as string),
      url: job.absolute_url ?? `https://job-boards.greenhouse.io/${token}/jobs/${job.id}`,
      location: job.location?.name,
      department: job.departments?.[0]?.name,
      updatedAt: job.updated_at?.slice(0, 10),
      content: htmlToText(decodeEntities(job.content ?? "")),
    }));
}

async function readLever(token: string, ctx: CollectorContext): Promise<Posting[]> {
  type LeverPost = {
    text?: string;
    hostedUrl?: string;
    createdAt?: number;
    descriptionPlain?: string;
    categories?: { team?: string; location?: string; commitment?: string };
    lists?: Array<{ text?: string; content?: string }>;
  };
  const data = await fetchJson<LeverPost[]>(`https://api.lever.co/v0/postings/${token}?mode=json`, {
    signal: ctx.signal,
    retries: 1,
    maxBytes: 6_000_000,
  });
  return (data ?? [])
    .filter((post) => post.text)
    .map((post) => ({
      title: collapse(post.text as string),
      url: post.hostedUrl ?? `https://jobs.lever.co/${token}`,
      location: post.categories?.location,
      department: post.categories?.team,
      updatedAt: post.createdAt ? new Date(post.createdAt).toISOString().slice(0, 10) : undefined,
      content: [
        post.descriptionPlain ?? "",
        ...(post.lists ?? []).map((list) => `${list.text ?? ""}\n${htmlToText(list.content ?? "")}`),
      ].join("\n"),
    }));
}

async function readAshby(token: string, ctx: CollectorContext): Promise<Posting[]> {
  type AshbyJob = {
    title?: string;
    jobUrl?: string;
    location?: string;
    department?: string;
    team?: string;
    publishedAt?: string;
    descriptionPlain?: string;
  };
  const data = await fetchJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`,
    { signal: ctx.signal, retries: 1, maxBytes: 6_000_000 },
  );
  return (data?.jobs ?? [])
    .filter((job) => job.title)
    .map((job) => ({
      title: collapse(job.title as string),
      url: job.jobUrl ?? `https://jobs.ashbyhq.com/${token}`,
      location: job.location,
      department: job.department ?? job.team,
      updatedAt: job.publishedAt?.slice(0, 10),
      content: job.descriptionPlain ?? "",
    }));
}

/**
 * Last resort for companies on a bespoke careers page: read job-looking links
 * and fetch a few of them. Lower yield than a board API, but better than
 * reporting no hiring activity at all.
 */
async function scrapeCareersPage(company: Company, ctx: CollectorContext): Promise<Posting[]> {
  for (const candidate of careersUrls(company)) {
    const response = await fetchText(candidate, { signal: ctx.signal, retries: 0 });
    if (!response.ok || !isHtml(response.contentType, response.body)) continue;

    const links = extractLinks(response.body, response.url, false)
      .filter((link) => /\/(job|jobs|careers|position|opening|role)s?\//i.test(link.url))
      .filter((link) => link.text.length > 6 && link.text.length < 120)
      .filter((link) => TECHNICAL_TITLE.test(link.text) && !NON_TECHNICAL_TITLE.test(link.text));
    if (links.length < 2) continue;

    log.debug("jobs", `careers page scrape ${response.url} -> ${links.length} candidate roles`);
    const shortlist = links.slice(0, Math.min(20, ctx.config.research.maxJobs));
    const pages = await mapWithConcurrency(shortlist, 3, async (link) => {
      const page = await fetchText(link.url, { signal: ctx.signal, retries: 0, maxBytes: 900_000 });
      const text = page.ok && isHtml(page.contentType, page.body) ? parsePage(page.body).text : "";
      return {
        title: collapse(link.text),
        url: link.url,
        content: text,
      } satisfies Posting;
    });
    return pages.filter((posting) => posting.content.length > 200 || posting.title.length > 10);
  }
  return [];
}

function technologiesIn(text: string): string[] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9+#. ]+/g, " ")} `;
  const found: string[] = [];
  for (const tech of TECHNOLOGIES) {
    if (haystack.includes(` ${tech} `)) found.push(tech);
  }
  return found;
}

function seniorityOf(title: string): string {
  for (const [label, pattern] of SENIORITY) {
    if (pattern.test(title)) return label;
  }
  return "unspecified";
}

function domainOf(text: string): string {
  for (const [label, pattern] of DOMAINS) {
    if (pattern.test(text)) return label;
  }
  return "other";
}

function tally(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function format(counts: Map<string, number>, limit = 12): string {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!entries.length) return "none";
  return entries.map(([key, count]) => `${key} (${count})`).join(", ");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
