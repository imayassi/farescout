/**
 * Entity resolution: map observations onto existing objects (update) or create new ones.
 * Status only advances forward unless evidence explicitly reopens; every change is journaled.
 */
import type { Store, AnyObject } from "../../store/store.js";
import {
  type Observation, type ActionItem, type Decision, type Escalation, type Risk, type DataRequest, type Signal,
  type BusinessMetric, type EvidenceRef, type ObjectType, ActionStatus,
} from "../../domain/index.js";
import { newId, nowIso, titleSimilarity, tokenOverlap, uniq } from "../../util.js";
import type { Logger } from "../../logging/logger.js";

const ACTION_ORDER: Record<string, number> = { detected: 0, confirmed: 1, assigned: 2, in_progress: 3, blocked: 3, escalation_candidate: 4, escalated: 5, completed: 6, dismissed: 6 };

export interface ReconcileResult { created: number; updated: number; objects: Array<{ type: ObjectType; id: string }> }

function kindToType(kind: Observation["kind"]): ObjectType {
  return kind === "metric" ? "metric" : kind === "signal" ? "signal" : kind;
}

function similar(a: string, b: string): boolean {
  return titleSimilarity(a, b) >= 0.55 || tokenOverlap(a, b) >= 0.75;
}

export function findMatch(store: Store, type: ObjectType, title: string, owner?: string, themeId?: string): AnyObject | undefined {
  const candidates = store.listObjects({ type, includeHidden: false, limit: 400 });
  let best: AnyObject | undefined; let bestScore = 0;
  for (const c of candidates) {
    const r = c as unknown as Record<string, unknown>;
    const ctitle = String(r.title ?? r.topic ?? r.issue ?? r.recommendation ?? r.request ?? r.statement ?? r.name ?? "");
    if (!ctitle) continue;
    let score = Math.max(titleSimilarity(title, ctitle), tokenOverlap(title, ctitle) * 0.9);
    if (owner && typeof r.owner === "string" && r.owner.toLowerCase() === owner.toLowerCase()) score += 0.1;
    if (themeId && r.theme_id === themeId) score += 0.05;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return bestScore >= 0.55 && best && similar(title, String((best as unknown as Record<string, unknown>).title ?? (best as unknown as Record<string, unknown>).topic ?? (best as unknown as Record<string, unknown>).issue ?? (best as unknown as Record<string, unknown>).request ?? (best as unknown as Record<string, unknown>).statement ?? (best as unknown as Record<string, unknown>).name ?? "")) ? best : undefined;
}

function mergeEvidence(existing: EvidenceRef[], incoming: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set(existing.map((e) => e.evidence_id));
  return [...existing, ...incoming.filter((e) => !seen.has(e.evidence_id))];
}

function actionStatusFromHint(hint: string | undefined, current?: string): ActionItem["status"] {
  const h = (hint ?? "").toLowerCase();
  let next: ActionItem["status"] = "detected";
  if (h.includes("complete") || h.includes("done") || h.includes("closed") || h.includes("shipped")) next = "completed";
  else if (h.includes("escalat")) next = "escalation_candidate";
  else if (h.includes("block")) next = "blocked";
  else if (h.includes("progress")) next = "in_progress";
  else if (h.includes("assign") || h.includes("committed")) next = "assigned";
  else if (h.includes("confirm")) next = "confirmed";
  if (!current) return next;
  // Forward-only unless explicit completion/reopen; blocked can replace in_progress at the same rank.
  const cur = ACTION_ORDER[current] ?? 0, nxt = ACTION_ORDER[next] ?? 0;
  if (current === "completed" && next !== "completed") return current; // reopening requires user feedback
  return nxt >= cur ? next : (current as ActionItem["status"]);
}

export function reconcileObservations(store: Store, observations: Observation[], themeResolver: (hints: string[]) => string | undefined, logger: Logger, observedAt: string = nowIso()): ReconcileResult {
  const result: ReconcileResult = { created: 0, updated: 0, objects: [] };
  for (const obs of observations) {
    const type = kindToType(obs.kind);
    const theme_id = themeResolver(obs.theme_hints);
    const refs: EvidenceRef[] = obs.evidence_ids.map((id) => ({ evidence_id: id, role: "supports" as const, excerpt: obs.excerpts?.[id] ?? obs.excerpt }));
    const now = nowIso();
    const lastEvidenceAt = latestEvidenceAt(store, obs.evidence_ids) ?? observedAt;

    if (store.isSuppressed(fingerprintOf(type, obs.title))) { logger.debug("observation suppressed by feedback", { type }); continue; }

    const match = type === "metric" ? undefined : findMatch(store, type, obs.title, obs.owner, theme_id);
    if (match) {
      const before = { ...(match as unknown as Record<string, unknown>) };
      const m = match as unknown as Record<string, unknown>;
      const locked = new Set((m.locked_fields as string[] | undefined) ?? []);
      m.evidence = mergeEvidence((m.evidence as EvidenceRef[]) ?? [], refs);
      m.updated_at = now;
      if (lastEvidenceAt > String(m.last_observed)) m.last_observed = lastEvidenceAt;
      if (!locked.has("theme_id")) m.theme_id = m.theme_id ?? theme_id;
      m.confidence = Math.max(Number(m.confidence ?? 0), obs.confidence);
      if (type === "action") {
        const a = m as unknown as ActionItem;
        a.mention_count = (a.evidence as EvidenceRef[]).length;
        if (!a.owner && obs.owner && !locked.has("owner")) a.owner = obs.owner;
        if (!a.due_at && obs.due_at && !locked.has("due_at")) a.due_at = obs.due_at;
        if (!locked.has("stakeholders")) a.stakeholders = uniq([...(a.stakeholders ?? []), ...obs.stakeholders]);
        const nextStatus = actionStatusFromHint(obs.status_hint, a.status);
        if (nextStatus !== a.status && !locked.has("status")) {
          store.journal({ object_type: "action", object_id: a.id, event: "status_changed", actor: "system", summary: `${a.status} → ${nextStatus}`, before: { status: a.status }, after: { status: nextStatus }, evidence: refs, at: now });
          a.status = nextStatus;
        }
      } else if (type === "decision") {
        const d = m as unknown as Decision;
        if (!d.decision_maker && obs.decision_maker && !locked.has("decision_maker")) d.decision_maker = obs.decision_maker;
        if (!d.rationale && obs.rationale && !locked.has("rationale")) d.rationale = obs.rationale;
        if (obs.alternatives.length) d.alternatives = uniq([...(d.alternatives ?? []), ...obs.alternatives]);
        const next: Decision["status"] = decisionStatus(obs.status_hint, obs.epistemic, d.status);
        if (next !== d.status && !locked.has("status") && !(d.status === "recorded" && next !== "recorded")) {
          store.journal({ object_type: "decision", object_id: d.id, event: "status_changed", actor: "system", summary: `${d.status} → ${next}`, before: { status: d.status }, after: { status: next }, evidence: refs, at: now });
          d.status = next;
          if (next === "recorded") { d.epistemic = "recorded_decision"; d.decision_date = d.decision_date ?? lastEvidenceAt; }
        }
      } else if (type === "escalation") {
        const e = m as unknown as Escalation;
        if (obs.urgency && !locked.has("urgency") && ["low", "medium", "high", "critical"].indexOf(obs.urgency) > ["low", "medium", "high", "critical"].indexOf(e.urgency)) e.urgency = obs.urgency;
        if (!e.target_decision_maker && obs.decision_maker && !locked.has("target_decision_maker")) e.target_decision_maker = obs.decision_maker;
      } else if (type === "risk") {
        const r = m as unknown as Risk;
        if (String(m.description ?? "") !== obs.description && obs.description && !locked.has("description")) r.description = obs.description;
      }
      store.upsertObject(type, m as unknown as AnyObject);
      store.journal({ object_type: type, object_id: String(m.id), event: "updated", actor: "system", summary: `New evidence (${refs.length}) linked`, before: { evidence_count: (before.evidence as EvidenceRef[] | undefined)?.length ?? 0 }, after: { evidence_count: (m.evidence as EvidenceRef[]).length }, evidence: refs, at: now });
      result.updated++;
      result.objects.push({ type, id: String(m.id) });
      continue;
    }

    // Create
    const base = { created_at: now, updated_at: now, first_seen: lastEvidenceAt, last_observed: lastEvidenceAt, theme_id, epistemic: obs.epistemic, confidence: obs.confidence, evidence: refs, reasoning: obs.description || undefined, hidden: false, locked_fields: [] as string[] };
    let created: AnyObject; let id: string;
    switch (type) {
      case "action": {
        id = newId("act");
        created = { ...base, id, title: obs.title, description: obs.description, owner: obs.owner, stakeholders: obs.stakeholders, due_at: obs.due_at, status: actionStatusFromHint(obs.status_hint), origin: obs.epistemic === "inference" ? "inferred" : "extracted", is_commitment: !!obs.is_commitment, mention_count: refs.length } satisfies ActionItem;
        break;
      }
      case "decision": {
        id = newId("dec");
        const status: Decision["status"] = decisionStatus(obs.status_hint, obs.epistemic);
        created = { ...base, id, topic: obs.title, decision: status === "recorded" ? obs.description : "", decision_date: status === "recorded" ? lastEvidenceAt : undefined, decision_maker: obs.decision_maker, rationale: obs.rationale, alternatives: obs.alternatives, status, downstream_action_ids: [], needed_by: obs.due_at, blocks: [] } satisfies Decision;
        break;
      }
      case "escalation": {
        id = newId("esc");
        created = { ...base, id, issue: obs.title, why_needed: obs.description, owner: obs.owner, target_decision_maker: obs.decision_maker, urgency: obs.urgency ?? "medium", status: "potential", related_action_ids: [] } satisfies Escalation;
        break;
      }
      case "risk": {
        id = newId("rsk");
        created = { ...base, id, title: obs.title, description: obs.description, likelihood: "medium", impact: obs.urgency === "high" || obs.urgency === "critical" ? "high" : "medium", trend: "stable", status: "open", owner: obs.owner } satisfies Risk;
        break;
      }
      case "data_request": {
        id = newId("dreq");
        const kinds = ["analysis", "metric", "dashboard", "data_pull", "experiment", "forecast", "engineering", "powerbi"] as const;
        const k = (kinds as readonly string[]).includes(obs.request_kind ?? "") ? (obs.request_kind as typeof kinds[number]) : "analysis";
        created = { ...base, id, request: obs.title, requested_by: obs.owner, kind: k, status: "identified", scope: "detected", priority: "medium", origin: "extracted", delivery: { status: "not_configured" } } satisfies DataRequest;
        break;
      }
      case "metric": {
        id = newId("met");
        created = { id, name: obs.metric?.name ?? obs.title, value: obs.metric?.value ?? 0, unit: obs.metric?.unit, as_of: lastEvidenceAt, delta: obs.metric?.delta, theme_id, evidence: refs } satisfies BusinessMetric;
        break;
      }
      default: {
        id = newId("sig");
        created = { ...base, id, statement: obs.title, occurred_at: lastEvidenceAt } satisfies Signal;
      }
    }
    store.upsertObject(type, created);
    store.journal({ object_type: type, object_id: id, event: "detected", actor: "system", summary: obs.title, after: { epistemic: obs.epistemic, confidence: obs.confidence }, evidence: refs, at: now });
    result.created++;
    result.objects.push({ type, id });
  }
  return result;
}

/** Explicit status hints win; the epistemic label only decides between recorded and needed. */
function decisionStatus(hint: string | undefined, epistemic: string, current?: Decision["status"]): Decision["status"] {
  const h = (hint ?? "").toLowerCase();
  if (h.includes("pending") || h.includes("approval")) return "pending_approval";
  if (h.includes("need") || h.includes("open") || h.includes("await")) return "needed";
  if (h.includes("record") || h.includes("made") || h.includes("decided") || epistemic === "recorded_decision") return "recorded";
  return current ?? "needed";
}

export function fingerprintOf(type: string, title: string): string {
  return `${type}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`;
}

function latestEvidenceAt(store: Store, ids: string[]): string | undefined {
  let max: string | undefined;
  for (const id of ids) { const e = store.getEvidence(id); if (e && (!max || e.occurred_at > max)) max = e.occurred_at; }
  return max;
}
