import { input, password, select } from "@inquirer/prompts";
import { loadConfig, updateConfig } from "../config/index.js";
import {
  HUBSPOT_SCOPES,
  clearTokens,
  connectPrivateApp,
  readTokens,
  redirectUri,
  runOAuthFlow,
} from "../crm/hubspot-auth.js";
import { createHubSpotProvider } from "../crm/hubspot.js";
import { pc, rule, symbols } from "./ui/theme.js";

/**
 * `abmbuddy login hubspot`. Two supported paths, both storing credentials in
 * the OS keychain: a browser OAuth flow against a HubSpot app you own, or a
 * pasted private app token.
 */
export async function loginHubSpot(): Promise<void> {
  const config = await loadConfig(true);
  const mode = await select<"oauth" | "private-app">({
    message: "How should ABMBuddy connect to HubSpot?",
    choices: [
      {
        name: "Private app access token (fastest — paste a token)",
        value: "private-app",
        description: "HubSpot → Settings → Integrations → Private apps → create an app and copy its token.",
      },
      {
        name: "OAuth (opens your browser — needs a HubSpot app you created)",
        value: "oauth",
        description: "Best when several people share the same HubSpot app, or you want refreshable tokens.",
      },
    ],
  });

  if (mode === "private-app") {
    process.stdout.write(
      [
        "",
        pc.bold("Create a private app in HubSpot"),
        rule(),
        "1. HubSpot → Settings → Integrations → Private apps → Create a private app",
        "2. On the Scopes tab, tick:",
        ...HUBSPOT_SCOPES.filter((scope) => scope !== "oauth").map((scope) => `     ${scope}`),
        "3. Create the app and copy the access token.",
        "",
      ].join("\n"),
    );
    const token = await password({ message: "Private app access token", mask: true });
    if (!token.trim()) throw new Error("No token entered.");
    const { portalId } = await connectPrivateApp(token.trim());
    process.stdout.write(
      `${pc.green(symbols.ok)} Connected to HubSpot${portalId ? ` (portal ${portalId})` : ""}\n`,
    );
    return;
  }

  const port = config.crm.redirectPort;
  process.stdout.write(
    [
      "",
      pc.bold("Create a HubSpot app for OAuth"),
      rule(),
      "1. https://developers.hubspot.com → your developer account → Apps → Create app",
      `2. Auth tab → add the redirect URL: ${pc.bold(redirectUri(config))}`,
      "3. Scopes: " + HUBSPOT_SCOPES.join(", "),
      "4. Copy the client ID and client secret.",
      "",
      pc.dim(`If port ${port} is taken, change crm.redirectPort with \`abmbuddy config\` first.`),
      "",
    ].join("\n"),
  );

  const clientId = await input({
    message: "Client ID",
    default: config.crm.clientId ?? "",
    validate: (value) => (value.trim() ? true : "Required"),
  });
  const clientSecret = await password({ message: "Client secret", mask: true });
  if (!clientSecret.trim()) throw new Error("No client secret entered.");

  const { portalId } = await runOAuthFlow(
    config,
    { clientId: clientId.trim(), clientSecret: clientSecret.trim() },
    {
      onUrl: (url) => {
        process.stdout.write(`\nOpening your browser to authorize ABMBuddy…\n${pc.dim(url)}\n\n`);
      },
    },
  );
  process.stdout.write(
    `${pc.green(symbols.ok)} Connected to HubSpot${portalId ? ` (portal ${portalId})` : ""}\n`,
  );
}

export async function logoutHubSpot(): Promise<void> {
  await clearTokens();
  await updateConfig({
    crm: { provider: undefined, authMode: undefined, portalId: undefined, connectedAt: undefined },
  });
  process.stdout.write(`${pc.green(symbols.ok)} Disconnected from HubSpot. Stored credentials were deleted.\n`);
}

/** Connects and verifies, so the CLI fails at login rather than mid-run. */
export async function connectedHubSpot(): Promise<ReturnType<typeof createHubSpotProvider>> {
  const config = await loadConfig(true);
  const provider = createHubSpotProvider(config);
  await provider.connect();
  return provider;
}

export async function isHubSpotConnected(): Promise<boolean> {
  return Boolean(await readTokens());
}
