# Local context documents

ExecOS uses private documents as context when interpreting communications: business priorities,
strategy, operating plans, goals, budgets, leadership expectations, organizational context,
project information, definitions, metrics, meeting notes.

**Preferred location (outside the repository):** `%LOCALAPPDATA%\ExecOS\docs`

Supported formats in this phase: `.md`, `.txt`, `.csv`, `.json`, `.yaml`. Word/PDF files are
listed as unsupported so you know they were not read (conversion is a Phase 5 item).

## This directory

`exec-os/docs/local-docs/` is a *convenience* drop location that is git-ignored (everything except
this README). To use it, set in `%LOCALAPPDATA%\ExecOS\config\mcp.yaml`:

```yaml
  - id: local_docs
    enabled: true
    type: local_docs
    directory: "C:\\path\\to\\farescout\\exec-os\\docs\\local-docs"
```

**Warning:** documents placed here live inside a git working tree. They are ignored by git, but
anyone with access to your clone directory can read them, and a mis-configured `.gitignore`
could expose them. The Sources page shows a warning while this is in use. Prefer the default
location.
