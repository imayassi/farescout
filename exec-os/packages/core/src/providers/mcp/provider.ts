import type { Evidence } from "../../domain/index.js";
import type { Logger } from "../../logging/logger.js";
import type { Capability, Cursor, EvidenceBatch, FetchContext, HealthStatus, ProviderInfo, RetrievalWindow, SourceProvider } from "../types.js";
import type { RawTextPolicy } from "../normalize.js";
import { McpClient } from "./client.js";
import type { SourceAdapter } from "./adapters/types.js";
import { WorkIqAdapter } from "./adapters/workiq.js";
import { GenericAskAdapter } from "./adapters/generic.js";

export const ADAPTERS: Record<string, () => SourceAdapter> = {
  workiq: () => new WorkIqAdapter(),
  generic: () => new GenericAskAdapter(),
};

export interface McpProviderOptions {
  id: string;
  transport: "stdio" | "http";
  command?: string; args?: string[]; env?: Record<string, string>;
  url?: string; headers?: Record<string, string>;
  adapter: "auto" | "workiq" | "generic";
  scopes: string[];
  timeout_ms: number;
  rawTextPolicy: RawTextPolicy;
  logger: Logger;
}

/** Generic MCP-backed source: connects, discovers tools, selects an adapter, normalizes evidence. */
export class McpProvider implements SourceProvider {
  readonly id: string;
  private client: McpClient;
  private adapter: SourceAdapter | undefined;
  private lastError: string | undefined;

  constructor(private readonly opts: McpProviderOptions) {
    this.id = opts.id;
    this.client = new McpClient({ ...opts, logger: opts.logger.child(`mcp:${opts.id}`) });
  }

  describe(): ProviderInfo {
    return {
      id: this.id, kind: "mcp", label: this.id === "workiq" ? "WorkIQ (Microsoft 365)" : `MCP: ${this.id}`,
      description: this.opts.transport === "stdio" ? `${this.opts.command} ${(this.opts.args ?? []).join(" ")}` : this.opts.url,
      adapter: this.adapter?.name ?? this.opts.adapter, tools: this.client.listTools().map((t) => t.name),
    };
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.lastError = undefined;
    } catch (e) {
      this.lastError = (e as Error).message;
      throw e;
    }
    this.adapter = this.selectAdapter(this.client.listTools().map((t) => t.name));
  }

  private selectAdapter(tools: string[]): SourceAdapter {
    if (this.opts.adapter !== "auto") return ADAPTERS[this.opts.adapter]!();
    let best: SourceAdapter | undefined; let bestScore = 0;
    for (const make of Object.values(ADAPTERS)) {
      const a = make(); const s = a.match(tools);
      if (s > bestScore) { best = a; bestScore = s; }
    }
    return best ?? new GenericAskAdapter();
  }

  async checkHealth(): Promise<HealthStatus> {
    if (!this.client.connected) {
      try { await this.connect(); }
      catch (e) {
        const msg = (e as Error).message;
        const notFound = /ENOENT|not found|spawn/i.test(msg);
        return {
          ok: false, message: notFound ? `Cannot start MCP server: ${this.opts.command ?? this.opts.url}` : msg,
          remediation: notFound ? "Install the server (e.g. `npm install -g @microsoft/workiq`) and make sure it is on PATH." : undefined,
        };
      }
    }
    return this.adapter!.health(this.client);
  }

  async discoverCapabilities(): Promise<Capability[]> {
    if (!this.client.connected) await this.connect();
    return this.adapter!.capabilities(this.client);
  }

  async *fetchSince(cursor: Cursor, window: RetrievalWindow, ctx: FetchContext): AsyncIterable<EvidenceBatch> {
    if (!this.client.connected) await this.connect();
    yield* this.adapter!.fetchSince(this.client, cursor, window, { ...ctx, providerId: this.id, scopes: this.opts.scopes, rawTextPolicy: this.opts.rawTextPolicy });
  }

  openSourceUrl(evidence: Evidence): string | undefined { return evidence.source_ref.url; }

  async close(): Promise<void> { await this.client.close(); }
}
