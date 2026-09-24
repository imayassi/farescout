/**
 * Fixture observations for the synthetic dataset: what a well-behaved model would extract.
 * Keyed by mock source id so the MockBackend can emit them for whatever evidence is in a batch.
 * Repeated mentions of the same item across sources are emitted separately and merged by
 * reconciliation — exactly as with real model output.
 */
import type { Observation } from "../../domain/index.js";

export interface FixtureSource { id: string; excerpt: string; status_hint?: string; confidence?: number }
export interface FixtureObservation extends Omit<Observation, "evidence_ids" | "excerpt" | "confidence" | "stakeholders" | "alternatives" | "description" | "theme_hints"> {
  description: string;
  theme_hints: string[];
  stakeholders?: string[];
  alternatives?: string[];
  key: string;
  sources: FixtureSource[];
  confidence: number;
}

export const FIXTURES: FixtureObservation[] = [
  {
    key: "forecast-rebaseline", kind: "action", epistemic: "extracted_action",
    title: "Deliver re-baselined H1 volume forecast", description: "Marcus Chen committed to a re-baselined H1 volume forecast so Finance can rerun the capacity model.",
    theme_hints: ["Forecast", "Capacity"], owner: "Marcus Chen", stakeholders: ["Priya Natarajan", "Jordan Lee"], is_commitment: true, confidence: 0.92,
    due_at: "__DUE_PAST_10__",
    sources: [
      { id: "teams-forecast-01", excerpt: "I will deliver a re-baselined H1 volume forecast by the 15th", status_hint: "assigned" },
      { id: "email-forecast-02", excerpt: "about 70% done ... Still targeting the 15th", status_hint: "in_progress" },
      { id: "meeting-mor-03", excerpt: "re-baselined H1 volume forecast is still pending; new ETA end of next week", status_hint: "in_progress" },
      { id: "teams-forecast-04", excerpt: "any update on the re-baselined forecast? We are now 10 days past the original date", status_hint: "blocked" },
      { id: "teams-forecast-05", excerpt: "I need the re-baselined forecast before the QBR", status_hint: "escalation_candidate" },
    ],
  },
  {
    key: "capacity-model-blocked", kind: "signal", epistemic: "fact",
    title: "Capacity model rerun is blocked on the forecast", description: "Finance cannot rerun the capacity model until the re-baselined forecast lands.",
    theme_hints: ["Capacity", "Forecast"], confidence: 0.9,
    sources: [{ id: "teams-forecast-01", excerpt: "Capacity model rerun is blocked until we have it." }, { id: "teams-forecast-04", excerpt: "I cannot rerun the capacity model without it" }],
  },
  {
    key: "decision-hiring-pause", kind: "decision", epistemic: "recorded_decision",
    title: "Tier-2 hiring plan paused for Q3 until forecast is re-baselined", description: "Jordan Lee decided to pause the Tier-2 hiring plan for Q3.",
    theme_hints: ["People", "Capacity", "Budget"], decision_maker: "Jordan Lee", status_hint: "recorded",
    rationale: "Do not add fixed cost against a forecast that is not trusted.", alternatives: ["Proceed with half the reqs", "Convert reqs to contractors"], confidence: 0.95,
    sources: [{ id: "email-decision-hiring", excerpt: "I have decided to pause the Tier-2 hiring plan for Q3 until the volume forecast is re-baselined" }, { id: "meeting-mor-03", excerpt: "Decision recorded: Jordan Lee confirmed the Tier-2 hiring plan for Q3 is paused" }],
  },
  {
    key: "budget-8", kind: "signal", epistemic: "fact",
    title: "Corporate guidance: 8% opex reduction for FY27 H1", description: "Priya reported an 8% reduction versus plan.",
    theme_hints: ["Budget"], confidence: 0.9,
    sources: [{ id: "email-budget-priya", excerpt: "corporate guidance for FY27 H1 is an 8% reduction to our opex envelope" }],
  },
  {
    key: "budget-12", kind: "signal", epistemic: "fact",
    title: "Budget conversation landed at 12% reduction for H1", description: "Jordan reported 12%, not 8%. Conflicts with Priya's earlier guidance.",
    theme_hints: ["Budget"], confidence: 0.9, contradicts: "Corporate guidance: 8% opex reduction for FY27 H1",
    sources: [{ id: "teams-budget-jordan", excerpt: "landed at a 12% reduction for H1, not 8%" }, { id: "teams-budget-priya-2", excerpt: "The delta between 8% and 12% is roughly the contractor surge line" }],
  },
  {
    key: "budget-reconcile", kind: "action", epistemic: "extracted_action",
    title: "Reconcile budget model to 12% reduction", description: "Priya to reconcile the finance model with the 12% guidance and report the gap.",
    theme_hints: ["Budget"], owner: "Priya Natarajan", stakeholders: ["Jordan Lee"], confidence: 0.85,
    sources: [{ id: "teams-budget-jordan", excerpt: "Priya, please reconcile with your model and come back with the gap", status_hint: "assigned" }, { id: "teams-budget-priya-2", excerpt: "Reconciling now", status_hint: "in_progress" }],
  },
  {
    key: "decision-contractors", kind: "decision", epistemic: "fact",
    title: "Approve 6 contractors for Q3 volume surge", description: "Marcus requests sign-off for 6 contractors (12 weeks) under the GVSA; Riley has the order drafted.",
    theme_hints: ["Capacity", "Budget"], decision_maker: "Alex Rivera", status_hint: "pending_approval", due_at: "__DUE_FUTURE_4__", confidence: 0.9,
    sources: [{ id: "email-contractors", excerpt: "requesting approval for 6 contractors for the Q3 volume surge ... I need your sign-off by the 30th" }, { id: "teams-contractors-2", excerpt: "waiting on your approval. Vendor lead time is 3 weeks" }, { id: "teams-budget-priya-2", excerpt: "Will need a decision on the contractor request before I can close the model" }],
  },
  {
    key: "escalation-contoso", kind: "escalation", epistemic: "potential_escalation",
    title: "Contoso Retail P1 backlog blocked on engineering fix (SLA breached)", description: "Three P1 tickets open >9 days waiting on a routing-service memory-leak fix owned outside the org; SLA breached on two; customer requesting an executive call.",
    theme_hints: ["Customer", "Delivery"], owner: "Lena Fischer", decision_maker: "Jordan Lee", urgency: "high", confidence: 0.9,
    sources: [
      { id: "email-contoso-1", excerpt: "3 P1 tickets open for more than 9 days ... I think this needs escalation to Engineering leadership", status_hint: "potential" },
      { id: "teams-contoso-2", excerpt: "If not by Friday I recommend Alex raises it with Jordan", status_hint: "potential" },
      { id: "teams-contoso-3", excerpt: "Contoso's CIO emailed ... asking for a leadership call this week", status_hint: "potential" },
    ],
  },
  {
    key: "action-contoso-position", kind: "action", epistemic: "extracted_action",
    title: "Agree a position on the Contoso routing-fix ETA before responding to their CIO", description: "Lena needs a leadership position on the ETA before replying.",
    theme_hints: ["Customer"], owner: "Alex Rivera", stakeholders: ["Lena Fischer", "Dana Okafor"], confidence: 0.8, due_at: "__DUE_FUTURE_2__",
    sources: [{ id: "teams-contoso-3", excerpt: "We need a position on the routing fix ETA before we respond.", status_hint: "detected" }],
  },
  {
    key: "action-hotfix", kind: "action", epistemic: "extracted_action",
    title: "Ship the ticket-routing hotfix", description: "Dana committed in the MOR to ship the ticket-routing hotfix by end of week.",
    theme_hints: ["Delivery"], owner: "Dana Okafor", is_commitment: true, confidence: 0.93,
    sources: [
      { id: "meeting-mor-03", excerpt: "Action: Dana to ship the ticket-routing hotfix by end of week.", status_hint: "assigned" },
      { id: "teams-hotfix-1", excerpt: "Confirming I will ship the ticket-routing hotfix by end of this week", status_hint: "in_progress" },
      { id: "teams-hotfix-2", excerpt: "Ticket-routing hotfix shipped to production this morning. Closing the action", status_hint: "completed" },
    ],
  },
  {
    key: "dep-data-platform", kind: "signal", epistemic: "fact",
    title: "Data Platform API dependency has no named owner", description: "Three teams (AI program, Analytics, Engineering) independently report being blocked by the Data Platform API team with no owner for support-org requests.",
    theme_hints: ["Dependencies", "AI", "Delivery"], confidence: 0.88,
    sources: [
      { id: "teams-dep-ai", excerpt: "Nobody on their side owns our request." },
      { id: "email-dep-data", excerpt: "no named owner for support-org requests. Third time this quarter." },
      { id: "teams-dep-eng", excerpt: "We really need a single owner for that dependency." },
      { id: "email-forecast-02", excerpt: "Data Platform API changes slowed the volume pull." },
    ],
  },
  {
    key: "risk-ai-slip", kind: "risk", epistemic: "inference",
    title: "Automation Scout deflection target at risk from Data Platform dependency", description: "Rollout slipped a week; the events endpoint has no committed date.",
    theme_hints: ["AI"], owner: "Kai Nakamura", confidence: 0.7,
    sources: [{ id: "teams-dep-ai", excerpt: "Automation Scout deflection rollout slipped a week." }],
  },
  {
    key: "metric-volume", kind: "metric", epistemic: "fact",
    title: "Weekly case volume", description: "Weekly case volume from the Support Ops dashboard.",
    theme_hints: ["Forecast"], confidence: 0.98, metric: { name: "Weekly case volume", value: 11300, unit: "cases", delta: 0.14 },
    sources: [{ id: "metric-volume-w1", excerpt: "11300 cases" }, { id: "metric-volume-w2", excerpt: "11050 cases" }, { id: "metric-volume-w3", excerpt: "10600 cases" }, { id: "metric-volume-w4", excerpt: "10250 cases" }],
  },
  {
    key: "risk-forecast-volume", kind: "risk", epistemic: "inference",
    title: "Case volume running ~14% above the four-week baseline", description: "Volume has risen four weeks in a row while the forecast is stale and Tier-2 hiring is paused; capacity shortfall risk in Q3.",
    theme_hints: ["Forecast", "Capacity"], confidence: 0.75,
    sources: [{ id: "metric-volume-w1", excerpt: "11300 cases" }, { id: "metric-volume-w2", excerpt: "11050 cases" }],
  },
  {
    key: "metric-sla", kind: "metric", epistemic: "fact",
    title: "P1 within-SLA attainment", description: "P1 SLA attainment vs 94% target.",
    theme_hints: ["Customer"], confidence: 0.98, metric: { name: "P1 within-SLA attainment", value: 90.6, unit: "%", delta: -0.031 },
    sources: [{ id: "metric-sla-w1", excerpt: "90.6% (target 94%)" }, { id: "metric-sla-w2", excerpt: "91.9%" }],
  },
  {
    key: "vendor-renewal", kind: "signal", epistemic: "fact",
    title: "Meridian outsourcing renewal: +15% rate increase; vendor transition under evaluation", description: "Procurement wants a recommendation on a second-vendor transition under the GVSA by the QBR.",
    theme_hints: ["Vendor transition", "Budget", "People"], confidence: 0.9,
    sources: [{ id: "email-vendor-1", excerpt: "signalled a 15% rate increase at renewal" }, { id: "teams-vendor-2", excerpt: "wants a recommendation on vendor transition by the QBR" }, { id: "meeting-vendor-3", excerpt: "Options discussed: (a) renew ... (b) dual-vendor ... (c) insource 20 seats. No decision." }],
  },
  {
    key: "decision-vendor", kind: "decision", epistemic: "inference",
    title: "Meridian renewal vs vendor transition", description: "Leadership must choose between renewal at +15%, dual-vendor, or insourcing before the QBR.",
    theme_hints: ["Vendor transition"], status_hint: "needed", due_at: "__DUE_FUTURE_5__", alternatives: ["Renew Meridian at +15%", "Dual-vendor under the GVSA", "Insource 20 seats"], confidence: 0.8,
    sources: [{ id: "meeting-vendor-3", excerpt: "No decision. Priya to cost options (a)-(c) before the QBR." }],
  },
  {
    key: "action-vendor-costing", kind: "action", epistemic: "extracted_action",
    title: "Cost vendor options (renew / dual-vendor / insource)", description: "Priya to cost the three vendor options before the QBR.",
    theme_hints: ["Vendor transition", "Budget"], owner: "Priya Natarajan", due_at: "__DUE_FUTURE_5__", confidence: 0.85,
    sources: [{ id: "meeting-vendor-3", excerpt: "Priya to cost options (a)-(c) before the QBR.", status_hint: "assigned" }],
  },
  {
    key: "action-vendor-counter", kind: "action", epistemic: "extracted_action",
    title: "Request Meridian counter-proposal", description: "Riley to request a counter-proposal from Meridian.",
    theme_hints: ["Vendor transition"], owner: "Riley Morgan", confidence: 0.85,
    sources: [{ id: "meeting-vendor-3", excerpt: "Riley to request a Meridian counter-proposal.", status_hint: "assigned" }],
  },
  {
    key: "risk-attrition", kind: "risk", epistemic: "fact",
    title: "Tier-1 attrition above target (4 resignations in 3 weeks)", description: "Annualized ~11% vs 9% target; exit interviews cite shift schedules and hiring-pause uncertainty.",
    theme_hints: ["People"], owner: "Samir Haddad", confidence: 0.9,
    sources: [{ id: "email-attrition", excerpt: "4 resignations in the Tier-1 team in 3 weeks (annualized ~11%, above the 9% target)" }],
  },
  {
    key: "action-retention", kind: "action", epistemic: "extracted_action",
    title: "Hold retention conversations with top 10 critical-skill Tier-1 agents", description: "Samir recommends targeted retention conversations.",
    theme_hints: ["People"], owner: "Samir Haddad", stakeholders: ["Alex Rivera"], confidence: 0.8,
    sources: [{ id: "email-attrition", excerpt: "I recommend a retention conversation with the top 10 critical-skill agents", status_hint: "detected" }],
  },
  {
    key: "data-req-backlog", kind: "data_request", epistemic: "extracted_action",
    title: "Power BI dashboard: backlog aging by tier and customer segment", description: "Requested by Jordan for the QBR; weekly refresh.",
    theme_hints: ["Metrics", "Customer"], owner: "Tom Alvarez", request_kind: "dashboard", confidence: 0.9,
    sources: [{ id: "email-data-request-1", excerpt: "a Power BI dashboard showing backlog aging by tier and by customer segment" }],
  },
  {
    key: "data-req-deflection", kind: "data_request", epistemic: "extracted_action",
    title: "Analysis: Automation Scout deflection impact on Tier-1 volume", description: "Requested by Kai to validate the 18% deflection target before the MOR.",
    theme_hints: ["AI", "Metrics"], owner: "Tom Alvarez", request_kind: "analysis", confidence: 0.85,
    sources: [{ id: "teams-data-request-2", excerpt: "run an analysis of Automation Scout deflection impact on Tier-1 volume" }],
  },
  {
    key: "decision-hemingway", kind: "decision", epistemic: "recorded_decision",
    title: "Adopt Hemingway summaries for executive customer communications", description: "Decided by Alex; Lena owns the rollout starting next month.",
    theme_hints: ["Customer"], decision_maker: "Alex Rivera", status_hint: "recorded", confidence: 0.95,
    sources: [{ id: "email-decision-hemingway", excerpt: "we have decided to adopt the Hemingway summary format for all executive customer communications" }],
  },
  {
    key: "action-hemingway-rollout", kind: "action", epistemic: "extracted_action",
    title: "Roll out Hemingway summary format for customer comms", description: "Lena owns the rollout starting next month.",
    theme_hints: ["Customer"], owner: "Lena Fischer", confidence: 0.85,
    sources: [{ id: "email-decision-hemingway", excerpt: "Lena owns the rollout.", status_hint: "assigned" }],
  },
  {
    key: "priorities", kind: "signal", epistemic: "fact",
    title: "FY27 H1 priorities: SLA 94%, forecast re-baseline, 18% AI deflection, budget envelope, attrition <9%", description: "From the operating plan.",
    theme_hints: ["Strategic initiatives"], confidence: 0.95,
    sources: [{ id: "doc-operating-plan", excerpt: "Priorities (agreed with Jordan Lee)" }],
  },
];

export const FIXTURE_THEMES: Array<{ name: string; description: string; sourceIds: string[] }> = [
  { name: "Forecast", description: "Volume forecast, re-baseline, and its downstream capacity decisions.", sourceIds: ["teams-forecast-01", "email-forecast-02", "meeting-mor-03", "teams-forecast-04", "teams-forecast-05", "metric-volume-w1"] },
  { name: "Budget", description: "FY27 H1 opex envelope, corporate reduction guidance, contractor surge line.", sourceIds: ["email-budget-priya", "teams-budget-jordan", "teams-budget-priya-2", "email-contractors"] },
  { name: "Capacity", description: "Tier-1/Tier-2 staffing, contractor surge, hiring pause.", sourceIds: ["email-decision-hiring", "email-contractors", "teams-contractors-2"] },
  { name: "Customer", description: "SLA attainment, Contoso Retail escalation, customer communications.", sourceIds: ["email-contoso-1", "teams-contoso-2", "teams-contoso-3", "metric-sla-w1", "email-decision-hemingway"] },
  { name: "People", description: "Attrition, retention, hiring pause impact.", sourceIds: ["email-attrition", "email-decision-hiring"] },
  { name: "AI", description: "Automation Scout deflection program.", sourceIds: ["teams-dep-ai", "teams-data-request-2"] },
  { name: "Dependencies", description: "Cross-team dependencies, notably the Data Platform API.", sourceIds: ["teams-dep-ai", "email-dep-data", "teams-dep-eng"] },
  { name: "Delivery", description: "Engineering fixes and shipping commitments.", sourceIds: ["teams-hotfix-1", "teams-hotfix-2", "teams-contoso-2"] },
  { name: "Vendor transition", description: "Meridian renewal and possible second-vendor transition under the GVSA.", sourceIds: ["email-vendor-1", "teams-vendor-2", "meeting-vendor-3"] },
  { name: "Metrics", description: "Analytics and dashboard requests.", sourceIds: ["email-data-request-1", "teams-data-request-2"] },
  { name: "Strategic initiatives", description: "FY27 H1 operating priorities.", sourceIds: ["doc-operating-plan"] },
];
