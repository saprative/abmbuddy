import { homedir } from "node:os";
import { join } from "node:path";

/** XDG-ish config home. Overridable so tests and CI never touch a real profile. */
export function configDir(): string {
  if (process.env.ABMBUDDY_CONFIG_DIR) return process.env.ABMBUDDY_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "abmbuddy");
}

export function configFile(): string {
  return join(configDir(), "config.json");
}

/** Only used when no OS keychain is available. */
export function fallbackSecretsFile(): string {
  return join(configDir(), "credentials.json");
}
