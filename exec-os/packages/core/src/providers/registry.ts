import path from "node:path";
import type { AppConfig, McpConfig } from "../config/schema.js";
import type { AppPaths } from "../config/paths.js";
import { isInsideGitRepo } from "../config/paths.js";
import type { Logger } from "../logging/logger.js";
import type { SourceProvider } from "./types.js";
import { MockProvider } from "./mock/provider.js";
import { LocalDocsProvider } from "./local_docs/provider.js";
import { McpProvider } from "./mcp/provider.js";

/** Build provider instances from configuration. Disabled providers are returned separately for the Sources page. */
export function buildProviders(app: AppConfig, mcp: McpConfig, paths: AppPaths, logger: Logger): { enabled: SourceProvider[]; disabled: string[] } {
  const enabled: SourceProvider[] = [];
  const disabled: string[] = [];
  for (const p of mcp.providers) {
    if (!p.enabled) { disabled.push(p.id); continue; }
    switch (p.type) {
      case "mock":
        enabled.push(new MockProvider(p.id, () => new Date(), app.retention.raw_text));
        break;
      case "local_docs": {
        const dir = p.directory ? path.resolve(p.directory) : paths.docs;
        enabled.push(new LocalDocsProvider(p.id, dir, app.retention.raw_text, isInsideGitRepo(dir)));
        break;
      }
      case "mcp":
        enabled.push(new McpProvider({
          id: p.id, transport: p.transport, command: p.command, args: p.args, env: p.env, url: p.url, headers: p.headers,
          adapter: p.adapter, scopes: p.scopes, timeout_ms: p.timeout_ms, rawTextPolicy: app.retention.raw_text, logger,
        }));
        break;
    }
  }
  return { enabled, disabled };
}
