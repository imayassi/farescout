# Privacy and storage boundary

## Principle

The repository contains application logic only. **Private data never lives inside the clone**, and
`.gitignore` is a second line of defense, not the boundary.

## Where things live (Windows)

| What | Where | Committed? |
|---|---|---|
| Code, prompts (no user content), sanitized config templates | `<clone>\exec-os\` | yes |
| Your configuration (names, roles, terminology, provider commands) | `%LOCALAPPDATA%\ExecOS\config\` | never |
| Evidence, themes, actions, decisions, escalations, risks, recommendations, summaries, journal, feedback | `%LOCALAPPDATA%\ExecOS\data\execos.sqlite` | never |
| Provider caches | `%LOCALAPPDATA%\ExecOS\cache\` | never |
| Logs (metadata only) | `%LOCALAPPDATA%\ExecOS\logs\` | never |
| Your private context documents | `%LOCALAPPDATA%\ExecOS\docs\` | never |
| Copilot CLI session state (contains prompts) | `%LOCALAPPDATA%\ExecOS\copilot-home\` (`COPILOT_HOME`) | never |
| Local API token | `%LOCALAPPDATA%\ExecOS\config\local-token` | never |

`EXECOS_HOME` overrides the root. The installer and `execos doctor` refuse a root inside a git
working tree.

## What is retained, and for how long

- Evidence older than `retention.lookback_days` (default 90) is purged on every sync, together
  with its links.
- Journal entries are shown for `retention.journal_days` (30) and purged after
  `retention.journal_keep_days` (180).
- `retention.raw_text` controls how much source text is kept per evidence item:
  `trimmed` (default, first 4,000 characters, enough for provenance), `full`, or `none`
  (metadata only; the "Show source text" control disappears).
- Structured objects keep only excerpts that justify a link, not whole messages.

## What leaves the machine

Only two outbound paths exist, both initiated by tools you already use and authenticated as you:

1. **GitHub Copilot** (via the Copilot CLI/SDK) receives the analysis prompts: batches of evidence
   text and the structured state needed for a skill. Your GitHub enterprise Copilot terms apply.
2. **MCP servers you configured** (WorkIQ → Microsoft 365) receive retrieval requests.

ExecOS itself makes no other network calls, has no telemetry, and introduces no cloud persistence.

## Logs

The logger redacts the values of fields named `body`, `text`, `content`, `subject`, `prompt`,
`answer`, `participants`, `title`, `description`, `question`, `rationale`, `reasoning`,
`summary`, `payload` and `excerpt` (replaced by length and a hash). Only ids, counts, timings,
statuses and error messages are written.

## Deleting your data

- Settings → **Delete local data…** (type `DELETE`), or
- `npm run delete-data` (add `-- --include-config` to remove configuration too), or
- `scripts\uninstall.ps1 -PurgeData`.

## Repo-local documents (optional convenience)

`exec-os/docs/local-docs/` is git-ignored except its README. If you point `local_docs.directory`
at it, the Sources page shows a warning because the directory is inside a repository. Prefer the
default `%LOCALAPPDATA%\ExecOS\docs`.
