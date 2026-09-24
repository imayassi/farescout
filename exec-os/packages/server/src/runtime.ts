/**
 * Runtime assembly: paths → config → store → providers → backend → orchestrator.
 * Shared by the HTTP server, the CLI and tests.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  appPaths, ensureDirs, resolveDataRoot, isInsideGitRepo, loadConfig, seedConfigFromTemplates, createLogger, silentLogger,
  Store, buildProviders, selectBackend, SyncOrchestrator, type AppPaths, type LoadedConfig, type Logger, type SourceProvider,
  type IntelligenceBackend, type BackendInfo,
} from "@execos/core";

export interface Runtime {
  paths: AppPaths;
  config: LoadedConfig;
  logger: Logger;
  store: Store;
  providers: SourceProvider[];
  disabledProviders: string[];
  backend: IntelligenceBackend;
  backendProbes: BackendInfo[];
  degraded: boolean;
  orchestrator: SyncOrchestrator;
  token: string;
  warnings: string[];
  close(): Promise<void>;
}

export interface RuntimeOptions { dataRoot?: string; quiet?: boolean; allowMockBackend?: boolean }

export function readOrCreateToken(p: AppPaths): string {
  try {
    if (fs.existsSync(p.tokenFile)) { const t = fs.readFileSync(p.tokenFile, "utf8").trim(); if (t.length >= 16) return t; }
  } catch { /* regenerate */ }
  const t = randomBytes(24).toString("base64url");
  fs.mkdirSync(path.dirname(p.tokenFile), { recursive: true });
  fs.writeFileSync(p.tokenFile, t, { encoding: "utf8", mode: 0o600 });
  return t;
}

/** Reads the private docs directory to build a short operating-context excerpt for prompts (never persisted to the repo). */
export function contextExcerptFrom(dir: string, maxChars = 3000): string | undefined {
  try {
    if (!fs.existsSync(dir)) return undefined;
    const files = fs.readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f) && f.toLowerCase() !== "readme.md").sort();
    let out = "";
    for (const f of files) {
      const t = fs.readFileSync(path.join(dir, f), "utf8");
      out += `\n# ${f}\n${t}`;
      if (out.length > maxChars) break;
    }
    return out ? out.slice(0, maxChars) : undefined;
  } catch { return undefined; }
}

export async function createRuntime(opts: RuntimeOptions = {}): Promise<Runtime> {
  const root = opts.dataRoot ?? resolveDataRoot();
  const paths = appPaths(root);
  ensureDirs(paths);
  const warnings: string[] = [];
  if (isInsideGitRepo(root)) warnings.push(`Data root ${root} is inside a git repository. Private data must live outside the repo; set EXECOS_HOME.`);
  seedConfigFromTemplates(paths);
  const config = loadConfig(paths);
  const logger = opts.quiet ? silentLogger : createLogger({ level: config.app.logging.level, dir: paths.logs, scope: "execos", stderr: true });
  const store = new Store(paths.dbFile);
  const { enabled, disabled } = buildProviders(config.app, config.mcp, paths, logger);
  if (enabled.length === 0) warnings.push("No sources are enabled. Enable workiq, local_docs or mock in config/mcp.yaml.");
  const hasMock = enabled.some((p) => p.describe().kind === "mock");
  const sel = await selectBackend(config.app, paths, logger, { allowMock: opts.allowMockBackend ?? hasMock });
  if (sel.degraded) warnings.push("No Copilot backend available: running in degraded mode (rule engine only, no model analysis). Run `copilot login` or set intelligence.backend.");
  const orchestrator = new SyncOrchestrator({ store, providers: enabled, backend: sel.backend, app: config.app, logger, degraded: sel.degraded, contextExcerpt: () => contextExcerptFrom(paths.docs) });
  const token = readOrCreateToken(paths);
  return {
    paths, config, logger, store, providers: enabled, disabledProviders: disabled, backend: sel.backend, backendProbes: sel.probes, degraded: sel.degraded,
    orchestrator, token, warnings,
    async close() { for (const p of enabled) await p.close?.().catch(() => undefined); await sel.backend.close?.().catch(() => undefined); store.close(); },
  };
}

/** "Delete Local Data": removes every runtime artifact under the data root. Config is kept unless requested. */
export function deleteLocalData(paths: AppPaths, opts: { includeConfig?: boolean } = {}): string[] {
  const removed: string[] = [];
  for (const d of [paths.data, paths.cache, paths.logs, paths.copilotHome]) {
    if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); removed.push(d); }
  }
  if (opts.includeConfig && fs.existsSync(paths.config)) { fs.rmSync(paths.config, { recursive: true, force: true }); removed.push(paths.config); }
  return removed;
}
