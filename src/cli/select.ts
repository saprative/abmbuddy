import { checkbox, confirm, input, select } from "@inquirer/prompts";
import type { CRMProvider } from "../crm/provider.js";
import type { Company } from "../models/company.js";
import type { Product } from "../models/product.js";
import { errorMessage } from "../util/logger.js";
import { pc, symbols, truncate } from "./ui/theme.js";

/**
 * Account selection. "Select all" means every account matching the current
 * filter across every page HubSpot returned — never just the page on screen.
 */
export type SelectOptions = {
  /** Skip the prompts and take everything matching. */
  all?: boolean;
  /** Pre-applied filter, e.g. from `--query`. */
  query?: string;
  /** Safety cap when listing an entire portal. */
  limit?: number;
};

export async function selectAccounts(
  crm: CRMProvider,
  options: SelectOptions = {},
): Promise<Company[]> {
  const query =
    options.query ??
    (options.all
      ? ""
      : (
          await input({
            message: "Filter accounts by name or domain (blank lists everything)",
            default: "",
          })
        ).trim());

  const companies = await loadCompanies(crm, query, options.limit);
  if (!companies.length) {
    process.stderr.write(pc.yellow(`${symbols.warn} No companies matched.\n`));
    return [];
  }

  if (options.all) {
    process.stderr.write(`${companies.length} account(s) selected.\n`);
    return companies;
  }

  const selected = await checkbox<Company>({
    message: `Select accounts  ${pc.dim("(space toggles · a selects all · i inverts · enter continues)")}`,
    pageSize: 15,
    loop: false,
    shortcuts: { all: "a", invert: "i" },
    choices: companies.map((company) => ({
      value: company,
      name: `${company.name}${company.domain ? pc.dim(`  ${company.domain}`) : ""}`,
      short: company.name,
    })),
  });

  return selected;
}

async function loadCompanies(
  crm: CRMProvider,
  query: string,
  limit: number | undefined,
): Promise<Company[]> {
  const cap = limit ?? 1000;
  let lastReported = 0;
  const companies = await crm.getCompanies({
    ...(query ? { query } : {}),
    limit: cap,
    onPage: (loaded) => {
      if (loaded - lastReported >= 100 && process.stdout.isTTY) {
        lastReported = loaded;
        process.stderr.write(pc.dim(`  loaded ${loaded} accounts…\n`));
      }
    },
  });
  if (companies.length >= cap) {
    process.stderr.write(
      pc.yellow(
        `${symbols.warn} Stopped at ${cap} accounts. Narrow the filter, or raise the cap with --limit.\n`,
      ),
    );
  }
  return companies;
}

/** The "12 accounts selected. Start deep research?" gate. */
export async function confirmResearch(companies: Company[]): Promise<boolean> {
  if (!companies.length) return false;
  const preview = companies
    .slice(0, 5)
    .map((company) => company.name)
    .join(", ");
  process.stderr.write(
    `\n${pc.bold(`${companies.length} account(s) selected.`)} ${pc.dim(
      truncate(preview + (companies.length > 5 ? `, +${companies.length - 5} more` : ""), 100),
    )}\n`,
  );
  return confirm({ message: "Start deep research?", default: true });
}

/**
 * Which product is this run positioning? Pulled from the CRM catalogue so the
 * answer matches what the team actually sells, rather than a sentence someone
 * typed into config once.
 */
export async function selectProduct(
  crm: CRMProvider,
  options: { preset?: string; interactive: boolean } = { interactive: true },
): Promise<Product | undefined> {
  let products: Product[] = [];
  try {
    products = await crm.getProducts();
  } catch (error) {
    // A portal with no product catalogue, or no scope to read it, should not
    // stop a research run.
    process.stderr.write(pc.dim(`  Could not read products from HubSpot (${errorMessage(error)}).\n`));
    return undefined;
  }

  if (options.preset) {
    const wanted = options.preset.trim().toLowerCase();
    const match =
      products.find((product) => product.id === options.preset) ??
      products.find((product) => product.name.toLowerCase() === wanted) ??
      products.find((product) => product.name.toLowerCase().includes(wanted));
    if (!match) {
      throw new Error(
        `No HubSpot product matched "${options.preset}". Run \`abmbuddy research\` without --product to pick from the list.`,
      );
    }
    return match;
  }

  if (!products.length || !options.interactive) return undefined;

  const choice = await select<Product | undefined>({
    message: "Which product are you positioning?",
    pageSize: 12,
    choices: [
      ...products.map((product) => ({
        name: product.name + (product.price ? pc.dim(`  ${product.price}`) : ""),
        value: product as Product | undefined,
        description: product.description ? truncate(product.description, 140) : undefined,
      })),
      { name: pc.dim("None — use my configured value proposition"), value: undefined },
    ],
  });
  return choice;
}
