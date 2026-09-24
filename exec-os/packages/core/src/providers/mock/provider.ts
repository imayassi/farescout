import type { Evidence } from "../../domain/index.js";
import type { Capability, Cursor, EvidenceBatch, FetchContext, HealthStatus, ProviderInfo, RetrievalWindow, SourceProvider } from "../types.js";
import { normalizeEvidence, type RawTextPolicy } from "../normalize.js";
import { ITEMS, type MockItem } from "./dataset.js";

export function mockOccurredAt(item: MockItem, now: Date): string {
  return new Date(now.getTime() - item.daysAgo * 86_400_000).toISOString();
}

/**
 * Synthetic provider emulating what an enterprise MCP would return.
 * Supports incremental sync: the cursor records the last `occurred_at` served so a
 * second sync only yields newer items (used to demonstrate "what changed since yesterday").
 */
export class MockProvider implements SourceProvider {
  readonly id: string;
  private failNext = false;
  constructor(id = "mock", private readonly now: () => Date = () => new Date(), private readonly rawTextPolicy: RawTextPolicy = "trimmed", private readonly items: MockItem[] = ITEMS) {
    this.id = id;
  }

  describe(): ProviderInfo {
    return { id: this.id, kind: "mock", label: "Synthetic organization (demo)", description: "Fictional Northwind Cloud Support dataset", adapter: "mock" };
  }
  async checkHealth(): Promise<HealthStatus> { return { ok: true, message: `${this.items.length} synthetic items` }; }
  async discoverCapabilities(): Promise<Capability[]> { return ["mail.list", "chat.list", "chat.threads", "calendar.list", "meeting.notes", "files.list", "metrics.read"]; }

  /** Test hook: make the next fetch fail to exercise graceful degradation. */
  simulateFailureOnce(): void { this.failNext = true; }

  async *fetchSince(cursor: Cursor, window: RetrievalWindow, ctx: FetchContext): AsyncIterable<EvidenceBatch> {
    if (this.failNext) { this.failNext = false; throw new Error("simulated provider outage"); }
    const now = this.now();
    const lastServed = typeof cursor.last_occurred_at === "string" ? cursor.last_occurred_at : undefined;
    const items: Evidence[] = [];
    let maxAt = lastServed ?? "";
    for (const it of this.items) {
      const at = mockOccurredAt(it, now);
      if (at < window.since || at >= window.until) continue;
      if (lastServed && at <= lastServed) continue;
      items.push(normalizeEvidence({
        provider_id: this.id, source_type: it.type, occurred_at: at, title: it.title,
        participants: it.participants, thread_id: it.thread, source_kind: "mock", source_id: it.id,
        text: it.text, structured: it.structured, url: it.url,
      }, this.rawTextPolicy));
      if (at > maxAt) maxAt = at;
    }
    ctx.logger.debug("mock fetch", { count: items.length });
    yield { items, next_cursor: { last_occurred_at: maxAt || lastServed } };
  }
}
