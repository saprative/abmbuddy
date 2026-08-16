import pc from "picocolors";

let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

export function isVerbose(): boolean {
  return verbose;
}

function stamp(): string {
  return pc.dim(new Date().toISOString().slice(11, 23));
}

/** Detailed logs, hidden unless --verbose. Written to stderr so stdout stays clean. */
export const log = {
  debug(scope: string, message: string, extra?: unknown): void {
    if (!verbose) return;
    const detail = extra === undefined ? "" : ` ${pc.dim(safeJson(extra))}`;
    process.stderr.write(`${stamp()} ${pc.dim(scope)} ${message}${detail}\n`);
  },
  warn(scope: string, message: string): void {
    if (!verbose) return;
    process.stderr.write(`${stamp()} ${pc.yellow(scope)} ${message}\n`);
  },
  /** Always shown. For things the user must know about. */
  error(scope: string, message: string): void {
    process.stderr.write(`${pc.red("error")} ${pc.dim(scope)} ${message}\n`);
  },
};

function safeJson(value: unknown): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return String(value);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
