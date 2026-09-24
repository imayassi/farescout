/**
 * Skills are versioned prompt + schema pairs. Prompts contain NO user content; private context
 * (terminology, roles, pinned themes, document excerpts) is injected at run time by the pipeline
 * from the private data directory and never written back into the repository.
 */
import { z } from "zod";
import { BatchAnalysis, EvidenceRef, EpistemicStatus, Recommendation } from "../../domain/index.js";

export interface Skill<TIn, TOut> {
  name: string;
  version: string;
  description: string;
  input: z.ZodType<TIn, z.ZodTypeDef, unknown>;
  output: z.ZodType<TOut, z.ZodTypeDef, unknown>;
  /** Builds the user prompt. `context` is private, run-time-only material. */
  prompt(input: TIn, context: SkillContext): string;
  system(context: SkillContext): string;
}

export interface SkillContext {
  today: string;                       // ISO date
  user: { display_name: string; role: string; email: string; team_members: string[] };
  terminology: Record<string, string>;
  important_roles: Array<{ title: string; name: string }>;
  pinned_themes: string[];
  known_themes: string[];
  org_context_excerpt?: string;        // from local docs, trimmed
}

const EPISTEMIC_RULES = `
Epistemic discipline (mandatory):
- "fact": only when the source material explicitly states it. Quote a short excerpt.
- "extracted_action": an action someone explicitly requested or committed to. Include owner if named.
- "recorded_decision": a decision clearly stated as made in the evidence. Include decision maker if named.
- "inference": your interpretation from one or more signals. Say so in the description.
- "potential_escalation": you believe leadership attention may be needed. Explain why.
- Never present an inference or recommendation as a fact or a decision.
- Never invent people, dates, numbers, or links. If unknown, omit the field.
- Every observation must cite at least one evidence_id from the batch, and "excerpts" must map each cited evidence_id to a short verbatim quote (≤ 200 characters) from that item.
- Attach a confidence between 0 and 1.`;

function baseSystem(ctx: SkillContext): string {
  const terms = Object.entries(ctx.terminology).map(([k, v]) => `${k} = ${v}`).join("; ");
  const roles = ctx.important_roles.filter((r) => r.title).map((r) => `${r.title}${r.name ? ` (${r.name})` : ""}`).join("; ");
  return [
    `You are the analytical engine of ExecOS, a private executive operating-intelligence system for ${ctx.user.display_name || "the user"}${ctx.user.role ? `, ${ctx.user.role}` : ""}.`,
    `Today is ${ctx.today}. You analyze organizational evidence (email, Teams, meetings, documents, metrics) and return STRUCTURED results only, by calling the submit_result tool exactly once.`,
    terms ? `Organization terminology: ${terms}.` : "",
    roles ? `Important roles: ${roles}.` : "",
    ctx.pinned_themes.length ? `Pinned business themes: ${ctx.pinned_themes.join(", ")}. Prefer these names when evidence fits; otherwise propose new theme names.` : "",
    ctx.known_themes.length ? `Themes already known: ${ctx.known_themes.join(", ")}.` : "",
    ctx.org_context_excerpt ? `Operating context (from the user's private documents):\n${ctx.org_context_excerpt}` : "",
    EPISTEMIC_RULES,
  ].filter(Boolean).join("\n\n");
}

/* --------------------------------- analyze_batch --------------------------------- */
export const AnalyzeBatchInput = z.object({
  batch_id: z.string(),
  evidence: z.array(z.object({
    evidence_id: z.string(), source_type: z.string(), occurred_at: z.string(), title: z.string(),
    participants: z.array(z.string()), thread_id: z.string().optional(), text: z.string().optional(),
    structured: z.record(z.string(), z.unknown()).optional(),
  })),
  existing_items: z.array(z.object({ type: z.string(), id: z.string(), title: z.string(), status: z.string().optional(), owner: z.string().optional() })).default([]),
});
export type AnalyzeBatchInput = z.infer<typeof AnalyzeBatchInput>;

export const analyzeBatch: Skill<AnalyzeBatchInput, BatchAnalysis> = {
  name: "analyze_batch", version: "1.0.0",
  description: "Extract signals, actions, decisions, escalations, risks, data requests, metrics and theme hints from a batch of evidence.",
  input: AnalyzeBatchInput, output: BatchAnalysis,
  system: baseSystem,
  prompt(input) {
    const ev = input.evidence.map((e) => [
      `--- evidence_id: ${e.evidence_id} | ${e.source_type} | ${e.occurred_at} | thread: ${e.thread_id ?? "-"}`,
      `title: ${e.title}`, `participants: ${e.participants.join(", ") || "-"}`,
      e.structured ? `structured: ${JSON.stringify(e.structured)}` : "", e.text ? `text:\n${e.text}` : "",
    ].filter(Boolean).join("\n")).join("\n\n");
    const existing = input.existing_items.length
      ? `\n\nItems already tracked (reuse their exact titles when the evidence refers to the same thing, so they can be updated instead of duplicated):\n${input.existing_items.map((i) => `- [${i.type}] ${i.title}${i.status ? ` (${i.status})` : ""}${i.owner ? ` owner: ${i.owner}` : ""}`).join("\n")}`
      : "";
    return `Analyze the following ${input.evidence.length} evidence items (batch ${input.batch_id}).${existing}

For each meaningful finding produce an observation with kind in {signal, action, decision, escalation, risk, data_request, metric}. Also:
- themes: business themes these items belong to (name + one-line description + evidence_ids).
- conflicts: statements in this batch that contradict each other or tracked items.
- evidence_gaps: things that are asserted but not evidenced.
- data_request: anything that asks for new analysis, metrics, dashboards, data pulls, experiments, forecasting or data engineering.
- status_hint for actions: one of detected, assigned, in_progress, blocked, completed. For decisions: recorded, needed, pending_approval.
- Ignore noise: newsletters, automated notifications, pleasantries.

EVIDENCE:
${ev}`;
  },
};

/* ------------------------------ generate_recommendations ------------------------------ */
export const RecommendationsInput = z.object({
  themes: z.array(z.object({ id: z.string(), name: z.string(), current_state: z.string(), what_changed: z.string() })),
  actions: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), owner: z.string().optional(), due_at: z.string().optional(), mention_count: z.number(), last_observed: z.string(), evidence_ids: z.array(z.string()) })),
  decisions: z.array(z.object({ id: z.string(), topic: z.string(), status: z.string(), needed_by: z.string().optional(), evidence_ids: z.array(z.string()) })),
  escalations: z.array(z.object({ id: z.string(), issue: z.string(), status: z.string(), urgency: z.string(), evidence_ids: z.array(z.string()) })),
  risks: z.array(z.object({ id: z.string(), title: z.string(), trend: z.string(), evidence_ids: z.array(z.string()) })),
  signals: z.array(z.object({ id: z.string(), statement: z.string(), evidence_ids: z.array(z.string()) })),
  existing_recommendation_fingerprints: z.array(z.string()).default([]),
});
export type RecommendationsInput = z.infer<typeof RecommendationsInput>;

export const RecommendationDraft = z.object({
  recommendation: z.string(),
  reasoning: z.string(),
  evidence_ids: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  theme_names: z.array(z.string()).default([]),
  suggested_owner: z.string().optional(),
  suggested_next_step: z.string(),
  related: z.array(z.object({ type: z.string(), id: z.string() })).default([]),
});
export const RecommendationsOutput = z.object({ recommendations: z.array(RecommendationDraft) });
export type RecommendationsOutput = z.infer<typeof RecommendationsOutput>;

export const generateRecommendations: Skill<RecommendationsInput, RecommendationsOutput> = {
  name: "generate_recommendations", version: "1.0.0",
  description: "Propose leadership recommendations from the current structured state (never auto-execute).",
  input: RecommendationsInput, output: RecommendationsOutput,
  system: baseSystem,
  prompt(input) {
    return `Given the current structured state below, propose at most 8 recommendations that would help the leader act. Each must have reasoning, evidence_ids taken from the listed items, confidence, affected theme names, a suggested owner (only if evident) and a concrete next step. Do not repeat items whose fingerprint is listed as existing. Recommendations are proposals for a human to accept, modify or dismiss — never phrase them as decisions.

STATE:
${JSON.stringify({ themes: input.themes, actions: input.actions, decisions: input.decisions, escalations: input.escalations, risks: input.risks, signals: input.signals }, null, 1)}`;
  },
};

/* ------------------------------------- summarize ------------------------------------- */
export const SummarizeInput = z.object({
  horizon: z.enum(["daily", "weekly", "monthly", "quarterly"]),
  period_start: z.string(), period_end: z.string(),
  changed: z.array(z.object({ object_type: z.string(), id: z.string(), title: z.string(), event: z.string(), at: z.string(), evidence_ids: z.array(z.string()) })),
  attention: z.object({ decisions_needed: z.array(z.object({ id: z.string(), topic: z.string() })), escalation_candidates: z.array(z.object({ id: z.string(), issue: z.string() })), overdue_actions: z.array(z.object({ id: z.string(), title: z.string(), owner: z.string().optional(), due_at: z.string().optional() })) }),
  themes: z.array(z.object({ id: z.string(), name: z.string(), current_state: z.string(), what_changed: z.string() })),
  metrics: z.array(z.object({ name: z.string(), value: z.number(), unit: z.string().optional(), delta: z.number().optional() })),
  upcoming: z.array(z.object({ title: z.string(), at: z.string(), evidence_id: z.string() })),
});
export type SummarizeInput = z.infer<typeof SummarizeInput>;
export const SummarizeOutput = z.object({
  narrative: z.string(),
  highlights: z.array(z.object({ text: z.string(), epistemic: EpistemicStatus, object_type: z.string().optional(), object_id: z.string().optional(), evidence: z.array(EvidenceRef).default([]) })),
});
export type SummarizeOutput = z.infer<typeof SummarizeOutput>;

export const summarize: Skill<SummarizeInput, SummarizeOutput> = {
  name: "summarize", version: "1.0.0",
  description: "Write the executive narrative for a horizon from structured state (facts vs inference clearly separated).",
  input: SummarizeInput, output: SummarizeOutput,
  system: baseSystem,
  prompt(input) {
    const guide = {
      daily: "What changed since yesterday, what needs attention today, new actions/decisions, emerging risks, upcoming commitments.",
      weekly: "Major developments, commitments and progress, unresolved issues, emerging themes, cross-team dependencies, decisions made and needed, risks, leadership attention.",
      monthly: "Evidence-based business narrative: performance, resources, risks, priorities, recurring blockers, significant decisions, progress against goals, recommended interventions.",
      quarterly: "Priorities, capacity, operating-model gaps and cross-team dependencies that should be deliberately reset.",
    }[input.horizon];
    return `Write the ${input.horizon} executive brief for ${input.period_start} to ${input.period_end}. Focus: ${guide}
Return a concise narrative (max 180 words) and up to 8 highlights, each labelled with its epistemic status and linked to object ids and evidence ids from the state. Facts must be traceable; label interpretations as inference.

STATE:
${JSON.stringify(input, null, 1)}`;
  },
};

/* ----------------------------------- answer_with_evidence ----------------------------------- */
export const AnswerInput = z.object({
  question: z.string(),
  evidence: z.array(z.object({ evidence_id: z.string(), source_type: z.string(), occurred_at: z.string(), title: z.string(), participants: z.array(z.string()), text: z.string().optional() })),
  objects: z.array(z.object({ type: z.string(), id: z.string(), title: z.string(), status: z.string().optional(), owner: z.string().optional(), epistemic: z.string(), evidence_ids: z.array(z.string()) })),
});
export type AnswerInput = z.infer<typeof AnswerInput>;
export const AnswerOutput = z.object({
  answer: z.string(),
  citations: z.array(z.object({ evidence_id: z.string(), why: z.string() })),
  related_objects: z.array(z.object({ type: z.string(), id: z.string() })).default([]),
  confidence: z.number().min(0).max(1),
  gaps: z.array(z.string()).default([]),
});
export type AnswerOutput = z.infer<typeof AnswerOutput>;

export const answerWithEvidence: Skill<AnswerInput, AnswerOutput> = {
  name: "answer_with_evidence", version: "1.0.0",
  description: "Answer a question strictly from local evidence and tracked objects, with citations.",
  input: AnswerInput, output: AnswerOutput,
  system: baseSystem,
  prompt(input) {
    return `Answer the question using ONLY the evidence and tracked objects below. Cite evidence_ids for every claim. If the evidence is insufficient, say so in gaps rather than guessing. Distinguish recorded decisions and explicit commitments from inferences.

QUESTION: ${input.question}

TRACKED OBJECTS:
${JSON.stringify(input.objects, null, 1)}

EVIDENCE:
${input.evidence.map((e) => `--- ${e.evidence_id} | ${e.source_type} | ${e.occurred_at} | ${e.title} | ${e.participants.join(", ")}\n${e.text ?? ""}`).join("\n\n")}`;
  },
};

export const SKILLS = { analyzeBatch, generateRecommendations, summarize, answerWithEvidence } as const;
export type RecommendationLike = Recommendation;
