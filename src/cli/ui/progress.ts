import logUpdate from "log-update";
import type { Company } from "../../models/company.js";
import type { ProgressEvent, StepStatus } from "../../orchestrator/events.js";
import { accountKey } from "../../orchestrator/events.js";
import { isVerbose } from "../../util/logger.js";
import { isInteractive, pc, spinnerFrames, symbols, truncate, width } from "./theme.js";

/**
 * Live research progress. In a TTY this redraws a compact block; anywhere else
 * (pipes, CI, --verbose) it prints one plain line per event so logs stay
 * greppable. Nothing in the pipeline prints — it only emits events here.
 */

type StepState = { label: string; status: StepStatus; detail?: string };

type AccountState = {
  name: string;
  steps: Map<string, StepState>;
  done: boolean;
  failed?: string;
  summary?: string;
};

export type ProgressRenderer = {
  onProgress: (event: ProgressEvent) => void;
  /** Marks an account finished, with a one-line result summary. */
  finish: (company: Company, summary: string) => void;
  fail: (company: Company, error: string) => void;
  stop: () => void;
};

export function createProgressRenderer(companies: Company[], title: string): ProgressRenderer {
  const live = isInteractive() && !isVerbose();
  const accounts = new Map<string, AccountState>(
    companies.map((company) => [
      accountKey(company),
      { name: company.name, steps: new Map(), done: false },
    ]),
  );

  let frame = 0;
  let timer: NodeJS.Timeout | undefined;

  const render = (): void => {
    if (!live) return;
    frame += 1;
    logUpdate(compose(accounts, frame));
  };

  if (live) {
    process.stdout.write(`${pc.bold(title)}\n`);
    timer = setInterval(render, 90);
    timer.unref?.();
  } else {
    process.stdout.write(`${title}\n`);
  }

  return {
    onProgress(event) {
      const state = accounts.get(event.account);
      if (!state) return;
      state.name = event.company.name;
      state.steps.set(event.step, {
        label: event.label,
        status: event.status,
        ...(event.detail ? { detail: event.detail } : {}),
      });
      if (live) {
        render();
      } else if (event.status !== "running") {
        process.stdout.write(`${plainLine(state.name, event)}\n`);
      }
    },
    finish(company, summary) {
      const state = accounts.get(accountKey(company));
      if (state) {
        state.done = true;
        state.summary = summary;
      }
      if (live) render();
      else process.stdout.write(`${symbols.ok} ${company.name} — ${summary}\n`);
    },
    fail(company, error) {
      const state = accounts.get(accountKey(company));
      if (state) {
        state.done = true;
        state.failed = error;
      }
      if (live) render();
      else process.stdout.write(`${symbols.fail} ${company.name} — ${error}\n`);
    },
    stop() {
      if (timer) clearInterval(timer);
      if (live) {
        logUpdate(compose(accounts, frame));
        logUpdate.done();
      }
    },
  };
}

function compose(accounts: Map<string, AccountState>, frame: number): string {
  const lines: string[] = [];
  const done = [...accounts.values()].filter((account) => account.done);
  const active = [...accounts.values()].filter((account) => !account.done && account.steps.size);
  const waiting = accounts.size - done.length - active.length;

  for (const account of done) {
    lines.push(
      account.failed
        ? `${pc.red(symbols.fail)} ${pc.bold(account.name)} ${pc.dim(truncate(account.failed, 60))}`
        : `${pc.green(symbols.ok)} ${pc.bold(account.name)} ${pc.dim(account.summary ?? "")}`,
    );
  }

  // Keep the live block inside the window so it never scrolls away.
  const budget = Math.max(6, (process.stdout.rows ?? 30) - done.length - 6);
  let used = 0;
  for (const account of active) {
    if (used + 1 + account.steps.size > budget) {
      lines.push(pc.dim(`  …and ${active.length - active.indexOf(account)} more in progress`));
      break;
    }
    lines.push(pc.bold(account.name));
    for (const step of account.steps.values()) {
      lines.push(`  ${stepLine(step, frame)}`);
    }
    used += 1 + account.steps.size;
  }

  if (waiting > 0) lines.push(pc.dim(`  ${waiting} account(s) queued`));
  return lines.join("\n");
}

function stepLine(step: StepState, frame: number): string {
  const detail = step.detail ? pc.dim(` ${truncate(step.detail, Math.max(20, width() - 40))}`) : "";
  switch (step.status) {
    case "running":
      return `${pc.cyan(spinnerFrames[frame % spinnerFrames.length] as string)} ${step.label}${detail}`;
    case "ok":
      return `${pc.green(symbols.ok)} ${step.label}${detail}`;
    case "warn":
      return `${pc.yellow(symbols.warn)} ${step.label}${detail}`;
    case "skipped":
      return `${pc.dim(symbols.skip)} ${pc.dim(step.label)}${detail}`;
    case "failed":
      return `${pc.red(symbols.fail)} ${step.label}${detail}`;
  }
}

function plainLine(name: string, event: ProgressEvent): string {
  const mark =
    event.status === "ok"
      ? symbols.ok
      : event.status === "failed"
        ? symbols.fail
        : event.status === "skipped"
          ? symbols.skip
          : symbols.warn;
  return `${mark} ${name}: ${event.label}${event.detail ? ` (${event.detail})` : ""}`;
}
