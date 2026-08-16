#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { errorMessage, log, setVerbose } from "../util/logger.js";
import { closeBrowser } from "../util/browser.js";
import { runConfigCommand, showConfig } from "./config.js";
import { runInteractive } from "./interactive.js";
import { loginHubSpot, logoutHubSpot } from "./login.js";
import { runResearch } from "./research.js";
import { runSkillCommand } from "./skill.js";
import { pc, symbols } from "./ui/theme.js";

// The AI SDK logs provider warnings straight to the console, which would cut
// through the progress display. Route them to the debug log instead; --verbose
// still shows them.
(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = (options: {
  warnings: Array<{ message?: string; type?: string }>;
}) => {
  for (const warning of options.warnings ?? []) {
    log.debug("ai-sdk", warning.message ?? JSON.stringify(warning));
  }
};

const program = new Command();

program
  .name("abmbuddy")
  .description("Open-source agentic account research and outreach for HubSpot.")
  .version(readVersion(), "-V, --version")
  .option("-v, --verbose", "print detailed logs to stderr")
  .hook("preAction", (command) => {
    if (command.opts().verbose) setVerbose(true);
  });

program
  .command("research", { isDefault: false })
  .description("Research accounts from HubSpot, or a domain directly")
  .argument("[targets...]", "domains or company names, e.g. stripe.com")
  .option("--hubspot", "select accounts from the connected HubSpot portal")
  .option("--all", "research every account matching the filter, without prompting")
  .option("--query <text>", "filter HubSpot accounts by name or domain")
  .option("--limit <n>", "maximum accounts to load from the CRM", parseIntArg)
  .option("--concurrency <n>", "accounts researched in parallel", parseIntArg)
  .option("--json", "print structured JSON instead of the terminal brief")
  .option("-y, --yes", "answer prompts automatically (non-interactive)")
  .option("--write", "write results back to HubSpot without asking")
  .option("--no-write", "never write results back to HubSpot")
  .option("--no-outreach", "skip the outreach agent")
  .option("--no-stakeholders", "skip stakeholder mapping")
  .option("--no-strategy", "skip the approach strategy")
  .option("--no-collateral", "skip collateral generation")
  .option("--product <name>", "HubSpot product to position this run around")
  .option("--save <dir>", "write generated collateral into a directory as Markdown")
  .action(async (targets: string[], options: Record<string, unknown>) => {
    const code = await runResearch({
      ...(targets.length ? { targets } : {}),
      ...(options.hubspot ? { hubspot: true } : {}),
      ...(options.all ? { all: true } : {}),
      ...(typeof options.query === "string" ? { query: options.query } : {}),
      ...(typeof options.limit === "number" ? { limit: options.limit } : {}),
      ...(typeof options.concurrency === "number" ? { concurrency: options.concurrency } : {}),
      ...(options.json ? { json: true } : {}),
      ...(options.yes ? { yes: true } : {}),
      // commander sets write=false only when --no-write was passed.
      ...(options.write === false ? { write: false } : {}),
      ...(options.write === true ? { write: true } : {}),
      ...(options.outreach === false ? { noOutreach: true } : {}),
      ...(options.stakeholders === false ? { noStakeholders: true } : {}),
      ...(options.strategy === false ? { noStrategy: true } : {}),
      ...(options.collateral === false ? { noCollateral: true } : {}),
      ...(typeof options.product === "string" ? { product: options.product } : {}),
      ...(typeof options.save === "string" ? { save: options.save } : {}),
    });
    process.exitCode = code;
  });

program
  .command("login")
  .description("Connect a CRM")
  .argument("[provider]", "crm provider", "hubspot")
  .option("--token <token>", "private app service token (non-interactive)")
  .option("--token-file <path>", "read the service token from a file")
  .option("--token-stdin", "read the service token from stdin")
  .action(async (provider: string, options: { token?: string; tokenFile?: string; tokenStdin?: boolean }) => {
    assertHubSpot(provider);
    await loginHubSpot({
      ...(options.token ? { token: options.token } : {}),
      ...(options.tokenFile ? { tokenFile: options.tokenFile } : {}),
      ...(options.tokenStdin ? { tokenStdin: true } : {}),
    });
  });

program
  .command("logout")
  .description("Disconnect a CRM and delete its stored credentials")
  .argument("[provider]", "crm provider", "hubspot")
  .action(async (provider: string) => {
    assertHubSpot(provider);
    await logoutHubSpot();
  });

program
  .command("skill")
  .description("Install the ABMBuddy skill into your coding agents (Claude Code, Codex, Antigravity, …)")
  .argument("[action]", "install or remove", "install")
  .option("--agents <ids>", "comma-separated agent ids, e.g. claude,codex,antigravity")
  .option("--all", "every supported agent")
  .option("--global", "install for every project on this machine")
  .option("--project", "install into the current project only")
  .option("--dry-run", "show what would be written without writing it")
  .option("-y, --yes", "no prompts")
  .action(async (action: string, options: Record<string, unknown>) => {
    const scope = options.project ? "project" : options.global ? "global" : undefined;
    process.exitCode = await runSkillCommand({
      ...(typeof options.agents === "string" ? { agents: [options.agents] } : {}),
      ...(options.all ? { all: true } : {}),
      ...(scope ? { scope } : {}),
      ...(action === "remove" ? { remove: true } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
      ...(options.yes ? { yes: true } : {}),
    });
  });

program
  .command("config")
  .description("View and change configuration")
  .option("--show", "print the current configuration and exit")
  .action(async (options: { show?: boolean }) => {
    if (options.show) {
      await showConfig(await loadConfig(true));
      return;
    }
    await runConfigCommand();
  });

program.action(async () => {
  process.exitCode = await runInteractive();
});

function assertHubSpot(provider: string): void {
  if (provider.toLowerCase() !== "hubspot") {
    throw new Error(`Unknown CRM provider "${provider}". Only "hubspot" is supported today.`);
  }
}

function parseIntArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive number, got "${value}"`);
  return parsed;
}

function readVersion(): string {
  for (const relative of ["../../package.json", "../../../package.json"]) {
    try {
      const path = join(dirname(fileURLToPath(import.meta.url)), relative);
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // Try the next location.
    }
  }
  return "0.0.0";
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (isPromptCancellation(error)) {
    process.stdout.write(pc.dim("\nCancelled.\n"));
    process.exitCode = 130;
  } else {
    process.stderr.write(`${pc.red(symbols.fail)} ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
} finally {
  await closeBrowser();
}

/** Ctrl-C inside an inquirer prompt is a normal exit, not a crash. */
function isPromptCancellation(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === "ExitPromptError" || name === "AbortPromptError";
}
