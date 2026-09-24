import { z } from "zod";

/* ------------------------------------------------------------------------- */
/* Epistemic status: the single most important field in the data model.       */
/* ------------------------------------------------------------------------- */
export const EpistemicStatus = z.enum([
  "fact",                 // explicitly supported by source material
  "extracted_action",     // an action explicitly requested or committed to
  "recorded_decision",    // a decision clearly recorded in evidence
  "inference",            // inferred by the system from one or more signals
  "recommendation",       // proposed by the system
  "potential_escalation", // the system believes leadership attention may be needed
]);
export type EpistemicStatus = z.infer<typeof EpistemicStatus>;

export const Confidence = z.number().min(0).max(1);

/* ------------------------------------------------------------------------- */
/* Evidence (normalized, provider-agnostic)                                    */
/* ------------------------------------------------------------------------- */
export const SourceType = z.enum([
  "email", "teams_message", "teams_thread", "meeting", "calendar_event",
  "document", "metric", "copilot_answer", "tracker_item",
]);
export type SourceType = z.infer<typeof SourceType>;

export const Participant = z.object({
  name: z.string(),
  email: z.string().optional(),
  role: z.string().optional(),
});
export type Participant = z.infer<typeof Participant>;

export const SourceRef = z.object({
  kind: z.string(),                  // e.g. "graph:message", "file", "mock"
  id: z.string(),
  url: z.string().optional(),        // only when supplied by the source system
  path: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const Evidence = z.object({
  evidence_id: z.string(),
  provider_id: z.string(),
  source_type: SourceType,
  occurred_at: z.string(),           // ISO
  retrieved_at: z.string(),          // ISO
  title: z.string().default(""),
  participants: z.array(Participant).default([]),
  thread_id: z.string().optional(),
  source_ref: SourceRef,
  text: z.string().optional(),
  structured: z.record(z.string(), z.unknown()).optional(),
  sensitivity: z.object({ label: z.string().optional(), confidential: z.boolean().optional() }).default({}),
  content_hash: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

export const EvidenceRole = z.enum(["supports", "mentions", "contradicts"]);
export const EvidenceRef = z.object({
  evidence_id: z.string(),
  role: EvidenceRole.default("supports"),
  excerpt: z.string().optional(),    // short quote that justifies the link
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

/* ------------------------------------------------------------------------- */
/* Intelligence objects                                                        */
/* ------------------------------------------------------------------------- */
const Base = {
  id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  first_seen: z.string(),
  last_observed: z.string(),
  theme_id: z.string().optional(),
  epistemic: EpistemicStatus,
  confidence: Confidence,
  evidence: z.array(EvidenceRef).default([]),
  reasoning: z.string().optional(),  // why the system surfaced this
  hidden: z.boolean().default(false),
  /** Fields the user set by hand; reconciliation never overwrites them. */
  locked_fields: z.array(z.string()).default([]),
};

export const Theme = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().default(""),
  pinned: z.boolean().default(false),
  discovered: z.boolean().default(true),
  what_changed: z.string().default(""),
  current_state: z.string().default(""),
  confidence: Confidence.default(0.5),
  created_at: z.string(),
  updated_at: z.string(),
  evidence: z.array(EvidenceRef).default([]),
  hidden: z.boolean().default(false),
  locked_fields: z.array(z.string()).default([]),
  origin: z.enum(["discovered", "pinned", "user"]).default("discovered"),
});
export type Theme = z.infer<typeof Theme>;

/* ------------------------------------------------------------------------- */
/* Bucket playbook ("skill"): how to manage a bucket, derived once, then fixed  */
/* ------------------------------------------------------------------------- */
export const LoopStage = z.enum(["sense", "interpret", "decide", "align", "execute"]);
export const PlaybookStep = z.object({
  n: z.number().int(),
  stage: LoopStage,
  title: z.string(),
  description: z.string().default(""),
  trigger: z.string().optional(),     // what starts this step (event, cadence, threshold)
  owner: z.string().optional(),
  output: z.string().optional(),      // what the step produces
  basis: z.enum(["history", "assumption"]).default("assumption"),
});
export const BucketSkill = z.object({
  id: z.string(),
  theme_id: z.string(),
  version: z.number().int().default(1),
  status: z.enum(["draft", "fixed"]).default("fixed"),
  generated_at: z.string(),
  fixed_at: z.string().optional(),
  generated_by: z.enum(["model", "rules", "user"]).default("rules"),
  basis: z.enum(["history", "assumption", "mixed"]).default("assumption"),
  history_depth: z.object({ evidence: z.number().int(), objects: z.number().int(), days: z.number().int() }).default({ evidence: 0, objects: 0, days: 0 }),
  purpose: z.string().default(""),
  cadence: z.object({ review: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly"]).default("weekly"), forums: z.array(z.string()).default([]), rationale: z.string().default("") }).default({}),
  owners: z.object({ primary: z.string().optional(), stakeholders: z.array(z.string()).default([]), rationale: z.string().default("") }).default({}),
  signals_to_watch: z.array(z.object({ name: z.string(), source_types: z.array(z.string()).default([]), threshold: z.string().optional(), rationale: z.string().default("") })).default([]),
  steps: z.array(PlaybookStep).default([]),
  escalation_path: z.array(z.object({ condition: z.string(), to: z.string(), within_days: z.number().int().optional() })).default([]),
  decision_rights: z.array(z.object({ decision: z.string(), maker: z.string() })).default([]),
  recurring_blockers: z.array(z.string()).default([]),
  evidence: z.array(EvidenceRef).default([]),
  confidence: Confidence.default(0.5),
  epistemic: EpistemicStatus.default("inference"),
  rationale: z.string().default(""),
  user_adjusted: z.boolean().default(false),
  user_notes: z.string().optional(),
});
export type BucketSkill = z.infer<typeof BucketSkill>;

export const Signal = z.object({
  ...Base,
  statement: z.string(),
  occurred_at: z.string(),
});
export type Signal = z.infer<typeof Signal>;

export const ActionStatus = z.enum([
  "detected", "confirmed", "assigned", "in_progress", "blocked",
  "escalation_candidate", "escalated", "completed", "dismissed",
]);
export type ActionStatus = z.infer<typeof ActionStatus>;
export const ActionOrigin = z.enum(["extracted", "inferred", "user", "accepted_recommendation"]);

export const ActionItem = z.object({
  ...Base,
  title: z.string(),
  description: z.string().default(""),
  owner: z.string().optional(),
  stakeholders: z.array(z.string()).default([]),
  due_at: z.string().optional(),
  status: ActionStatus,
  origin: ActionOrigin.default("extracted"),
  escalation_id: z.string().optional(),
  is_commitment: z.boolean().default(false),   // a commitment *made by* someone (vs. a request)
  mention_count: z.number().int().default(1),
});
export type ActionItem = z.infer<typeof ActionItem>;

export const DecisionStatus = z.enum(["recorded", "needed", "pending_approval", "superseded"]);
export const Decision = z.object({
  ...Base,
  topic: z.string(),
  decision: z.string().default(""),
  decision_date: z.string().optional(),
  decision_maker: z.string().optional(),
  rationale: z.string().optional(),
  alternatives: z.array(z.string()).default([]),
  status: DecisionStatus,
  downstream_action_ids: z.array(z.string()).default([]),
  needed_by: z.string().optional(),
  blocks: z.array(z.string()).default([]),    // free-text of what waits on it
});
export type Decision = z.infer<typeof Decision>;

export const Urgency = z.enum(["low", "medium", "high", "critical"]);
export const EscalationStatus = z.enum(["potential", "active", "resolved", "dismissed"]);
export const Escalation = z.object({
  ...Base,
  issue: z.string(),
  why_needed: z.string().default(""),
  owner: z.string().optional(),
  target_decision_maker: z.string().optional(),
  urgency: Urgency.default("medium"),
  status: EscalationStatus,
  recommended_resolution: z.string().optional(),
  related_action_ids: z.array(z.string()).default([]),
});
export type Escalation = z.infer<typeof Escalation>;

export const Risk = z.object({
  ...Base,
  title: z.string(),
  description: z.string().default(""),
  likelihood: z.enum(["low", "medium", "high"]).default("medium"),
  impact: z.enum(["low", "medium", "high"]).default("medium"),
  trend: z.enum(["rising", "stable", "falling"]).default("stable"),
  status: z.enum(["open", "mitigating", "closed"]).default("open"),
  owner: z.string().optional(),
});
export type Risk = z.infer<typeof Risk>;

export const RecommendationStatus = z.enum(["proposed", "accepted", "modified", "dismissed"]);
export const Recommendation = z.object({
  ...Base,
  recommendation: z.string(),
  theme_ids: z.array(z.string()).default([]),
  suggested_owner: z.string().optional(),
  suggested_next_step: z.string().default(""),
  status: RecommendationStatus.default("proposed"),
  dismissed_reason: z.string().optional(),
  rule: z.string().optional(),               // rule id when produced by the rule engine
  fingerprint: z.string(),                    // used to honour "don't show again"
  resulting_action_id: z.string().optional(),
});
export type Recommendation = z.infer<typeof Recommendation>;

export const DataRequestKind = z.enum(["analysis", "metric", "dashboard", "data_pull", "experiment", "forecast", "engineering", "powerbi"]);
export const DataRequest = z.object({
  ...Base,
  request: z.string(),
  requested_by: z.string().optional(),
  owner: z.string().optional(),          // who is expected to fulfil it (e.g. data & analytics lead)
  kind: DataRequestKind,
  status: z.enum(["identified", "accepted", "declined", "submitted", "in_progress", "delivered"]).default("identified"),
  /** Where the request was raised: a whole bucket (theme) or a single item inside it. */
  scope: z.enum(["bucket", "item", "detected"]).default("detected"),
  object_type: z.string().optional(),
  object_id: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  needed_by: z.string().optional(),
  notes: z.string().optional(),
  origin: z.enum(["extracted", "user"]).default("extracted"),
  delivery: z.object({
    status: z.enum(["not_configured", "delivered", "failed", "pending"]).default("not_configured"),
    endpoint: z.string().optional(),
    at: z.string().optional(),
    response_status: z.number().optional(),
    error: z.string().optional(),
    external_id: z.string().optional(),
  }).default({}),
});
export type DataRequest = z.infer<typeof DataRequest>;

export const BusinessMetric = z.object({
  id: z.string(),
  name: z.string(),
  value: z.number(),
  unit: z.string().optional(),
  as_of: z.string(),
  delta: z.number().optional(),
  delta_period: z.string().optional(),
  theme_id: z.string().optional(),
  evidence: z.array(EvidenceRef).default([]),
});
export type BusinessMetric = z.infer<typeof BusinessMetric>;

export const Stakeholder = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  role: z.string().optional(),
  org: z.string().optional(),
  first_seen: z.string(),
  last_seen: z.string(),
  mention_count: z.number().int().default(0),
});
export type Stakeholder = z.infer<typeof Stakeholder>;

export const Horizon = z.enum(["daily", "weekly", "monthly", "quarterly"]);
export type Horizon = z.infer<typeof Horizon>;

export const SummarySection = z.object({
  heading: z.string(),
  items: z.array(z.object({
    text: z.string(),
    epistemic: EpistemicStatus.default("inference"),
    object_type: z.string().optional(),
    object_id: z.string().optional(),
    evidence: z.array(EvidenceRef).default([]),
  })).default([]),
  narrative: z.string().optional(),
});
export const Summary = z.object({
  id: z.string(),
  horizon: Horizon,
  period_start: z.string(),
  period_end: z.string(),
  generated_at: z.string(),
  attention: z.object({
    decisions_needed: z.number().int(),
    escalation_candidates: z.number().int(),
    overdue_actions: z.number().int(),
    new_risks: z.number().int(),
  }),
  sections: z.array(SummarySection),
  coverage: z.object({
    providers: z.array(z.object({ id: z.string(), ok: z.boolean(), message: z.string().optional() })),
    incomplete: z.boolean(),
    reasons: z.array(z.string()).default([]),
  }),
});
export type Summary = z.infer<typeof Summary>;

export const JournalEvent = z.enum([
  "detected", "updated", "status_changed", "merged", "dismissed", "accepted", "modified",
  "feedback", "sync_started", "sync_completed", "sync_failed", "purged",
]);
export const JournalEntry = z.object({
  id: z.string(),
  at: z.string(),
  object_type: z.string(),
  object_id: z.string(),
  event: JournalEvent,
  actor: z.enum(["system", "user"]),
  summary: z.string().default(""),
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  evidence: z.array(EvidenceRef).default([]),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

export const FeedbackKind = z.enum([
  "edit", "add", "remove", "move_bucket", "exclude_evidence", "playbook_edit", "playbook_regenerate",
  "not_an_action", "wrong_owner", "mark_completed", "merge", "not_important",
  "is_decision", "escalate", "hide_recommendation", "pin_theme", "unpin_theme",
  "accept_recommendation", "modify_recommendation", "dismiss_recommendation",
  "set_status", "resolve_escalation",
]);
export type FeedbackKind = z.infer<typeof FeedbackKind>;
export const Feedback = z.object({
  id: z.string(),
  at: z.string(),
  object_type: z.string(),
  object_id: z.string(),
  kind: FeedbackKind,
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type Feedback = z.infer<typeof Feedback>;

export const SyncState = z.object({
  provider_id: z.string(),
  cursor: z.record(z.string(), z.unknown()).default({}),
  last_sync_at: z.string().optional(),
  last_status: z.enum(["never", "ok", "partial", "error", "auth_required", "unavailable"]).default("never"),
  last_error: z.string().optional(),
  stats: z.object({
    items_seen: z.number().int().default(0),
    items_new: z.number().int().default(0),
    duration_ms: z.number().int().default(0),
  }).default({}),
});
export type SyncState = z.infer<typeof SyncState>;

export type ObjectType =
  | "theme" | "signal" | "action" | "decision" | "escalation" | "risk"
  | "recommendation" | "data_request" | "metric";

/* ------------------------------------------------------------------------- */
/* Observations: what the analysis skill returns per batch (pre-reconciliation)*/
/* ------------------------------------------------------------------------- */
export const Observation = z.object({
  kind: z.enum(["signal", "action", "decision", "escalation", "risk", "data_request", "metric"]),
  epistemic: EpistemicStatus,
  title: z.string(),
  description: z.string().default(""),
  theme_hints: z.array(z.string()).default([]),
  owner: z.string().optional(),
  decision_maker: z.string().optional(),
  stakeholders: z.array(z.string()).default([]),
  due_at: z.string().optional(),
  status_hint: z.string().optional(),     // e.g. "completed", "blocked", "needed", "recorded"
  urgency: Urgency.optional(),
  is_commitment: z.boolean().optional(),
  rationale: z.string().optional(),
  alternatives: z.array(z.string()).default([]),
  evidence_ids: z.array(z.string()).min(1),
  excerpt: z.string().optional(),
  excerpts: z.record(z.string(), z.string()).optional(),   // evidence_id -> short quote justifying that link
  confidence: Confidence,
  metric: z.object({ name: z.string(), value: z.number(), unit: z.string().optional(), delta: z.number().optional() }).optional(),
  request_kind: z.string().optional(),
  contradicts: z.string().optional(),     // title of an observation this conflicts with
});
export type Observation = z.infer<typeof Observation>;

export const ThemeHint = z.object({
  name: z.string(),
  description: z.string().default(""),
  evidence_ids: z.array(z.string()).default([]),
});
export const BatchAnalysis = z.object({
  observations: z.array(Observation),
  themes: z.array(ThemeHint).default([]),
  evidence_gaps: z.array(z.string()).default([]),
  conflicts: z.array(z.object({ statement: z.string(), evidence_ids: z.array(z.string()) })).default([]),
});
export type BatchAnalysis = z.infer<typeof BatchAnalysis>;
