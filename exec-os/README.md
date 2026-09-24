# ExecOS

**A private, local-first, evidence-backed operating-intelligence layer for a leader.**

ExecOS reads the signals scattered across your organization (email, Teams, meetings, documents,
metrics, other MCP-connected systems), keeps structured state over time, separates facts from
inference, tracks commitments and decisions, identifies what needs leadership attention, and
helps turn information into action. It assists your judgement; it never decides for you.

It is **not** a chatbot that summarizes your inbox. It is a command center built around the loop

```
SENSE → INTERPRET → DECIDE → ALIGN → EXECUTE & LEARN
```

All private data lives outside this repository in `%LOCALAPPDATA%\ExecOS`. See
[ARCHITECTURE.md](./ARCHITECTURE.md), [docs/PRIVACY.md](./docs/PRIVACY.md) and
[docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md).

---

## Install (Windows)

Prerequisites: Windows 10/11, Node.js 22.13+ (LTS), Microsoft Edge or Chrome, GitHub Copilot
CLI signed in with your enterprise GitHub account, and a Microsoft 365 account with Copilot for
WorkIQ. No API keys are needed.

```powershell
git clone <this repository>
cd farescout\exec-os
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The installer validates prerequisites (and tells you exactly what to fix), installs dependencies,
builds the app, seeds your private configuration in `%LOCALAPPDATA%\ExecOS\config`, and creates
an **ExecOS** desktop shortcut. Double-click the shortcut: the local service starts on
`127.0.0.1` and the app opens in an Edge app window.

First-time authentication (once, in a terminal):

```powershell
npm install -g @github/copilot @microsoft/workiq
copilot login            # GitHub enterprise account
workiq accept-eula
workiq auth login        # uses your Windows / Entra ID sign-in (WAM broker)
```

Want to explore without enterprise access? `scripts\install.ps1 -DemoData` enables a synthetic
organization (fictional people and messages) so every screen and workflow can be exercised.

Other platforms (development): `npm install && npm run build && npm start`.

## Everyday use

| Screen | What it answers |
|---|---|
| **Home** (Daily / Weekly / Monthly / Quarterly) | What needs my attention? What changed? Which themes moved? What is recommended? What is coming up? |
| **Themes** | Business domains discovered from evidence plus the ones you pinned, each with "what changed" and "current state" |
| **Actions** | Commitments and requests with Mine / My team / Overdue / This week / Waiting / Escalated / Completed |
| **Decisions** | Decisions needed · Pending approvals · Decisions made (kept strictly apart) |
| **Escalations** | Potential (system judgement) · Active (confirmed by you) · Resolved |
| **Risks**, **Recommendations**, **Data requests** | Each with reasoning, evidence, confidence, and Accept / Modify / Dismiss where relevant |
| **Timeline** | The journal: first detected, status changes, your corrections, syncs |
| **Ask** | Secondary Q&A over local evidence with citations |
| **Sources** | Provider health, last sync, coverage gaps, cursors, backend status |
| **Settings** | Pinned themes, retention, sources, paths, **Delete local data** |

Every item has **Why am I seeing this?** — the epistemic status (Fact / Extracted action /
Recorded decision / AI inference / AI recommendation / Potential escalation), confidence, the
reasoning, the supporting evidence (`Email — Sep 12`, `Teams thread — Sep 14`, …) with "Open
source" only when the source system supplied a link, related items, and full history.

## Command line

```
npm start                 # start the local service (opens window, runs incremental sync)
npm run doctor            # prerequisite diagnostics with remediation (add -- --probe-mcp to connect to MCP servers)
npm run sync              # run a sync without the UI (add -- --bootstrap to force a full 90-day scan)
npm run delete-data       # remove all private local data (asks for confirmation)
```

## Configuration

Templates are in `config/*.example.yaml`; your real copies live in
`%LOCALAPPDATA%\ExecOS\config\app.yaml` and `mcp.yaml` and are never committed.

- `app.yaml`: who you are, retention (`lookback_days: 90`, `journal_days: 30`), enabled sources,
  summaries, pinned themes, organization terminology, important roles, intelligence backend
  (`auto | copilot-sdk | copilot-cli | mock`) and the Copilot launcher command.
- `mcp.yaml`: providers. WorkIQ is the default (`npx -y @microsoft/workiq@latest mcp`); add any
  MCP server (stdio or HTTP). ExecOS discovers tools at runtime and picks an adapter.
- Private context documents: drop `.md`/`.txt` files in `%LOCALAPPDATA%\ExecOS\docs`
  (see [docs/local-docs/README.md](./docs/local-docs/README.md)).

## Repository layout

```
exec-os/
  ARCHITECTURE.md   design, verified facts, unknowns, phases
  config/           sanitized templates only
  docs/             privacy, threat model, local-docs guide
  scripts/          install.ps1, launch.ps1, Start-ExecOS.cmd, uninstall.ps1
  packages/core     domain model, SQLite store, providers (mock, local docs, MCP/WorkIQ), intelligence pipeline
  packages/server   loopback API, CLI (start/doctor/sync/delete-data), static UI hosting
  packages/ui       React command center
```

## Development

```
npm install
npm run build
npm test            # core pipeline tests on the synthetic dataset + API tests
npm run dev:ui      # Vite dev server proxying /api to a running service
```

## Status

Phase 1–4 vertical slice is complete against synthetic data. WorkIQ retrieval and the Copilot
backends are implemented against verified interfaces but need validation on a Windows machine
with enterprise access; see the "UNVERIFIED" items in ARCHITECTURE.md §0.
