import { input, select } from "@inquirer/prompts";
import { isLlmConfigured, loadConfig } from "../config/index.js";
import { resolveApiKey } from "../llm/provider.js";
import type { LlmProviderName } from "../config/index.js";
import { ensureLlmConfigured, runConfigCommand, showConfig } from "./config.js";
import { isHubSpotConnected, loginHubSpot } from "./login.js";
import { runResearch } from "./research.js";
import { offerSkillInstall, runSkillCommand } from "./skill.js";
import { pc, symbols } from "./ui/theme.js";

/**
 * `npx abmbuddy` with no arguments. First run connects a CRM and a model;
 * after that it is a four-item menu that gets out of the way.
 */
export async function runInteractive(): Promise<number> {
  banner();

  let connected = await isHubSpotConnected();
  if (!connected) {
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

  const config = await loadConfig(true);
  const firstRun = !isLlmConfigured(config) || !(await resolveApiKey(config.llm.provider as LlmProviderName));
  if (firstRun) {
    await ensureLlmConfigured();
    // Only offered once, at the end of setup, and easy to decline.
    await offerSkillInstall();
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
