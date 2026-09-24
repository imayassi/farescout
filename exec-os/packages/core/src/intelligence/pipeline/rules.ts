/**
 * Deterministic rule engine. Runs every sync, produces recommendations (epistemic: recommendation)
 * and escalation candidates (epistemic: potential_escalation) from structured state. Rules are
 * transparent: each recommendation records the rule id and its reasoning so the UI can show "why".
 */
import type { Store } from "../../store/store.js";
import { Recommendation, type ActionItem, type Decision, type Escalation, type Signal, type Risk, type EvidenceRef, type BusinessMetric } from "../../domain/index.js";
import { newId, nowIso, daysAgo, uniq } from "../../util.js";

interface Draft { rule: string; recommendation: string; reasoning: string; evidence: EvidenceRef[]; confidence: number; theme_ids: string[]; suggested_owner?: string; suggested_next_step: string; fingerprint: string }

function upsertRecommendation(store: Store, d: Draft): boolean {
  if (store.isSuppressed(d.fingerprint)) return false;
  const existing = store.listObjects<Recommendation>({ type: "recommendation", includeHidden: true, limit: 1000 }).find((r) => r.fingerprint === d.fingerprint);
  const now = nowIso();
  if (existing) {
    if (existing.status !== "proposed") return false;   // accepted/modified/dismissed: leave alone
    const seen = new Set(existing.evidence.map((e) => e.evidence_id));
    existing.evidence = [...existing.evidence, ...d.evidence.filter((e) => !seen.has(e.evidence_id))];
    existing.reasoning = d.reasoning; existing.updated_at = now; existing.last_observed = now; existing.confidence = d.confidence;
    store.upsertObject("recommendation", existing);
    return false;
  }
  const rec = Recommendation.parse({
    id: newId("rec"), created_at: now, updated_at: now, first_seen: now, last_observed: now, epistemic: "recommendation",
    confidence: d.confidence, evidence: d.evidence, reasoning: d.reasoning, recommendation: d.recommendation, theme_ids: d.theme_ids,
    suggested_owner: d.suggested_owner, suggested_next_step: d.suggested_next_step, status: "proposed", rule: d.rule, fingerprint: d.fingerprint,
  });
  store.upsertObject("recommendation", rec);
  store.journal({ object_type: "recommendation", object_id: rec.id, event: "detected", actor: "system", summary: rec.recommendation, evidence: rec.evidence });
  return true;
}

export interface RuleRunResult { recommendations_created: number; escalations_created: number }

export function runRules(store: Store, now: Date = new Date()): RuleRunResult {
  const res: RuleRunResult = { recommendations_created: 0, escalations_created: 0 };
  const nowIsoStr = now.toISOString();
  const actions = store.listObjects<ActionItem>({ type: "action" });
  const decisions = store.listObjects<Decision>({ type: "decision" });
  const escalations = store.listObjects<Escalation>({ type: "escalation" });
  const signals = store.listObjects<Signal>({ type: "signal" });
  const risks = store.listObjects<Risk>({ type: "risk" });
  const metrics = store.listObjects<BusinessMetric>({ type: "metric" });
  const themeOf = (o: { theme_id?: string }) => (o.theme_id ? [o.theme_id] : []);
  const providersOf = (refs: EvidenceRef[]): string[] => uniq(refs.map((r) => store.getEvidence(r.evidence_id)?.source_type as string | undefined).filter((x): x is string => !!x));

  // R1: overdue action with no update in 7 days → escalation candidate + recommendation
  for (const a of actions) {
    if (["completed", "dismissed", "escalated"].includes(a.status)) continue;
    const overdue = a.due_at && a.due_at < nowIsoStr;
    const stale = a.last_observed < daysAgo(7, now).toISOString();
    if (overdue && (stale || a.status === "blocked" || a.status === "escalation_candidate")) {
      const days = Math.floor((now.getTime() - Date.parse(a.due_at!)) / 86_400_000);
      if (a.status !== "escalation_candidate") {
        store.journal({ object_type: "action", object_id: a.id, event: "status_changed", actor: "system", summary: `${a.status} → escalation_candidate (overdue ${days}d, rule R1)`, before: { status: a.status }, after: { status: "escalation_candidate" }, evidence: a.evidence });
        a.status = "escalation_candidate"; a.updated_at = nowIsoStr; store.upsertObject("action", a);
      }
      const fp = `r1:${a.id}`;
      const already = escalations.find((e) => e.related_action_ids.includes(a.id));
      if (!already && !store.isSuppressed(fp)) {
        const esc: Escalation = {
          id: newId("esc"), created_at: nowIsoStr, updated_at: nowIsoStr, first_seen: nowIsoStr, last_observed: nowIsoStr, theme_id: a.theme_id,
          epistemic: "potential_escalation", confidence: 0.7, evidence: a.evidence, hidden: false,
          reasoning: `Commitment "${a.title}" is ${days} day(s) past due${a.owner ? ` (owner ${a.owner})` : " with no identifiable owner"} and has been chased ${a.mention_count} time(s) across ${providersOf(a.evidence).length} source type(s).`,
          issue: `Overdue commitment: ${a.title}`, why_needed: `Past due by ${days} day(s); downstream work depends on it.`, owner: a.owner, urgency: days > 14 ? "high" : "medium", status: "potential",
          related_action_ids: [a.id], recommended_resolution: `Ask ${a.owner ?? "the owner"} for a firm date or reassign; decide whether to escalate.`,
        };
        store.upsertObject("escalation", esc);
        store.journal({ object_type: "escalation", object_id: esc.id, event: "detected", actor: "system", summary: esc.issue, evidence: esc.evidence });
        res.escalations_created++;
      }
      if (upsertRecommendation(store, {
        rule: "R1", fingerprint: `r1rec:${a.id}`, recommendation: `Get a firm date or reassign "${a.title}"`,
        reasoning: `This commitment is ${days} day(s) overdue and has appeared in ${a.evidence.length} evidence item(s) across ${providersOf(a.evidence).join(", ")}. The last observed update was ${a.last_observed.slice(0, 10)}.`,
        evidence: a.evidence, confidence: 0.75, theme_ids: themeOf(a), suggested_owner: a.owner, suggested_next_step: "Raise it in the next 1:1 or ask for a written ETA today.",
      })) res.recommendations_created++;
    }
  }

  // R2: commitment mentioned ≥3 times with no owner
  for (const a of actions) {
    if (!a.owner && a.mention_count >= 3 && !["completed", "dismissed"].includes(a.status)) {
      if (upsertRecommendation(store, {
        rule: "R2", fingerprint: `r2:${a.id}`, recommendation: `Assign an owner to "${a.title}"`,
        reasoning: `This item has appeared in ${a.mention_count} conversations but no owner is identifiable in the evidence.`,
        evidence: a.evidence, confidence: 0.7, theme_ids: themeOf(a), suggested_next_step: "Name an owner and a due date in the next relevant meeting.",
      })) res.recommendations_created++;
    }
  }

  // R3: the same signal raised across ≥3 evidence items from ≥2 source types within 10 days (repeated, unresolved)
  for (const s of signals) {
    const recent = s.evidence.map((r) => store.getEvidence(r.evidence_id)).filter((e): e is NonNullable<typeof e> => !!e && e.occurred_at >= daysAgo(10, now).toISOString());
    const types = uniq(recent.map((e) => e.source_type));
    if (recent.length >= 3 && types.length >= 2) {
      const people = uniq(recent.flatMap((e) => e.participants.map((p) => p.name))).slice(0, 4);
      if (upsertRecommendation(store, {
        rule: "R3", fingerprint: `r3:${s.id}`, recommendation: `Resolve the recurring issue: ${s.statement}`,
        reasoning: `${people.length || "Several"} people${people.length ? ` (${people.join(", ")})` : ""} independently raised this in ${recent.length} items across ${types.join(" and ")} during the last 10 days, and no owner or resolution is recorded.`,
        evidence: s.evidence, confidence: 0.7, theme_ids: themeOf(s), suggested_next_step: "Name a single owner and agree a resolution path with the dependent team.",
      })) res.recommendations_created++;
    }
  }

  // R4: decision needed/pending blocking ≥2 open actions or explicitly referenced as blocking
  for (const d of decisions) {
    if (d.status !== "needed" && d.status !== "pending_approval") continue;
    const dependents = actions.filter((a) => !["completed", "dismissed"].includes(a.status) && (d.downstream_action_ids.includes(a.id) || (a.theme_id && a.theme_id === d.theme_id && a.status === "blocked")));
    const sharedEvidence = actions.filter((a) => a.evidence.some((r) => d.evidence.some((x) => x.evidence_id === r.evidence_id)) && a.id !== d.id);
    const blocking = uniq([...dependents, ...sharedEvidence].map((a) => a.id));
    if (blocking.length >= 2 || (d.needed_by && d.needed_by < daysAgo(-7, now).toISOString())) {
      if (upsertRecommendation(store, {
        rule: "R4", fingerprint: `r4:${d.id}`, recommendation: `Make the decision: ${d.topic}`,
        reasoning: blocking.length >= 2 ? `This decision appears to block ${blocking.length} tracked action(s).` : `This decision is due by ${d.needed_by!.slice(0, 10)}.`,
        evidence: d.evidence, confidence: 0.7, theme_ids: themeOf(d), suggested_owner: d.decision_maker, suggested_next_step: d.alternatives.length ? `Choose between: ${d.alternatives.join(" / ")}.` : "Schedule a decision slot with the stakeholders.",
      })) res.recommendations_created++;
    }
  }

  // R5: metric moved beyond threshold
  for (const m of metrics) {
    if (m.delta !== undefined && Math.abs(m.delta) >= 0.05) {
      if (upsertRecommendation(store, {
        rule: "R5", fingerprint: `r5:${m.name.toLowerCase()}`, recommendation: `Review ${m.name}: ${m.delta > 0 ? "up" : "down"} ${(Math.abs(m.delta) * 100).toFixed(0)}%`,
        reasoning: `${m.name} is ${m.value}${m.unit ?? ""} as of ${m.as_of.slice(0, 10)}, a ${(m.delta * 100).toFixed(0)}% move${m.delta_period ? ` over ${m.delta_period}` : ""}. Compared with earlier signals this changes the risk picture.`,
        evidence: m.evidence, confidence: 0.65, theme_ids: m.theme_id ? [m.theme_id] : [], suggested_next_step: "Ask for the driver analysis before the next operations review.",
      })) res.recommendations_created++;
    }
  }

  // R6: contradicting signals in the same theme
  const byTheme = new Map<string, Signal[]>();
  for (const s of signals) { if (!s.theme_id) continue; byTheme.set(s.theme_id, [...(byTheme.get(s.theme_id) ?? []), s]); }
  for (const [theme, list] of byTheme) {
    const nums = list.map((s) => ({ s, n: s.statement.match(/(\d+(?:\.\d+)?)\s?%/)?.[1] })).filter((x) => x.n);
    if (nums.length >= 2 && uniq(nums.map((x) => x.n)).length >= 2) {
      const ev = nums.flatMap((x) => x.s.evidence);
      if (upsertRecommendation(store, {
        rule: "R6", fingerprint: `r6:${theme}:${nums.map((x) => x.n).sort().join("-")}`, recommendation: `Reconcile conflicting figures (${nums.map((x) => x.n + "%").join(" vs ")})`,
        reasoning: `Different sources state different numbers for the same theme: ${nums.map((x) => `"${x.s.statement}"`).join("; ")}. Until reconciled, downstream planning may be using the wrong basis.`,
        evidence: ev, confidence: 0.7, theme_ids: [theme], suggested_next_step: "Ask the finance partner to confirm the authoritative figure in writing.",
      })) res.recommendations_created++;
    }
  }

  // R7: rising risk with no owner
  for (const r of risks) {
    if (r.status === "open" && !r.owner && r.confidence >= 0.6) {
      if (upsertRecommendation(store, {
        rule: "R7", fingerprint: `r7:${r.id}`, recommendation: `Assign an owner to risk "${r.title}"`,
        reasoning: `An open risk with no owner will not be mitigated. ${r.description}`, evidence: r.evidence, confidence: 0.6, theme_ids: themeOf(r), suggested_next_step: "Name a mitigation owner and a review date.",
      })) res.recommendations_created++;
    }
  }

  return res;
}
