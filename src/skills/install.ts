import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../util/logger.js";
import { findTarget, type SkillScope, type SkillTarget } from "./targets.js";

/**
 * Installs the ABMBuddy agent skill into whichever agent platforms the user
 * picked. Shared instruction files (AGENTS.md, GEMINI.md, copilot-instructions)
 * are edited surgically: the skill lives between two markers, so installing,
 * updating and removing it never disturbs anything else in the file.
 */

const START = "<!-- abmbuddy:skill:start -->";
const END = "<!-- abmbuddy:skill:end -->";

export type InstallAction = "created" | "updated" | "unchanged" | "removed" | "missing";

export type InstallResult = {
  target: SkillTarget;
  scope: SkillScope;
  path: string;
  action: InstallAction;
};

/** The canonical skill body, shared by every target. */
export function readSkillBody(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "abmbuddy.md"), "utf8");
}

export type InstallOptions = {
  targets: string[];
  scope: SkillScope;
  cwd?: string;
  home: string;
  dryRun?: boolean;
};

export async function installSkill(options: InstallOptions): Promise<InstallResult[]> {
  const body = readSkillBody();
  const cwd = options.cwd ?? process.cwd();
  const results: InstallResult[] = [];
  const written = new Set<string>();

  for (const id of options.targets) {
    const target = findTarget(id);
    if (!target) continue;
    const resolved = target.resolve(options.scope, cwd, options.home);
    if (!resolved) continue;

    // Several targets legitimately share a file (Codex and AGENTS.md, or
    // Antigravity and Gemini CLI globally). Write once, report for each.
    if (written.has(resolved.path)) {
      results.push({ target, scope: options.scope, path: resolved.path, action: "unchanged" });
      continue;
    }
    written.add(resolved.path);

    const content = resolved.render(body).trimEnd() + "\n";
    const action = options.dryRun
      ? await previewAction(resolved.path, resolved.mode, content)
      : resolved.mode === "file"
        ? await writeWholeFile(resolved.path, content)
        : await upsertBlockInFile(resolved.path, content);

    log.debug("skill", `${action} ${resolved.path}`);
    results.push({ target, scope: options.scope, path: resolved.path, action });
  }

  return results;
}

export async function removeSkill(options: Omit<InstallOptions, "dryRun">): Promise<InstallResult[]> {
  const { rm } = await import("node:fs/promises");
  const cwd = options.cwd ?? process.cwd();
  const results: InstallResult[] = [];
  const handled = new Set<string>();

  for (const id of options.targets) {
    const target = findTarget(id);
    if (!target) continue;
    const resolved = target.resolve(options.scope, cwd, options.home);
    if (!resolved || handled.has(resolved.path)) continue;
    handled.add(resolved.path);

    const existing = await readIfPresent(resolved.path);
    if (existing === undefined) {
      results.push({ target, scope: options.scope, path: resolved.path, action: "missing" });
      continue;
    }

    if (resolved.mode === "file") {
      await rm(resolved.path, { force: true });
      results.push({ target, scope: options.scope, path: resolved.path, action: "removed" });
      continue;
    }

    const stripped = stripBlock(existing);
    if (stripped === existing) {
      results.push({ target, scope: options.scope, path: resolved.path, action: "missing" });
      continue;
    }
    // A shared file that held nothing but our block was ours to begin with —
    // leaving an empty file behind would be litter.
    if (stripped.trim()) {
      await writeFile(resolved.path, stripped, "utf8");
    } else {
      await rm(resolved.path, { force: true });
    }
    results.push({ target, scope: options.scope, path: resolved.path, action: "removed" });
  }

  return results;
}

async function writeWholeFile(path: string, content: string): Promise<InstallAction> {
  const existing = await readIfPresent(path);
  if (existing === content) return "unchanged";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return existing === undefined ? "created" : "updated";
}

/**
 * Replaces the managed block if one is present, appends it otherwise. The rest
 * of the file — which the user wrote — is preserved byte for byte.
 */
async function upsertBlockInFile(path: string, content: string): Promise<InstallAction> {
  const existing = await readIfPresent(path);
  const block = `${START}\n${content.trimEnd()}\n${END}`;

  if (existing === undefined) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${block}\n`, "utf8");
    return "created";
  }

  const next = hasBlock(existing) ? replaceBlock(existing, block) : `${existing.trimEnd()}\n\n${block}\n`;
  if (next === existing) return "unchanged";
  await writeFile(path, next, "utf8");
  return "updated";
}

async function previewAction(path: string, mode: string, content: string): Promise<InstallAction> {
  const existing = await readIfPresent(path);
  if (existing === undefined) return "created";
  if (mode === "file") return existing === content ? "unchanged" : "updated";
  return "updated";
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function hasBlock(content: string): boolean {
  return content.includes(START) && content.includes(END);
}

function replaceBlock(content: string, block: string): string {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start === -1 || end === -1 || end < start) return content;
  return content.slice(0, start) + block + content.slice(end + END.length);
}

function stripBlock(content: string): string {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start === -1 || end === -1 || end < start) return content;
  const before = content.slice(0, start).trimEnd();
  const after = content.slice(end + END.length).trimStart();
  if (!before) return after;
  if (!after) return `${before}\n`;
  return `${before}\n\n${after}`;
}

export { START as SKILL_BLOCK_START, END as SKILL_BLOCK_END };
