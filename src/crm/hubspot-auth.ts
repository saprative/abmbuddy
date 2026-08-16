import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Client } from "@hubspot/api-client";
import open from "open";
import { SecretKey, getSecret, setSecret, deleteSecret } from "../config/secrets.js";
import { updateConfig, type Config } from "../config/index.js";
import { log } from "../util/logger.js";
import { CrmAuthError } from "./provider.js";

/**
 * HubSpot credentials. Two honest options:
 *
 *   oauth        — you create a HubSpot app, we open your browser, HubSpot
 *                  redirects to localhost, we exchange the code and refresh
 *                  the token from then on.
 *   private-app  — you paste a private app access token. No browser, no app
 *                  registration, no refresh.
 *
 * Tokens live in the OS keychain (or a 0600 file when there is no keychain),
 * never in config.json and never in the repository.
 */

export const HUBSPOT_SCOPES = [
  "oauth",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.schemas.companies.read",
  "crm.schemas.companies.write",
];

export type StoredTokens = {
  mode: "oauth" | "private-app";
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. Absent for private app tokens, which do not expire. */
  expiresAt?: number;
  clientId?: string;
};

export async function readTokens(): Promise<StoredTokens | undefined> {
  const envToken = process.env.HUBSPOT_ACCESS_TOKEN ?? process.env.ABMBUDDY_HUBSPOT_TOKEN;
  if (envToken) return { mode: "private-app", accessToken: envToken };
  const raw = await getSecret(SecretKey.hubspotTokens);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return undefined;
  }
}

export async function writeTokens(tokens: StoredTokens): Promise<void> {
  await setSecret(SecretKey.hubspotTokens, JSON.stringify(tokens));
}

export async function clearTokens(): Promise<void> {
  await deleteSecret(SecretKey.hubspotTokens);
  await deleteSecret(SecretKey.hubspotClientSecret);
}

/** Returns a valid access token, refreshing an expired OAuth one on the way. */
export async function getAccessToken(config: Config): Promise<string> {
  const tokens = await readTokens();
  if (!tokens) {
    throw new CrmAuthError("Not connected to HubSpot. Run `abmbuddy login hubspot`.");
  }
  if (tokens.mode === "private-app") return tokens.accessToken;
  // Refresh a minute early so a long run never fails mid-flight.
  if (tokens.expiresAt && tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  const refreshed = await refresh(tokens, config);
  return refreshed.accessToken;
}

async function refresh(tokens: StoredTokens, config: Config): Promise<StoredTokens> {
  const clientId = tokens.clientId ?? config.crm.clientId;
  const clientSecret = await getSecret(SecretKey.hubspotClientSecret);
  if (!tokens.refreshToken || !clientId || !clientSecret) {
    throw new CrmAuthError("HubSpot session expired and cannot be refreshed. Run `abmbuddy login hubspot`.");
  }
  log.debug("hubspot", "refreshing access token");
  const client = new Client();
  try {
    const response = await client.oauth.tokensApi.create(
      "refresh_token",
      undefined,
      redirectUri(config),
      clientId,
      clientSecret,
      tokens.refreshToken,
    );
    const next: StoredTokens = {
      mode: "oauth",
      accessToken: response.accessToken,
      refreshToken: response.refreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      clientId,
    };
    await writeTokens(next);
    return next;
  } catch (error) {
    throw new CrmAuthError(
      `Could not refresh the HubSpot session (${describeError(error)}). Run \`abmbuddy login hubspot\`.`,
    );
  }
}

export function redirectUri(config: Config): string {
  return `http://localhost:${config.crm.redirectPort}/oauth/callback`;
}

export function authorizeUrl(config: Config, clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(config),
    scope: HUBSPOT_SCOPES.join(" "),
    state,
  });
  return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
}

export type OAuthResult = { tokens: StoredTokens; portalId?: string };

/**
 * Runs the browser OAuth dance: start a loopback listener, open the consent
 * screen, wait for the redirect, exchange the code. The listener only ever
 * accepts one request and only from the local machine.
 */
export async function runOAuthFlow(
  config: Config,
  credentials: { clientId: string; clientSecret: string },
  hooks: { onUrl?: (url: string) => void } = {},
): Promise<OAuthResult> {
  const state = randomBytes(16).toString("hex");
  const url = authorizeUrl(config, credentials.clientId, state);
  const code = await waitForCode(config.crm.redirectPort, state, () => {
    hooks.onUrl?.(url);
    void open(url).catch(() => {
      // A headless machine just means the user opens the URL themselves.
    });
  });

  const client = new Client();
  let tokens: StoredTokens;
  try {
    const response = await client.oauth.tokensApi.create(
      "authorization_code",
      code,
      redirectUri(config),
      credentials.clientId,
      credentials.clientSecret,
    );
    tokens = {
      mode: "oauth",
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      clientId: credentials.clientId,
    };
  } catch (error) {
    throw new CrmAuthError(`HubSpot rejected the authorization code: ${describeError(error)}`);
  }

  await setSecret(SecretKey.hubspotClientSecret, credentials.clientSecret);
  await writeTokens(tokens);
  const portalId = await lookupPortalId(tokens.accessToken);
  await updateConfig({
    crm: {
      provider: "hubspot",
      authMode: "oauth",
      clientId: credentials.clientId,
      ...(portalId ? { portalId } : {}),
      connectedAt: new Date().toISOString(),
    },
  });
  return { tokens, ...(portalId ? { portalId } : {}) };
}

/** Stores a pasted private app token after checking it actually works. */
export async function connectPrivateApp(token: string): Promise<{ portalId?: string }> {
  const portalId = await lookupPortalId(token);
  await writeTokens({ mode: "private-app", accessToken: token });
  await updateConfig({
    crm: {
      provider: "hubspot",
      authMode: "private-app",
      ...(portalId ? { portalId } : {}),
      connectedAt: new Date().toISOString(),
    },
  });
  return { ...(portalId ? { portalId } : {}) };
}

/** Also serves as a credential check: a bad token cannot read account info. */
export async function lookupPortalId(accessToken: string): Promise<string | undefined> {
  const response = await fetch("https://api.hubapi.com/account-info/v3/details", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new CrmAuthError(
      "HubSpot rejected that token. Check it is valid and has the companies read/write scopes.",
    );
  }
  if (!response.ok) return undefined;
  const data = (await response.json().catch(() => undefined)) as { portalId?: number } | undefined;
  return data?.portalId ? String(data.portalId) : undefined;
}

function waitForCode(port: number, state: string, onListening: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (requestUrl.pathname !== "/oauth/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = requestUrl.searchParams.get("code");
      const returnedState = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");
      const done = (status: number, message: string) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(page(message));
        server.close();
      };
      if (error) {
        done(400, `HubSpot returned an error: ${escapeHtml(error)}`);
        reject(new CrmAuthError(`HubSpot authorization failed: ${error}`));
        return;
      }
      if (!code || returnedState !== state) {
        done(400, "Invalid callback. You can close this tab and try again.");
        reject(new CrmAuthError("HubSpot returned an invalid callback (state mismatch)."));
        return;
      }
      done(200, "Connected. You can close this tab and return to your terminal.");
      resolve(code);
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new CrmAuthError(
            `Port ${port} is already in use. Free it, or change crm.redirectPort with \`abmbuddy config\` (and update your HubSpot app's redirect URL).`,
          ),
        );
        return;
      }
      reject(error);
    });

    // Loopback only: nothing outside this machine can reach the listener.
    server.listen(port, "127.0.0.1", onListening);

    const timer = setTimeout(
      () => {
        server.close();
        reject(new CrmAuthError("Timed out waiting for HubSpot authorization (5 minutes)."));
      },
      5 * 60 * 1000,
    );
    timer.unref?.();
    server.on("close", () => clearTimeout(timer));
  });
}

function page(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>ABMBuddy</title><body style="font:16px system-ui;padding:3rem;max-width:32rem"><h1 style="font-size:1.2rem">ABMBuddy</h1><p>${message}</p></body>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[<>&"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
  }
  return error instanceof Error ? error.message : String(error);
}
