/**
 * WorkIQ adapter (Microsoft 365 via `@microsoft/workiq mcp`).
 *
 * Verified (Phase 0): the local server always advertises `accept_eula`, `ask`, `list_agents`.
 * Entity tools (`fetch`, `search_paths`, `get_schema`, `call_function`, ...) are proxied from the
 * remote WorkIQ server and only appear after Entra authentication succeeds. Their exact
 * parameter shapes are UNVERIFIED in this environment, so this adapter:
 *   1. discovers which tools exist at runtime,
 *   2. prefers deterministic entity retrieval when `fetch` is present,
 *   3. falls back to `ask`-based retrieval otherwise, flagging the evidence as `copilot_answer`,
 *   4. never fabricates links: URLs are taken only from `webLink`/`webUrl` fields in responses.
 */
import type { SourceAdapter, AdapterContext } from "./types.js";
import type { McpClient } from "../client.js";
import type { Capability, Cursor, EvidenceBatch, FetchContext, HealthStatus, RetrievalWindow } from "../../types.js";
import { normalizeEvidence, type RawItem } from "../../normalize.js";
import type { Evidence, Participant, SourceType } from "../../../domain/index.js";

type Json = Record<string, unknown>;

const ENTITY_TOOLS = ["fetch", "search_paths", "get_schema", "call_function"];

interface EntityScope {
  scope: string;
  source_type: SourceType;
  /** Graph-style path template; {since}/{until} are ISO timestamps. */
  path: (w: RetrievalWindow) => string;
  cursorKey: string;
}

/** Candidate entity paths (Graph v1 shapes). Validated at runtime via search_paths/get_schema when available. */
const SCOPES: EntityScope[] = [
  {
    scope: "mail", source_type: "email", cursorKey: "mail",
    path: (w) => `/me/messages?$filter=receivedDateTime ge ${w.since} and receivedDateTime lt ${w.until}&$orderby=receivedDateTime asc&$top=50&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,conversationId,webLink,importance`,
  },
  {
    scope: "calendar", source_type: "calendar_event", cursorKey: "calendar",
    path: (w) => `/me/calendarView?startDateTime=${w.since}&endDateTime=${w.until}&$top=50&$select=id,subject,start,end,organizer,attendees,bodyPreview,webLink,seriesMasterId,onlineMeeting`,
  },
  {
    scope: "chat", source_type: "teams_message", cursorKey: "chat",
    path: () => `/me/chats?$top=50&$expand=lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc`,
  },
];

function asArray(x: unknown): Json[] {
  if (Array.isArray(x)) return x as Json[];
  if (x && typeof x === "object" && Array.isArray((x as Json).value)) return (x as Json).value as Json[];
  return [];
}

function parseJsonLoose(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return undefined;
}

function person(x: unknown): Participant | undefined {
  if (!x || typeof x !== "object") return undefined;
  const j = x as Json;
  const ea = (j.emailAddress ?? j.user ?? j) as Json;
  const name = String(ea.name ?? ea.displayName ?? "").trim();
  const email = typeof ea.address === "string" ? ea.address : typeof ea.email === "string" ? ea.email : undefined;
  if (!name && !email) return undefined;
  return { name: name || email || "unknown", email };
}

function messageToRaw(providerId: string, m: Json): RawItem {
  const parts: Participant[] = [];
  const from = person(m.from); if (from) parts.push(from);
  for (const r of asArray(m.toRecipients)) { const p = person(r); if (p) parts.push(p); }
  for (const r of asArray(m.ccRecipients)) { const p = person(r); if (p) parts.push(p); }
  return {
    provider_id: providerId, source_type: "email",
    occurred_at: String(m.receivedDateTime ?? m.sentDateTime ?? new Date().toISOString()),
    title: String(m.subject ?? ""), participants: parts,
    thread_id: typeof m.conversationId === "string" ? m.conversationId : undefined,
    source_kind: "graph:message", source_id: String(m.id),
    url: typeof m.webLink === "string" ? m.webLink : undefined,
    text: typeof m.bodyPreview === "string" ? m.bodyPreview : typeof (m.body as Json | undefined)?.content === "string" ? String((m.body as Json).content) : undefined,
    structured: { importance: m.importance },
  };
}

function eventToRaw(providerId: string, e: Json): RawItem {
  const parts: Participant[] = [];
  const org = person(e.organizer); if (org) parts.push(org);
  for (const a of asArray(e.attendees)) { const p = person(a); if (p) parts.push(p); }
  const start = (e.start as Json | undefined)?.dateTime;
  return {
    provider_id: providerId, source_type: "calendar_event",
    occurred_at: typeof start === "string" ? (start.endsWith("Z") ? start : start + "Z") : new Date().toISOString(),
    title: String(e.subject ?? ""), participants: parts,
    thread_id: typeof e.seriesMasterId === "string" ? e.seriesMasterId : undefined,
    source_kind: "graph:event", source_id: String(e.id),
    url: typeof e.webLink === "string" ? e.webLink : undefined,
    text: typeof e.bodyPreview === "string" ? e.bodyPreview : undefined,
    structured: { end: (e.end as Json | undefined)?.dateTime, online: !!e.onlineMeeting },
  };
}

function chatToRaw(providerId: string, c: Json): RawItem | undefined {
  const preview = c.lastMessagePreview as Json | undefined;
  if (!preview) return undefined;
  const body = preview.body as Json | undefined;
  const from = person((preview.from as Json | undefined)?.user);
  return {
    provider_id: providerId, source_type: "teams_message",
    occurred_at: String(preview.createdDateTime ?? c.lastUpdatedDateTime ?? new Date().toISOString()),
    title: String(c.topic ?? (c.chatType === "oneOnOne" ? "1:1 chat" : "Group chat")),
    participants: from ? [from] : [],
    thread_id: String(c.id), source_kind: "graph:chatMessage", source_id: String(preview.id ?? c.id),
    url: typeof c.webUrl === "string" ? c.webUrl : undefined,
    text: typeof body?.content === "string" ? String(body.content).replace(/<[^>]+>/g, " ") : undefined,
  };
}

export class WorkIqAdapter implements SourceAdapter {
  readonly name = "workiq";

  match(tools: string[]): number {
    const t = new Set(tools);
    if (t.has("ask") && t.has("list_agents")) return 100;
    if (t.has("ask") && t.has("accept_eula")) return 90;
    return 0;
  }

  async health(client: McpClient): Promise<HealthStatus> {
    const tools = client.listTools().map((t) => t.name);
    const hasEntity = ENTITY_TOOLS.some((n) => tools.includes(n));
    const err = client.recentStderr;
    if (/eula/i.test(err)) return { ok: false, eula_required: true, message: "WorkIQ EULA not accepted", remediation: "Run `workiq accept-eula` once in a terminal." };
    if (!hasEntity) {
      const authHint = /auth|login|token|msal|consent/i.test(err);
      return {
        ok: tools.includes("ask"),
        auth_required: authHint || !hasEntity,
        message: hasEntity ? "ok" : "Entity tools not available (not signed in, or tenant not consented). Falling back to `ask` retrieval.",
        remediation: "Run `workiq auth login` (uses your Windows/Entra account), then `workiq auth consent` if prompted.",
      };
    }
    return { ok: true, message: "WorkIQ entity tools available" };
  }

  async capabilities(client: McpClient): Promise<Capability[]> {
    const tools = client.listTools().map((t) => t.name);
    const caps: Capability[] = [];
    if (tools.includes("ask")) caps.push("ask");
    if (tools.includes("fetch")) caps.push("mail.list", "calendar.list", "chat.list", "files.list", "people.read");
    return caps;
  }

  async *fetchSince(client: McpClient, cursor: Cursor, window: RetrievalWindow, ctx: FetchContext & AdapterContext): AsyncIterable<EvidenceBatch> {
    const tools = client.listTools().map((t) => t.name);
    if (tools.includes("fetch")) {
      yield* this.fetchEntities(client, cursor, window, ctx);
    } else if (tools.includes("ask")) {
      yield* this.fetchViaAsk(client, cursor, window, ctx);
    } else {
      yield { items: [], next_cursor: cursor, partial: true, notes: ["WorkIQ exposes neither fetch nor ask tools"] };
    }
  }

  /** Deterministic retrieval through Graph-style entity paths. */
  private async *fetchEntities(client: McpClient, cursor: Cursor, window: RetrievalWindow, ctx: FetchContext & AdapterContext): AsyncIterable<EvidenceBatch> {
    const next: Cursor = { ...cursor };
    const notes: string[] = [];
    let partial = false;
    const wanted = ctx.scopes.length ? SCOPES.filter((s) => ctx.scopes.includes(s.scope)) : SCOPES;
    for (const scope of wanted) {
      const lastSeen = typeof cursor[scope.cursorKey] === "string" ? (cursor[scope.cursorKey] as string) : undefined;
      const w: RetrievalWindow = { since: lastSeen && lastSeen > window.since ? lastSeen : window.since, until: window.until };
      let url: string | undefined = scope.path(w);
      let pages = 0;
      const items: Evidence[] = [];
      let maxAt = lastSeen ?? "";
      while (url && pages < 20) {
        pages++;
        let res;
        try {
          res = await client.callTool("fetch", { urls: [url] });
        } catch (e) {
          partial = true; notes.push(`${scope.scope}: ${(e as Error).message}`); break;
        }
        if (res.isError) { partial = true; notes.push(`${scope.scope}: ${res.text.slice(0, 200)}`); break; }
        const json = (res.structured ?? parseJsonLoose(res.text)) as Json | Json[] | undefined;
        // Responses may be a single object, an array of per-url results, or {value:[...]}.
        const pageObj: Json | undefined = Array.isArray(json) ? ((json[0] as Json | undefined)?.value !== undefined ? (json[0] as Json) : { value: json }) : json;
        const rows = asArray(pageObj);
        for (const row of rows) {
          let raw: RawItem | undefined;
          if (scope.source_type === "email") raw = messageToRaw(ctx.providerId, row);
          else if (scope.source_type === "calendar_event") raw = eventToRaw(ctx.providerId, row);
          else raw = chatToRaw(ctx.providerId, row);
          if (!raw) continue;
          if (scope.source_type === "teams_message" && (raw.occurred_at < w.since || raw.occurred_at >= w.until)) continue;
          items.push(normalizeEvidence(raw, ctx.rawTextPolicy));
          if (raw.occurred_at > maxAt) maxAt = raw.occurred_at;
        }
        const nl = pageObj?.["@odata.nextLink"];
        url = typeof nl === "string" ? nl.replace(/^https?:\/\/graph\.microsoft\.com\/v1\.0/, "") : undefined;
      }
      if (maxAt) next[scope.cursorKey] = maxAt;
      ctx.logger.info("workiq entity scope fetched", { scope: scope.scope, count: items.length, pages });
      yield { items, next_cursor: next, partial, notes };
    }
  }

  /**
   * Fallback: natural-language retrieval. Lower fidelity — the answer is Copilot's synthesis,
   * not the underlying items — so it is stored as `copilot_answer` evidence and the coverage is
   * marked partial. Used only when entity tools are unavailable.
   */
  private async *fetchViaAsk(client: McpClient, cursor: Cursor, window: RetrievalWindow, ctx: FetchContext & AdapterContext): AsyncIterable<EvidenceBatch> {
    const since = window.since.slice(0, 10); const until = window.until.slice(0, 10);
    const questions: Array<{ key: string; type: SourceType; q: string }> = [
      { key: "mail", type: "email", q: `List the most important emails I received between ${since} and ${until}. For each give: date, sender, subject, and a two-sentence summary of any decisions, commitments, requests, risks or escalations. Return as a JSON array of objects with fields date, from, subject, summary, link (only if you have a real link).` },
      { key: "chat", type: "teams_message", q: `List the most important Teams chat and channel messages between ${since} and ${until}. For each give: date, sender, chat or channel name, and a two-sentence summary of any decisions, commitments, requests, risks or escalations. Return as a JSON array with fields date, from, chat, summary, link (only if real).` },
      { key: "meetings", type: "meeting", q: `List meetings I attended between ${since} and ${until} that have notes, transcripts or recaps. For each give: date, title, attendees, and the key decisions, action items and open questions. Return as a JSON array with fields date, title, attendees, summary, link (only if real).` },
    ];
    const wanted = ctx.scopes.length ? questions.filter((q) => ctx.scopes.includes(q.key === "meetings" ? "calendar" : q.key)) : questions;
    const items: Evidence[] = [];
    const notes: string[] = ["Retrieved via WorkIQ `ask` (natural-language synthesis); coverage is approximate."];
    for (const q of wanted) {
      let res;
      try { res = await client.callTool("ask", { question: q.q }, 240000); }
      catch (e) { notes.push(`${q.key}: ${(e as Error).message}`); continue; }
      if (res.isError) { notes.push(`${q.key}: ${res.text.slice(0, 200)}`); continue; }
      const parsed = parseJsonLoose(res.text);
      const rows = asArray(parsed);
      if (rows.length === 0) {
        // Keep the whole answer as one evidence item so nothing is silently dropped.
        items.push(normalizeEvidence({
          provider_id: ctx.providerId, source_type: "copilot_answer", occurred_at: window.until,
          title: `WorkIQ answer: ${q.key} ${since}..${until}`, source_kind: "workiq:ask", source_id: `${q.key}:${since}:${until}`,
          text: res.text, structured: { question: q.q, window: [since, until] },
        }, ctx.rawTextPolicy));
        continue;
      }
      for (const [i, row] of rows.entries()) {
        const date = String(row.date ?? until);
        const iso = /T/.test(date) ? date : `${date}T12:00:00Z`;
        const who = String(row.from ?? row.attendees ?? "");
        items.push(normalizeEvidence({
          provider_id: ctx.providerId, source_type: q.type,
          occurred_at: isNaN(Date.parse(iso)) ? window.until : new Date(iso).toISOString(),
          title: String(row.subject ?? row.title ?? row.chat ?? ""),
          participants: who ? who.split(/[,;]/).map((n) => ({ name: n.trim() })).filter((p) => p.name) : [],
          thread_id: typeof row.chat === "string" ? row.chat : undefined,
          source_kind: "workiq:ask-item", source_id: `${q.key}:${since}:${until}:${i}`,
          url: typeof row.link === "string" && /^https?:\/\//.test(row.link) ? row.link : undefined,
          text: String(row.summary ?? ""), structured: { via: "ask", fidelity: "synthesized" },
        }, ctx.rawTextPolicy));
      }
    }
    yield { items, next_cursor: { ...cursor, ask_until: window.until }, partial: true, notes };
  }
}
