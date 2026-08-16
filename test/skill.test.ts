import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installSkill, readSkillBody, removeSkill } from "../src/skills/install.ts";
import { SKILL_TARGETS } from "../src/skills/targets.ts";

/**
 * The installer edits files people already own. These tests pin the part that
 * could do damage: a managed block must never disturb the rest of a file.
 */

async function sandbox(): Promise<{ cwd: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), "abmbuddy-skill-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  await mkdir(cwd, { recursive: true });
  await mkdir(home, { recursive: true });
  return { cwd, home };
}

test("the skill body is packaged and describes non-interactive use", () => {
  const body = readSkillBody();
  assert.ok(body.includes("--json"));
  assert.ok(body.includes("--yes"));
  // Antigravity caps a rules file at 12,000 characters.
  assert.ok(body.length < 12_000, `skill is ${body.length} chars`);
});

test("file targets write a dedicated file with the right frontmatter", async () => {
  const { cwd, home } = await sandbox();
  const results = await installSkill({ targets: ["claude", "cursor"], scope: "project", cwd, home });

  const claude = results.find((result) => result.target.id === "claude");
  assert.equal(claude?.action, "created");
  assert.equal(claude?.path, join(cwd, ".claude", "skills", "abmbuddy", "SKILL.md"));
  const claudeBody = await readFile(claude?.path as string, "utf8");
  assert.ok(claudeBody.startsWith("---\nname: abmbuddy\n"));

  const cursor = results.find((result) => result.target.id === "cursor");
  assert.equal(cursor?.path, join(cwd, ".cursor", "rules", "abmbuddy.mdc"));
  const cursorBody = await readFile(cursor?.path as string, "utf8");
  assert.ok(cursorBody.includes("alwaysApply: false"));
});

test("a shared instructions file keeps everything the user wrote", async () => {
  const { cwd, home } = await sandbox();
  const agentsFile = join(cwd, "AGENTS.md");
  const original = "# House rules\n\nAlways run the linter before committing.\n";
  await writeFile(agentsFile, original, "utf8");

  await installSkill({ targets: ["agents"], scope: "project", cwd, home });
  const afterInstall = await readFile(agentsFile, "utf8");
  assert.ok(afterInstall.startsWith(original.trimEnd()));
  assert.ok(afterInstall.includes("abmbuddy:skill:start"));
  assert.ok(afterInstall.includes("Always run the linter"));

  // Re-installing replaces the block rather than appending a second copy.
  await installSkill({ targets: ["agents"], scope: "project", cwd, home });
  const afterSecond = await readFile(agentsFile, "utf8");
  assert.equal(afterSecond.match(/abmbuddy:skill:start/g)?.length, 1);

  // Removing takes the block back out and leaves the user's content intact.
  await removeSkill({ targets: ["agents"], scope: "project", cwd, home });
  const afterRemove = await readFile(agentsFile, "utf8");
  assert.equal(afterRemove.trim(), original.trim());
});

test("removing from a file we created deletes it rather than leaving it empty", async () => {
  const { cwd, home } = await sandbox();
  await installSkill({ targets: ["copilot"], scope: "project", cwd, home });
  const path = join(cwd, ".github", "copilot-instructions.md");
  assert.ok((await readFile(path, "utf8")).includes("abmbuddy"));

  await removeSkill({ targets: ["copilot"], scope: "project", cwd, home });
  await assert.rejects(readFile(path, "utf8"), "an empty shell was left behind");
});

test("targets that share a file are written once", async () => {
  const { cwd, home } = await sandbox();
  // Codex and the generic AGENTS.md target resolve to the same project file.
  const results = await installSkill({ targets: ["codex", "agents"], scope: "project", cwd, home });
  assert.equal(results.length, 2);
  assert.equal(results[0]?.action, "created");
  assert.equal(results[1]?.action, "unchanged");
  const body = await readFile(join(cwd, "AGENTS.md"), "utf8");
  assert.equal(body.match(/abmbuddy:skill:start/g)?.length, 1);
});

test("a second install with no changes reports unchanged", async () => {
  const { cwd, home } = await sandbox();
  await installSkill({ targets: ["claude"], scope: "global", cwd, home });
  const again = await installSkill({ targets: ["claude"], scope: "global", cwd, home });
  assert.equal(again[0]?.action, "unchanged");
  assert.equal(again[0]?.path, join(home, ".claude", "skills", "abmbuddy", "SKILL.md"));
});

test("dry run writes nothing", async () => {
  const { cwd, home } = await sandbox();
  const results = await installSkill({ targets: ["claude"], scope: "project", cwd, home, dryRun: true });
  assert.equal(results[0]?.action, "created");
  await assert.rejects(readFile(results[0]?.path as string, "utf8"));
});

test("every target resolves for the scopes it advertises", () => {
  for (const target of SKILL_TARGETS) {
    for (const scope of target.scopes) {
      const resolved = target.resolve(scope, "/tmp/project", "/tmp/home");
      assert.ok(resolved, `${target.id} advertises ${scope} but did not resolve`);
      assert.ok(resolved.path.startsWith("/tmp/"), `${target.id} resolved outside the sandbox`);
    }
  }
});
