import pc from "picocolors";

/** Shared terminal vocabulary: one place to change how ABMBuddy looks. */

export const symbols = {
  ok: "✓",
  warn: "⚠",
  fail: "✗",
  skip: "–",
  pending: "●",
  bullet: "•",
  arrow: "→",
  up: "↑",
};

export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function width(): number {
  const columns = process.stdout.columns ?? 80;
  return Math.max(40, Math.min(columns, 100));
}

export function rule(char = "─"): string {
  return pc.dim(char.repeat(width()));
}

export function heading(text: string): string {
  return pc.bold(text.toUpperCase());
}

/** Word wrap that keeps indentation stable across lines. */
export function wrap(text: string, indent = 0, max = width()): string {
  const limit = Math.max(20, max - indent);
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line.length) {
        line = word;
      } else if (line.length + 1 + word.length <= limit) {
        line += ` ${word}`;
      } else {
        lines.push(pad + line);
        line = word;
      }
    }
    lines.push(pad + line);
  }
  return lines.join("\n");
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Right-aligns a value on the same line as a label. */
export function pad(left: string, right: string, max = width()): string {
  const gap = Math.max(1, max - visibleLength(left) - visibleLength(right));
  return `${left}${" ".repeat(gap)}${right}`;
}

export function confidenceColor(confidence: number): (text: string) => string {
  if (confidence >= 0.75) return pc.green;
  if (confidence >= 0.5) return pc.yellow;
  return pc.dim;
}

export function percent(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

/** Matches SGR colour codes, so padding maths counts printable characters. */
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

export function visibleLength(text: string): number {
  return text.replace(ANSI, "").length;
}

export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.CI;
}

export { pc };
