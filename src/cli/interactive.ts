import { input, select } from "@inquirer/prompts";
import { isLlmConfigured, loadConfig, updateConfig } from "../config/index.js";
import { resolveApiKey } from "../llm/provider.js";
import type { LlmProviderName } from "../config/index.js";
import { ensureLlmConfigured, runConfigCommand, showConfig } from "./config.js";
import { isHubSpotConnected, loginHubSpot } from "./login.js";
import { runResearch } from "./research.js";
import { offerSkillInstall, runSkillCommand } from "./skill.js";
import { pc, symbols } from "./ui/theme.js";

/**
 * `npx abmbuddy` with no arguments.
 *
 * Onboarding is three steps — CRM, model, coding agents — and each is skipped
 * silently once it is done, so a returning user drops straight into the menu.
 */
export async function runInteractive(): Promise<number> {
  banner();

  const before = await loadConfig(true);
  const needsCrm = !(await isHubSpotConnected());
  const needsLlm =
    !isLlmConfigured(before) || !(await resolveApiKey(before.llm.provider as LlmProviderName));
  const needsSkill = !before.skills.offeredAt;
  const steps = [needsCrm, needsLlm, needsSkill].filter(Boolean).length;
  let step = 0;
  const heading = (title: string): void => {
    step += 1;
    if (steps > 1) process.stdout.write(`\n${pc.dim(`Step ${step} of ${steps}`)}  ${pc.bold(title)}\n`);
  };

  // 1. CRM ----------------------------------------------------------------
  let connected = !needsCrm;
  if (needsCrm) {
    heading("Connect your CRM");
    const choice = await select<"hubspot" | "skip">({
      message: "Connect CRM",
      choices: [
        { name: "HubSpot", value: "hubspot" },
        { name: "Skip for now (research a domain instead)", value: "skip" },
      ],
    });
    if (choice === "hubspot") {
      await loginHubSpot();
      connected = await isHubSpotConnected();
    }
  } else {
    process.stdout.write(`${pc.green(symbols.ok)} HubSpot connected\n`);
  }

  // 2. Model --------------------------------------------------------------
  if (needsLlm) {
    heading("Choose an AI provider");
    await ensureLlmConfigured();
  }

  // 3. Coding agents ------------------------------------------------------
  if (needsSkill) {
    heading("Set up your coding agents");
    process.stdout.write(
      pc.dim("  ABMBuddy can teach Claude Code, Codex, Antigravity and others to run it for you.\n"),
    );
    await offerSkillInstall();
    // Asked once. The menu still has it if the answer was "not now".
    await updateConfig({ skills: { offeredAt: new Date().toISOString() } });
  }

  while (true) {
    const action = await select<string>({
      message: "What would you like to do?",
      choices: connected
        ? [
            { name: "Research accounts", value: "research" },
            { name: "Research a domain", value: "domain" },
            { name: "Set up coding agents", value: "skill" },
            { name: "View configuration", value: "config" },
            { name: "Reconnect HubSpot", value: "reconnect" },
            { name: "Exit", value: "exit" },
          ]
        : [
            { name: "Research a domain", value: "domain" },
            { name: "Set up coding agents", value: "skill" },
            { name: "Connect HubSpot", value: "reconnect" },
            { name: "View configuration", value: "config" },
            { name: "Exit", value: "exit" },
          ],
    });

    if (action === "exit") return 0;
    if (action === "research") {
      await runResearch({ hubspot: true });
    } else if (action === "domain") {
      const target = await input({
        message: "Company domain (e.g. stripe.com)",
        validate: (value) => (value.trim() ? true : "Enter a domain or company name"),
      });
      await runResearch({ targets: [target.trim()] });
    } else if (action === "skill") {
      await runSkillCommand({});
    } else if (action === "config") {
      await runConfigCommand();
    } else if (action === "reconnect") {
      await loginHubSpot();
      connected = await isHubSpotConnected();
    }
    process.stdout.write("\n");
  }
}

function banner(): void {
  process.stdout.write(`\n${pc.bold("ABMBuddy")}\n${pc.dim("Open-source agentic account research.")}\n\n`);
}

export { showConfig };
