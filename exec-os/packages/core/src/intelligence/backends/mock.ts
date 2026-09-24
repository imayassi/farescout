/**
 * Deterministic backend for demos and tests. For the synthetic dataset it returns the fixture
 * observations (what a good model would extract); for anything else it applies light heuristics.
 * It never calls a model and never leaves the process.
 */
import type { IntelligenceBackend, BackendInfo, RunOptions } from "./types.js";
import type { Skill, SkillContext } from "../skills/index.js";
import { FIXTURES, FIXTURE_THEMES } from "../../providers/mock/fixtures.js";
import type { BatchAnalysis, Observation } from "../../domain/index.js";
import type { AnalyzeBatchInput, RecommendationsInput, SummarizeInput, AnswerInput, BucketSkillInput, BucketSkillOutput } from "../skills/index.js";
import { derivePlaybook, type BucketHistory } from "../pipeline/playbooks.js";

function resolveDue(marker: string | undefined, today: Date): string | undefined {
  if (!marker) return undefined;
  const m = marker.match(/^__DUE_(PAST|FUTURE)_(\d+)__$/);
  if (!m) return marker;
  const days = Number(m[2]) * (m[1] === "PAST" ? -1 : 1);
  return new Date(today.getTime() + days * 86_400_000).toISOString();
}

const ACTION_RE = /\b(will|please|can you|need to|to do|action:|by (monday|tuesday|wednesday|thursday|friday|end of)|owner)\b/i;
const DECISION_RE = /\b(decided|decision:|we have decided|agreed to|approved)\b/i;
const RISK_RE = /\b(risk|at risk|exposure|breach|slipp?ed|attrition)\b/i;
const ESCALATION_RE = /\b(escalat|urgent|blocked outside|executive call)\b/i;
const DATA_RE = /\b(dashboard|analysis|data pull|forecast model|metric|power bi|report on)\b/i;

function heuristics(input: AnalyzeBatchInput): BatchAnalysis {
  const observations: Observation[] = [];
  for (const e of input.evidence) {
    const text = `${e.title}\n${e.text ?? ""}`;
    const firstLine = (e.text ?? e.title).split(/\n/).find((l) => l.trim().length > 10) ?? e.title;
    const base = { evidence_ids: [e.evidence_id], excerpt: firstLine.slice(0, 160), stakeholders: e.participants.slice(0, 4), theme_hints: [] as string[] };
    if (DECISION_RE.test(text)) observations.push({ kind: "decision", epistemic: "recorded_decision", title: e.title || firstLine.slice(0, 80), description: firstLine.slice(0, 240), status_hint: "recorded", confidence: 0.55, alternatives: [], ...base });
    else if (ESCALATION_RE.test(text)) observations.push({ kind: "escalation", epistemic: "potential_escalation", title: e.title || firstLine.slice(0, 80), description: firstLine.slice(0, 240), urgency: "medium", confidence: 0.5, alternatives: [], ...base });
    else if (ACTION_RE.test(text)) observations.push({ kind: "action", epistemic: "extracted_action", title: e.title || firstLine.slice(0, 80), description: firstLine.slice(0, 240), status_hint: "detected", confidence: 0.5, alternatives: [], ...base });
    else if (RISK_RE.test(text)) observations.push({ kind: "risk", epistemic: "inference", title: e.title || firstLine.slice(0, 80), description: firstLine.slice(0, 240), confidence: 0.45, alternatives: [], ...base });
    else if (e.source_type === "document") observations.push({ kind: "signal", epistemic: "fact", title: `Context document: ${e.title}`, description: firstLine.slice(0, 240), confidence: 0.6, alternatives: [], ...base, theme_hints: ["Strategic initiatives"] });
    if (DATA_RE.test(text) && /\b(request|can we|would like|need)\b/i.test(text)) {
      observations.push({ kind: "data_request", epistemic: "extracted_action", title: `Data request: ${e.title || firstLine.slice(0, 60)}`, description: firstLine.slice(0, 240), request_kind: "analysis", confidence: 0.45, alternatives: [], ...base });
    }
  }
  // Documents seed themes: markdown headings and numbered priority lines become theme hints.
  const themes: Array<{ name: string; description: string; evidence_ids: string[] }> = [];
  for (const e of input.evidence) {
    if (e.source_type !== "document" || !e.text) continue;
    for (const line of e.text.split(/\n/)) {
      const m = line.match(/^\s*(?:#{1,3}\s+|\d+[.)]\s+)(.{4,80})$/);
      if (!m) continue;
      const name = m[1]!.replace(/[:.]+$/, "").split(/[:—-]/)[0]!.trim().slice(0, 40);
      if (name.length < 4 || /^(priorities|terminology|notes?|summary)$/i.test(name)) continue;
      const t = themes.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (t) t.evidence_ids.push(e.evidence_id); else themes.push({ name, description: `From ${e.title}`, evidence_ids: [e.evidence_id] });
    }
  }
  return { observations, themes: themes.slice(0, 12), evidence_gaps: [], conflicts: [] };
}

export class MockBackend implements IntelligenceBackend {
  readonly name = "mock" as const;
  constructor(private readonly now: () => Date = () => new Date()) {}
  async probe(): Promise<BackendInfo> { return { name: "mock", available: true, detail: "deterministic fixtures (no model calls)" }; }

  async runSkill<TIn, TOut>(skill: Skill<TIn, TOut>, input: TIn, ctx: SkillContext, opts: RunOptions): Promise<TOut> {
    switch (skill.name) {
      case "analyze_batch": return this.analyze(input as AnalyzeBatchInput, opts) as TOut;
      case "generate_recommendations": return this.recommend(input as RecommendationsInput) as TOut;
      case "summarize": return this.summarize(input as SummarizeInput) as TOut;
      case "answer_with_evidence": return this.answer(input as AnswerInput) as TOut;
      case "generate_bucket_skill": return this.playbook(input as BucketSkillInput, ctx) as TOut;
      default: throw new Error(`mock backend: unknown skill ${skill.name}`);
    }
  }

  private playbook(input: BucketSkillInput, ctx: SkillContext): BucketSkillOutput {
    // Rebuild a BucketHistory-shaped view from the skill input and reuse the deterministic derivation.
    const h = {
      theme: { id: input.theme.id, name: input.theme.name, description: input.theme.description, pinned: input.theme.pinned, evidence: [], slug: "", discovered: true, what_changed: "", current_state: "", confidence: 0.5, created_at: "", updated_at: "", hidden: false, locked_fields: [], origin: "discovered" as const },
      evidence: input.evidence.map((e) => ({ evidence_id: e.evidence_id, provider_id: "", source_type: e.source_type as never, occurred_at: e.occurred_at, retrieved_at: e.occurred_at, title: e.title, participants: e.participants.map((name) => ({ name })), source_ref: { kind: "", id: "" }, text: e.text, sensitivity: {}, content_hash: "" })),
      actions: input.actions.map((a) => ({ ...a, id: "", evidence: [], status: a.status as never })) as never[], decisions: input.decisions.map((d) => ({ ...d, id: "", evidence: [], status: d.status as never })) as never[],
      escalations: input.escalations.map((e) => ({ ...e, id: "", evidence: [], target_decision_maker: e.target })) as never[], risks: input.risks.map((r) => ({ ...r, id: "", evidence: [] })) as never[],
      signals: input.signals.map((s) => ({ statement: s.statement, evidence: Array.from({ length: s.mentions }, () => ({ evidence_id: "", role: "supports" })) })) as never[],
      metrics: input.metrics.map((m) => ({ ...m, id: "", as_of: input.evidence[0]?.occurred_at ?? "", evidence: [] })) as never[],
      people: input.people, forums: input.forums, sourceTypes: Array.from(new Set(input.evidence.map((e) => e.source_type))), days: input.days,
    } as unknown as BucketHistory;
    const sk = derivePlaybook(h, ctx);
    const { id: _i, theme_id: _t, version: _v, status: _s, generated_at: _g, fixed_at: _f, generated_by: _b, history_depth: _h, evidence: _e, user_adjusted: _u, user_notes: _n, epistemic: _p, ...out } = sk;
    return out;
  }

  private analyze(input: AnalyzeBatchInput, opts: RunOptions): BatchAnalysis {
    const today = this.now();
    const bySource = new Map<string, string>();     // mock source id -> evidence_id
    for (const e of opts.batchEvidence ?? []) bySource.set(e.source_ref_id, e.evidence_id);
    const covered = new Set<string>();
    const observations: Observation[] = [];
    for (const f of FIXTURES) {
      const present = f.sources.filter((s) => bySource.has(s.id));
      if (present.length === 0) continue;
      for (const s of present) covered.add(bySource.get(s.id)!);
      // Status hint = the most recent source's hint in this batch (sources are in chronological order in fixtures).
      const last = present[present.length - 1]!;
      observations.push({
        kind: f.kind, epistemic: f.epistemic, title: f.title, description: f.description,
        theme_hints: f.theme_hints, owner: f.owner, decision_maker: f.decision_maker, stakeholders: f.stakeholders ?? [],
        due_at: resolveDue(f.due_at, today), status_hint: last.status_hint ?? f.status_hint, urgency: f.urgency,
        is_commitment: f.is_commitment, rationale: f.rationale, alternatives: f.alternatives ?? [],
        evidence_ids: present.map((s) => bySource.get(s.id)!), excerpt: last.excerpt,
        excerpts: Object.fromEntries(present.map((s) => [bySource.get(s.id)!, s.excerpt])),
        confidence: last.confidence ?? f.confidence, metric: f.metric, request_kind: f.request_kind, contradicts: f.contradicts,
      });
    }
    const themes = FIXTURE_THEMES.map((t) => ({ name: t.name, description: t.description, evidence_ids: t.sourceIds.map((id) => bySource.get(id)).filter((x): x is string => !!x) }))
      .filter((t) => t.evidence_ids.length > 0);
    // Heuristics for evidence that is not part of the synthetic dataset (e.g. local docs).
    const rest = { ...input, evidence: input.evidence.filter((e) => !covered.has(e.evidence_id) && !bySource.has(e.evidence_id)) };
    const extra = rest.evidence.length ? heuristics(rest) : { observations: [], themes: [], evidence_gaps: [], conflicts: [] };
    const conflicts = observations.filter((o) => o.contradicts).map((o) => ({ statement: `${o.title} conflicts with: ${o.contradicts}`, evidence_ids: o.evidence_ids }));
    return { observations: [...observations, ...extra.observations], themes, evidence_gaps: [], conflicts };
  }

  private recommend(input: RecommendationsInput) {
    // The rule engine in the pipeline produces the substantive recommendations; the mock model adds none
    // unless a decision is pending approval with a due date, mirroring what a model would likely add.
    const recs = input.decisions.filter((d) => d.status === "pending_approval" && d.needed_by).map((d) => ({
      recommendation: `Decide on "${d.topic}" before ${d.needed_by!.slice(0, 10)}`,
      reasoning: "A pending approval with a stated deadline is waiting on you; delay pushes downstream dates.",
      evidence_ids: d.evidence_ids, confidence: 0.7, theme_names: [], suggested_owner: undefined,
      suggested_next_step: "Review the request and approve, modify or decline it.", related: [{ type: "decision", id: d.id }],
    }));
    return { recommendations: recs };
  }

  private summarize(input: SummarizeInput) {
    const a = input.attention;
    const parts: string[] = [];
    parts.push(`${a.decisions_needed.length} decision(s) need you, ${a.escalation_candidates.length} potential escalation(s), ${a.overdue_actions.length} overdue action(s).`);
    if (input.changed.length) parts.push(`${input.changed.length} tracked item(s) changed in this period.`);
    const rising = input.metrics.filter((m) => (m.delta ?? 0) > 0.05).map((m) => `${m.name} up ${(m.delta! * 100).toFixed(0)}%`);
    const falling = input.metrics.filter((m) => (m.delta ?? 0) < -0.02).map((m) => `${m.name} down ${(Math.abs(m.delta!) * 100).toFixed(1)}%`);
    if (rising.length || falling.length) parts.push([...rising, ...falling].join("; ") + ".");
    const themes = input.themes.filter((t) => t.what_changed).slice(0, 3).map((t) => `${t.name}: ${t.what_changed}`);
    if (themes.length) parts.push(themes.join(" "));
    const highlights = [
      ...a.overdue_actions.slice(0, 3).map((x) => ({ text: `Overdue: ${x.title}${x.owner ? ` (${x.owner})` : ""}`, epistemic: "extracted_action" as const, object_type: "action", object_id: x.id, evidence: [] })),
      ...a.decisions_needed.slice(0, 3).map((x) => ({ text: `Decision needed: ${x.topic}`, epistemic: "inference" as const, object_type: "decision", object_id: x.id, evidence: [] })),
      ...a.escalation_candidates.slice(0, 2).map((x) => ({ text: `Potential escalation: ${x.issue}`, epistemic: "potential_escalation" as const, object_type: "escalation", object_id: x.id, evidence: [] })),
    ];
    return { narrative: parts.join(" "), highlights };
  }

  private answer(input: AnswerInput) {
    const q = input.question.toLowerCase();
    const words = q.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["what", "which", "have", "been", "this", "that", "about", "were", "made", "show", "everything", "related", "last", "week", "month"].includes(w));
    const score = (t: string) => words.reduce((n, w) => n + (t.toLowerCase().includes(w) ? 1 : 0), 0);
    const objs = input.objects.map((o) => ({ o, s: score(o.title) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 6);
    const ev = input.evidence.map((e) => ({ e, s: score(`${e.title} ${e.text ?? ""}`) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 6);
    if (objs.length === 0 && ev.length === 0) {
      return { answer: "I could not find local evidence that addresses this question.", citations: [], related_objects: [], confidence: 0.2, gaps: ["No matching evidence in the local store."] };
    }
    const lines = objs.map(({ o }) => `- [${o.type}${o.status ? `, ${o.status}` : ""}] ${o.title}${o.owner ? ` — ${o.owner}` : ""} (${o.epistemic.replace("_", " ")})`);
    const answer = `Based on local evidence (deterministic demo mode, no model):\n${lines.join("\n")}${ev.length ? `\n\nSupporting evidence: ${ev.map(({ e }) => e.title).join("; ")}` : ""}`;
    return {
      answer, citations: ev.map(({ e }) => ({ evidence_id: e.evidence_id, why: `matches: ${e.title}` })),
      related_objects: objs.map(({ o }) => ({ type: o.type, id: o.id })), confidence: 0.5,
      gaps: ["Demo mode answers by keyword match; connect Copilot for reasoning."],
    };
  }
}
