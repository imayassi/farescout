import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { AppConfigSchema, McpConfigSchema, type AppConfig, type McpConfig } from "./schema.js";
import type { AppPaths } from "./paths.js";

function readYaml(file: string): unknown {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  return YAML.parse(text) ?? {};
}

export interface LoadedConfig {
  app: AppConfig;
  mcp: McpConfig;
  sources: { appFile: string; mcpFile: string; appExists: boolean; mcpExists: boolean };
}

/** Locate the sanitized templates shipped in the repo (used to seed a fresh install). */
export function templateDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/config -> ../../../../config  (packages/core/dist/config)
  const candidates = [
    path.resolve(here, "..", "..", "..", "..", "config"),
    path.resolve(here, "..", "..", "..", "config"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, "app.example.yaml"))) return c;
  return candidates[0]!;
}

export function seedConfigFromTemplates(p: AppPaths): { seeded: string[] } {
  const seeded: string[] = [];
  const tpl = templateDir();
  const pairs: Array<[string, string]> = [
    [path.join(tpl, "app.example.yaml"), p.appConfigFile],
    [path.join(tpl, "mcp.example.yaml"), p.mcpConfigFile],
  ];
  for (const [src, dst] of pairs) {
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      seeded.push(dst);
    }
  }
  return { seeded };
}

export function loadConfig(p: AppPaths): LoadedConfig {
  const appRaw = readYaml(p.appConfigFile);
  const mcpRaw = readYaml(p.mcpConfigFile);
  const app = AppConfigSchema.parse(appRaw);
  const mcp = McpConfigSchema.parse(mcpRaw);
  // enabled_sources in app.yaml overrides provider `enabled` flags when present.
  for (const prov of mcp.providers) {
    const flag = app.enabled_sources[prov.id];
    if (typeof flag === "boolean") prov.enabled = flag;
  }
  return {
    app,
    mcp,
    sources: {
      appFile: p.appConfigFile,
      mcpFile: p.mcpConfigFile,
      appExists: fs.existsSync(p.appConfigFile),
      mcpExists: fs.existsSync(p.mcpConfigFile),
    },
  };
}

export function saveAppConfig(p: AppPaths, app: AppConfig): void {
  fs.mkdirSync(path.dirname(p.appConfigFile), { recursive: true });
  fs.writeFileSync(p.appConfigFile, YAML.stringify(app), "utf8");
}
