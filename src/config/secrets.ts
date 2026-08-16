import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { configDir, fallbackSecretsFile } from "./paths.js";
import { log } from "../util/logger.js";

const SERVICE = "abmbuddy";

/**
 * Secret keys. Values never touch config.json, never get logged, and never
 * appear in source. Preference order: OS keychain -> 0600 file in the config
 * directory.
 */
export const SecretKey = {
  llmApiKey: "llm.apiKey",
  searchApiKey: "search.apiKey",
  hubspotTokens: "hubspot.tokens",
  hubspotClientSecret: "hubspot.clientSecret",
} as const;

export type SecretKeyName = (typeof SecretKey)[keyof typeof SecretKey];

type KeyringEntry = {
  getPassword(): string;
  setPassword(password: string): void;
  deletePassword(): boolean;
};

let keyringCtor: (new (service: string, user: string) => KeyringEntry) | null | undefined;

async function keyring(): Promise<typeof keyringCtor> {
  if (keyringCtor !== undefined) return keyringCtor;
  if (process.env.ABMBUDDY_DISABLE_KEYCHAIN === "1") {
    keyringCtor = null;
    return null;
  }
  try {
    const mod = (await import("@napi-rs/keyring")) as {
      Entry: new (service: string, user: string) => KeyringEntry;
    };
    // Probe once: an installed binding on a machine with no usable keyring
    // (headless Linux without libsecret) throws only on first real use.
    const probe = new mod.Entry(SERVICE, "__probe__");
    try {
      probe.getPassword();
    } catch (error) {
      if (!/no ?entry|not found/i.test(String(error))) throw error;
    }
    keyringCtor = mod.Entry;
  } catch (error) {
    log.debug("secrets", `keychain unavailable, using file store: ${String(error)}`);
    keyringCtor = null;
  }
  return keyringCtor;
}

/** True when secrets are stored in the OS keychain rather than on disk. */
export async function usingKeychain(): Promise<boolean> {
  return (await keyring()) !== null;
}

export async function getSecret(key: SecretKeyName): Promise<string | undefined> {
  const Entry = await keyring();
  if (Entry) {
    try {
      return new Entry(SERVICE, key).getPassword() || undefined;
    } catch {
      return undefined;
    }
  }
  const store = await readFileStore();
  return store[key];
}

export async function setSecret(key: SecretKeyName, value: string): Promise<void> {
  const Entry = await keyring();
  if (Entry) {
    try {
      new Entry(SERVICE, key).setPassword(value);
      return;
    } catch (error) {
      log.debug("secrets", `keychain write failed, falling back to file: ${String(error)}`);
      keyringCtor = null;
    }
  }
  const store = await readFileStore();
  store[key] = value;
  await writeFileStore(store);
}

export async function deleteSecret(key: SecretKeyName): Promise<void> {
  const Entry = await keyring();
  if (Entry) {
    try {
      new Entry(SERVICE, key).deletePassword();
    } catch {
      // Nothing stored: deleting is still a success from the caller's view.
    }
  }
  const store = await readFileStore();
  if (key in store) {
    delete store[key];
    await writeFileStore(store);
  }
}

async function readFileStore(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(fallbackSecretsFile(), "utf8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeFileStore(store: Record<string, string>): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  const file = fallbackSecretsFile();
  await writeFile(file, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
}

/** Shows only enough of a secret to recognise it. */
export function maskSecret(value: string | undefined): string {
  if (!value) return "not set";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(6)}${value.slice(-4)}`;
}
