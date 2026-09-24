/**
 * Human feedback: corrections are persisted, journaled with actor=user, and turned into
 * suppression/alias rules so future syncs respect them.
 */
import type { Store, AnyObject } from "../../store/store.js";
import type { FeedbackKind, ActionItem, Decision, Escalation, Recommendation, Theme, ObjectType } from "../../domain/index.js";
import { newId, nowIso } from "../../util.js";
import { fingerprintOf } from "./reconcile.js";

export interface FeedbackRequest { object_type: string; object_id: string; kind: FeedbackKind; payload?: Record<string, unknown> }

export function applyFeedback(store: Store, req: FeedbackRequest): { ok: boolean; message: string; created_id?: string } {
  const payload = req.payload ?? {};
  const now = nowIso();
  const fb = store.saveFeedback({ object_type: req.object_type, object_id: req.object_id, kind: req.kind, payload });
  const journal = (summary: string, before?: Record<string, unknown>, after?: Record<string, unknown>) =>
    store.journal({ object_type: req.object_type, object_id: req.object_id, event: "feedback", actor: "user", summary: `${req.kind}: ${summary}`, before, after, evidence: [] });

  if (req.object_type === "theme") {
    const t = store.getTheme(req.object_id);
    if (!t) return { ok: false, message: "theme not found" };
    if (req.kind === "pin_theme" || req.kind === "unpin_theme") { t.pinned = req.kind === "pin_theme"; t.updated_at = now; store.upsertTheme(t); journal(t.name); return { ok: true, message: t.pinned ? "pinned" : "unpinned" }; }
    if (req.kind === "not_important") { t.hidden = true; t.updated_at = now; store.upsertTheme(t); journal(t.name); return { ok: true, message: "hidden" }; }
    return { ok: false, message: `unsupported feedback ${req.kind} for theme` };
  }

  const found = store.getObject(req.object_id);
  if (!found) return { ok: false, message: "object not found" };
  const { type, object } = found;
  const o = object as unknown as Record<string, unknown>;
  const title = String(o.title ?? o.topic ?? o.issue ?? o.recommendation ?? o.request ?? o.statement ?? "");
  const save = () => { o.updated_at = now; store.upsertObject(type, o as unknown as AnyObject); };

  switch (req.kind) {
    case "not_an_action":
    case "not_important": {
      const before = { status: o.status, hidden: o.hidden };
      o.hidden = true; if (type === "action") o.status = "dismissed";
      store.suppress(fingerprintOf(type, title), req.kind, String(payload.reason ?? ""));
      save(); journal(title, before, { hidden: true }); return { ok: true, message: "dismissed and suppressed" };
    }
    case "wrong_owner": {
      const before = { owner: o.owner }; o.owner = String(payload.owner ?? "") || undefined; if (type === "action" && o.status === "detected") o.status = "assigned";
      save(); journal(`${before.owner ?? "—"} → ${o.owner ?? "—"}`, before, { owner: o.owner }); return { ok: true, message: "owner updated" };
    }
    case "mark_completed": {
      const before = { status: o.status }; o.status = type === "escalation" ? "resolved" : type === "risk" ? "closed" : "completed";
      save(); journal(title, before, { status: o.status }); return { ok: true, message: "completed" };
    }
    case "set_status": {
      const before = { status: o.status }; o.status = String(payload.status ?? o.status);
      save(); journal(`${before.status} → ${o.status}`, before, { status: o.status }); return { ok: true, message: "status set" };
    }
    case "resolve_escalation": {
      const before = { status: o.status }; o.status = "resolved"; save(); journal(title, before, { status: "resolved" }); return { ok: true, message: "resolved" };
    }
    case "escalate": {
      if (type === "action") {
        const a = o as unknown as ActionItem;
        const esc: Escalation = { id: newId("esc"), created_at: now, updated_at: now, first_seen: now, last_observed: now, theme_id: a.theme_id, epistemic: "potential_escalation", confidence: 1, evidence: a.evidence, hidden: false, reasoning: "Escalated by the user.", issue: a.title, why_needed: String(payload.reason ?? "Escalated by the user."), owner: a.owner, target_decision_maker: payload.target as string | undefined, urgency: (payload.urgency as Escalation["urgency"]) ?? "high", status: "active", related_action_ids: [a.id] };
        store.upsertObject("escalation", esc); a.status = "escalated"; a.escalation_id = esc.id; save();
        store.journal({ object_type: "escalation", object_id: esc.id, event: "detected", actor: "user", summary: esc.issue, evidence: esc.evidence });
        journal(title, undefined, { escalation_id: esc.id }); return { ok: true, message: "escalated", created_id: esc.id };
      }
      if (type === "escalation") { const before = { status: o.status }; o.status = "active"; save(); journal(title, before, { status: "active" }); return { ok: true, message: "escalation activated" }; }
      return { ok: false, message: "cannot escalate this object type" };
    }
    case "is_decision": {
      const a = o as unknown as ActionItem;
      const d: Decision = { id: newId("dec"), created_at: now, updated_at: now, first_seen: a.first_seen ?? now, last_observed: a.last_observed ?? now, theme_id: a.theme_id, epistemic: "recorded_decision", confidence: 1, evidence: a.evidence, hidden: false, reasoning: "Reclassified by the user.", topic: a.title, decision: a.description ?? "", decision_maker: a.owner, alternatives: [], status: (payload.status as Decision["status"]) ?? "recorded", downstream_action_ids: [], blocks: [] };
      store.upsertObject("decision", d); o.hidden = true; save(); store.addAlias(a.id, d.id);
      store.journal({ object_type: "decision", object_id: d.id, event: "detected", actor: "user", summary: d.topic, evidence: d.evidence });
      journal(title, undefined, { decision_id: d.id }); return { ok: true, message: "converted to decision", created_id: d.id };
    }
    case "merge": {
      const targetId = String(payload.into ?? "");
      const target = store.getObject(targetId);
      if (!target || target.type !== type) return { ok: false, message: "merge target must be same type" };
      const t = target.object as unknown as Record<string, unknown>;
      const seen = new Set(((t.evidence as Array<{ evidence_id: string }>) ?? []).map((e) => e.evidence_id));
      t.evidence = [...((t.evidence as unknown[]) ?? []), ...((o.evidence as Array<{ evidence_id: string }>) ?? []).filter((e) => !seen.has(e.evidence_id))];
      if (type === "action") t.mention_count = Number(t.mention_count ?? 1) + Number(o.mention_count ?? 1);
      t.updated_at = now; store.upsertObject(type, t as unknown as AnyObject);
      o.hidden = true; save(); store.addAlias(req.object_id, targetId);
      store.journal({ object_type: type, object_id: targetId, event: "merged", actor: "user", summary: `Merged "${title}" into this item`, evidence: [] });
      journal(`into ${targetId}`); return { ok: true, message: "merged" };
    }
    case "hide_recommendation":
    case "dismiss_recommendation": {
      const r = o as unknown as Recommendation; const before = { status: r.status };
      r.status = "dismissed"; r.dismissed_reason = String(payload.reason ?? ""); r.hidden = req.kind === "hide_recommendation";
      store.suppress(r.fingerprint, req.kind, r.dismissed_reason); save(); journal(title, before, { status: "dismissed" }); return { ok: true, message: "dismissed" };
    }
    case "accept_recommendation":
    case "modify_recommendation": {
      const r = o as unknown as Recommendation; const before = { status: r.status };
      const text = req.kind === "modify_recommendation" ? String(payload.text ?? r.recommendation) : r.recommendation;
      const a: ActionItem = { id: newId("act"), created_at: now, updated_at: now, first_seen: now, last_observed: now, theme_id: r.theme_ids[0], epistemic: "extracted_action", confidence: 1, evidence: r.evidence, hidden: false, reasoning: `Accepted from recommendation ${r.id} by the user.`, title: text, description: r.suggested_next_step, owner: String(payload.owner ?? r.suggested_owner ?? "") || undefined, stakeholders: [], due_at: payload.due_at as string | undefined, status: "confirmed", origin: "accepted_recommendation", is_commitment: true, mention_count: 1 };
      store.upsertObject("action", a);
      r.status = req.kind === "accept_recommendation" ? "accepted" : "modified"; r.resulting_action_id = a.id; if (req.kind === "modify_recommendation") r.recommendation = text; save();
      store.journal({ object_type: "action", object_id: a.id, event: "accepted", actor: "user", summary: `Created from recommendation: ${text}`, evidence: a.evidence });
      journal(title, before, { status: r.status, action_id: a.id }); return { ok: true, message: "accepted → action created", created_id: a.id };
    }
    default:
      return { ok: false, message: `unsupported feedback kind ${String(req.kind)} (${fb.id})` };
  }
}

export type { Theme, ObjectType };
