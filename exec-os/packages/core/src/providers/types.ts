import type { Evidence } from "../domain/index.js";
import type { Logger } from "../logging/logger.js";

/** Capability identifiers discovered on a source (provider-agnostic vocabulary). */
export type Capability =
  | "mail.list" | "chat.list" | "chat.threads" | "calendar.list" | "meeting.notes"
  | "files.list" | "metrics.read" | "ask" | "people.read" | "tracker.list";

export interface ProviderInfo {
  id: string;
  kind: "mcp" | "mock" | "local_docs";
  label: string;
  description?: string;
  adapter?: string;
  tools?: string[];             // raw tool names for MCP providers (metadata only)
}

export interface HealthStatus {
  ok: boolean;
  auth_required?: boolean;
  eula_required?: boolean;
  message?: string;
  remediation?: string;
}

export interface RetrievalWindow {
  since: string;   // ISO — inclusive lower bound
  until: string;   // ISO — exclusive upper bound
}

export type Cursor = Record<string, unknown>;

export interface EvidenceBatch {
  items: Evidence[];
  next_cursor: Cursor;
  /** true when the provider could not cover the whole window (rate limit, error, unsupported scope). */
  partial?: boolean;
  notes?: string[];
}

export interface FetchContext {
  logger: Logger;
  signal?: AbortSignal;
  /** provider-specific tuning, e.g. page sizes */
  limits?: { max_items?: number };
}

export interface SourceProvider {
  readonly id: string;
  describe(): ProviderInfo;
  connect?(): Promise<void>;
  close?(): Promise<void>;
  checkHealth(): Promise<HealthStatus>;
  discoverCapabilities(): Promise<Capability[]>;
  fetchSince(cursor: Cursor, window: RetrievalWindow, ctx: FetchContext): AsyncIterable<EvidenceBatch>;
  /** Only return a URL if the source system supplied one. Never fabricate links. */
  openSourceUrl?(evidence: Evidence): string | undefined;
}
