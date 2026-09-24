import type { Store } from "../../store/store.js";
import { Summary, type Horizon, type ActionItem, type Decision, type Escalation, type Risk, type BusinessMetric, type Evidence } from "../../domain/index.js";
import type { IntelligenceBackend } from "../backends/types.js";
import { summarize, type SkillContext, type SummarizeInput } from "../skills/index.js";
import type { Logger } from "../../logging/logger.js";
import { newId, nowIso, daysAgo } from "../../util.js";
import type { HealthStatus } from "../../providers/types.js";

export function horizonWindow(h: Horizon, now: Date): { start: string; end: string } {
  const days = h === "daily" ? 1 : h === "weekly" ? 7 : h === "monthly" ? 30 : 90;
  return { start: daysAgo(days, now).toISOString(), end: now.toISOString() };
}

/** Structured "attention" numbers are computed locally; the narrative is delegated to the backend. */
export async function buildSummary(store: Store, backend: IntelligenceBackend, ctx: SkillContext, h: Horizon, coverage: Array<{ id: string; ok: boolean; message?: string }>, partialReasons: string[], logger: Logger, now: Date = new Date()): Promise<Summary> {
  const { start, end } = horizonWindow(h, now);
  const nowStr = now.toISOString();
  const actions = store.listObjects<ActionItem>({ type: "action" });
  const decisions = store.listObjects<Decision>({ type: "decision" });
  const escalations = store.listObjects<Escalation>({ type: "escalation" });
  const risks = store.listObjects<Risk>({ type: "risk" });
  const metrics = store.listObjects<BusinessMetric>({ type: "metric" });
  const overdue = actions.filter((a) => !["completed", "dismissed"].includes(a.status) && a.due_at && a.due_at < nowStr);
  const needed = decisions.filter((d) => d.status === "needed" || d.status === "pending_approval");
  const candidates = escalations.filter((e) => e.status === "potential");
  const newRisks = risks.filter((r) => r.first_seen >= start && r.status !== "closed");
  const journal = store.listJournal({ since: start, limit: 1000 }).filter((j) => ["detected", "status_changed", "accepted", "dismissed", "merged"].includes(j.event));
  const changed = journal.slice(0, 40).map((j) => {
    const o = store.getObject(j.object_id);
    const r = (o?.object ?? {}) as Record<string, unknown>;
    const title = String(r.title ?? r.topic ?? r.issue ?? r.recommendation ?? r.request ?? r.statement ?? r.name ?? j.summary);
    return { object_type: j.object_type, id: j.object_id, title, event: j.event, at: j.at, evidence_ids: j.evidence.map((e) => e.evidence_id) };
  });
  const upcoming = store.listEvidence({ since: nowStr, until: daysAgo(-14, now).toISOString() }).filter((e: Evidence) => e.source_type === "calendar_event").slice(0, 10)
    .map((e) => ({ title: e.title, at: e.occurred_at, evidence_id: e.evidence_id }));
  const themes = store.listThemes().map((t) => ({ id: t.id, name: t.name, current_state: t.current_state, what_changed: t.what_changed }));
  const input: SummarizeInput = {
    horizon: h, period_start: start, period_end: end, changed,
    attention: {
      decisions_needed: needed.map((d) => ({ id: d.id, topic: d.topic })),
      escalation_candidates: candidates.map((e) => ({ id: e.id, issue: e.issue })),
      overdue_actions: overdue.map((a) => ({ id: a.id, title: a.title, owner: a.owner, due_at: a.due_at })),
    },
    themes, metrics: metrics.map((m) => ({ name: m.name, value: m.value, unit: m.unit, delta: m.delta })), upcoming,
  };
  let narrative = ""; let highlights: Array<{ text: string; epistemic: "fact" | "extracted_action" | "recorded_decision" | "inference" | "recommendation" | "potential_escalation"; object_type?: string; object_id?: string; evidence: Array<{ evidence_id: string; role: "supports" | "mentions" | "contradicts"; excerpt?: string }> }> = [];
  const reasons = [...partialReasons];
  try {
    const out = await backend.runSkill(summarize, input, ctx, { logger });
    narrative = out.narrative; highlights = out.highlights;
  } catch (e) {
    logger.warn("summary narrative unavailable", { horizon: h, error: e });
    reasons.push(`Narrative unavailable: ${(e as Error).message}`);
  }
  const sections = [
    { heading: "Needs your attention", items: [
      ...needed.map((d) => ({ text: `Decision ${d.status === "pending_approval" ? "pending approval" : "needed"}: ${d.topic}`, epistemic: d.epistemic, object_type: "decision", object_id: d.id, evidence: d.evidence })),
      ...candidates.map((e) => ({ text: `Potential escalation: ${e.issue}`, epistemic: "potential_escalation" as const, object_type: "escalation", object_id: e.id, evidence: e.evidence })),
      ...overdue.map((a) => ({ text: `Overdue: ${a.title}${a.owner ? ` — ${a.owner}` : ""}`, epistemic: a.epistemic, object_type: "action", object_id: a.id, evidence: a.evidence })),
    ] },
    { heading: "What's changed", items: changed.slice(0, 12).map((c) => ({ text: `${c.event.replace("_", " ")}: ${c.title}`, epistemic: "fact" as const, object_type: c.object_type, object_id: c.id, evidence: c.evidence_ids.map((id) => ({ evidence_id: id, role: "supports" as const })) })) },
    { heading: "Key themes", items: themes.filter((t) => t.what_changed || t.current_state).slice(0, 8).map((t) => ({ text: `${t.name}: ${t.what_changed || t.current_state}`, epistemic: "inference" as const, object_type: "theme", object_id: t.id, evidence: [] })) },
    { heading: "Highlights", items: highlights, narrative },
    { heading: "Upcoming", items: upcoming.map((u) => ({ text: `${u.title} — ${new Date(u.at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`, epistemic: "fact" as const, evidence: [{ evidence_id: u.evidence_id, role: "supports" as const }] })) },
  ];
  const s = Summary.parse({
    id: newId("sum"), horizon: h, period_start: start, period_end: end, generated_at: nowIso(),
    attention: { decisions_needed: needed.length, escalation_candidates: candidates.length, overdue_actions: overdue.length, new_risks: newRisks.length },
    sections, coverage: { providers: coverage, incomplete: reasons.length > 0 || coverage.some((c) => !c.ok), reasons },
  });
  store.saveSummary(s);
  return s;
}

export function coverageFromHealth(entries: Array<{ id: string; health: HealthStatus }>): Array<{ id: string; ok: boolean; message?: string }> {
  return entries.map((e) => ({ id: e.id, ok: e.health.ok, message: e.health.message }));
}
