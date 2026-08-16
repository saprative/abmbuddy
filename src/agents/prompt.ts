import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "../config/paths.js";
import { log } from "../util/logger.js";

/**
 * Agent instructions live in plain Markdown next to the agent that uses them,
 * so changing how ABMBuddy sells is a text edit and not a code change.
 *
 * A user can override any prompt without forking: drop a file at
 * ~/.config/abmbuddy/prompts/<agent>.md and it wins over the built-in one.
 */
export function readPrompt(moduleUrl: string, agentName: string, file = "prompt.md"): string {
  const override = join(configDir(), "prompts", `${agentName}.md`);
  try {
    const custom = readFileSync(override, "utf8");
    if (custom.trim()) {
      log.debug("prompt", `using override ${override}`);
      return custom;
    }
  } catch {
    // No override: the normal case.
  }
  return readFileSync(join(dirname(fileURLToPath(moduleUrl)), file), "utf8");
}

/** Where a user should put a prompt override. Shown by `abmbuddy config`. */
export function promptOverrideDir(): string {
  return join(configDir(), "prompts");
}
