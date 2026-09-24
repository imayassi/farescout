import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const APP_NAME = "ExecOS";

/**
 * Resolve the per-user data root. Runtime/private data NEVER lives in the repository.
 *   EXECOS_HOME                      explicit override (tests, portable installs)
 *   %LOCALAPPDATA%\ExecOS            Windows
 *   $XDG_DATA_HOME/ExecOS            Linux/macOS dev machines
 */
export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.EXECOS_HOME && env.EXECOS_HOME.trim()) return path.resolve(env.EXECOS_HOME);
  if (process.platform === "win32") {
    const base = env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(base, APP_NAME);
  }
  const base = env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, APP_NAME);
}

export interface AppPaths {
  root: string;
  config: string;
  data: string;
  cache: string;
  logs: string;
  docs: string;
  copilotHome: string;
  dbFile: string;
  appConfigFile: string;
  mcpConfigFile: string;
  tokenFile: string;
}

export function appPaths(root: string = resolveDataRoot()): AppPaths {
  return {
    root,
    config: path.join(root, "config"),
    data: path.join(root, "data"),
    cache: path.join(root, "cache"),
    logs: path.join(root, "logs"),
    docs: path.join(root, "docs"),
    copilotHome: path.join(root, "copilot-home"),
    dbFile: path.join(root, "data", "execos.sqlite"),
    appConfigFile: path.join(root, "config", "app.yaml"),
    mcpConfigFile: path.join(root, "config", "mcp.yaml"),
    tokenFile: path.join(root, "config", "local-token"),
  };
}

export function ensureDirs(p: AppPaths): void {
  for (const d of [p.root, p.config, p.data, p.cache, p.logs, p.docs, p.copilotHome]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** Guard: refuse to place the data root inside a git working tree (privacy boundary). */
export function isInsideGitRepo(dir: string): boolean {
  let cur = path.resolve(dir);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(cur, ".git"))) return true;
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
  return false;
}
