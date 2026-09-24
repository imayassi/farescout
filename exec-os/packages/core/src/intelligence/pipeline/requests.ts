/**
 * Data / analytics requests raised by the user at bucket (theme) or item level.
 * Always persisted locally and journaled; optionally forwarded to a configured intake endpoint.
 */
import type { Store, AnyObject } from "../../store/store.js";
import { DataRequest, type DataRequestKind, type EvidenceRef } from "../../domain/index.js";
import { newId, nowIso } from "../../util.js";
import { z } from "zod";

export const DataRequestInput = z.object({
  scope: z.enum(["bucket", "item"]),
  theme_id: z.string().optional(),
  object_id: z.string().optional(),
  request: z.string().min(3).max(2000),
  kind: DataRequestKindSchema(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  needed_by: z.string().optional(),
  notes: z.string().max(4000).optional(),
  requested_by: z.string().optional(),
  owner: z.string().optional(),
});
function DataRequestKindSchema() { return z.enum(["analysis", "metric", "dashboard", "data_pull", "experiment", "forecast", "engineering", "powerbi"]).default("analysis"); }
export type DataRequestInput = z.infer<typeof DataRequestInput>;

export interface OutboundPayload {
  id: string; created_at: string; scope: string; request: string; kind: string; priority: string; needed_by?: string; notes?: string;
  requested_by?: string; owner?: string;
  bucket?: { id: string; name: string; current_state: string };
  item?: { type: string; id: string; title: string; status?: string; owner?: string; epistemic: string };
  evidence: Array<{ evidence_id: string; label: string; title: string; source_type: string; occurred_at: string; url?: string }>;
  source: "execos";
}

export function createDataRequest(store: Store, input: DataRequestInput, user: { display_name: string }): { request: DataRequest; payload: OutboundPayload } {
  const now = nowIso();
  let theme = input.theme_id ? store.getTheme(input.theme_id) : undefined;
  let item: { type: string; object: AnyObject } | undefined;
  let evidence: EvidenceRef[] = [];
  if (input.scope === "item") {
    if (!input.object_id) throw new Error("object_id is required for item scope");
    item = store.getObject(store.resolveAlias(input.object_id));
    if (!item) throw new Error("item not found");
    const o = item.object as unknown as Record<string, unknown>;
    evidence = ((o.evidence as EvidenceRef[] | undefined) ?? []).slice(0, 20);
    if (!theme && typeof o.theme_id === "string") theme = store.getTheme(o.theme_id);
  } else {
    if (!theme) throw new Error("theme_id is required for bucket scope");
    evidence = theme.evidence.slice(0, 20);
  }
  const itemTitle = item ? String((item.object as unknown as Record<string, unknown>).title ?? (item.object as unknown as Record<string, unknown>).topic ?? (item.object as unknown as Record<string, unknown>).issue ?? (item.object as unknown as Record<string, unknown>).recommendation ?? (item.object as unknown as Record<string, unknown>).statement ?? (item.object as unknown as Record<string, unknown>).name ?? "") : undefined;
  const req = DataRequest.parse({
    id: newId("dreq"), created_at: now, updated_at: now, first_seen: now, last_observed: now,
    theme_id: theme?.id, epistemic: "fact", confidence: 1, evidence, hidden: false,
    reasoning: `Raised by ${input.requested_by ?? (user.display_name || "the user")} at ${input.scope} level${itemTitle ? ` for "${itemTitle}"` : theme ? ` for bucket "${theme.name}"` : ""}.`,
    request: input.request, requested_by: input.requested_by ?? (user.display_name || undefined), owner: input.owner,
    kind: input.kind, status: "submitted", scope: input.scope, object_type: item?.type, object_id: item ? (item.object as { id: string }).id : undefined,
    priority: input.priority, needed_by: input.needed_by, notes: input.notes, origin: "user", delivery: { status: "pending" },
  });
  store.upsertObject("data_request", req);
  store.journal({ object_type: "data_request", object_id: req.id, event: "detected", actor: "user", summary: `${input.scope}-level data request: ${req.request}`, evidence });
  const io = item?.object as unknown as Record<string, unknown> | undefined;
  const payload: OutboundPayload = {
    id: req.id, created_at: now, scope: input.scope, request: req.request, kind: req.kind, priority: req.priority, needed_by: req.needed_by, notes: req.notes,
    requested_by: req.requested_by, owner: input.owner,
    bucket: theme ? { id: theme.id, name: theme.name, current_state: theme.current_state } : undefined,
    item: item && io ? { type: item.type, id: String(io.id), title: itemTitle ?? "", status: io.status as string | undefined, owner: io.owner as string | undefined, epistemic: String(io.epistemic) } : undefined,
    evidence: evidence.map((r) => { const e = store.getEvidence(r.evidence_id); return e ? { evidence_id: e.evidence_id, label: `${e.source_type} — ${e.occurred_at.slice(0, 10)}`, title: e.title, source_type: e.source_type, occurred_at: e.occurred_at, url: e.source_ref.url } : { evidence_id: r.evidence_id, label: "purged", title: "", source_type: "", occurred_at: "" }; }),
    source: "execos",
  };
  return { request: req, payload };
}

export function recordDelivery(store: Store, id: string, delivery: DataRequest["delivery"]): DataRequest | undefined {
  const found = store.getObject<DataRequest>(id);
  if (!found) return undefined;
  const r = found.object; r.delivery = delivery; r.updated_at = nowIso();
  store.upsertObject("data_request", r);
  store.journal({ object_type: "data_request", object_id: id, event: "updated", actor: "system", summary: delivery.status === "delivered" ? `Delivered to ${delivery.endpoint}` : delivery.status === "failed" ? `Delivery failed: ${delivery.error}` : "Stored locally (no intake endpoint configured)" });
  return r;
}
export type { DataRequestKind };
