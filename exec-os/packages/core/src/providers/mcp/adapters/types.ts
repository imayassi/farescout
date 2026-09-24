import type { McpClient } from "../client.js";
import type { Capability, Cursor, EvidenceBatch, FetchContext, HealthStatus, RetrievalWindow } from "../../types.js";
import type { RawTextPolicy } from "../../normalize.js";

export interface AdapterContext {
  providerId: string;
  scopes: string[];
  rawTextPolicy: RawTextPolicy;
}

/** Turns a specific MCP server's tools into normalized evidence. */
export interface SourceAdapter {
  readonly name: string;
  /** 0 = cannot handle this server; higher = better match. Used for auto-detection. */
  match(tools: string[]): number;
  health(client: McpClient): Promise<HealthStatus>;
  capabilities(client: McpClient): Promise<Capability[]>;
  fetchSince(client: McpClient, cursor: Cursor, window: RetrievalWindow, ctx: FetchContext & AdapterContext): AsyncIterable<EvidenceBatch>;
}
