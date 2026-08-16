# ABMBuddy

[![npm](https://img.shields.io/npm/v/abmbuddy.svg)](https://www.npmjs.com/package/abmbuddy)
[![license](https://img.shields.io/npm/l/abmbuddy.svg)](LICENSE)

Open-source agentic account research and outreach for HubSpot. One command, no
infrastructure.

```bash
npx abmbuddy
```

Connect HubSpot, choose which product you are selling, pick accounts, and get
evidence-backed account intelligence: what the company is doing publicly, what
patterns that adds up to, what operational problem it might indicate, who to
talk to about it, how to approach them, and the collateral to send.

ABMBuddy is **not** a CRM. HubSpot owns companies, contacts, deals, properties
and ownership. ABMBuddy owns the research process between "here is an account"
and "here is something worth talking about", and writes a short summary back.

```
HubSpot → pick a product → select accounts → public research → evidence
        → signals → hypotheses → stakeholders → approach → outreach
        → collateral → HubSpot
```

---

## Install

Nothing to install — run it straight from npm:

```bash
npx abmbuddy
```

Or install it globally if you use it often:

```bash
npm install -g abmbuddy
abmbuddy
```

Requires **Node 20.11 or newer**. Check with `node --version`.

---

## What you need before your first run

| | Required? | Notes |
| --- | --- | --- |
| An AI provider key | **Yes** | OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible endpoint (including a local model, which needs no key) |
| A HubSpot service key | No | Only if you want to research CRM accounts and write results back. Without it, research any domain directly |
| A web search key | No | Tavily, Brave or Serper. Without one, news falls back to headlines and leadership content is skipped |

---

## Getting started

### 1. Run it

```bash
npx abmbuddy
```

First run walks you through setup:

```
ABMBuddy
Open-source agentic account research.

? Connect CRM
❯ HubSpot
  Skip for now (research a domain instead)

✓ Connected to HubSpot

? AI Provider
❯ OpenAI
  Anthropic
  Google Gemini
  OpenAI Compatible
```

Your API key is stored in your operating system's keychain — never in a file in
this project, never in the config file.

### 2. Connect HubSpot (optional)

**Service key — recommended.** An account-level API credential you create in
Settings. There is no app to build, no client secret, and no OAuth round trip.

1. HubSpot → **Development** → **Keys** → **Service keys** → **Create service key**
2. Name it, click **Add new scope**, and tick these four:
   ```
   crm.objects.companies.read
   crm.objects.companies.write
   crm.schemas.companies.read
   crm.schemas.companies.write
   ```
   Two optional extras, each unlocking one feature:
   ```
   crm.objects.contacts.read   → stakeholder mapping against your CRM contacts
   e-commerce                  → reading your product catalogue
   ```
   Without them ABMBuddy degrades gracefully: public-only stakeholders, and
   your configured value proposition instead of a selected product.
3. **Update** → **Create**, then **Show** and **Copy** the key.
4. Paste it when ABMBuddy asks.

You need to be a super admin, or have the developer tools access permission.
Keys can be rotated or revoked from the same screen at any time.

> Service keys are in HubSpot **public beta** (since February 2026) and, in
> HubSpot's words, "subject to change based on testing and feedback". They are
> the modern replacement for legacy private apps. If your portal does not have
> them yet, use a private app token instead — ABMBuddy accepts either.

**Private app token — the legacy equivalent.** HubSpot → Settings →
Integrations → Private apps → Create a private app, tick the same four scopes,
and copy the access token. Legacy private apps are still fully supported by
HubSpot.

**OAuth — for teams.** Create an app at
[developers.hubspot.com](https://developers.hubspot.com), add
`http://localhost:8787/oauth/callback` as its redirect URL, and paste the client
ID and secret. ABMBuddy opens your browser, completes the exchange on a loopback
listener, and refreshes the token automatically from then on. Worth it when
several people share one app or you want auto-refreshing tokens.

ABMBuddy verifies whatever you give it at login — a wrong or under-scoped
credential fails immediately with the list of missing scopes, rather than
throwing a 403 halfway through a run.

#### Non-interactive (scripts and CI)

Skip the prompts entirely:

```bash
export HUBSPOT_ACCESS_TOKEN=pat-na1-...        # service key or private app token
abmbuddy research --hubspot --all --yes

# or store it in the OS keychain once, without a prompt:
abmbuddy login hubspot --token pat-na1-...     # visible in shell history
abmbuddy login hubspot --token-file ./key.txt  # safer
echo "$HUBSPOT_KEY" | abmbuddy login hubspot --token-stdin   # safest
```

### 3. Choose what you are selling

When HubSpot is connected, ABMBuddy reads your **product catalogue** and asks
which one this run is about:

```
? Which product are you positioning?
❯ Deployment Platform — Ships models to production faster
  Observability Suite
  Data Governance Add-on
  None — use my configured value proposition
```

The selected product ranks which well-supported hypothesis to lead with, and
keeps the collateral honest about what is actually on offer. It never invents a
problem to match the pitch. Pass `--product "Deployment Platform"` to skip the
prompt.

### 4. Research some accounts

After setup, every run is a short menu:

```
ABMBuddy
✓ HubSpot connected
? What would you like to do?
❯ Research accounts
  Research a domain
  View configuration
  Reconnect HubSpot
  Exit
```

Pick **Research accounts**, filter, and select one, several, or all:

```
? Filter accounts by name or domain (blank lists everything)
? Select accounts  (space toggles · a selects all · i inverts · enter continues)
❯ ◯ Stripe        stripe.com
  ◉ Datadog       datadoghq.com
  ◉ Snowflake     snowflake.com
  ◯ Cloudflare    cloudflare.com

3 account(s) selected.
? Start deep research? (Y/n)
```

### 5. Read the brief

```
DATADOG
datadoghq.com · 62 sources
────────────────────────────────────────────────────────────
STRATEGIC INITIATIVES
• Expanding platform and AI-enabled operations
• Investing in enterprise product capabilities

SIGNALS
↑ AI platform expansion                                   84%
  7 ML platform roles · AI-enabled operations on the website

POTENTIAL BOTTLENECKS
1. Platform engineering complexity                        87%
   Rapid expansion of infrastructure capabilities may be
   increasing internal platform engineering overhead.
   Ask: How long does a new service take to reach production today?
   Evidence:
   → SEC filing: Datadog, Inc. 10-K (filed 2026-02-18)
     https://www.sec.gov/Archives/edgar/data/1561550/...
   → Job posting: Senior ML Platform Engineer
     https://careers.datadoghq.com/...

STAKEHOLDERS
• Sam Okafor · CTO                                        economic buyer
    Has spoken publicly about platform standardisation.
• Platform engineering lead                                     champion
    The open ML platform roles report into this function.

Start with: Platform engineering lead — Closest to the observed problem.
  ⚠ No procurement contact identified from public sources

APPROACH
Open with the platform lead on deployment throughput, then earn an
introduction upward.

1. Earn a reply · email · Platform engineering lead
   When: Now
2. Stay visible without repeating the ask · linkedin
   When: Five working days after step 1, if no reply

Walk away if:
  - A hiring freeze, or an in-house platform team already at capacity

RECOMMENDED OUTREACH
Subject: scaling platform operations
...

COLLATERAL
Deployment throughput while the ML team doubles · personalized
When ML hiring outpaces deployment tooling · reusable
```

Then, if HubSpot is connected:

```
? Save research to HubSpot (3 account(s))? (Y/n)
```

---

## Using it without HubSpot

Research any company from the command line. This needs nothing but an AI key:

```bash
npx abmbuddy research stripe.com
npx abmbuddy research stripe.com datadoghq.com snowflake.com
```

---

## Command reference

```bash
abmbuddy                              # interactive
abmbuddy login hubspot                # connect a CRM (service key, token or OAuth)
abmbuddy login hubspot --token <key>  # non-interactive; also --token-file / --token-stdin
abmbuddy logout hubspot               # disconnect and delete stored credentials
abmbuddy research                     # pick accounts from HubSpot
abmbuddy research stripe.com          # research a domain, no CRM needed
abmbuddy research --hubspot --all     # every account in the portal
abmbuddy research --query "fintech"   # filter the portal server-side
abmbuddy research --json > out.json   # structured output for scripts
abmbuddy research --product "Deploy"  # position the run around a HubSpot product
abmbuddy research --save ./collateral # write generated one-pagers to disk
abmbuddy config                       # view and change settings
abmbuddy config --show                # print settings and exit
abmbuddy --verbose research           # detailed logs on stderr
```

**`research` flags**

| Flag | Effect |
| --- | --- |
| `--hubspot` | Select accounts from the connected portal |
| `--all` | Research everything matching the filter, no prompt |
| `--query <text>` | Filter accounts by name or domain |
| `--limit <n>` | Maximum accounts to load from the CRM (default 1000) |
| `--concurrency <n>` | Accounts researched in parallel (default 4) |
| `--json` | Machine-readable output instead of the brief |
| `-y, --yes` | Answer prompts automatically (for scripts and CI) |
| `--write` / `--no-write` | Force HubSpot write-back on or off |
| `--no-outreach` | Skip the outreach agent |
| `--no-stakeholders` / `--no-strategy` / `--no-collateral` | Skip the later stages for a cheaper run |
| `--product <name>` | HubSpot product to position the run around |
| `--save <dir>` | Write generated collateral into a directory as Markdown |

Non-interactive example:

```bash
abmbuddy research --hubspot --all --yes --write --concurrency 3
```

---

## What it actually does

For each account, in this order:

```
Company
   ↓ resolve identity          which company on the public web is this?
   ↓ collect public evidence   website · news · jobs · SEC · leadership
   ↓ extraction agent          "what facts did we discover?"
   ↓ signal agent              "what patterns are visible?"
   ↓ hypothesis agent          "what operational problem might this indicate?"
   ↓ stakeholder agent         "who would feel, fund, evaluate or block it?"
   ↓ strategy agent            "how should we approach them, in what order?"
   ↓ outreach agent            "how should we start the conversation?"
   ↓ collateral agent          "what can we actually send?"
   ↓ display, then optionally update HubSpot
```

That is seven model calls per account. Skip any of the later stages with
`--no-stakeholders`, `--no-strategy`, `--no-outreach` or `--no-collateral` when
you want a cheaper run.

Accounts run concurrently (4 at a time by default). One collector failing never
fails an account, and one account failing never stops the run:

```
Stripe
  ✓ Company website        14 items
  ✓ Recent developments     8 items
  ✓ Engineering jobs       23 items
  – SEC filings            not a US public company
  ⚠ Leadership content     no search provider configured
```

### Collectors (deterministic, never agents)

| Source | What it reads |
| --- | --- |
| `company-web` | About, leadership, product, engineering, blog, newsroom, investor pages |
| `news` | The company's own newsroom, plus recent coverage via your search provider (or Google News without one) |
| `jobs` | Greenhouse, Lever and Ashby boards, with careers-page discovery as fallback; roles are classified by seniority, domain and technology |
| `sec` | 10-K, 10-Q and recent 8-K filings, cut down to the sections that describe how the business runs |
| `leadership` | Public interviews, podcasts and talks (needs a search provider) |

### Agents (Vercel AI SDK, Zod schemas, Markdown prompts)

Each agent is instructions + model + schema, and the orchestrator decides what
runs when. Agents never call each other and never touch the network directly.

- **Extraction** — structures the evidence. Explicitly forbidden from selling.
- **Signals** — finds patterns across independent observations.
- **Hypothesis** — works the chain *observed change → initiative → resources →
  operational implication → bottleneck*, and states the result as a
  possibility, never a fact.
- **Stakeholders** — maps who would feel, fund, evaluate or block the problem,
  combining CRM contacts with publicly identified people.
- **Strategy** — the approach: entry point, a short sequence with one objective
  per step, and the disqualifiers that would call it off.
- **Outreach** — one real observation, one possible implication, one question,
  addressed to whoever the approach starts with.
- **Collateral** — a personalized one-pager for this account, plus a reusable
  version with every account-specific fact removed.

### Stakeholder mapping and your CRM contacts

Stakeholder mapping reads the contacts already associated with the account and
combines them with people identified in public evidence. Two standards of proof
apply: a CRM stakeholder must point at a real contact record, and a publicly
identified one must cite evidence. Anything satisfying neither is dropped as
invention, and roles nobody was found for are reported as gaps rather than
filled with plausible names.

**Only names, titles and lifecycle fields are read.** Email addresses, phone
numbers and message history are never requested from HubSpot, so they cannot
reach a model or your terminal.

### Evidence rules

Everything downstream cites evidence ids, and citations are verified after every
agent call: ids that were never collected are stripped, and anything left with
no real source is dropped and reported as a warning. The distinction the whole
tool is built on:

- **Fact** — directly supported by public evidence.
- **Inference** — a conclusion derived from evidence.
- **Hypothesis** — a possible operational bottleneck that still needs
  validation.

---

## HubSpot write-back

ABMBuddy creates an `ABMBuddy` property group on the company object if it does
not exist, then writes six concise properties:

| Property | Contents |
| --- | --- |
| ABMBuddy Last Scan | When this account was last researched |
| ABMBuddy Strategic Initiatives | Publicly stated initiatives |
| ABMBuddy Signals | Patterns observed, with confidence |
| ABMBuddy Top Hypothesis | The strongest hypothesis, its reasoning and sources |
| ABMBuddy Hypothesis Confidence | 0–100 |
| ABMBuddy Outreach Angle | Observation, angle, opener and subject |
| ABMBuddy Stakeholders | Who would feel, fund, evaluate or block it |
| ABMBuddy Approach | Entry point and the planned sequence |
| ABMBuddy Product | The product the research was positioned around |

Scraped documents are never written to HubSpot. The raw evidence lives in memory
for the duration of the run and is then gone.

---

## Configuration

`abmbuddy config` covers the AI provider, an optional web search provider, who
the outreach comes from, and research limits:

```
Configuration
────────────────────────────────────────────────────────────
CRM            ✓ HubSpot — service key / token · portal 12345678
AI provider    Anthropic · claude-sonnet-5
AI key         sk-a••••••1f9c
Web search     Tavily
Concurrency    4 accounts
Pages/site     14
SEC filings    on  contact: you@example.com
Sender         Sam · Toolco
Config file    ~/.config/abmbuddy/config.json
```

Settings live in `~/.config/abmbuddy/config.json`. Secrets never go there and
never appear in source.

Telling ABMBuddy **what you sell** (`abmbuddy config` → Outreach identity)
improves relevance: it is used to rank which well-supported hypothesis to lead
with, and never to invent one.

**SEC EDGAR** requires a contact address in the User-Agent and blocks requests
that do not carry one. Set yours in `abmbuddy config` if you research public
companies regularly.

See [.env.example](.env.example) for every environment variable.

---

## Changing how it thinks

The prompts are Markdown files, not strings buried in code:

```
src/agents/
├── extraction/{agent.ts, prompt.md, schema.ts}
├── signals/{agent.ts, prompt.md, schema.ts}
├── hypothesis/{agent.ts, prompt.md, schema.ts}
└── outreach/{agent.ts, prompt.md, schema.ts}
```

- Different selling strategy → edit `agents/hypothesis/prompt.md`
- Different outreach style → edit `agents/outreach/prompt.md`

Without forking, drop a replacement at `~/.config/abmbuddy/prompts/<agent>.md`
and it takes precedence over the built-in prompt.

---

## Extending it

Every external system sits behind a small interface, so contributions do not
touch the research logic.

**A new CRM** — implement `CRMProvider` in `src/crm/`:

```ts
export interface CRMProvider {
  connect(): Promise<void>;
  getCompanies(options?: ListCompaniesOptions): Promise<Company[]>;
  updateCompany(companyId: string, result: AccountResearch): Promise<void>;
}
```

**A new research source** — implement `ResearchSource` in `src/collectors/` and
add it to the registry in `src/collectors/index.ts`:

```ts
export interface ResearchSource {
  name: string;
  label: string;
  collect(company: Company): Promise<Evidence[]>;
}
```

Collectors are deterministic modules. They fetch, they parse, they return
evidence with its source attached — they never call a model and never draw a
conclusion.

**A new model provider** — extend `src/llm/provider.ts`. **A new search
provider** — extend `src/search/provider.ts`.

```
src/
├── cli/            interactive shell, commands, terminal rendering
├── crm/            HubSpot provider, auth, write-back mapping
├── collectors/     website · news · jobs · sec · leadership
├── agents/         extraction · signals · hypothesis · outreach
├── orchestrator/   identity resolution and the pipeline
├── llm/            model provider abstraction
├── search/         search provider abstraction
├── models/         Company, Evidence, AccountResearch
├── config/         config file and OS keychain secrets
└── util/           http, html, browser fallback, logging, pooling
```

### Local development

```bash
git clone https://github.com/saprative/abmbuddy.git
cd abmbuddy
npm install
npm run dev        # run the CLI from source
npm run typecheck
npm test
npm run build
```

---

## Using it as a library

The CLI is the product, but the pipeline is importable:

```ts
import { researchAccount, createLLMProvider, createSearchProvider, loadConfig } from "abmbuddy";

const config = await loadConfig();
const research = await researchAccount(
  { name: "Stripe", domain: "stripe.com", source: "app" },
  { config, llm: await createLLMProvider(config), search: await createSearchProvider(config) },
);

console.log(research.hypotheses[0]);
```

---

## Design constraints

Deliberately absent: no web app, no database, no server, no queue, no workers, no
vector store, no background monitoring, no autonomous email sending. State lives
in HubSpot. Local disk holds configuration, credentials and a disposable HTTP
cache, nothing else.

Playwright is optional and only used when a page renders empty over plain HTTP.
Install it yourself and enable the fallback in `abmbuddy config` if you need it.

---

## Being a good citizen

ABMBuddy reads public pages only, at one request per host at a time with a polite
gap between them, and it identifies itself honestly in its User-Agent. It does
not log in, bypass paywalls, or scrape anything that requires authentication.
Check the terms of any source you point it at, and set a real SEC contact address
before querying EDGAR at volume.

## Troubleshooting

**"No API key found"** — run `abmbuddy config` and pick your AI provider, or set
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`.

**"Port 8787 is already in use"** during OAuth — free the port, or change
`crm.redirectPort` in `abmbuddy config` and update your HubSpot app's redirect
URL to match.

**SEC filings always skipped** — expected for private and non-US companies. For
US public companies, set a contact email in `abmbuddy config`; EDGAR rejects
requests without one.

**Leadership content always skipped** — it needs a web search provider. Add one
in `abmbuddy config`.

**A run looks thin** — check the `Sources:` line at the end of each brief to see
which collectors found nothing, and re-run with `--verbose` for details.

## License

MIT — see [LICENSE](LICENSE).
