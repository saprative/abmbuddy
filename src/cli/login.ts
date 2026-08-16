import { readFile } from "node:fs/promises";
import { input, password, select } from "@inquirer/prompts";
import { loadConfig, updateConfig } from "../config/index.js";
import {
  HUBSPOT_SCOPES,
  OPTIONAL_SCOPES,
  REQUIRED_SCOPES,
  clearTokens,
  connectWithToken,
  readTokens,
  redirectUri,
  runOAuthFlow,
} from "../crm/hubspot-auth.js";
import { createHubSpotProvider } from "../crm/hubspot.js";
import { pc, rule, symbols } from "./ui/theme.js";

export type LoginOptions = {
  /** A private app token supplied directly, for scripts and CI. */
  token?: string;
  /** Read the token from a file — keeps it out of shell history and `ps`. */
  tokenFile?: string;
  /** Read the token from stdin, e.g. `echo $KEY | abmbuddy login hubspot --token-stdin`. */
  tokenStdin?: boolean;
};

/**
 * `abmbuddy login hubspot`. Three ways in, all storing credentials in the OS
 * keychain: a service token passed non-interactively, a pasted private app
 * token, or a browser OAuth flow against a HubSpot app you own.
 */
export async function loginHubSpot(options: LoginOptions = {}): Promise<void> {
  const supplied = await readSuppliedToken(options);
  if (supplied) {
    await storeServiceToken(supplied);
    return;
  }

  const config = await loadConfig(true);
  const mode = await select<"token" | "oauth">({
    message: "How should ABMBuddy connect to HubSpot?",
    choices: [
      {
        name: "Service key or private app token (fastest — paste a key)",
        value: "token",
        description: "A service key is account-level, created in Settings, and needs no app to be built.",
      },
      {
        name: "OAuth (opens your browser — needs a HubSpot app you created)",
        value: "oauth",
        description: "Best when several people share one HubSpot app, or you want refreshable tokens.",
      },
    ],
  });

  if (mode === "token") {
    const scopeLines = REQUIRED_SCOPES.map((scope) => `     ${scope}`);
    process.stdout.write(
      [
        "",
        pc.bold("Create a service key") + pc.dim("  (recommended · HubSpot public beta)"),
        rule(),
        "1. HubSpot → Development → Keys → Service keys → Create service key",
        "2. Name it, then Add new scope and tick:",
        ...scopeLines,
        "3. Optional, each unlocking one feature:",
        ...OPTIONAL_SCOPES.map(({ scope, unlocks }) => `     ${scope}${" ".repeat(Math.max(1, 28 - scope.length))}${pc.dim(unlocks)}`),
        "4. Update → Create, then Show and Copy the key.",
        pc.dim("   Needs super admin, or the developer tools access permission."),
        "",
        pc.bold("No service keys in your portal?") + pc.dim("  Use a private app instead"),
        rule(),
        "1. HubSpot → Settings → Integrations → Private apps → Create a private app",
        "2. On the Scopes tab, tick the same four scopes above.",
        "3. Create the app and copy its access token.",
        "",
      ].join("\n"),
    );
    const token = await password({ message: "Service key or access token", mask: true });
    if (!token.trim()) throw new Error("No token entered.");
    await storeServiceToken(token.trim());
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

/** Validates a service token, stores it, and reports what it can actually do. */
async function storeServiceToken(token: string): Promise<void> {
  const { portalId, scopes, missing } = await connectWithToken(token);
  process.stdout.write(
    `${pc.green(symbols.ok)} Connected to HubSpot${portalId ? ` (portal ${portalId})` : ""}\n`,
  );
  if (missing.length) {
    process.stdout.write(
      `${pc.yellow(symbols.warn)} This token is missing ${missing.length} scope(s) ABMBuddy needs:\n` +
        missing.map((scope) => `    ${scope}\n`).join("") +
        pc.dim("  Add them to the private app in HubSpot, then run login again.\n"),
    );
  } else if (scopes?.length) {
    process.stdout.write(pc.dim(`  All ${REQUIRED_SCOPES.length} required scopes present.\n`));
  }
}

/** Resolves a token passed by flag, file or stdin. Undefined means "ask". */
async function readSuppliedToken(options: LoginOptions): Promise<string | undefined> {
  if (options.token?.trim()) return options.token.trim();

  if (options.tokenFile) {
    const raw = await readFile(options.tokenFile, "utf8").catch((error: NodeJS.ErrnoException) => {
      throw new Error(`Could not read token file ${options.tokenFile}: ${error.message}`);
    });
    const token = raw.trim();
    if (!token) throw new Error(`Token file ${options.tokenFile} is empty.`);
    return token;
  }

  if (options.tokenStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const token = Buffer.concat(chunks).toString("utf8").trim();
    if (!token) throw new Error("No token received on stdin.");
    return token;
  }

  return undefined;
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
