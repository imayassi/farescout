/**
 * Tab-level feedback loop: add, remove and adjust items, buckets and evidence by hand.
 * Every edit is journaled with actor=user and locks the edited fields against later syncs.
 */
import { z } from "zod";
import type { Store, AnyObject } from "../../store/store.js";
import { Theme, ActionItem, Decision, Escalation, Risk, Signal, DataRequest, type ObjectType, type EvidenceRef } from "../../domain/index.js";
import { newId, nowIso, slugify, uniq } from "../../util.js";
import { fingerprintOf } from "./reconcile.js";

export const EDITABLE: Record<string, string[]> = {
  action: ["title", "description", "owner", "stakeholders", "due_at", "status", "theme_id", "is_commitment"],
  decision: ["topic", "decision", "decision_maker", "decision_date", "rationale", "alternatives", "status", "needed_by", "theme_id"],
  escalation: ["issue", "why_needed", "owner", "target_decision_maker", "urgency", "status", "recommended_resolution", "theme_id"],
  risk: ["title", "description", "likelihood", "impact", "trend", "status", "owner", "theme_id"],
  recommendation: ["recommendation", "suggested_owner", "suggested_next_step", "theme_ids"],
  data_request: ["request", "owner", "kind", "status", "priority", "needed_by", "notes", "theme_id"],
  signal: ["statement", "theme_id"],
  metric: ["name", "value", "unit", "theme_id"],
};

export const ObjectPatch = z.record(z.string(), z.unknown());

export function editObject(store: Store, id: string, patch: Record<string, unknown>): { type: ObjectType; object: AnyObject; changed: string[] } {
  const found = store.getObject(store.resolveAlias(id));
  if (!found) throw new Error("item not found");
  const allowed = EDITABLE[found.type] ?? [];
  const o = found.object as unknown as Record<string, unknown>;
  const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {}; const changed: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue;
    if (JSON.stringify(o[k]) === JSON.stringify(v)) continue;
    before[k] = o[k]; after[k] = v; o[k] = v === "" ? undefined : v; changed.push(k);
  }
  if (!changed.length) return { type: found.type, object: found.object, changed };
  o.locked_fields = uniq([...((o.locked_fields as string[] | undefined) ?? []), ...changed]);
  o.updated_at = nowIso();
  if (changed.includes("theme_id")) {
    const t = o.theme_id ? store.getTheme(String(o.theme_id)) : undefined;
    store.journal({ object_type: found.type, object_id: found.object.id, event: "feedback", actor: "user", summary: `Moved to bucket ${t?.name ?? "(none)"}`, before: { theme_id: before.theme_id }, after: { theme_id: o.theme_id } });
    store.saveFeedback({ object_type: found.type, object_id: found.object.id, kind: "move_bucket", payload: { theme_id: o.theme_id } });
  }
  store.upsertObject(found.type, o as unknown as AnyObject);
  store.journal({ object_type: found.type, object_id: found.object.id, event: "feedback", actor: "user", summary: `Adjusted ${changed.join(", ")}`, before, after });
  store.saveFeedback({ object_type: found.type, object_id: found.object.id, kind: "edit", payload: { fields: changed } });
  return { type: found.type, object: o as unknown as AnyObject, changed };
}

export function removeObject(store: Store, id: string, reason?: string): { type: ObjectType; id: string } {
  const found = store.getObject(store.resolveAlias(id));
  if (!found) throw new Error("item not found");
  const o = found.object as unknown as Record<string, unknown>;
  const title = String(o.title ?? o.topic ?? o.issue ?? o.recommendation ?? o.request ?? o.statement ?? o.name ?? "");
  o.hidden = true; o.updated_at = nowIso();
  if (found.type === "action") o.status = "dismissed"; else if (found.type === "recommendation") o.status = "dismissed"; else if (found.type === "escalation") o.status = "dismissed";
  store.suppress(fingerprintOf(found.type, title), "remove", reason);
  if (typeof o.fingerprint === "string") store.suppress(o.fingerprint, "remove", reason);
  store.upsertObject(found.type, o as unknown as AnyObject);
  store.journal({ object_type: found.type, object_id: found.object.id, event: "dismissed", actor: "user", summary: `Removed from the tab${reason ? `: ${reason}` : ""}` });
  store.saveFeedback({ object_type: found.type, object_id: found.object.id, kind: "remove", payload: { reason: reason ?? "" } });
  return { type: found.type, id: found.object.id };
}

export const NewObjectInput = z.object({
  type: z.enum(["action", "decision", "escalation", "risk", "signal", "data_request"]),
  title: z.string().min(2).max(300),
  description: z.string().max(4000).default(""),
  theme_id: z.string().optional(),
  owner: z.string().optional(),
  due_at: z.string().optional(),
  status: z.string().optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
  evidence_ids: z.array(z.string()).default([]),
});
export type NewObjectInput = z.infer<typeof NewObjectInput>;

export function createManualObject(store: Store, input: NewObjectInput, userName: string): { type: ObjectType; object: AnyObject } {
  const now = nowIso();
  const evidence: EvidenceRef[] = input.evidence_ids.filter((id) => !!store.getEvidence(id)).map((id) => ({ evidence_id: id, role: "supports" as const }));
  const base = { created_at: now, updated_at: now, first_seen: now, last_observed: now, theme_id: input.theme_id, epistemic: "fact" as const, confidence: 1, evidence, reasoning: `Added by ${userName || "the user"}.`, hidden: false, locked_fields: ["title", "topic", "issue", "statement", "request", "description", "owner", "due_at", "status", "theme_id"] };
  let created: AnyObject; let type: ObjectType = input.type;
  switch (input.type) {
    case "action": created = ActionItem.parse({ ...base, id: newId("act"), title: input.title, description: input.description, owner: input.owner, due_at: input.due_at, status: input.status ?? (input.owner ? "assigned" : "confirmed"), origin: "user", is_commitment: true, mention_count: evidence.length || 1 }); break;
    case "decision": created = Decision.parse({ ...base, id: newId("dec"), topic: input.title, decision: input.status === "recorded" ? input.description : "", decision_maker: input.owner, status: input.status ?? "needed", needed_by: input.due_at, rationale: input.status === "recorded" ? input.description : undefined, epistemic: input.status === "recorded" ? "recorded_decision" : "fact" }); break;
    case "escalation": created = Escalation.parse({ ...base, id: newId("esc"), issue: input.title, why_needed: input.description, owner: input.owner, urgency: input.urgency ?? "medium", status: input.status ?? "active", epistemic: "fact" }); break;
    case "risk": created = Risk.parse({ ...base, id: newId("rsk"), title: input.title, description: input.description, owner: input.owner, status: input.status ?? "open" }); break;
    case "signal": created = Signal.parse({ ...base, id: newId("sig"), statement: input.title, occurred_at: now }); break;
    case "data_request": created = DataRequest.parse({ ...base, id: newId("dreq"), request: input.title, notes: input.description, owner: input.owner, requested_by: userName || undefined, kind: "analysis", status: input.status ?? "identified", scope: input.theme_id ? "bucket" : "detected", priority: "medium", needed_by: input.due_at, origin: "user", delivery: { status: "not_configured" } }); type = "data_request"; break;
  }
  store.upsertObject(type, created);
  store.journal({ object_type: type, object_id: created.id, event: "detected", actor: "user", summary: `Added by hand: ${input.title}`, evidence });
  store.saveFeedback({ object_type: type, object_id: created.id, kind: "add", payload: { theme_id: input.theme_id } });
  return { type, object: created };
}

export const ThemePatch = z.object({ name: z.string().min(2).max(80).optional(), description: z.string().max(1000).optional(), pinned: z.boolean().optional(), hidden: z.boolean().optional(), current_state: z.string().max(1000).optional(), what_changed: z.string().max(1000).optional() });

export function editTheme(store: Store, id: string, patch: z.infer<typeof ThemePatch>): Theme {
  const t = store.getTheme(id);
  if (!t) throw new Error("bucket not found");
  const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {}; const changed: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || JSON.stringify((t as unknown as Record<string, unknown>)[k]) === JSON.stringify(v)) continue;
    before[k] = (t as unknown as Record<string, unknown>)[k]; (t as unknown as Record<string, unknown>)[k] = v; after[k] = v; changed.push(k);
  }
  if (changed.includes("name")) { t.slug = slugify(t.name); }
  t.locked_fields = uniq([...t.locked_fields, ...changed.filter((c) => ["description", "current_state", "what_changed", "name"].includes(c))]);
  t.updated_at = nowIso();
  store.upsertTheme(t);
  if (changed.length) {
    store.journal({ object_type: "theme", object_id: t.id, event: changed.includes("hidden") && t.hidden ? "dismissed" : "feedback", actor: "user", summary: `Bucket adjusted: ${changed.join(", ")}`, before, after });
    store.saveFeedback({ object_type: "theme", object_id: t.id, kind: changed.includes("hidden") && t.hidden ? "remove" : "edit", payload: { fields: changed } });
    if (changed.includes("hidden") && t.hidden) store.suppress(`theme:${t.slug}`, "remove");
  }
  return t;
}

export function createTheme(store: Store, input: { name: string; description?: string; pinned?: boolean }): Theme {
  const slug = slugify(input.name);
  const existing = store.getThemeBySlug(slug);
  if (existing) { if (existing.hidden) { existing.hidden = false; store.upsertTheme(existing); } return existing; }
  const now = nowIso();
  const t = Theme.parse({ id: newId("thm"), name: input.name.trim(), slug, description: input.description ?? "", pinned: input.pinned ?? true, discovered: false, origin: "user", created_at: now, updated_at: now, locked_fields: ["name", "description"] });
  store.upsertTheme(t);
  store.journal({ object_type: "theme", object_id: t.id, event: "detected", actor: "user", summary: `Bucket added by hand: ${t.name}` });
  store.saveFeedback({ object_type: "theme", object_id: t.id, kind: "add", payload: {} });
  return t;
}

export function excludeEvidence(store: Store, id: string, reason?: string): { removed: boolean } {
  const e = store.getEvidence(id);
  if (!e) return { removed: false };
  store.excludeEvidence(id, reason);
  store.journal({ object_type: "evidence", object_id: id, event: "dismissed", actor: "user", summary: `Evidence excluded from analysis${reason ? `: ${reason}` : ""} (${e.source_type}, ${e.occurred_at.slice(0, 10)})` });
  store.saveFeedback({ object_type: "evidence", object_id: id, kind: "exclude_evidence", payload: { reason: reason ?? "", source_type: e.source_type } });
  return { removed: true };
}
