import React, { useEffect, useState } from "react";
import { api, fmtDate, fmtDateTime, titleOf, type Epistemic, type EvidenceView, type Obj, type JournalEntry } from "../api";

export const EPISTEMIC_LABEL: Record<Epistemic, string> = {
  fact: "Fact", extracted_action: "Extracted action", recorded_decision: "Recorded decision",
  inference: "AI inference", recommendation: "AI recommendation", potential_escalation: "Potential escalation",
};
export const EPISTEMIC_HELP: Record<Epistemic, string> = {
  fact: "Explicitly supported by source material.",
  extracted_action: "An action explicitly requested or committed to in the evidence.",
  recorded_decision: "A decision clearly recorded in the evidence.",
  inference: "Something the system inferred from one or more signals. Not a fact.",
  recommendation: "Proposed by the system for you to accept, modify or dismiss. Not a decision.",
  potential_escalation: "The system believes leadership attention may be needed.",
};

export function Badge({ e }: { e: Epistemic }) {
  return <span className={`badge ${e}`} title={EPISTEMIC_HELP[e]}>{EPISTEMIC_LABEL[e]}</span>;
}
export function StatusBadge({ s }: { s?: string }) {
  if (!s) return null;
  return <span className={`badge neutral status-${s}`}>{s.replace(/_/g, " ")}</span>;
}
export function Confidence({ v }: { v: number }) {
  return <span title={`Confidence ${(v * 100).toFixed(0)}%`} className="row" style={{ gap: 6 }}><span className="conf"><i style={{ width: `${Math.round(v * 100)}%` }} /></span><span className="small muted">{(v * 100).toFixed(0)}%</span></span>;
}

export function useApi<T>(path: string | null, deps: unknown[] = []): { data: T | undefined; error: string | undefined; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>(); const [error, setError] = useState<string>(); const [loading, setLoading] = useState(!!path); const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true; setLoading(true);
    api.get<T>(path).then((d) => { if (alive) { setData(d); setError(undefined); } }).catch((e) => alive && setError((e as Error).message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export function EvidenceCard({ e, showText = true }: { e: EvidenceView; showText?: boolean }) {
  const [open, setOpen] = useState(false);
  if (e.missing) return <div className="ev"><div className="h">{e.label}</div></div>;
  return (
    <div className="ev">
      <div className="h"><span>{e.label}{e.role === "contradicts" ? " · conflicts" : ""}</span><small>{e.provider_id}</small></div>
      <div className="small">{e.title}{e.participants?.length ? <span className="muted"> · {e.participants.slice(0, 4).map((p) => p.name).join(", ")}</span> : null}</div>
      {e.excerpt && <blockquote>“{e.excerpt}”</blockquote>}
      <div className="row" style={{ marginTop: 6 }}>
        {showText && e.text && <button className="btn link sm" onClick={() => setOpen((o) => !o)}>{open ? "Hide source text" : "Show source text"}</button>}
        {e.open_url ? <a className="btn link sm" href={e.open_url} target="_blank" rel="noreferrer">Open source ↗</a> : <span className="small muted">No link supplied by source</span>}
      </div>
      {open && e.text && <pre>{e.text}</pre>}
    </div>
  );
}

/** "Why am I seeing this?" — the mandatory provenance drawer. */
export function WhyDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const { data, error, reload } = useApi<{ type: string; object: Obj; why: { epistemic: Epistemic; confidence: number; reasoning?: string; rule?: string; first_seen?: string; last_observed?: string; origin?: string; evidence_summary: string[] }; related: Array<{ type: string; id: string; title: string }>; journal: JournalEntry[] }>(`/api/object/${id}`);
  useEffect(() => { const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const o = data?.object;
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Why am I seeing this">
        <button className="btn close" onClick={onClose}>Close</button>
        {error && <div className="notice err">{error}</div>}
        {o && data && (
          <>
            <div className="eyebrow">Why am I seeing this?</div>
            <h2>{titleOf(o)}</h2>
            <div className="row" style={{ marginTop: 6 }}><Badge e={data.why.epistemic} /><StatusBadge s={o.status} />{o.theme && <span className="badge neutral">{o.theme}</span>}<Confidence v={data.why.confidence} /></div>
            <p className="narrative" style={{ marginTop: 12 }}>{data.why.reasoning ?? o.description ?? "—"}</p>
            {data.why.epistemic === "recommendation" && <div className="notice warn">This is a proposal generated by the system{data.why.rule ? ` (rule ${data.why.rule})` : ""}. It is not an organizational decision until you accept it.</div>}
            {data.why.epistemic === "inference" && <div className="notice warn">This is an interpretation, not a stated fact. Check the evidence below before acting on it.</div>}
            <dl className="kv">
              {o.owner && <><dt>Owner</dt><dd>{o.owner}</dd></>}
              {o.decision_maker && <><dt>Decision maker</dt><dd>{o.decision_maker}</dd></>}
              {o.target_decision_maker && <><dt>Escalate to</dt><dd>{o.target_decision_maker}</dd></>}
              {o.due_at && <><dt>Due</dt><dd>{fmtDate(o.due_at)}</dd></>}
              {o.needed_by && <><dt>Needed by</dt><dd>{fmtDate(o.needed_by)}</dd></>}
              {o.decision_date && <><dt>Decided</dt><dd>{fmtDate(o.decision_date)}</dd></>}
              {o.rationale && <><dt>Rationale</dt><dd>{o.rationale}</dd></>}
              {o.alternatives && o.alternatives.length > 0 && <><dt>Alternatives</dt><dd>{o.alternatives.join(" · ")}</dd></>}
              {o.suggested_next_step && <><dt>Suggested next step</dt><dd>{o.suggested_next_step}</dd></>}
              {o.recommended_resolution && <><dt>Suggested resolution</dt><dd>{o.recommended_resolution}</dd></>}
              {o.stakeholders && o.stakeholders.length > 0 && <><dt>Stakeholders</dt><dd>{o.stakeholders.join(", ")}</dd></>}
              <dt>First detected</dt><dd>{fmtDateTime(data.why.first_seen)}</dd>
              <dt>Last observed</dt><dd>{fmtDateTime(data.why.last_observed)}</dd>
              {o.mention_count !== undefined && <><dt>Mentions</dt><dd>{o.mention_count} evidence item(s)</dd></>}
              {data.why.origin && <><dt>Origin</dt><dd>{data.why.origin.replace(/_/g, " ")}</dd></>}
            </dl>
            <FeedbackBar type={data.type} obj={o} onDone={() => { reload(); onChanged?.(); }} />
            <div className="section"><div className="section-head"><h2>Supporting evidence ({o.evidence_details.length})</h2></div>
              {o.evidence_details.length === 0 && <div className="empty">No evidence linked.</div>}
              {o.evidence_details.map((e) => <EvidenceCard key={e.evidence_id} e={e} />)}
            </div>
            {data.related.length > 0 && <div className="section"><div className="section-head"><h2>Related items (share evidence)</h2></div><ul className="small">{data.related.map((r) => <li key={r.id}><span className="muted">{r.type}</span> · {r.title}</li>)}</ul></div>}
            <div className="section"><div className="section-head"><h2>History</h2></div>
              <div className="timeline">{data.journal.map((j) => <div key={j.id} className={`tl ${j.actor}`}><div className="small muted">{fmtDateTime(j.at)} · {j.actor}</div><div>{j.event.replace(/_/g, " ")}: {j.summary}</div></div>)}</div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

export function FeedbackBar({ type, obj, onDone }: { type: string; obj: Obj; onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  const send = async (kind: string, payload?: Record<string, unknown>) => {
    setBusy(true); setMsg(undefined);
    try { const r = await api.post<{ ok: boolean; message: string }>("/api/feedback", { object_type: type, object_id: obj.id, kind, payload }); setMsg(r.message); onDone(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const ask = (label: string, def = "") => window.prompt(label, def) ?? undefined;
  const done = ["completed", "resolved", "closed", "dismissed", "accepted", "modified"].includes(obj.status ?? "");
  return (
    <div className="card" style={{ padding: 12, marginTop: 10, background: "var(--surface-2)" }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Correct the system</div>
      <div className="chips">
        {type === "action" && <>
          <button className="chip" disabled={busy || done} onClick={() => send("mark_completed")}>Mark completed</button>
          <button className="chip" disabled={busy} onClick={() => { const o = ask("Who is the owner?", obj.owner ?? ""); if (o !== undefined) void send("wrong_owner", { owner: o }); }}>Wrong owner</button>
          <button className="chip" disabled={busy} onClick={() => send("not_an_action")}>Not an action</button>
          <button className="chip" disabled={busy || done} onClick={() => send("is_decision")}>This is a decision</button>
          <button className="chip" disabled={busy || done} onClick={() => { const r = ask("Why does this need escalation?"); if (r !== undefined) void send("escalate", { reason: r }); }}>Escalate</button>
          <button className="chip" disabled={busy} onClick={() => { const into = ask("Merge into which item id?"); if (into) void send("merge", { into }); }}>Merge duplicate</button>
        </>}
        {type === "decision" && <>
          <button className="chip" disabled={busy} onClick={() => send("set_status", { status: "recorded" })}>Mark as made</button>
          <button className="chip" disabled={busy} onClick={() => send("set_status", { status: "needed" })}>Still needed</button>
          <button className="chip" disabled={busy} onClick={() => send("not_important")}>Not important</button>
        </>}
        {type === "escalation" && <>
          <button className="chip" disabled={busy || done} onClick={() => send("escalate")}>Confirm escalation</button>
          <button className="chip" disabled={busy || done} onClick={() => send("resolve_escalation")}>Resolved</button>
          <button className="chip" disabled={busy} onClick={() => send("not_important")}>Not important</button>
        </>}
        {type === "risk" && <>
          <button className="chip" disabled={busy} onClick={() => send("set_status", { status: "mitigating" })}>Mitigating</button>
          <button className="chip" disabled={busy || done} onClick={() => send("mark_completed")}>Closed</button>
          <button className="chip" disabled={busy} onClick={() => { const o = ask("Who owns this risk?", obj.owner ?? ""); if (o !== undefined) void send("wrong_owner", { owner: o }); }}>Set owner</button>
          <button className="chip" disabled={busy} onClick={() => send("not_important")}>Not important</button>
        </>}
        {type === "recommendation" && <>
          <button className="chip on" disabled={busy || done} onClick={() => send("accept_recommendation")}>Accept → action</button>
          <button className="chip" disabled={busy || done} onClick={() => { const t = ask("Modify the recommendation text", obj.recommendation); if (t) void send("modify_recommendation", { text: t }); }}>Modify</button>
          <button className="chip" disabled={busy || done} onClick={() => { const r = ask("Why dismiss? (optional)"); void send("dismiss_recommendation", { reason: r ?? "" }); }}>Dismiss</button>
          <button className="chip" disabled={busy} onClick={() => send("hide_recommendation")}>Don't show again</button>
        </>}
        {(type === "data_request" || type === "signal") && <>
          {type === "data_request" && <button className="chip" disabled={busy} onClick={() => send("set_status", { status: "accepted" })}>Accept request</button>}
          {type === "data_request" && <button className="chip" disabled={busy} onClick={() => send("set_status", { status: "declined" })}>Decline</button>}
          <button className="chip" disabled={busy} onClick={() => send("not_important")}>Not important</button>
        </>}
      </div>
      {msg && <div className="small muted" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

export function ObjectItem({ o, type, onWhy, extra }: { o: Obj; type: string; onWhy: (id: string) => void; extra?: React.ReactNode }) {
  const due = o.due_at ?? o.needed_by;
  const overdue = due && due < new Date().toISOString() && !["completed", "dismissed", "recorded"].includes(o.status ?? "");
  return (
    <div className="item">
      <div>
        <div className="t">{titleOf(o)}</div>
        {(o.description || o.why_needed || o.reasoning) && <div className="d">{type === "recommendation" ? o.reasoning : (o.description || o.why_needed)}</div>}
        <div className="meta">
          <Badge e={o.epistemic} /><StatusBadge s={o.status} />
          {o.theme && <span>{o.theme}</span>}
          {(o.owner ?? o.decision_maker ?? o.suggested_owner) && <span>👤 {o.owner ?? o.decision_maker ?? o.suggested_owner}</span>}
          {due && <span style={overdue ? { color: "var(--err)", fontWeight: 650 } : undefined}>{overdue ? "Overdue · " : "Due "}{fmtDate(due)}</span>}
          {o.urgency && <span>urgency: {o.urgency}</span>}
          {o.mention_count !== undefined && o.mention_count > 1 && <span>{o.mention_count} mentions</span>}
          <span>{o.evidence_details?.length ?? o.evidence.length} evidence</span>
          <Confidence v={o.confidence} />
        </div>
        {extra}
      </div>
      <div className="actions"><button className="why" onClick={() => onWhy(o.id)}>Why am I seeing this?</button><span className="small muted">{fmtDate(o.last_observed)}</span></div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) { return <div className="empty">{children}</div>; }
export function Loading() { return <div className="muted small"><span className="spin" /> Loading…</div>; }
