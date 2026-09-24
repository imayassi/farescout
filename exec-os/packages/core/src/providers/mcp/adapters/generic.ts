/**
 * Generic adapter for MCP servers that expose an `ask`/`search`/`query`-style tool.
 * It retrieves through natural language only and marks coverage as partial.
 */
import type { SourceAdapter, AdapterContext } from "./types.js";
import type { McpClient } from "../client.js";
import type { Capability, Cursor, EvidenceBatch, FetchContext, HealthStatus, RetrievalWindow } from "../../types.js";
import { normalizeEvidence } from "../../normalize.js";

const ASK_LIKE = ["ask", "search", "query", "search_documents", "semantic_search"];

export class GenericAskAdapter implements SourceAdapter {
  readonly name = "generic";
  match(tools: string[]): number { return tools.some((t) => ASK_LIKE.includes(t)) ? 10 : 1; }
  async health(client: McpClient): Promise<HealthStatus> {
    const tools = client.listTools();
    return tools.length ? { ok: true, message: `${tools.length} tool(s)` } : { ok: false, message: "server exposes no tools" };
  }
  async capabilities(client: McpClient): Promise<Capability[]> {
    return client.listTools().some((t) => ASK_LIKE.includes(t.name)) ? ["ask"] : [];
  }
  async *fetchSince(client: McpClient, cursor: Cursor, window: RetrievalWindow, ctx: FetchContext & AdapterContext): AsyncIterable<EvidenceBatch> {
    const tool = client.listTools().find((t) => ASK_LIKE.includes(t.name));
    if (!tool) { yield { items: [], next_cursor: cursor, partial: true, notes: ["no ask-like tool"] }; return; }
    const since = window.since.slice(0, 10), until = window.until.slice(0, 10);
    const question = `Summarize the most important business signals, metrics, decisions, risks and requests between ${since} and ${until}. Cite sources where you can.`;
    const argKey = tool.inputSchema && typeof tool.inputSchema === "object" && "properties" in (tool.inputSchema as object)
      ? Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)[0] ?? "question" : "question";
    try {
      const res = await client.callTool(tool.name, { [argKey]: question });
      const items = res.isError ? [] : [normalizeEvidence({
        provider_id: ctx.providerId, source_type: "copilot_answer", occurred_at: window.until,
        title: `${ctx.providerId} answer ${since}..${until}`, source_kind: `${ctx.providerId}:${tool.name}`, source_id: `${since}:${until}`, text: res.text,
      }, ctx.rawTextPolicy)];
      yield { items, next_cursor: { ...cursor, until: window.until }, partial: true, notes: res.isError ? [res.text.slice(0, 200)] : [] };
    } catch (e) {
      yield { items: [], next_cursor: cursor, partial: true, notes: [(e as Error).message] };
    }
  }
}
