# Threat model

## Assets

1. Organizational content retrieved from Microsoft 365 and other sources (evidence).
2. Derived intelligence: actions, decisions, escalations, risks, recommendations, summaries, journal.
3. The user's identity and existing authentication sessions (GitHub Copilot, Entra ID/WAM).
4. Private context documents and configuration (names, roles, terminology).

## Trust boundaries

```
[ Windows user session ]
   ├─ ExecOS service (Node, 127.0.0.1:<port>, token-protected)  ── local-only HTTP ──▶ Edge app window
   ├─ SQLite + files under %LOCALAPPDATA%\ExecOS                    (NTFS ACL: current user)
   ├─ Copilot CLI/SDK subprocess  ── HTTPS ──▶ GitHub Copilot (authenticated as the user)
   └─ MCP subprocesses (WorkIQ)   ── HTTPS ──▶ Microsoft 365 (Entra ID via WAM, user's own permissions)
```

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| Private data committed to git | Runtime never writes inside the repo; data root is validated to be outside any git tree; strong `.gitignore` as defense in depth; prompts contain no user content |
| Another local process reads the API | Service binds to loopback only; every `/api` call requires the per-install random token stored with user-only permissions; the UI keeps it in `sessionStorage` and strips it from the URL |
| Another Windows user reads the data | Data root is under the user's profile (`%LOCALAPPDATA%`), protected by NTFS ACLs. Full-disk encryption (BitLocker) is recommended; DPAPI (`ProtectedData`) is reserved for any future secret that must be stored (none in the default workflow) |
| Model executes unintended actions | The intelligence backend is given a single custom tool (`submit_result`); every other permission request (shell, write, URL, MCP) is rejected in the SDK handler and denied via CLI flags. ExecOS never calls WorkIQ write tools (`create/update/delete/do_action`) |
| Prompt injection through evidence (an email that tells the model to do something) | Model output is structured and schema-validated; it can only produce observations. Observations can only create or update local objects, never send messages, and every object shows its evidence so a manipulated item is inspectable. Recommendations require explicit human acceptance |
| Fabricated facts, links or people | Epistemic status is mandatory; links come only from source metadata (`webLink`/`webUrl`); evidence ids are validated against the store before reconciliation; coverage gaps are displayed instead of filled |
| Circumventing enterprise access controls | All retrieval is performed as the signed-in user through WorkIQ/Graph; ExecOS stores no Entra tokens and cannot widen scope |
| Secret leakage via environment | MCP subprocesses receive a curated environment (PATH, proxy, profile paths, explicit `env` from config), not the whole process environment |
| Sensitive content in logs | Logger redacts content-bearing fields by name; log level configurable |
| Data retention beyond need | Evidence purged after `lookback_days`; raw text trimmed by default; one-click Delete Local Data |
| Supply chain (npm) | Dependencies are few (Fastify, Zod, YAML, MCP SDK, Copilot SDK, React). Lockfile is committed; installs can be pointed at an internal registry mirror |
| Availability: a source or the model fails | Sync continues with other sources; cursors and state are preserved; UI shows partial coverage and remediation |

## Out of scope (for now)

- Multi-user or shared deployment (ExecOS is per-user by design).
- Protection against an attacker with the user's Windows session (they already have the same M365 access).
- Guarantees about Copilot's or WorkIQ's own data handling (governed by the enterprise agreements).
