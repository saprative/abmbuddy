# ABMBuddy: account research from the command line

`abmbuddy` is a CLI that researches B2B accounts from public sources and returns
evidence-backed intelligence: signals, hypotheses about operational problems,
stakeholder maps, an approach plan, outreach copy and collateral. It reads
company websites, news, engineering job boards, SEC filings and public
leadership content, and can pull accounts from HubSpot.

Use it when asked to research a company or account, build an account plan,
prepare outreach, or find a reason to reach out to a prospect.

## Always run it non-interactively

`abmbuddy` with no arguments opens an interactive menu that **will hang** waiting
for keyboard input. Never run bare `abmbuddy`, `abmbuddy config` or
`abmbuddy login` without flags.

Always pass `--json --yes`:

```bash
abmbuddy research stripe.com --json --yes
```

`--json` prints one machine-readable object to stdout; `--yes` answers every
prompt. Progress goes to stderr and never contaminates stdout.

## Before the first run

Check the setup — this is read-only and safe:

```bash
abmbuddy config --show
```

An AI provider key is **required**. If none is configured, tell the user to run
`abmbuddy config` themselves (it is interactive) or to set `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`. Do not try to configure it
for them, and never write an API key into a file in the repository.

HubSpot is optional. Without it, research any domain directly.

## Commands

```bash
# One or more domains, no CRM needed
abmbuddy research stripe.com --json --yes
abmbuddy research stripe.com datadoghq.com --json --yes

# From HubSpot
abmbuddy research --hubspot --all --json --yes
abmbuddy research --hubspot --query "fintech" --json --yes
abmbuddy research --hubspot --product "Deployment Platform" --json --yes

# Cheaper: skip later stages
abmbuddy research stripe.com --json --yes --no-collateral --no-strategy

# Write generated collateral to disk as Markdown
abmbuddy research stripe.com --json --yes --save ./collateral
```

Useful flags: `--limit <n>`, `--concurrency <n>` (default 4), `--verbose`
(debug logs to stderr), `--no-stakeholders`, `--no-strategy`, `--no-outreach`,
`--no-collateral`.

## Cost

Each account costs **seven model calls** plus a few dozen HTTP fetches, and
takes roughly one to three minutes. Before researching many accounts, tell the
user how many you are about to run and get agreement. Prefer a small batch
first. Do not fan out over an entire CRM unless explicitly asked.

## Reading the output

```jsonc
{
  "generatedAt": "2026-08-16T10:00:00.000Z",
  "accounts": [
    {
      "status": "ok",                  // or "failed", with an "error" field
      "company": { "name": "Stripe", "domain": "stripe.com" },
      "collectors": [ { "name": "sec", "status": "skipped", "note": "..." } ],
      "evidence": [ { "id": "ev_1", "sourceType": "job", "title": "...", "url": "..." } ],
      "extraction": { "strategicInitiatives": [ { "statement": "...", "evidenceIds": ["ev_1"] } ] },
      "signals":    [ { "name": "...", "observations": ["..."], "evidenceIds": ["ev_1"], "confidence": 0.84 } ],
      "hypotheses": [ { "title": "...", "hypothesis": "...", "reasoning": {}, "evidenceIds": [], "confidence": 0.87 } ],
      "stakeholders": { "stakeholders": [], "entryPoint": {}, "gaps": [] },
      "strategy":   { "summary": "...", "entryPoint": {}, "sequence": [], "disqualifiers": [] },
      "outreach":   { "subject": "...", "email": "...", "conversationOpener": "..." },
      "collateral": { "personalized": { "body": "..." }, "general": { "body": "..." } },
      "warnings":   ["..."]
    }
  ]
}
```

`evidence[]` carries no page bodies — only ids, titles and URLs. Resolve any
`evidenceIds` against it to cite a source.

## How to report results honestly

This tool exists to keep sales claims traceable. Preserve that when you
summarise:

1. **A hypothesis is not a fact.** Every hypothesis is a *possible* operational
   problem awaiting validation. Keep the hedging — "may", "appears to",
   "suggests" — and never restate one as something the company is definitely
   experiencing.
2. **Cite sources.** When you repeat a finding, resolve its `evidenceIds` to
   URLs so the user can check it. If you cannot cite it, do not assert it.
3. **Never add facts of your own.** Do not enrich the output with things you
   happen to know about the company, and never invent a name, a metric or a
   headcount. If something is missing, it is missing.
4. **Report what failed.** `collectors[]` shows which sources were skipped or
   failed, `warnings[]` shows what was dropped, and `stakeholders.gaps` shows
   roles nobody was found for. Surface these instead of presenting a partial
   picture as complete.
5. **Confidence is about evidence**, not certainty. A 0.6 hypothesis is worth a
   question, not a pitch.

## Writing back to HubSpot

`--write` updates the HubSpot company record. **Never pass it unless the user
has asked for the results to be saved to their CRM in this conversation.**
Without HubSpot connected, or when researching a bare domain, there is nothing
to write to and the flag does nothing.

`--no-write` guarantees nothing is written.

## Exit codes and failures

- `0` — at least one account succeeded (check each account's `status`).
- `1` — everything failed, or the setup is incomplete. The reason is on stderr.

One collector failing never fails an account, and one account failing never
stops the others. An account with `"status": "failed"` usually means no public
evidence could be reached — a dead domain, or a company with no web presence.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Hangs with no output | Interactive mode. Add `--json --yes`. |
| "No API key found" | Ask the user to run `abmbuddy config`, or set a provider key in the environment. |
| "No CRM connected and no target given" | Pass a domain, or ask the user to run `abmbuddy login hubspot`. |
| SEC always skipped | Normal for private and non-US companies. |
| Leadership always skipped | Needs a search provider; ask the user to add one in `abmbuddy config`. |
| Thin results | Check `collectors[]`. Re-run with `--verbose` to see what could not be fetched. |

## Do not

- Do not run `abmbuddy` interactively, or try to answer its prompts by piping input.
- Do not run `abmbuddy login`, `abmbuddy logout` or `abmbuddy config` without
  flags — they are interactive and handle credentials. Ask the user instead.
- Do not read, print or copy credentials from `~/.config/abmbuddy/` or the OS
  keychain.
- Do not send generated outreach anywhere. ABMBuddy drafts messages; a human
  decides whether to send them.
