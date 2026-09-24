/**
 * Synthetic organization: "Northwind Cloud Support" (fictional).
 * Every person, customer, number and message here is invented for demos and tests.
 * Dates are relative to "now" so the demo always looks current.
 */
import type { Participant, SourceType } from "../../domain/index.js";

export interface MockItem {
  id: string;                 // stable source id (used by fixtures)
  type: SourceType;
  daysAgo: number;            // fractional days allowed
  title: string;
  participants: Participant[];
  thread?: string;
  text: string;
  structured?: Record<string, unknown>;
  url?: string;               // only where a real system would supply one (kept undefined for mock)
}

export const PEOPLE = {
  me: { name: "Alex Rivera", email: "alex.rivera@northwind.example", role: "General Manager, Cloud Support" },
  vp: { name: "Jordan Lee", email: "jordan.lee@northwind.example", role: "Vice President, Support" },
  finance: { name: "Priya Natarajan", email: "priya.natarajan@northwind.example", role: "Finance partner" },
  forecast: { name: "Marcus Chen", email: "marcus.chen@northwind.example", role: "Forecasting & Capacity lead" },
  eng: { name: "Dana Okafor", email: "dana.okafor@northwind.example", role: "Engineering lead" },
  people: { name: "Samir Haddad", email: "samir.haddad@northwind.example", role: "HR partner" },
  cs: { name: "Lena Fischer", email: "lena.fischer@northwind.example", role: "Customer Success lead" },
  data: { name: "Tom Alvarez", email: "tom.alvarez@northwind.example", role: "Data & Analytics lead" },
  ai: { name: "Kai Nakamura", email: "kai.nakamura@northwind.example", role: "AI program lead" },
  vendor: { name: "Riley Morgan", email: "riley.morgan@northwind.example", role: "Vendor management" },
} satisfies Record<string, Participant>;

const P = PEOPLE;

export const ITEMS: MockItem[] = [
  /* ------------------------------------------------------------------ */
  /* Operating context document                                          */
  /* ------------------------------------------------------------------ */
  {
    id: "doc-operating-plan", type: "document", daysAgo: 60, title: "FY27 H1 Operating Plan — Cloud Support.md",
    participants: [P.me],
    text: `# FY27 H1 Operating Plan — Cloud Support
Priorities (agreed with Jordan Lee):
1. Protect customer SLA attainment (target 94% P1 within-SLA).
2. Re-baseline the volume forecast and align capacity (Tier-1/Tier-2) to it.
3. Land the AI deflection program (Automation Scout) to 18% self-serve deflection.
4. Hold FY27 H1 spend to the approved budget envelope.
5. Retain critical talent; attrition below 9% annualized.
Terminology: MOR = monthly operations review; ROB = rhythm of business; GVSA = global vendor service agreement.`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 2: repeated, unresolved commitment (forecast re-baseline)  */
  /* ------------------------------------------------------------------ */
  {
    id: "teams-forecast-01", type: "teams_thread", daysAgo: 25, title: "Capacity planning — forecast re-baseline", thread: "thr-forecast",
    participants: [P.forecast, P.me, P.finance],
    text: `Marcus Chen: Given the Q2 actuals, the current H1 volume forecast is stale. I will deliver a re-baselined H1 volume forecast by the 15th so Finance can rerun the capacity model.
Alex Rivera: Thanks Marcus — that unblocks the Tier-2 hiring question too.
Priya Natarajan: Noted. Capacity model rerun is blocked until we have it.`,
  },
  {
    id: "email-forecast-02", type: "email", daysAgo: 18, title: "RE: Forecast re-baseline — status", thread: "thr-forecast-mail",
    participants: [P.forecast, P.me],
    text: `Alex — quick status: the re-baselined forecast is about 70% done. Data Platform API changes slowed the volume pull. Still targeting the 15th. — Marcus`,
  },
  {
    id: "meeting-mor-03", type: "meeting", daysAgo: 12, title: "Monthly Operations Review (MOR) — notes", thread: "mtg-mor",
    participants: [P.me, P.vp, P.forecast, P.finance, P.eng, P.cs],
    text: `MOR notes.
- Forecast: Marcus reported the re-baselined H1 volume forecast is still pending; new ETA end of next week. Jordan asked for a firm date.
- Budget: Priya walked through the FY27 H1 envelope; a reduction has been signalled by corporate (see Priya's mail).
- Decision recorded: Jordan Lee confirmed the Tier-2 hiring plan for Q3 is paused until the forecast is re-baselined.
- Customer: Lena flagged Contoso Retail P1 backlog waiting on an engineering fix.
- Action: Dana to ship the ticket-routing hotfix by end of week.`,
  },
  {
    id: "teams-forecast-04", type: "teams_message", daysAgo: 5, title: "Capacity planning — forecast re-baseline", thread: "thr-forecast",
    participants: [P.finance, P.forecast],
    text: `Priya Natarajan: Marcus — any update on the re-baselined forecast? We are now 10 days past the original date and I cannot rerun the capacity model without it.`,
  },
  {
    id: "teams-forecast-05", type: "teams_message", daysAgo: 1.2, title: "Capacity planning — forecast re-baseline", thread: "thr-forecast",
    participants: [P.vp, P.forecast, P.me],
    text: `Jordan Lee: I need the re-baselined forecast before the QBR. Alex, can you make sure this lands this week?`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 1: recorded decision (Tier-2 hiring pause)                 */
  /* ------------------------------------------------------------------ */
  {
    id: "email-decision-hiring", type: "email", daysAgo: 20, title: "Decision: Tier-2 hiring plan paused for Q3", thread: "thr-hiring",
    participants: [P.vp, P.me, P.finance, P.people],
    text: `Team — after reviewing the Q2 actuals with Finance, I have decided to pause the Tier-2 hiring plan for Q3 until the volume forecast is re-baselined. Rationale: we do not want to add fixed cost against a forecast we do not trust. Alternatives considered: proceed with half the reqs; convert reqs to contractors. We will revisit once Marcus delivers the new forecast. — Jordan`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 4: conflicting information (budget cut 8% vs 12%)          */
  /* ------------------------------------------------------------------ */
  {
    id: "email-budget-priya", type: "email", daysAgo: 14, title: "FY27 H1 budget envelope — corporate guidance", thread: "thr-budget",
    participants: [P.finance, P.me],
    text: `Alex — corporate guidance for FY27 H1 is an 8% reduction to our opex envelope versus plan. I will bring options to the MOR. Please do not communicate a number broadly until Jordan confirms. — Priya`,
  },
  {
    id: "teams-budget-jordan", type: "teams_message", daysAgo: 9, title: "Leadership team chat", thread: "thr-lt",
    participants: [P.vp, P.me, P.finance],
    text: `Jordan Lee: Heads up — the budget conversation with corporate landed at a 12% reduction for H1, not 8%. Priya, please reconcile with your model and come back with the gap.`,
  },
  {
    id: "teams-budget-priya-2", type: "teams_message", daysAgo: 3, title: "Leadership team chat", thread: "thr-lt",
    participants: [P.finance, P.vp, P.me],
    text: `Priya Natarajan: Reconciling now. The delta between 8% and 12% is roughly the contractor surge line. Will need a decision on the contractor request before I can close the model.`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 10: decision needed (approve 6 contractors)                */
  /* ------------------------------------------------------------------ */
  {
    id: "email-contractors", type: "email", daysAgo: 8, title: "Approval needed: 6 contractors for Q3 surge", thread: "thr-contractors",
    participants: [P.forecast, P.me, P.finance],
    text: `Alex — with Tier-2 hiring paused, I am requesting approval for 6 contractors for the Q3 volume surge (12 weeks). Cost is within the surge line Priya has modelled. I need your sign-off by the 30th so Riley can execute under the GVSA. — Marcus`,
  },
  {
    id: "teams-contractors-2", type: "teams_message", daysAgo: 2, title: "Leadership team chat", thread: "thr-lt",
    participants: [P.vendor, P.me],
    text: `Riley Morgan: Alex, the GVSA order for the 6 contractors is drafted and waiting on your approval. Vendor lead time is 3 weeks, so any delay pushes start dates into the surge.`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 3: escalation (Contoso Retail SLA breach)                  */
  /* ------------------------------------------------------------------ */
  {
    id: "email-contoso-1", type: "email", daysAgo: 4, title: "Contoso Retail — P1 backlog and SLA exposure", thread: "thr-contoso",
    participants: [P.cs, P.me, P.eng],
    text: `Alex — Contoso Retail has 3 P1 tickets open for more than 9 days, all waiting on the same engineering fix (routing service memory leak). We have breached SLA on two of them. The account team is asking for an executive call. I think this needs escalation to Engineering leadership because it is blocked outside our org. — Lena`,
  },
  {
    id: "teams-contoso-2", type: "teams_message", daysAgo: 2.5, title: "Customer escalations", thread: "thr-esc",
    participants: [P.cs, P.eng, P.me],
    text: `Lena Fischer: Contoso called again. Dana, is there an ETA on the routing fix? If not by Friday I recommend Alex raises it with Jordan.
Dana Okafor: The fix is in review; ETA is Thursday but it depends on the Data Platform API team for the deploy window.`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 6: completed action (routing hotfix)                       */
  /* ------------------------------------------------------------------ */
  {
    id: "teams-hotfix-1", type: "teams_message", daysAgo: 11, title: "Engineering channel", thread: "thr-eng",
    participants: [P.eng, P.me],
    text: `Dana Okafor: Confirming I will ship the ticket-routing hotfix by end of this week, as discussed in the MOR.`,
  },
  {
    id: "teams-hotfix-2", type: "teams_message", daysAgo: 6, title: "Engineering channel", thread: "thr-eng",
    participants: [P.eng, P.me, P.cs],
    text: `Dana Okafor: Ticket-routing hotfix shipped to production this morning. Closing the action from the MOR. Note this does NOT address the memory leak behind the Contoso P1s — that is a separate fix.`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 5: repeated cross-team dependency (Data Platform API)      */
  /* ------------------------------------------------------------------ */
  {
    id: "teams-dep-ai", type: "teams_message", daysAgo: 9, title: "Automation Scout program", thread: "thr-ai",
    participants: [P.ai, P.me],
    text: `Kai Nakamura: Automation Scout deflection rollout slipped a week. The Data Platform API team has not given us a date for the events endpoint. Nobody on their side owns our request.`,
  },
  {
    id: "email-dep-data", type: "email", daysAgo: 6, title: "Backlog analytics blocked on Data Platform API", thread: "thr-dep",
    participants: [P.data, P.me],
    text: `Alex — the backlog aging analysis is blocked: the Data Platform API changed its schema without notice and there is no named owner for support-org requests. Third time this quarter. — Tom`,
  },
  {
    id: "teams-dep-eng", type: "teams_message", daysAgo: 2.5, title: "Engineering channel", thread: "thr-eng",
    participants: [P.eng],
    text: `Dana Okafor: FYI the Contoso fix deploy window also depends on Data Platform API. We really need a single owner for that dependency.`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 7: forecast change (metrics)                               */
  /* ------------------------------------------------------------------ */
  ...[8, 7, 6, 5, 4, 3, 2, 1].map((w) => ({
    id: `metric-volume-w${w}`, type: "metric" as SourceType, daysAgo: w * 7 - 0.5,
    title: "Weekly case volume", participants: [], thread: "pbi-volume",
    text: `Weekly case volume: ${[9800, 9900, 9850, 10100, 10250, 10600, 11050, 11300][8 - w]} cases (Power BI: Support Ops dashboard).`,
    structured: { metric: "weekly_case_volume", value: [9800, 9900, 9850, 10100, 10250, 10600, 11050, 11300][8 - w], unit: "cases", dashboard: "Support Ops", week_offset: -w },
  })),
  ...[4, 3, 2, 1].map((w) => ({
    id: `metric-sla-w${w}`, type: "metric" as SourceType, daysAgo: w * 7 - 0.4,
    title: "P1 within-SLA attainment", participants: [], thread: "pbi-sla",
    text: `P1 within-SLA attainment: ${[93.5, 92.8, 91.9, 90.6][4 - w]}% (target 94%).`,
    structured: { metric: "p1_sla_attainment", value: [93.5, 92.8, 91.9, 90.6][4 - w], unit: "%", target: 94, week_offset: -w },
  })),

  /* ------------------------------------------------------------------ */
  /* Scenario 8: emerging theme (vendor transition)                      */
  /* ------------------------------------------------------------------ */
  {
    id: "email-vendor-1", type: "email", daysAgo: 6, title: "Heads-up: Meridian outsourcing contract renewal", thread: "thr-vendor",
    participants: [P.vendor, P.me],
    text: `Alex — Meridian (our Tier-1 outsourcing partner) signalled a 15% rate increase at renewal in November. Procurement wants us to evaluate a transition to a second vendor under the GVSA. This would be a significant change for Tier-1 coverage. — Riley`,
  },
  {
    id: "teams-vendor-2", type: "teams_message", daysAgo: 3.5, title: "Leadership team chat", thread: "thr-lt",
    participants: [P.vendor, P.people, P.me],
    text: `Riley Morgan: Meridian renewal: procurement now wants a recommendation on vendor transition by the QBR.
Samir Haddad: A transition would also affect the 40 Meridian-badged agents' onboarding and knowledge transfer; we should model the attrition risk.`,
  },
  {
    id: "meeting-vendor-3", type: "meeting", daysAgo: 1.5, title: "Vendor strategy sync — notes", thread: "mtg-vendor",
    participants: [P.me, P.vendor, P.finance],
    text: `Vendor strategy sync. Options discussed: (a) renew Meridian at +15%; (b) dual-vendor under the GVSA; (c) insource 20 seats. No decision. Priya to cost options (a)-(c) before the QBR. Riley to request a Meridian counter-proposal.`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 14: people risk                                            */
  /* ------------------------------------------------------------------ */
  {
    id: "email-attrition", type: "email", daysAgo: 7, title: "Tier-1 attrition — 4 resignations in 3 weeks", thread: "thr-people",
    participants: [P.people, P.me],
    text: `Alex — we have had 4 resignations in the Tier-1 team in 3 weeks (annualized ~11%, above the 9% target). Exit interviews cite shift schedules and the hiring pause creating uncertainty. I recommend a retention conversation with the top 10 critical-skill agents. — Samir`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 9: data / analytics requests                               */
  /* ------------------------------------------------------------------ */
  {
    id: "email-data-request-1", type: "email", daysAgo: 10, title: "Request: backlog aging dashboard by tier", thread: "thr-data",
    participants: [P.vp, P.me, P.data],
    text: `Alex / Tom — for the QBR I would like a Power BI dashboard showing backlog aging by tier and by customer segment, refreshed weekly. Can the data team scope it? — Jordan`,
  },
  {
    id: "teams-data-request-2", type: "teams_message", daysAgo: 4, title: "Automation Scout program", thread: "thr-ai",
    participants: [P.ai, P.data],
    text: `Kai Nakamura: Tom, can your team run an analysis of Automation Scout deflection impact on Tier-1 volume so we can validate the 18% target? Ideally before the MOR.`,
  },

  /* ------------------------------------------------------------------ */
  /* Scenario 13: daily — new since yesterday                            */
  /* ------------------------------------------------------------------ */
  {
    id: "email-decision-hemingway", type: "email", daysAgo: 0.8, title: "Decision: adopt Hemingway summaries for customer comms", thread: "thr-comms",
    participants: [P.me, P.cs, P.vp],
    text: `Team — following last week's review, we have decided to adopt the Hemingway summary format for all executive customer communications starting next month. Lena owns the rollout. — Alex`,
  },
  {
    id: "teams-contoso-3", type: "teams_message", daysAgo: 0.4, title: "Customer escalations", thread: "thr-esc",
    participants: [P.cs, P.me],
    text: `Lena Fischer: Contoso's CIO emailed their account exec overnight asking for a leadership call this week. We need a position on the routing fix ETA before we respond.`,
  },

  /* ------------------------------------------------------------------ */
  /* Upcoming calendar                                                   */
  /* ------------------------------------------------------------------ */
  {
    id: "cal-1on1-jordan", type: "calendar_event", daysAgo: -2, title: "1:1 — Alex / Jordan", participants: [P.me, P.vp],
    text: "1:1 with Jordan Lee. Agenda placeholder: forecast, contractors approval, Contoso.", structured: { starts_in_days: 2, duration_min: 30 },
  },
  {
    id: "cal-qbr-prep", type: "calendar_event", daysAgo: -5, title: "QBR preparation — leadership team", participants: [P.me, P.vp, P.finance, P.forecast, P.cs],
    text: "Quarterly business review preparation.", structured: { starts_in_days: 5, duration_min: 90 },
  },
  {
    id: "cal-mor-next", type: "calendar_event", daysAgo: -9, title: "Monthly Operations Review (MOR)", participants: [P.me, P.vp, P.finance, P.forecast, P.eng, P.cs],
    text: "Monthly operations review.", structured: { starts_in_days: 9, duration_min: 60 },
  },
];
