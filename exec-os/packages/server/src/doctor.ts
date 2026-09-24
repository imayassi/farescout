/**
 * `execos doctor`: validates prerequisites and prints understandable remediation. Every check the
 * PowerShell installer performs is also implemented here so it can run cross-platform and in CI.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { appPaths, resolveDataRoot, isInsideGitRepo, loadConfig, McpClient, silentLogger, type ProviderConfig } from "@execos/core";

export interface Check { name: string; ok: boolean; level: "critical" | "warn" | "info"; detail: string; remediation?: string }

function which(cmd: string): string | undefined {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : undefined;
}
function version(cmd: string, args: string[] = ["--version"]): string | undefined {
  try { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20000, shell: process.platform === "win32" }); return r.status === 0 ? (r.stdout || r.stderr).trim().split(/\r?\n/)[0] : undefined; } catch { return undefined; }
}

export async function runDoctor(dataRoot: string = resolveDataRoot(), opts: { probeMcp?: boolean } = {}): Promise<Check[]> {
  const checks: Check[] = [];
  const paths = appPaths(dataRoot);

  const [maj, min] = process.versions.node.split(".").map(Number);
  const nodeOk = (maj ?? 0) > 22 || ((maj ?? 0) === 22 && (min ?? 0) >= 13);
  checks.push({ name: "Node.js", ok: nodeOk, level: "critical", detail: `v${process.versions.node}`, remediation: nodeOk ? undefined : "Install Node.js 22.13 or newer (LTS) from https://nodejs.org (needed for the built-in SQLite module)." });

  let sqliteOk = false;
  try { const { DatabaseSync } = await import("node:sqlite"); new DatabaseSync(":memory:").close(); sqliteOk = true; } catch { /* ignore */ }
  checks.push({ name: "Built-in SQLite", ok: sqliteOk, level: "critical", detail: sqliteOk ? "node:sqlite available" : "node:sqlite unavailable", remediation: sqliteOk ? undefined : "Upgrade Node.js to 22.13+." });

  const inRepo = isInsideGitRepo(dataRoot);
  checks.push({ name: "Data root outside git", ok: !inRepo, level: "critical", detail: dataRoot, remediation: inRepo ? "Set EXECOS_HOME to a directory outside any git repository (default is %LOCALAPPDATA%\\ExecOS)." : undefined });

  const cfgExists = fs.existsSync(paths.appConfigFile) && fs.existsSync(paths.mcpConfigFile);
  checks.push({ name: "User configuration", ok: cfgExists, level: "warn", detail: cfgExists ? paths.config : "not initialized", remediation: cfgExists ? undefined : "Run `npm start` once (or install.ps1) to seed config from the sanitized templates." });

  let providers: ProviderConfig[] = [];
  let backendCmd = "copilot";
  try { const c = loadConfig(paths); providers = c.mcp.providers; backendCmd = c.app.intelligence.copilot.command; } catch (e) { checks.push({ name: "Configuration parses", ok: false, level: "critical", detail: (e as Error).message, remediation: "Fix the YAML in the config directory or delete it to re-seed from templates." }); }

  const copilotPath = which(backendCmd);
  const copilotVer = copilotPath ? version(backendCmd) : undefined;
  checks.push({ name: `GitHub Copilot CLI (${backendCmd})`, ok: !!copilotVer, level: "warn", detail: copilotVer ?? "not found on PATH", remediation: copilotVer ? undefined : "Install with `npm install -g @github/copilot`, then run `copilot login`. If your organization mandates a wrapper (e.g. `agency`), set intelligence.copilot.command in app.yaml." });

  let sdkOk = false;
  try { await import("@github/copilot-sdk"); sdkOk = true; } catch { /* optional */ }
  checks.push({ name: "Copilot SDK", ok: sdkOk, level: "info", detail: sdkOk ? "@github/copilot-sdk installed (primary backend)" : "not installed; CLI fallback will be used", remediation: sdkOk ? undefined : "Run `npm install` in exec-os/ with network access to npmjs.org." });

  if (copilotVer) {
    const login = spawnSync(backendCmd, ["-p", "Reply with the single word OK", "-s", "--no-ask-user", "--disable-builtin-mcps"], { encoding: "utf8", timeout: 60000, shell: process.platform === "win32" });
    const ok = login.status === 0 && /ok/i.test(login.stdout);
    checks.push({ name: "Copilot authentication", ok, level: "warn", detail: ok ? "signed in" : (login.stderr || login.stdout || "no response").trim().slice(0, 200), remediation: ok ? undefined : "Run `copilot login` and complete the browser sign-in with your GitHub enterprise account." });
  }

  for (const p of providers) {
    if (!p.enabled) continue;
    if (p.type === "mcp" && p.transport === "stdio" && p.command) {
      const cmdPath = which(p.command);
      checks.push({ name: `MCP server "${p.id}" command`, ok: !!cmdPath, level: "warn", detail: cmdPath ? `${p.command} ${p.args.join(" ")}` : `${p.command} not found on PATH`, remediation: cmdPath ? undefined : p.id === "workiq" ? "Install Node.js (provides npx) or `npm install -g @microsoft/workiq`, then run `workiq auth login` and `workiq accept-eula`." : `Install the ${p.id} MCP server or disable it in mcp.yaml.` });
      if (p.id === "workiq") {
        const w = which("workiq");
        checks.push({ name: "WorkIQ CLI", ok: !!w, level: "info", detail: w ? (version("workiq", ["version"]) ?? w) : "not installed globally (npx will download on first run)", remediation: w ? undefined : "Optional: `npm install -g @microsoft/workiq` avoids the npx download and lets you run `workiq auth login` up front." });
      }
      if (opts.probeMcp && cmdPath) {
        const client = new McpClient({ id: p.id, transport: "stdio", command: p.command, args: p.args, env: p.env, timeout_ms: 30000, logger: silentLogger });
        try {
          await Promise.race([client.connect(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout after 45s")), 45000))]);
          const tools = client.listTools().map((t) => t.name);
          const entity = tools.includes("fetch");
          checks.push({ name: `MCP "${p.id}" tools`, ok: tools.length > 0, level: "warn", detail: tools.join(", ") || "none", remediation: p.id === "workiq" && !entity ? "Only local tools are visible: run `workiq auth login` (and `workiq auth consent` if your tenant requires it) to unlock entity retrieval. Until then ExecOS uses `ask`-based retrieval with partial coverage." : undefined });
        } catch (e) {
          checks.push({ name: `MCP "${p.id}" connect`, ok: false, level: "warn", detail: (e as Error).message.slice(0, 200), remediation: "Check the command/args in mcp.yaml and that the server starts from a terminal." });
        } finally { await client.close(); }
      }
    }
    if (p.type === "local_docs") {
      const dir = p.directory ?? paths.docs;
      checks.push({ name: "Local documents directory", ok: fs.existsSync(dir), level: "info", detail: dir, remediation: fs.existsSync(dir) ? undefined : "Create the directory and drop .md/.txt context documents in it." });
    }
  }

  const edge = process.platform === "win32" ? (which("msedge") ?? [process.env["ProgramFiles(x86)"], process.env.ProgramFiles].map((b) => b && `${b}\\Microsoft\\Edge\\Application\\msedge.exe`).find((f) => f && fs.existsSync(f))) : which("chromium") ?? which("google-chrome") ?? which("microsoft-edge");
  checks.push({ name: "App window browser", ok: !!edge, level: "info", detail: edge ?? "Edge/Chrome not found; default browser will be used" });

  return checks;
}

export function formatChecks(checks: Check[]): string {
  const lines = checks.map((c) => `${c.ok ? "  OK " : c.level === "critical" ? "FAIL " : "WARN "} ${c.name}: ${c.detail}${!c.ok && c.remediation ? `\n       → ${c.remediation}` : ""}`);
  const critical = checks.filter((c) => !c.ok && c.level === "critical").length;
  const warns = checks.filter((c) => !c.ok && c.level === "warn").length;
  lines.push("", critical ? `${critical} critical problem(s) must be fixed before ExecOS can run.` : warns ? `${warns} warning(s): ExecOS will run with reduced capability.` : "All checks passed.");
  return lines.join("\n");
}
