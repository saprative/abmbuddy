import { confirm } from "@inquirer/prompts";
import { loadConfig } from "../config/index.js";
import type { CRMProvider } from "../crm/provider.js";
import { normalizeDomain, type Company } from "../models/company.js";
import type { Product } from "../models/product.js";
import type { AccountResearch, ResearchOutcome } from "../models/research.js";
import { researchAccounts } from "../orchestrator/index.js";
import { closeBrowser } from "../util/browser.js";
import { errorMessage } from "../util/logger.js";
import { buildRuntime } from "./context.js";
import { ensureLlmConfigured } from "./config.js";
import { connectedHubSpot, isHubSpotConnected } from "./login.js";
import { confirmResearch, selectAccounts, selectProduct } from "./select.js";
import { createProgressRenderer } from "./ui/progress.js";
import { renderResearch, summarize } from "./ui/render.js";
import { pc, rule, symbols } from "./ui/theme.js";

export type ResearchCommandOptions = {
  /** Domains or company names for a CRM-free run. */
  targets?: string[];
  /** Load accounts from the connected CRM. */
  hubspot?: boolean;
  /** Take every account matching the filter without prompting. */
  all?: boolean;
  query?: string;
  limit?: number;
  concurrency?: number;
  /** Print machine-readable output instead of the brief. */
  json?: boolean;
  /** Answer prompts automatically (write-back follows config). */
  yes?: boolean;
  /** Force write-back on or off, overriding the prompt. */
  write?: boolean;
  /** Skip the outreach agent. */
  noOutreach?: boolean;
  /** Skip the later stages, for cheaper runs. */
  noStakeholders?: boolean;
  noStrategy?: boolean;
  noCollateral?: boolean;
  /** Name or id of the HubSpot product to position this run around. */
  product?: string;
  /** Directory to write generated collateral into, as Markdown. */
  save?: string;
};

export async function runResearch(options: ResearchCommandOptions): Promise<number> {
  const interactive = Boolean(process.stdout.isTTY) && !options.yes && !options.json;

  // 1. Decide which accounts to research ----------------------------------
  let crm: CRMProvider | undefined;
  let companies: Company[];

  if (options.targets?.length) {
    companies = options.targets.map(toCompany);
  } else {
    if (!(await isHubSpotConnected())) {
      process.stderr.write(
        `${pc.red(symbols.fail)} No CRM connected and no target given.\n` +
          `  Connect one with ${pc.bold("abmbuddy login hubspot")}, or research a domain directly:\n` +
          `  ${pc.bold("abmbuddy research stripe.com")}\n`,
      );
      return 1;
    }
    crm = await connectedHubSpot();
    companies = await selectAccounts(crm, {
      ...(options.all ? { all: true } : {}),
      ...(options.query ? { query: options.query } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    });
    if (!companies.length) return 0;
    if (interactive && !options.all && !(await confirmResearch(companies))) return 0;
  }

  // The product being positioned comes from the CRM catalogue, so hypotheses
  // are ranked — and collateral written — against something real.
  let product: Product | undefined;
  if (crm) {
    product = await selectProduct(crm, {
      ...(options.product ? { preset: options.product } : {}),
      interactive,
    });
    if (product && !options.json) {
      process.stdout.write(`${pc.dim("Positioning:")} ${product.name}\n`);
    }
  }

  // 2. Make sure we can actually run before spending anyone's time --------
  if (interactive) await ensureLlmConfigured();
  const runtime = await buildRuntime(options.concurrency ? { concurrency: options.concurrency } : {});

  if (!options.json) {
    process.stdout.write(
      `\n${pc.dim(`Model: ${runtime.llm.describe()}  ·  Search: ${runtime.search.label}  ·  Concurrency: ${runtime.config.research.concurrency}`)}\n\n`,
    );
  }

  // 3. Run the pipeline ---------------------------------------------------
  const progress = options.json
    ? undefined
    : createProgressRenderer(companies, `Researching ${companies.length} account(s)…`);

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);

  let outcomes: ResearchOutcome[];
  try {
    outcomes = await researchAccounts(companies, {
      config: runtime.config,
      llm: runtime.llm,
      search: runtime.search,
      signal: controller.signal,
      ...(options.noOutreach ? { skipOutreach: true } : {}),
      ...(options.noStakeholders ? { skipStakeholders: true } : {}),
      ...(options.noStrategy ? { skipStrategy: true } : {}),
      ...(options.noCollateral ? { skipCollateral: true } : {}),
      ...(product ? { product } : {}),
      // Stakeholder mapping reads names and titles only — never contact details.
      ...(crm ? { loadContacts: (company: Company) => crm.getContacts(company.id as string) } : {}),
      ...(progress ? { onProgress: progress.onProgress } : {}),
      onAccount: (outcome, input) => {
        if (!progress) return;
        // Keyed on the input record: identity resolution may have given the
        // account a domain it did not arrive with.
        if (outcome.ok) progress.finish(input, summarize(outcome.research));
        else progress.fail(input, outcome.failure.error);
      },
    });
  } finally {
    progress?.stop();
    process.removeListener("SIGINT", onSigint);
    await closeBrowser();
  }

  const succeeded = outcomes.filter((outcome): outcome is { ok: true; research: AccountResearch } => outcome.ok);
  const failed = outcomes.filter((outcome) => !outcome.ok);

  // 4. Show results -------------------------------------------------------
  if (options.json) {
    process.stdout.write(`${JSON.stringify(toJson(outcomes), null, 2)}\n`);
  } else {
    for (const outcome of succeeded) {
      process.stdout.write(renderResearch(outcome.research));
      process.stdout.write(`${rule()}\n`);
    }
    for (const outcome of failed) {
      if (outcome.ok) continue;
      process.stdout.write(
        `${pc.red(symbols.fail)} ${outcome.failure.company.name}: ${outcome.failure.error}\n`,
      );
    }
  }

  // 5. Optionally save the collateral as files ----------------------------
  if (options.save && succeeded.length) {
    await saveCollateral(options.save, succeeded.map((outcome) => outcome.research), options.json === true);
  }

  // 6. Offer to write back ------------------------------------------------
  const writable = succeeded.filter((outcome) => outcome.research.company.id);
  if (crm && writable.length) {
    const config = await loadConfig();
    const shouldWrite =
      options.write ??
      (config.hubspot.autoWriteBack || options.yes
        ? true
        : interactive
          ? await confirm({ message: `Save research to HubSpot (${writable.length} account(s))?`, default: true })
          : false);
    if (shouldWrite) await writeBack(crm, writable.map((outcome) => outcome.research), options.json === true);
  }

  return failed.length && !succeeded.length ? 1 : 0;
}

async function writeBack(crm: CRMProvider, results: AccountResearch[], quiet: boolean): Promise<void> {
  let written = 0;
  for (const research of results) {
    const id = research.company.id;
    if (!id) continue;
    try {
      await crm.updateCompany(id, research);
      written += 1;
      if (!quiet) process.stdout.write(`${pc.green(symbols.ok)} ${research.company.name} updated in HubSpot\n`);
    } catch (error) {
      process.stderr.write(
        `${pc.red(symbols.fail)} ${research.company.name}: could not update HubSpot — ${errorMessage(error)}\n`,
      );
    }
  }
  if (!quiet && written) process.stdout.write(pc.dim(`\n${written} account(s) written back.\n`));
}

/** Writes generated collateral to disk as Markdown, one file per piece. */
async function saveCollateral(dir: string, results: AccountResearch[], quiet: boolean): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(dir, { recursive: true });
  let written = 0;
  for (const research of results) {
    if (!research.collateral) continue;
    const slug =
      research.company.domain?.replace(/[^a-z0-9]+/gi, "-") ??
      research.company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const files: Array<[string, string]> = [
      [`${slug}-personalized.md`, research.collateral.personalized.body],
      [`${slug}-general.md`, research.collateral.general.body],
    ];
    for (const [name, body] of files) {
      await writeFile(join(dir, name), `${body.trim()}\n`, "utf8");
      written += 1;
    }
  }
  if (!quiet && written) process.stdout.write(pc.dim(`\n${written} collateral file(s) written to ${dir}\n`));
}

function toCompany(target: string): Company {
  const domain = normalizeDomain(target);
  return {
    name: domain ?? target,
    ...(domain ? { domain } : {}),
    source: "cli",
  };
}

/**
 * JSON output keeps every conclusion and the provenance behind it, but not the
 * scraped page bodies — those are disposable by design.
 */
function toJson(outcomes: ResearchOutcome[]): unknown {
  return {
    generatedAt: new Date().toISOString(),
    accounts: outcomes.map((outcome) =>
      outcome.ok
        ? {
            status: "ok",
            company: outcome.research.company,
            collectors: outcome.research.collectors,
            evidence: outcome.research.evidence.map(({ id, sourceType, title, url, publishedAt }) => ({
              id,
              sourceType,
              title,
              url,
              publishedAt,
            })),
            extraction: outcome.research.extraction,
            signals: outcome.research.signals,
            hypotheses: outcome.research.hypotheses,
            stakeholders: outcome.research.stakeholders,
            strategy: outcome.research.strategy,
            outreach: outcome.research.outreach,
            collateral: outcome.research.collateral,
            product: outcome.research.product,
            warnings: outcome.research.warnings,
            startedAt: outcome.research.startedAt,
            finishedAt: outcome.research.finishedAt,
          }
        : { status: "failed", company: outcome.failure.company, error: outcome.failure.error },
    ),
  };
}
