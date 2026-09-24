# ExecOS — Architecture

> A private, local-first, evidence-backed operating-intelligence layer for a leader.
> It senses signals across the organization, maintains state over time, separates
> fact from inference, identifies what needs leadership attention, tracks commitments
> and decisions, and helps turn information into action. **It assists judgment; it
> does not replace it.**

This document records the Phase 0 investigation (what was verified, what remains
unknown) and the design decisions that follow from it. It is the reference for all
later phases. Anything marked **UNVERIFIED** must be confirmed on a real Windows
enterprise machine before it is relied on.

---

## 0. Phase 0 — what was inspected and what was verified

### 0.1 The existing repository

The `farescout` repository contains an unrelated Python/Streamlit flight-and-hotel
search tool (`streamlit_app.py`, `travel_search.py`, `airports.py`). Nothing in it is
reusable for this product, and it is left untouched. ExecOS lives in its own
top-level directory, `exec-os/`, with its own toolchain, so the two projects do not
interfere. If ExecOS is later moved to its own repository, `exec-os/` can be lifted
out verbatim.

### 0.2 GitHub Copilot CLI — verified programmatic invocation

Verified by installing `@github/copilot@1.0.88` and `@github/copilot-sdk@1.0.14`
from npm and reading `copilot --help`, `copilot help environment`,
`copilot help permissions`, `copilot mcp --help`, and the SDK README and type
definitions. The Copilot CLI ships as a per-platform native binary (`win32-x64`,
`win32-arm64`, ...), installed with `npm install -g @github/copilot`.

Two programmatic paths exist. Both reuse the user's existing Copilot login
(`copilot login`, or `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`); no separate LLM API key is
required.

| Path | How | Use in ExecOS |
|---|---|---|
| **Copilot SDK** (`@github/copilot-sdk`) | Spawns the CLI runtime and talks JSON-RPC over stdio. `createSession({ model, tools, mcpServers, systemMessage, onPermissionRequest })`, `sendAndWait({ prompt })`, typed events. Custom tools are declared with Zod schemas and executed in our process. `baseDirectory` sets `COPILOT_HOME` so session state can be kept in our private data directory. | **Primary backend.** Custom tools give us *structured* output: every skill declares a `submit_result` tool whose Zod schema is the skill's output schema; the model must call it. Tool permissions are decided by our handler, so the model can never run shell commands or write files. |
| **Copilot CLI non-interactive** | `copilot -p "<prompt>" -s --output-format json --allow-tool ... --deny-tool ... --additional-mcp-config @file` | **Fallback backend** when the SDK runtime cannot be started (e.g. policy). Output is JSONL; we parse the final assistant message and validate against the skill schema. |

Relevant verified facts:

- MCP servers for the CLI are configured in `~/.copilot/mcp-config.json`
  (user), `.mcp.json` / `.github/mcp.json` (workspace), or per-run via
  `--additional-mcp-config <json|@file>`. `copilot mcp add <name> -- <cmd> [args]`
  writes the user file. `copilot mcp list` enumerates servers.
- Tool permission patterns: `shell(cmd:*)`, `write(path)`, `<mcp-server>(tool)`,
  `url(domain)`. Denials beat allows. `--available-tools` / `--excluded-tools`
  filter what the model can even see.
- In the SDK, the runtime name of an MCP tool is `<server-key>-<tool-name>`.
- `--secret-env-vars` strips named environment variables from shell and MCP
  server environments and redacts them from output.
- `COPILOT_HOME` relocates all CLI state (sessions, logs, config).
- Session transcripts written by the CLI contain prompt content. ExecOS therefore
  points `COPILOT_HOME` at `%LOCALAPPDATA%\ExecOS\copilot-home` so those files
  never land in the repository and are covered by "Delete Local Data".

### 0.3 The `agency copilot --mcp workiq` invocation — UNVERIFIED

No `agency` executable exists on npm, PyPI, or in this environment, and no public
documentation describes it. It is most likely an internal wrapper that launches
Copilot CLI with a pre-registered WorkIQ MCP server. ExecOS therefore does **not**
depend on it. The intelligence backend's executable and arguments are configurable
(`intelligence.copilot.command`, `intelligence.copilot.args`), so if `agency` turns
out to be the mandated launcher on the user's machine, it can be substituted in
configuration without code changes. The `doctor` command reports which launcher was
found.

### 0.4 WorkIQ — verified capabilities

WorkIQ is public: `@microsoft/workiq@1.0.0` (GA) on npm, source at
`github.com/microsoft/work-iq`. Verified by installing the package, reading its CLI
help, and speaking MCP to `workiq mcp` over stdio (`initialize` + `tools/list`).

- **CLI**: `workiq ask -q "<question>" [--json] [-c <conversationId>]`,
  `workiq mcp` (stdio MCP server), `workiq auth login|logout|consent`,
  `workiq accept-eula`, `workiq agents list`, and **entity commands**
  `fetch -u /me/messages`, `search-paths -f <regex> [-b graph-v1|sharepoint-rest|dataverse]`,
  `get-schema -p /me/messages`, `call-function -u /me/calendar/getSchedule`,
  plus `create|update|delete|do-action` (write operations — ExecOS never uses these).
- **MCP server (`workiq mcp`)** advertises, without authentication:
  `accept_eula`, `ask(question, fileUrls?, conversationId?, agentId?)`, `list_agents`.
  The **entity tools** (`fetch`, `search_paths`, `get_schema`, `call_function`,
  `create_entity`, `update_entity`, `delete_entity`, `do_action`) are **proxied from
  a remote WorkIQ MCP server** and are only listed after authentication succeeds
  (stderr in this container: `[MCP Proxy] Failed to fetch remote tools`, because
  the MSAL broker library is absent on Linux). Tool lists therefore differ by auth
  state, which is why capability discovery is a runtime step, not a static table.
- **Authentication**: Microsoft Entra ID via MSAL with **WAM broker on Windows**
  (i.e. the signed-in Windows/enterprise account is reused), falling back to a
  browser flow. Tokens are cached by WorkIQ itself. Tenant consent may be needed
  (`workiq auth consent`). Access is always evaluated as the signed-in user, so
  ExecOS inherits, and cannot exceed, the user's permissions.
- **Data reach**: mail, Teams chats/channels, meetings/calendar, files
  (OneDrive/SharePoint), people. Graph-style paths (`/me/messages`, `/me/chats`,
  `/me/events`, `/me/calendarView`) are the entity addressing scheme.

**UNVERIFIED (needs a Windows machine with an M365 Copilot licence):**

1. The exact entity tool names/parameters as exposed over MCP after login
   (documented names come from the package changelog, not from a live `tools/list`).
2. Whether `fetch` supports OData `$filter`/`$select`/`$top`/`$orderby` and
   `@odata.nextLink` paging the way Graph does (expected; to be confirmed with
   `get_schema`).
3. Whether `/me/chats/{id}/messages` and Teams channel messages are reachable for
   the user's tenant policy.
4. Whether a Power BI MCP is available in the user's environment (none was found
   publicly under a stable name; it is modelled as an optional provider).
5. Rate limits and payload size limits of the remote WorkIQ server.

Design consequence: the WorkIQ adapter has two retrieval modes chosen at runtime by
capability discovery — **entity mode** (deterministic, filterable, paged; preferred)
and **ask mode** (natural-language retrieval via the `ask` tool; lower fidelity,
answers are stored as evidence of kind `copilot_answer` and flagged as such, never
as primary facts).

### 0.5 Platform facts

- Node.js 22.13+ ships `node:sqlite` (SQLite 3.51 with **FTS5 and JSON1**) with no
  native build step. Verified here on Node 22.22. This removes the usual Windows
  pain of compiling `better-sqlite3` behind a corporate proxy.
- The dev container is Linux without PowerShell, so `install.ps1`/`launch.ps1` are
  written and reviewed but could not be executed here. They are written
  defensively (explicit checks, no silent failure) and every check they perform is
  also implemented in the cross-platform `execos doctor` command, which was run.

---

## 1. Stack decision

Alternatives compared:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Node/TypeScript service + React UI in an Edge/Chrome app-mode window** | One language end-to-end; same runtime as Copilot SDK, MCP SDK and WorkIQ (all npm); `node:sqlite` needs no native build; no code-signing; ~1 minute install; Edge is present on every enterprise Windows machine and `--app=` gives a real chromeless window with its own taskbar entry | Not a "true" packaged .exe; relies on a browser being installed | **Chosen for Phases 1–5** |
| Electron | True desktop shell, tray, notifications | 100 MB+ download often blocked by proxies; native module rebuilds; code-signing/SmartScreen friction; slower install | Optional Phase 6 packaging target; the UI and API are already shell-agnostic |
| Tauri (Rust) + WebView2 | Tiny binary, WebView2 is built into Windows | Requires Rust toolchain on the user's machine or CI-built binaries; a second language | Optional Phase 6 |
| .NET (WPF/WinUI) | Native Windows, DPAPI is first-class | Copilot SDK and MCP SDK are TypeScript-first; two toolchains; slower iteration | Rejected |
| Python + Streamlit (like FareScout) | Fast prototyping | Not a command-center UX; no typed boundaries; Copilot SDK unavailable | Rejected |

Chosen stack:

- **Runtime**: Node.js ≥ 22.13 (LTS), TypeScript strict, ESM.
- **Local service**: Fastify bound to `127.0.0.1` only, with a per-install random
  bearer token (so another local process cannot query the API blindly).
- **State**: SQLite via `node:sqlite` (WAL mode, FTS5 for evidence search).
- **UI**: React 19 + Vite, no component framework, custom design system tuned to
  the brainstorming slides (editorial, calm, evidence-forward).
- **Validation**: Zod for configuration, domain objects, skill I/O, and API bodies.
- **LLM**: GitHub Copilot via `@github/copilot-sdk` (primary) or CLI (fallback).
- **MCP**: `@modelcontextprotocol/sdk` client (stdio and Streamable HTTP).
- **Windows integration**: PowerShell installer/launcher, Edge/Chrome app window,
  `%LOCALAPPDATA%` data root, DPAPI via PowerShell when a secret ever needs storing
  (none in the default workflow).

---

## 2. Repository structure

```
exec-os/
├── ARCHITECTURE.md              ← this document
├── README.md                    ← install / run / troubleshoot
├── docs/
│   ├── THREAT_MODEL.md
│   ├── PRIVACY.md               ← storage boundary, retention, deletion
│   └── local-docs/README.md     ← how to supply private context documents
├── config/
│   ├── app.example.yaml         ← sanitized user config template
│   └── mcp.example.yaml         ← sanitized provider/MCP template
├── scripts/
│   ├── install.ps1              ← one-command Windows install + desktop shortcut
│   ├── launch.ps1               ← starts the service, opens the app window
│   ├── Start-ExecOS.cmd         ← shortcut target (double-click friendly)
│   └── uninstall.ps1            ← removes shortcut; optional local-data wipe
├── package.json                 ← npm workspaces root; scripts: install, build, start, doctor, test
├── packages/
│   ├── core/                    ← domain, store, providers, intelligence, sync (no HTTP, no UI)
│   │   └── src/
│   │       ├── domain/          ← Zod schemas: evidence, objects, epistemic status
│   │       ├── store/           ← SQLite schema/migrations + repositories + journal
│   │       ├── providers/       ← SourceProvider interface, registry, mock, local docs, MCP + adapters
│   │       ├── intelligence/    ← skills (versioned prompts+schemas), backends, pipeline, reconcile
│   │       ├── sync/            ← orchestrator, cursors, status
│   │       ├── config/          ← config loading/validation, paths (AppData)
│   │       └── logging/         ← sanitized structured logger
│   ├── server/                  ← Fastify API + static UI hosting + CLI (start, doctor, delete-data)
│   └── ui/                      ← React command center
└── .gitignore                   ← defense in depth only (see §4)
```

Dependency direction: `ui → (HTTP) → server → core`. `core` never imports from
`server` or `ui`. Providers and backends are plug-ins behind interfaces; nothing
outside `providers/mcp/adapters/workiq.ts` knows WorkIQ tool names.

---

## 3. Privacy and storage boundary

**Code, configuration, private data, cache, logs and user documents are physically
separated.** The repository directory is treated as read-only at runtime except for
build output.

| Category | Location (Windows) | Git | Notes |
|---|---|---|---|
| Code | `<clone>\exec-os\` | tracked | Never written at runtime |
| Config templates | `<clone>\exec-os\config\*.example.yaml` | tracked | Sanitized |
| **User config** | `%LOCALAPPDATA%\ExecOS\config\app.yaml`, `mcp.yaml` | outside repo | Created from templates by installer; may name people/terms → private |
| **Private data** | `%LOCALAPPDATA%\ExecOS\data\execos.sqlite` | outside repo | Evidence, objects, journal, feedback, summaries |
| **Cache** | `%LOCALAPPDATA%\ExecOS\cache\` | outside repo | Provider responses, batch inputs; TTL-bounded |
| **Logs** | `%LOCALAPPDATA%\ExecOS\logs\` | outside repo | Metadata-only; bodies never logged (§3.2) |
| **User documents** | `%LOCALAPPDATA%\ExecOS\docs\` (default) | outside repo | Optional repo-local `exec-os/docs/local-docs/` is git-ignored and displays a warning banner in Settings |
| Copilot session state | `%LOCALAPPDATA%\ExecOS\copilot-home\` | outside repo | via `COPILOT_HOME`; contains prompts → private |
| Access token | `%LOCALAPPDATA%\ExecOS\config\local-token` | outside repo | random per install; loopback API auth |

The data root can be overridden with `EXECOS_HOME` (e.g. for tests, which use a
temp directory). On Linux/macOS dev machines it defaults to
`$XDG_DATA_HOME/ExecOS` or `~/.local/share/ExecOS`.

### 3.1 Retention

- `retention.lookback_days: 90` — evidence older than this is purged on sync.
- `retention.journal_days: 30` — journal views default to 30 days; entries older
  than `retention.journal_keep_days` (default 180) are purged.
- `retention.raw_text: "trimmed" | "full" | "none"` — how much source text is kept
  per evidence row. Default `trimmed` (first 4 000 characters, enough for
  provenance display; analysis batches are built at ingest time).
- `Delete Local Data` (Settings, `execos delete-data`, `uninstall.ps1 -PurgeData`)
  deletes the entire data root after explicit confirmation.

### 3.2 Logging rules

Loggers accept structured fields only. Fields named `body`, `text`, `content`,
`subject`, `prompt`, `answer`, `participants` are redacted by the logger itself
(replaced by length + hash) so a careless call site cannot leak content. Log level
and location are configurable; default level is `info`.

### 3.3 `.gitignore` as defense in depth

The repository `.gitignore` excludes `*.sqlite*`, `*.db`, `docs/local-docs/*`
(except README), `config/*.yaml` (except `*.example.yaml`), `.execos/`, logs,
`copilot-session-*.md`, `.mcp.json`. This is a second line of defense; the first is
that the runtime never writes private data inside the repository.

---

## 4. Domain and data model

All objects are Zod schemas in `packages/core/src/domain/` and are persisted as
typed columns + a JSON `payload` column in SQLite, with dedicated link tables for
evidence references so provenance queries are indexed.

### 4.1 Epistemic status (mandatory on every object and observation)

```
fact                 explicitly supported by source material (quote/paraphrase)
extracted_action     an action explicitly requested or committed to in evidence
recorded_decision    a decision clearly recorded in evidence
inference            the system inferred it from one or more signals
recommendation       the system proposes it; not an organizational fact
potential_escalation the system believes leadership attention may be needed
```

The UI renders each with a distinct badge and wording ("Recorded decision" vs
"AI suggests"). A recommendation can only become an ActionItem through an explicit
user **Accept**, which is journaled with `actor: user`.

### 4.2 Evidence (normalized, provider-agnostic)

```
Evidence {
  evidence_id        stable hash of (provider, source_ref)          PK
  provider_id        "workiq" | "mock" | "local_docs" | ...
  source_type        email | teams_message | teams_thread | meeting | calendar_event
                     | document | metric | copilot_answer | tracker_item
  occurred_at        ISO timestamp of the underlying event
  retrieved_at       ISO timestamp of retrieval
  title              subject / thread title / file name
  participants[]     { name, email?, role? }   (people are stored as given by the source)
  thread_id?         conversation / channel / meeting series identifier
  source_ref         { kind, id, url?, path? } — url only if the source system supplied one
  text?              extracted text (subject to retention.raw_text)
  structured?        provider-specific structured payload (e.g. metric value, delta)
  sensitivity        { label?: string, confidential?: boolean }   from source if available
  content_hash       for dedupe across providers
}
```

### 4.3 Intelligence objects

```
Theme          { id, name, slug, description, pinned, discovered, state: what_changed,
                 current_state, confidence, last_updated, evidence_count, related_object_counts }
Signal         { id, theme_id?, statement, epistemic, confidence, occurred_at, evidence[] }
ActionItem     { id, title, description, owner?, stakeholders[], created_at, due_at?,
                 status: detected|confirmed|assigned|in_progress|blocked|escalation_candidate
                        |escalated|completed|dismissed,
                 epistemic, confidence, theme_id?, evidence[], first_seen, last_observed,
                 escalation_id?, origin: extracted|inferred|user|accepted_recommendation }
Decision       { id, topic, decision, decision_date?, decision_maker?, rationale?,
                 alternatives[], status: recorded|needed|pending_approval|superseded,
                 epistemic, confidence, theme_id?, evidence[], downstream_action_ids[] }
Escalation     { id, issue, why_needed, owner?, target_decision_maker?, urgency: low|medium|high|critical,
                 status: potential|active|resolved|dismissed, recommended_resolution?, epistemic,
                 confidence, theme_id?, evidence[], related_action_ids[] }
Risk           { id, title, description, likelihood, impact, trend: rising|stable|falling,
                 status: open|mitigating|closed, owner?, theme_id?, epistemic, evidence[] }
Recommendation { id, recommendation, reasoning, evidence[], confidence, theme_ids[],
                 suggested_owner?, suggested_next_step, status: proposed|accepted|modified|dismissed,
                 dismissed_reason?, created_at }
DataRequest    { id, request, requested_by?, kind: analysis|metric|dashboard|data_pull|experiment
                 |forecast|engineering, status: identified|accepted|declined, evidence[], theme_id? }
BusinessMetric { id, name, value, unit?, as_of, delta?, source_evidence, theme_id? }
Stakeholder    { id, name, email?, role?, org?, first_seen, last_seen, mention_count }
Summary        { id, horizon: daily|weekly|monthly|quarterly, period_start, period_end,
                 sections: { attention, changed, themes, recommendations, upcoming, narrative? },
                 generated_at, evidence_coverage: { providers, incomplete: boolean, reasons[] } }
JournalEntry   { id, at, object_type, object_id, event: detected|updated|status_changed|merged|
                 dismissed|accepted|feedback|sync, actor: system|user, before?, after?, evidence[] }
Feedback       { id, at, object_type, object_id, kind: not_an_action|wrong_owner|mark_completed|
                 merge|not_important|is_decision|escalate|hide_recommendation|pin_theme, payload }
SyncState      { provider_id, cursor (opaque JSON), last_sync_at, last_status, last_error?, stats }
```

Every object carries `evidence[]` (evidence ids + role: `supports|mentions|contradicts`)
so "Why am I seeing this?" is a single join.

---

## 5. MCP / provider abstraction

```
SourceProvider (interface)
  id, kind: "mcp" | "mock" | "local_docs"
  describe(): ProviderInfo
  checkHealth(): { ok, auth_required?, message }
  discoverCapabilities(): Capability[]          // e.g. mail.list, chat.list, calendar.list, ask
  fetchSince(cursor, window): AsyncIterable<EvidenceBatch & { next_cursor }>
  openSourceUrl?(evidence): string | undefined   // only if the source supplies a URL
```

Layers:

```
McpProvider  (generic MCP client: stdio | streamable-http; tools/list; call_tool)
   └── SourceAdapter chosen by capability fingerprint
         ├── WorkIqAdapter    matches tools {ask, fetch?, search_paths?, ...}
         ├── GenericMcpAdapter (any server that exposes list/search-style tools; ask-only)
         └── (future) PowerBiAdapter
MockProvider  (synthetic dataset; scenarios in §8)
LocalDocsProvider (txt/md/docx→text from the private docs directory)
```

The provider registry reads `mcp.yaml`:

```yaml
providers:
  - id: workiq
    enabled: true
    type: mcp
    transport: stdio
    command: npx
    args: ["-y", "@microsoft/workiq@latest", "mcp"]
    adapter: workiq            # optional; auto-detected from tools if omitted
    scopes: [mail, chat, calendar, files]
  - id: powerbi
    enabled: false
    type: mcp
    transport: http
    url: https://example.invalid/mcp
  - id: local_docs
    enabled: true
    type: local_docs
  - id: mock
    enabled: false            # installer enables this when no real provider is configured
    type: mock
```

WorkIQ specifics stay inside the adapter: entity paths, OData filters, paging,
`ask` fallbacks, EULA/auth error mapping. Everything downstream sees `Evidence`.

---

## 6. Intelligence pipeline

```
discover_sources → filter by window/cursor → incremental retrieval → normalize
→ dedupe (content_hash) → persist evidence → batch (by day + thread, token-bounded)
→ analyze_batch (skill) → observations → reconcile into objects (entity resolution)
→ detect/refresh themes → generate_recommendations → summarize_{daily,weekly,monthly}
→ journal + sync_state
```

### 6.1 Skills

A skill is `{ name, version, description, input schema, output schema, prompt template }`
in `packages/core/src/intelligence/skills/`. Prompts contain **no user content**;
private context (org terminology, roles, pinned themes, local-doc excerpts) is
injected at run time from the private config/data directories.

`discover_sources`, `analyze_batch`, `extract_actions`, `extract_decisions`,
`identify_escalations`, `detect_themes`, `reconcile_entities`,
`update_existing_items`, `summarize_daily`, `summarize_weekly`, `summarize_monthly`,
`generate_recommendations`, `identify_data_requests`, `answer_with_evidence`.

In Phase 3 `analyze_batch` performs actions/decisions/escalations/risks/data
requests/theme hints in one pass per batch (fewer model calls); the specialised
skills exist for targeted re-runs and for the mock backend.

### 6.2 Backends

```
IntelligenceBackend.runSkill(skill, input, ctx) → validated output
  MockBackend        deterministic; fixture-driven for the synthetic dataset, heuristic otherwise
  CopilotSdkBackend  Copilot SDK session per skill run; output captured via submit_result tool
  CopilotCliBackend  spawn `copilot -p ... --output-format json`; parse + validate
```

Structured-output strategy: the model is told to call `submit_result` exactly once;
the SDK tool handler validates with the skill's Zod schema and returns validation
errors to the model for one retry. This is more reliable than parsing free text.

### 6.3 Reconciliation

For each observation: candidate match by (type, theme, normalized title trigram
similarity ≥ 0.6, owner overlap, thread overlap). Match → update: append evidence,
bump `last_observed`, advance status only forward unless evidence says completed
or reopened, record a journal `updated`/`status_changed`. No match → create with
`detected`. User feedback (`merge`, `not_an_action`, `wrong_owner`) is applied
before model output on subsequent runs and stored as suppression/alias rules.

### 6.4 Recommendations (rule + model)

Rules run locally every sync and are labelled `inference`:
- same issue in ≥ 3 evidence items across ≥ 2 sources within 10 days → "repeated, unresolved"
- commitment with ≥ 3 mentions and no owner → "no identifiable owner"
- action past due with no update in 7 days → escalation candidate
- decision `needed` blocking ≥ 2 actions → "blocking decision"
- metric delta beyond threshold → "forecast/metric moved"

The model skill can add further recommendations; both carry reasoning, evidence,
confidence, affected themes, suggested owner and next step, and an
Accept / Modify / Dismiss lifecycle.

---

## 6.5 Bucket playbooks and the tab edit loop

**Playbooks** (`BucketSkill`) are generated by `ensureBucketSkills` after theme refresh: for each
bucket without a playbook, `collectBucketHistory` gathers evidence, objects, participants, forums
and metrics; the `generate_bucket_skill` skill (model) or `derivePlaybook` (rules; also the mock
backend) produces purpose, cadence, owners, signals, five stage steps each labelled
`history|assumption`, escalation path, decision rights and recurring blockers, with `basis`
history/mixed/assumption and a rationale. Version 1 is stored `fixed`. Sync never regenerates a
fixed playbook; `regenerateBucketSkill` (new version) and `editBucketSkill` (user_adjusted) are
user actions. Rule R8 proposes a refresh when an assumption-based playbook gains enough history.

**Edit loop** (`edits.ts`): `editObject` (allowed fields per type; edited fields go into
`locked_fields`, which reconciliation honours), `removeObject` (hidden + suppression fingerprint),
`createManualObject` (origin user, epistemic fact), `editTheme`/`createTheme` (locked description
and state overrides; hidden buckets are never rediscovered), `excludeEvidence` (deleted, unlinked
from all objects and themes, remembered by id and content hash so ingestion skips it).

## 7. UI information architecture

Primary navigation is a strict drill-down; every element at a level links to the next level:

```
Level 1  Executive   attention counts · narrative · buckets (themes) · metrics · upcoming
Level 2  Bucket      what changed · current state · items grouped by type · evidence behind the bucket · Request data (bucket)
Level 3  Item        why am I seeing this · fields · evidence rows · data requests on the item · related · history · corrections · Request data (item)
Level 4  Evidence    retained source text · open-in-source (only if the source supplied a URL) · items derived from it
```

Data requests raised at levels 2 and 3 go to `POST /api/data-requests`, are persisted as
`DataRequest` objects with `scope: bucket | item`, and are forwarded to the configured intake
endpoint (`data_requests.endpoint_url`) when one exists. Delivery status is recorded on the object.

The secondary screens ("More" menu):

```
Home / Executive Brief   [Daily | Weekly | Monthly]  Needs attention · What changed · Key themes · Recommendations · Upcoming · Coverage
Themes                   cards (pinned + discovered) → theme detail (state, signals, objects, evidence)
Actions                  filters: Mine · My team · Overdue · This week · Waiting · Escalated · Completed
Decisions                Made · Needed · Pending approvals
Escalations              Potential · Active · Resolved   (each shows "why surfaced")
Risks                    open/mitigating/closed with trend
Recommendations          Accept / Modify / Dismiss with reasoning + evidence
Data requests            identified analytics/data work (not accepted work)
Timeline                 journal (30 days): detected/updated/status changes/feedback
Ask                      secondary conversational Q&A with evidence citations
Sources                  provider health, last sync, cursors, coverage gaps, errors
Settings                 config view, pinned themes, retention, Delete Local Data
```

Every object row has **Why am I seeing this?** → drawer with epistemic badge,
confidence, reasoning, and evidence list (`Email — Sep 12`, `Teams thread — Sep 14`,
...) with "Open source" only when the source supplied a URL.

---

## 8. Synthetic data (testability)

`MockProvider` ships a synthetic organization (fictional company "Northwind Cloud
Support") with ~60 evidence items across email, Teams, meetings, documents and
metrics covering: a recorded decision; an unresolved commitment repeated across
channels; an escalation; conflicting information; a completed action; a forecast
change; and an emerging theme. The mock backend returns fixture observations for
these so the full UI and lifecycle can be exercised offline and in CI.

---

## 9. Security summary (see docs/THREAT_MODEL.md)

- Loopback-only API with random per-install token; no inbound network exposure.
- Outbound calls only from Copilot CLI (GitHub) and configured MCP servers
  (WorkIQ → Microsoft). ExecOS itself makes no other network calls.
- No secrets in the default workflow; if a provider requires one, it is stored via
  Windows DPAPI (`ProtectedData`) in the config directory, never in git.
- The model backend is denied shell, file write and URL tools; only `submit_result`
  and read-only evidence lookup tools are exposed.
- Source access is always the signed-in user's; ExecOS never stores or replays
  Entra tokens (WorkIQ owns its token cache).

---

## 10. Phased plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Investigation (this document) | done |
| 1 | Local shell: installer, shortcut, config, SQLite state, mock provider, UI shell | this commit |
| 2 | WorkIQ: MCP client, capability discovery, entity/ask retrieval, cursors | adapter implemented; live validation pending (§0.4) |
| 3 | Intelligence: batch analysis, reconciliation, themes, recommendations, provenance | mock backend end-to-end; Copilot backends implemented, live validation pending |
| 4 | Executive UX: horizons, centers, evidence drill-down | first version in this commit |
| 5 | Local docs, additional MCPs (Power BI), Ask | local docs + Ask (mock) in this commit |
| 6 | Hardening: DPAPI, packaging (Electron/Tauri optional), perf, telemetry (local only) | planned |

The smallest vertical slice delivered now:
launch → mock provider → ingest → identify theme/action/decision → persist → render
→ "Why am I seeing this?" → inspect evidence.
