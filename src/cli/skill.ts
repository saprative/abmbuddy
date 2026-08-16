import { checkbox, select } from "@inquirer/prompts";
import { installSkill, removeSkill, type InstallResult } from "../skills/install.js";
import { SKILL_TARGETS, defaultHome, type SkillScope } from "../skills/targets.js";
import { pc, rule, symbols } from "./ui/theme.js";

/**
 * `abmbuddy skill install` — copies the ABMBuddy agent skill into the places
 * coding agents look for standing instructions, so Claude Code, Codex,
 * Antigravity and the rest can drive the CLI correctly without being told how
 * every time.
 */
export type SkillCommandOptions = {
  /** Target ids, or "all". */
  agents?: string[];
  all?: boolean;
  scope?: SkillScope;
  remove?: boolean;
  dryRun?: boolean;
  yes?: boolean;
};

export async function runSkillCommand(options: SkillCommandOptions): Promise<number> {
  const home = defaultHome();
  const cwd = process.cwd();
  const interactive = Boolean(process.stdout.isTTY) && !options.yes;

  const scope: SkillScope =
    options.scope ??
    (interactive && !options.all
      ? await select<SkillScope>({
          message: "Install the skill for",
          choices: [
            { name: "Me — every project on this machine", value: "global" },
            { name: "This project only", value: "project" },
          ],
        })
      : "global");

  const available = SKILL_TARGETS.filter((target) => target.scopes.includes(scope));
  let ids: string[];

  if (options.all) {
    ids = available.map((target) => target.id);
  } else if (options.agents?.length) {
    ids = options.agents.flatMap((value) => value.split(",")).map((value) => value.trim().toLowerCase());
    const unknown = ids.filter((id) => !available.some((target) => target.id === id));
    if (unknown.length) {
      process.stderr.write(
        `${pc.red(symbols.fail)} Unknown or unsupported agent(s) for ${scope} scope: ${unknown.join(", ")}\n` +
          `  Available: ${available.map((target) => target.id).join(", ")}\n`,
      );
      return 1;
    }
  } else if (interactive) {
    const detected = available.filter((target) => target.detect(cwd, home));
    ids = await checkbox<string>({
      message: `Which agents should get the ABMBuddy skill?  ${pc.dim("(a selects all)")}`,
      shortcuts: { all: "a", invert: "i" },
      pageSize: 12,
      choices: available.map((target) => ({
        value: target.id,
        name: `${target.label}${detected.includes(target) ? pc.green("  found") : ""}`,
        description: target.docs,
        checked: detected.includes(target),
      })),
    });
  } else {
    ids = available.map((target) => target.id);
  }

  if (!ids.length) {
    process.stdout.write(pc.dim("No agents selected.\n"));
    return 0;
  }

  const results = options.remove
    ? await removeSkill({ targets: ids, scope, cwd, home })
    : await installSkill({
        targets: ids,
        scope,
        cwd,
        home,
        ...(options.dryRun ? { dryRun: true } : {}),
      });

  report(results, Boolean(options.dryRun), Boolean(options.remove));
  return 0;
}

function report(results: InstallResult[], dryRun: boolean, removing: boolean): void {
  if (!results.length) {
    process.stdout.write(pc.dim("Nothing to do.\n"));
    return;
  }

  process.stdout.write(
    `\n${pc.bold(dryRun ? "Would write" : removing ? "Removed" : "Installed")}\n${rule()}\n`,
  );
  for (const result of results) {
    const mark =
      result.action === "missing"
        ? pc.dim(symbols.skip)
        : result.action === "unchanged"
          ? pc.dim(symbols.ok)
          : pc.green(symbols.ok);
    const note = result.action === "unchanged" ? pc.dim(" (already current)") : result.action === "missing" ? pc.dim(" (not installed)") : "";
    process.stdout.write(`${mark} ${result.target.label.padEnd(34)} ${pc.dim(result.path)}${note}\n`);
  }

  if (!dryRun && !removing) {
    process.stdout.write(
      pc.dim("\nAgents pick this up on their next session. Re-run after upgrading ABMBuddy to refresh it.\n"),
    );
  }
}

/** Offered once during first-run setup; never nags. */
export async function offerSkillInstall(): Promise<void> {
  const choice = await select<"all" | "select" | "skip">({
    message: "Teach your coding agents to use ABMBuddy?",
    choices: [
      { name: "Yes — set up every agent found on this machine", value: "all" },
      { name: "Let me choose which agents", value: "select" },
      { name: "Not now", value: "skip" },
    ],
  });
  if (choice === "skip") {
    process.stdout.write(pc.dim("You can do this later with `abmbuddy skill install`.\n"));
    return;
  }
  if (choice === "all") {
    const home = defaultHome();
    const cwd = process.cwd();
    const detected = SKILL_TARGETS.filter(
      (target) => target.scopes.includes("global") && target.detect(cwd, home),
    ).map((target) => target.id);
    if (!detected.length) {
      process.stdout.write(pc.dim("No coding agents detected on this machine. Skipping.\n"));
      return;
    }
    report(await installSkill({ targets: detected, scope: "global", cwd, home }), false, false);
    return;
  }
  await runSkillCommand({ scope: "global" });
}
