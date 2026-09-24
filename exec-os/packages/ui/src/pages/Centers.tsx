import { useState } from "react";
import { type Obj } from "../api";
import { Empty, Loading, ObjectItem, useApi } from "../components/common";

function Center({ title, eyebrow, blurb, type, tabs, initial, onWhy, refreshKey, query }: { title: string; eyebrow: string; blurb: string; type: string; tabs: Array<{ key: string; label: string; status?: string; filter?: string }>; initial: string; onWhy: (id: string) => void; refreshKey: number; query?: string }) {
  const [tab, setTab] = useState(query && tabs.some((t) => t.key === query) ? query : initial);
  const t = tabs.find((x) => x.key === tab) ?? tabs[0]!;
  const qs = new URLSearchParams(); if (t.status) qs.set("status", t.status); if (t.filter) qs.set("filter", t.filter);
  const { data, loading, error } = useApi<Obj[]>(`/api/objects/${type}?${qs.toString()}`, [refreshKey]);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{blurb}</p></div></div>
      <div className="chips" style={{ marginBottom: 14 }}>{tabs.map((x) => <button key={x.key} className={`chip ${x.key === tab ? "on" : ""}`} onClick={() => setTab(x.key)}>{x.label}</button>)}</div>
      {error && <div className="notice err">{error}</div>}
      {loading && !data && <Loading />}
      <div className="list">
        {data && data.length === 0 && <Empty>Nothing here.</Empty>}
        {(data ?? []).map((o) => <ObjectItem key={o.id} o={o} type={type} onWhy={onWhy} />)}
      </div>
    </>
  );
}

export const Actions = (p: { onWhy: (id: string) => void; refreshKey: number; query?: string }) => (
  <Center {...p} type="action" title="Action center" eyebrow="Execute & learn" blurb="Commitments and requests tracked over time. Items stay visible until the evidence says they are done — or you say so." initial="all"
    tabs={[{ key: "all", label: "Open" }, { key: "mine", label: "Mine", filter: "mine" }, { key: "team", label: "My team", filter: "team" }, { key: "overdue", label: "Overdue", filter: "overdue" }, { key: "week", label: "This week", filter: "week" }, { key: "waiting", label: "Waiting", filter: "waiting" }, { key: "escalated", label: "Escalated", filter: "escalated" }, { key: "completed", label: "Completed", filter: "completed" }]} />
);
export const Decisions = (p: { onWhy: (id: string) => void; refreshKey: number; query?: string }) => (
  <Center {...p} type="decision" title="Decision center" eyebrow="Decide" blurb="Decisions recorded in evidence are kept apart from decisions the system believes are still needed. Leadership remains the decision maker." initial="needed"
    tabs={[{ key: "needed", label: "Decisions needed", status: "needed" }, { key: "pending", label: "Pending approvals", status: "pending_approval" }, { key: "made", label: "Decisions made", status: "recorded" }, { key: "superseded", label: "Superseded", status: "superseded" }]} />
);
export const Escalations = (p: { onWhy: (id: string) => void; refreshKey: number; query?: string }) => (
  <Center {...p} type="escalation" title="Escalation center" eyebrow="Intervene" blurb="Potential escalations are the system's judgement that leadership attention may be needed; active ones are confirmed by you. Every item shows why it was surfaced." initial="potential"
    tabs={[{ key: "potential", label: "Potential", status: "potential" }, { key: "active", label: "Active", status: "active" }, { key: "resolved", label: "Resolved", status: "resolved,dismissed" }]} />
);
export const Risks = (p: { onWhy: (id: string) => void; refreshKey: number; query?: string }) => (
  <Center {...p} type="risk" title="Risks" eyebrow="Monitor" blurb="Risks observed in evidence or inferred from patterns, with trend and ownership." initial="open"
    tabs={[{ key: "open", label: "Open", status: "open" }, { key: "mitigating", label: "Mitigating", status: "mitigating" }, { key: "closed", label: "Closed", status: "closed" }]} />
);
export const Recommendations = (p: { onWhy: (id: string) => void; refreshKey: number; query?: string }) => (
  <Center {...p} type="recommendation" title="Recommendations" eyebrow="Decide" blurb="Proposals with reasoning, evidence and confidence. Accept turns one into a tracked action; nothing becomes a commitment silently." initial="proposed"
    tabs={[{ key: "proposed", label: "Proposed", status: "proposed" }, { key: "accepted", label: "Accepted", status: "accepted,modified" }, { key: "dismissed", label: "Dismissed", status: "dismissed" }]} />
);
export const DataRequests = (p: { onWhy: (id: string) => void; refreshKey: number; query?: string }) => (
  <Center {...p} type="data_request" title="Data & analytics requests" eyebrow="Sense" blurb="Requests that appear to need new analysis, metrics, dashboards, data pulls, experiments or forecasting. Identified, not accepted, until you say so." initial="identified"
    tabs={[{ key: "identified", label: "Identified", status: "identified" }, { key: "accepted", label: "Accepted", status: "accepted" }, { key: "declined", label: "Declined", status: "declined" }]} />
);
