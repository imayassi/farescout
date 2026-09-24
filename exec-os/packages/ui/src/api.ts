/** Thin typed client for the loopback API. The token arrives on the launch URL and is kept in sessionStorage only. */
const TOKEN_KEY = "execos.token";

export function bootstrapToken(): string | null {
  const url = new URL(window.location.href);
  const t = url.searchParams.get("token");
  if (t) {
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ }
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    return t;
  }
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = bootstrapToken();
  const res = await fetch(path, { method, headers: { "content-type": "application/json", ...(token ? { "x-execos-token": token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error ?? j.message ?? msg; if (j.hint) msg += ` — ${j.hint}`; } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body?: unknown) => call<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => call<T>("PUT", path, body),
};

/* ---- shared types (mirrors the server payloads; kept loose on purpose) ---- */
export type Epistemic = "fact" | "extracted_action" | "recorded_decision" | "inference" | "recommendation" | "potential_escalation";
export interface EvidenceView {
  evidence_id: string; provider_id: string; source_type: string; occurred_at: string; title: string; label: string;
  participants: Array<{ name: string; email?: string }>; role?: string; excerpt?: string; text?: string; open_url?: string; missing?: boolean; thread_id?: string;
  structured?: Record<string, unknown>;
}
export interface Obj {
  id: string; epistemic: Epistemic; confidence: number; status?: string; owner?: string; theme?: string; theme_id?: string;
  title?: string; topic?: string; issue?: string; recommendation?: string; request?: string; statement?: string; name?: string;
  description?: string; reasoning?: string; why_needed?: string; rationale?: string; decision?: string; decision_maker?: string; decision_date?: string;
  alternatives?: string[]; due_at?: string; needed_by?: string; first_seen?: string; last_observed?: string; updated_at?: string; created_at?: string;
  stakeholders?: string[]; mention_count?: number; urgency?: string; recommended_resolution?: string; target_decision_maker?: string;
  suggested_owner?: string; suggested_next_step?: string; rule?: string; theme_ids?: string[]; kind?: string; requested_by?: string;
  trend?: string; likelihood?: string; impact?: string; is_commitment?: boolean; origin?: string; value?: number; unit?: string; delta?: number; as_of?: string;
  evidence: Array<{ evidence_id: string; role: string; excerpt?: string }>; evidence_details: EvidenceView[];
  delivery?: { status: string; endpoint?: string; error?: string; external_id?: string; response_status?: number }; scope?: string; notes?: string; priority?: string;
}
export interface Theme { id: string; name: string; slug: string; description: string; pinned: boolean; discovered: boolean; what_changed: string; current_state: string; confidence: number; updated_at: string; counts: Record<string, number>; evidence: unknown[] }
export interface JournalEntry { id: string; at: string; object_type: string; object_id: string; event: string; actor: string; summary: string; title?: string; status?: string; epistemic?: Epistemic; before?: Record<string, unknown>; after?: Record<string, unknown>; evidence: Array<{ evidence_id: string }> }
export interface Status {
  version: string; data_root: string; backend: { name: string; degraded: boolean; probes: Array<{ name: string; available: boolean; detail?: string; remediation?: string }> };
  sync: { state: string; phase?: string; started_at?: string; finished_at?: string; last_error?: string; progress: { providers_done: number; providers_total: number; batches_done: number; batches_total: number }; last_result?: { mode: string; duration_ms: number; created: number; updated: number; providers: Array<{ id: string; status: string; items_new: number; items_seen: number; message?: string }> } };
  last_sync_at?: string; bootstrap_completed_at?: string; stats: Record<string, number>; warnings: string[];
  sources: Array<{ id: string; kind: string; label: string; state: { last_status: string; last_sync_at?: string; last_error?: string; stats: { items_new: number; items_seen: number } } }>;
  user: { display_name: string; role: string };
}
export function titleOf(o: Obj): string { return o.title ?? o.topic ?? o.issue ?? o.recommendation ?? o.request ?? o.statement ?? o.name ?? "(untitled)"; }
export function fmtDate(iso?: string): string { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
export function fmtDateTime(iso?: string): string { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
export function daysUntil(iso?: string): number | undefined { if (!iso) return undefined; return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000); }
