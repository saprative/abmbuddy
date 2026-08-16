import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where each agent platform looks for standing instructions. One canonical
 * skill, adapted per target: some want a dedicated file with frontmatter,
 * others want a section inside a shared instructions file.
 *
 * Paths follow each platform's own documentation. Shared files are never
 * overwritten — the skill goes in as a delimited block that can be updated or
 * removed without touching anything else in the file.
 */

export type SkillScope = "global" | "project";

/** "file" owns the whole file; "block" is a managed section inside a shared one. */
export type WriteMode = "file" | "block";

export type ResolvedTarget = {
  path: string;
  mode: WriteMode;
  render: (body: string) => string;
};

export type SkillTarget = {
  id: string;
  label: string;
  /** Shown in the CLI so a user can check the claim. */
  docs: string;
  scopes: SkillScope[];
  resolve(scope: SkillScope, cwd: string, home: string): ResolvedTarget | undefined;
  /** Heuristic used to pre-select the agents that look present. */
  detect(cwd: string, home: string): boolean;
};

const SKILL_NAME = "abmbuddy";

const DESCRIPTION =
  "Research B2B accounts with the abmbuddy CLI: evidence-backed signals, hypotheses, " +
  "stakeholder maps, approach plans, outreach and collateral from public sources and HubSpot. " +
  "Use when asked to research a company or account, build an account plan, or prepare outreach.";

/** Claude Code skills carry name/description frontmatter. */
function claudeSkill(body: string): string {
  return `---\nname: ${SKILL_NAME}\ndescription: ${DESCRIPTION}\n---\n\n${body}`;
}

/** Cursor rules use .mdc with its own frontmatter keys. */
function cursorRule(body: string): string {
  return `---\ndescription: ${DESCRIPTION}\nalwaysApply: false\n---\n\n${body}`;
}

/** Plain Markdown, for targets that take a bare rules file or a shared block. */
function plain(body: string): string {
  return body;
}

export const SKILL_TARGETS: SkillTarget[] = [
  {
    id: "claude",
    label: "Claude Code",
    docs: "~/.claude/skills/ or .claude/skills/",
    scopes: ["global", "project"],
    resolve(scope, cwd, home) {
      const base = scope === "global" ? join(home, ".claude") : join(cwd, ".claude");
      return { path: join(base, "skills", SKILL_NAME, "SKILL.md"), mode: "file", render: claudeSkill };
    },
    detect: (cwd, home) => existsSync(join(home, ".claude")) || existsSync(join(cwd, ".claude")),
  },
  {
    id: "codex",
    label: "Codex CLI",
    docs: "~/.codex/AGENTS.md or ./AGENTS.md",
    scopes: ["global", "project"],
    resolve(scope, cwd, home) {
      const path = scope === "global" ? join(home, ".codex", "AGENTS.md") : join(cwd, "AGENTS.md");
      return { path, mode: "block", render: plain };
    },
    detect: (cwd, home) => existsSync(join(home, ".codex")) || existsSync(join(cwd, "AGENTS.md")),
  },
  {
    id: "antigravity",
    label: "Antigravity",
    docs: ".agents/rules/ or ~/.gemini/GEMINI.md",
    scopes: ["global", "project"],
    resolve(scope, cwd, home) {
      if (scope === "global") {
        return { path: join(home, ".gemini", "GEMINI.md"), mode: "block", render: plain };
      }
      // Antigravity defaults to .agents/rules and keeps .agent/rules working;
      // write to whichever the workspace already uses.
      const legacy = join(cwd, ".agent", "rules");
      const dir = existsSync(legacy) && !existsSync(join(cwd, ".agents", "rules")) ? legacy : join(cwd, ".agents", "rules");
      return { path: join(dir, `${SKILL_NAME}.md`), mode: "file", render: plain };
    },
    detect: (cwd, home) =>
      existsSync(join(cwd, ".agents")) || existsSync(join(cwd, ".agent")) || existsSync(join(home, ".gemini")),
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    docs: "~/.gemini/GEMINI.md or ./GEMINI.md",
    scopes: ["global", "project"],
    resolve(scope, cwd, home) {
      const path = scope === "global" ? join(home, ".gemini", "GEMINI.md") : join(cwd, "GEMINI.md");
      return { path, mode: "block", render: plain };
    },
    detect: (cwd, home) => existsSync(join(home, ".gemini")) || existsSync(join(cwd, "GEMINI.md")),
  },
  {
    id: "cursor",
    label: "Cursor",
    docs: ".cursor/rules/",
    scopes: ["project"],
    resolve(scope, cwd) {
      if (scope !== "project") return undefined;
      return { path: join(cwd, ".cursor", "rules", `${SKILL_NAME}.mdc`), mode: "file", render: cursorRule };
    },
    detect: (cwd) => existsSync(join(cwd, ".cursor")),
  },
  {
    id: "windsurf",
    label: "Windsurf",
    docs: ".windsurf/rules/",
    scopes: ["project"],
    resolve(scope, cwd) {
      if (scope !== "project") return undefined;
      return { path: join(cwd, ".windsurf", "rules", `${SKILL_NAME}.md`), mode: "file", render: plain };
    },
    detect: (cwd) => existsSync(join(cwd, ".windsurf")),
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    docs: ".github/copilot-instructions.md",
    scopes: ["project"],
    resolve(scope, cwd) {
      if (scope !== "project") return undefined;
      return { path: join(cwd, ".github", "copilot-instructions.md"), mode: "block", render: plain };
    },
    detect: (cwd) => existsSync(join(cwd, ".github")),
  },
  {
    id: "agents",
    label: "AGENTS.md (any agent that reads it)",
    docs: "./AGENTS.md",
    scopes: ["project"],
    resolve(scope, cwd) {
      if (scope !== "project") return undefined;
      return { path: join(cwd, "AGENTS.md"), mode: "block", render: plain };
    },
    detect: (cwd) => existsSync(join(cwd, "AGENTS.md")),
  },
];

export function findTarget(id: string): SkillTarget | undefined {
  return SKILL_TARGETS.find((target) => target.id === id.toLowerCase());
}

export function defaultHome(): string {
  return homedir();
}
