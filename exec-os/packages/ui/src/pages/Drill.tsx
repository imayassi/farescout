/**
 * Drill-down navigation: Executive → Bucket → Item → Evidence.
 * Every tile, count and row is clickable and takes you one level deeper.
 */
import { useState } from "react";
import { fmtDate, fmtDateTime, titleOf, type Epistemic, type EvidenceView, type JournalEntry, type Obj } from "../api";
import { Badge, Confidence, Empty, FeedbackBar, Loading, StatusBadge, useApi } from "../components/common";
import { DataRequestForm, type DrTarget } from "../components/DataRequestForm";
import { AddDrawer, BucketDrawer, EditDrawer } from "../components/EditDrawer";
import { PlaybookPanel } from "../components/Playbook";
import { api } from "../api";

interface Bucket { id: string; name: string; description: string; pinned: boolean; discovered: boolean; what_changed: string; current_state: string; confidence: number; counts: Record<string, number>; derived_from: { evidence: number; source_types: string[] }; attention: { overdue: number; decisions_needed: number; escalations: number; open_requests: number }; playbook?: { version: number; status: string; basis: string; user_adjusted: boolean; cadence: string; owner?: string } | null }
interface Exec { generated_at?: string; narrative?: string; coverage?: { incomplete: boolean; reasons: string[] }; backend: { name: string; degraded: boolean }; attention: { decisions_needed: Obj[]; escalations: Obj[]; overdue_actions: Obj[]; recommendations: Obj[]; open_data_requests: Obj[] }; buckets: Bucket[]; metrics: Obj[]; upcoming: EvidenceView[]; data_request_endpoint: string | null }

export interface DrillNav { openBucket: (id: string) => void; openItem: (id: string) => void; openEvidence: (id: string) => void }

const TYPE_LABEL: Record<string, string> = { decision: "Decisions", action: "Actions & commitments", escalation: "Escalations", risk: "Risks", recommendation: "Recommendations", data_request: "Data requests", signal: "Signals", metric: "Metrics" };

function RowTools({ onEdit, onRemove }: { onEdit?: () => void; onRemove?: () => void }) {
  return <span className="rowtools" onClick={(e) => e.stopPropagation()}>{onEdit && <button title="Adjust" onClick={onEdit}>✎ adjust</button>}{onRemove && <button title="Remove from this tab" onClick={onRemove}>✕ remove</button>}</span>;
}

function Row({ o, type, onClick, onEdit, onRemove }: { o: Obj; type: string; onClick: () => void; onEdit?: () => void; onRemove?: () => void }) {
  const due = o.due_at ?? o.needed_by; const overdue = due && due < new Date().toISOString() && !["completed", "dismissed", "recorded"].includes(o.status ?? "");
  return (
    <div className="item" style={{ cursor: "pointer" }} onClick={onClick} role="link">
      <div><div className="t">{titleOf(o)}</div>
        {(o.description || o.why_needed || o.reasoning) && <div className="d">{type === "recommendation" ? o.reasoning : (o.description || o.why_needed)}</div>}
        <div className="meta"><Badge e={o.epistemic} /><StatusBadge s={o.status} />{o.theme && <span>{o.theme}</span>}{(o.owner ?? o.decision_maker ?? o.suggested_owner) && <span>👤 {o.owner ?? o.decision_maker ?? o.suggested_owner}</span>}{due && <span style={overdue ? { color: "var(--err)", fontWeight: 650 } : undefined}>{overdue ? "Overdue · " : "Due "}{fmtDate(due)}</span>}{o.delivery && <span>delivery: {(o.delivery as { status: string }).status.replace("_", " ")}</span>}<span>{o.evidence_details?.length ?? o.evidence.length} evidence</span>{typeof o.confidence === "number" && <Confidence v={o.confidence} />}</div></div>
      <div className="actions"><span className="btn link sm">Open →</span><span className="small muted">{fmtDate(o.last_observed ?? o.updated_at)}</span><RowTools onEdit={onEdit} onRemove={onRemove} /></div>
    </div>
  );
}

/** Shared edit-loop state for a tab: which drawer is open, and a remove helper. */
function useTabEdits(onChanged: () => void) {
  const [edit, setEdit] = useState<{ type: string; obj: Obj }>();
  const [add, setAdd] = useState<{ themeId?: string } | undefined>();
  const [bucketDrawer, setBucketDrawer] = useState<{ theme?: { id: string; name: string; description: string; current_state?: string; what_changed?: string; pinned: boolean } } | undefined>();
  const remove = async (o: Obj) => {
    const reason = window.prompt(`Remove "${titleOf(o)}" from this tab? It will not come back on later syncs. Reason (optional):`, "");
    if (reason === null) return;
    try { await api.del(`/api/object/${o.id}?reason=${encodeURIComponent(reason)}`); onChanged(); } catch (e) { alert((e as Error).message); }
  };
  const removeBucket = async (b: { id: string; name: string }) => {
    if (!window.confirm(`Remove bucket "${b.name}" from the executive view? Its items stay in the store; the bucket will not be rediscovered.`)) return;
    try { await api.del(`/api/themes/${b.id}`); onChanged(); } catch (e) { alert((e as Error).message); }
  };
  const drawers = (
    <>
      {edit && <EditDrawer type={edit.type} obj={edit.obj} onClose={() => setEdit(undefined)} onSaved={onChanged} />}
      {add && <AddDrawer themeId={add.themeId} onClose={() => setAdd(undefined)} onSaved={onChanged} />}
      {bucketDrawer && <BucketDrawer theme={bucketDrawer.theme} onClose={() => setBucketDrawer(undefined)} onSaved={onChanged} />}
    </>
  );
  return { setEdit, setAdd, setBucketDrawer, remove, removeBucket, drawers };
}

/* ------------------------------ Level 1: Executive ------------------------------ */
export function ExecutiveTab({ nav, refreshKey, onChanged }: { nav: DrillNav; refreshKey: number; onChanged: () => void }) {
  const { data, loading, error } = useApi<Exec>("/api/exec", [refreshKey]);
  const [focus, setFocus] = useState<keyof Exec["attention"] | null>(null);
  const ed = useTabEdits(onChanged);
  if (error) return <div className="notice err">{error}</div>;
  if (!data) return loading ? <Loading /> : null;
  const tiles: Array<[keyof Exec["attention"], string, boolean]> = [["decisions_needed", "decisions need you", true], ["escalations", "escalations", true], ["overdue_actions", "overdue commitments", true], ["recommendations", "recommendations", false], ["open_data_requests", "open data requests", false]];
  const focusList = focus ? data.attention[focus] : [];
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Level 1 · Executive</div><h1>Business at a glance</h1><p>{data.generated_at ? `Brief generated ${fmtDateTime(data.generated_at)}. ` : ""}Click a number to see the items behind it, or a bucket to drill into it.</p></div>
        <div className="tabtools"><button className="btn" onClick={() => ed.setBucketDrawer({})}>+ Add bucket</button><button className="btn" onClick={() => ed.setAdd({})}>+ Add item</button></div></div>
      {data.coverage?.incomplete && <div className="notice warn" style={{ marginBottom: 12 }}>Coverage incomplete: {data.coverage.reasons.join(" · ")}</div>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(5, minmax(0,1fr))" }}>
        {tiles.map(([k, label, hot]) => <div key={k} className={`card stat ${hot && data.attention[k].length ? "hot" : ""}`} style={{ cursor: "pointer", outline: focus === k ? "2px solid var(--accent)" : undefined }} onClick={() => setFocus(focus === k ? null : k)}><span className="n">{data.attention[k].length}</span><span className="l">{label} →</span></div>)}
      </div>
      {focus && <div className="section"><div className="section-head"><h2>{tiles.find((t) => t[0] === focus)![1]}</h2><button className="btn link sm" onClick={() => setFocus(null)}>collapse</button></div>
        <div className="list">{focusList.length === 0 && <Empty>Nothing here.</Empty>}{focusList.map((o) => { const t = focus === "decisions_needed" ? "decision" : focus === "escalations" ? "escalation" : focus === "overdue_actions" ? "action" : focus === "recommendations" ? "recommendation" : "data_request"; return <Row key={o.id} o={o} type={t} onClick={() => nav.openItem(o.id)} onEdit={() => ed.setEdit({ type: t, obj: o })} onRemove={() => ed.remove(o)} />; })}</div></div>}
      {data.narrative && <div className="card section"><div className="eyebrow">Narrative</div><p className="narrative" style={{ margin: "6px 0 0" }}>{data.narrative}</p></div>}
      <div className="section"><div className="section-head"><h2>Buckets</h2><span className="small muted">derived from evidence across your sources{data.buckets.some((b) => b.pinned) ? "; pinned buckets come from your configuration" : ""}</span></div>
        <div className="grid grid-3">
          {data.buckets.map((b) => (
            <div key={b.id} className="card theme-card" onClick={() => nav.openBucket(b.id)}>
              <div className="row" style={{ justifyContent: "space-between" }}><h2>{b.name}</h2><span className="row" style={{ gap: 6 }}>{b.pinned ? <span className="badge neutral">pinned</span> : <span className="badge inference">discovered</span>}<RowTools onEdit={() => ed.setBucketDrawer({ theme: b })} onRemove={() => ed.removeBucket(b)} /></span></div>
              <div className="small muted">{b.description || "—"}</div>
              {b.playbook ? <div className="small"><span className={`badge ${b.playbook.basis === "history" ? "fact" : "inference"}`}>playbook v{b.playbook.version} · {b.playbook.basis}</span>{b.playbook.owner && <span className="muted"> · {b.playbook.owner} · {b.playbook.cadence}</span>}</div> : <div className="small muted">playbook: generated on next sync</div>}
              <div className="small"><b>Changed:</b> {b.what_changed || "—"}</div>
              <div className="small"><b>State:</b> {b.current_state}</div>
              <div className="counts">
                {b.attention.decisions_needed > 0 && <span className="badge status-needed">{b.attention.decisions_needed} decision{b.attention.decisions_needed > 1 ? "s" : ""} needed</span>}
                {b.attention.overdue > 0 && <span className="badge status-blocked">{b.attention.overdue} overdue</span>}
                {b.attention.escalations > 0 && <span className="badge potential_escalation">{b.attention.escalations} escalation{b.attention.escalations > 1 ? "s" : ""}</span>}
                {b.attention.open_requests > 0 && <span className="badge neutral">{b.attention.open_requests} data request{b.attention.open_requests > 1 ? "s" : ""}</span>}
                <span className="badge neutral">{b.derived_from.evidence} evidence · {b.derived_from.source_types.map((s) => s.replace("_", " ")).join(", ") || "no sources yet"}</span>
              </div>
            </div>
          ))}
          {data.buckets.length === 0 && <Empty>No buckets yet — run a sync from Sources.</Empty>}
        </div>
      </div>
      <div className="grid grid-2 section">
        <div><div className="section-head"><h2>Metrics</h2></div><div className="grid grid-2">{data.metrics.map((m) => <div key={m.id} className="card stat" style={{ cursor: "pointer" }} onClick={() => nav.openItem(m.id)}><span className="n" style={{ fontSize: 26 }}>{m.value}{m.unit === "%" ? "%" : ""}</span><span className="l">{titleOf(m)}{m.delta !== undefined && <b style={{ color: m.delta > 0 ? "var(--err)" : "var(--ok)", marginLeft: 6 }}>{m.delta > 0 ? "▲" : "▼"} {(Math.abs(m.delta) * 100).toFixed(1)}%</b>} →</span></div>)}{data.metrics.length === 0 && <Empty>No metrics.</Empty>}</div></div>
        <div><div className="section-head"><h2>Upcoming</h2></div><div className="list">{data.upcoming.map((u) => <div key={u.evidence_id} className="item" style={{ cursor: "pointer" }} onClick={() => nav.openEvidence(u.evidence_id)}><div><div className="t">{u.title}</div><div className="meta"><span>{new Date(u.occurred_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><span>{u.participants.length} attendees</span></div></div><div className="actions"><span className="btn link sm">Open →</span></div></div>)}{data.upcoming.length === 0 && <Empty>Nothing scheduled.</Empty>}</div></div>
      </div>
      {ed.drawers}
    </>
  );
}

/* ------------------------------ Level 2: Bucket ------------------------------ */
export function BucketTab({ id, nav, refreshKey, endpoint, onChanged }: { id: string; nav: DrillNav; refreshKey: number; endpoint: string | null; onChanged: () => void }) {
  const { data, loading, error } = useApi<{ theme: Bucket & { evidence: unknown[] }; objects: Record<string, Obj[]>; evidence: EvidenceView[]; journal: JournalEntry[] }>(`/api/themes/${id}`, [refreshKey]);
  const [form, setForm] = useState<DrTarget>();
  const ed = useTabEdits(onChanged);
  const excludeEv = async (e: EvidenceView) => {
    const reason = window.prompt(`Exclude "${e.title}" from analysis? It is unlinked from every item and never re-ingested. Reason (optional):`, "");
    if (reason === null) return;
    try { await api.post(`/api/evidence/${e.evidence_id}/exclude`, { reason }); onChanged(); } catch (x) { alert((x as Error).message); }
  };
  if (error) return <div className="notice err">{error}</div>;
  if (!data) return loading ? <Loading /> : null;
  const t = data.theme;
  const sources = [...new Set(data.evidence.map((e) => e.source_type.replace("_", " ")))];
  const order = ["decision", "escalation", "action", "risk", "recommendation", "data_request", "signal", "metric"];
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Level 2 · Bucket {t.pinned ? "· pinned" : "· discovered from evidence"}</div><h1>{t.name}</h1><p>{t.description}</p><div className="small muted">Derived from {data.evidence.length} evidence item{data.evidence.length === 1 ? "" : "s"} across {sources.join(", ") || "no sources yet"}.</div></div>
        <div className="tabtools"><button className="btn" onClick={() => ed.setBucketDrawer({ theme: t })}>✎ Adjust bucket</button><button className="btn" onClick={() => ed.setAdd({ themeId: t.id })}>+ Add item</button><button className="btn" onClick={() => ed.removeBucket(t)}>✕ Remove bucket</button><button className="btn primary" onClick={() => setForm({ scope: "bucket", theme_id: t.id, label: t.name })}>Request data for this bucket</button></div></div>
      <div className="grid grid-2"><div className="card"><div className="eyebrow">What changed (7 days)</div><p style={{ margin: "6px 0 0" }}>{t.what_changed || "No change recorded."}</p></div><div className="card"><div className="eyebrow">Current state</div><p style={{ margin: "6px 0 0" }}>{t.current_state}</p></div></div>
      <div className="section"><PlaybookPanel themeId={t.id} themeName={t.name} onEvidence={nav.openEvidence} onChanged={onChanged} /></div>
      {order.map((k) => (data.objects[k]?.length ?? 0) > 0 && (
        <div className="section" key={k}><div className="section-head"><h2>{TYPE_LABEL[k]}</h2><span className="small muted">{data.objects[k]!.length}</span></div><div className="list">{data.objects[k]!.map((o) => <Row key={o.id} o={o} type={k} onClick={() => nav.openItem(o.id)} onEdit={() => ed.setEdit({ type: k, obj: o })} onRemove={() => ed.remove(o)} />)}</div></div>
      ))}
      {order.every((k) => !(data.objects[k]?.length)) && <Empty>No tracked items in this bucket yet.</Empty>}
      <div className="section"><div className="section-head"><h2>Evidence behind this bucket</h2><span className="small muted">{data.evidence.length}</span></div>
        <div className="list">{data.evidence.slice(0, 30).map((e) => <div key={e.evidence_id} className="item" style={{ cursor: "pointer" }} onClick={() => nav.openEvidence(e.evidence_id)}><div><div className="t">{e.label} · {e.title}</div><div className="meta"><span>{e.provider_id}</span>{e.participants.length > 0 && <span>{e.participants.slice(0, 3).map((p) => p.name).join(", ")}</span>}</div></div><div className="actions"><span className="btn link sm">Open →</span><RowTools onRemove={() => excludeEv(e)} /></div></div>)}</div></div>
      {form && <DataRequestForm target={form} endpoint={endpoint} onClose={() => setForm(undefined)} onDone={onChanged} />}
      {ed.drawers}
    </>
  );
}

/* ------------------------------ Level 3: Item ------------------------------ */
export function ItemTab({ id, nav, refreshKey, endpoint, onChanged }: { id: string; nav: DrillNav; refreshKey: number; endpoint: string | null; onChanged: () => void }) {
  const { data, loading, error, reload } = useApi<{ type: string; object: Obj & { delivery?: { status: string; endpoint?: string; error?: string; external_id?: string }; scope?: string; notes?: string; priority?: string }; why: { epistemic: Epistemic; confidence: number; reasoning?: string; rule?: string; first_seen?: string; last_observed?: string; origin?: string }; related: Array<{ type: string; id: string; title: string }>; journal: JournalEntry[] }>(`/api/object/${id}`, [refreshKey]);
  const { data: reqs } = useApi<{ items: Obj[] }>(`/api/data-requests?object_id=${id}`, [refreshKey]);
  const [form, setForm] = useState<DrTarget>();
  const ed = useTabEdits(onChanged);
  const excludeEv = async (e: EvidenceView) => {
    const reason = window.prompt(`Exclude "${e.title}" from analysis? It is unlinked from every item and never re-ingested. Reason (optional):`, "");
    if (reason === null) return;
    try { await api.post(`/api/evidence/${e.evidence_id}/exclude`, { reason }); onChanged(); } catch (x) { alert((x as Error).message); }
  };
  if (error) return <div className="notice err">{error}</div>;
  if (!data) return loading ? <Loading /> : null;
  const o = data.object;
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Level 3 · {data.type.replace("_", " ")}{o.theme ? <> · <a href="#" onClick={(e) => { e.preventDefault(); if (o.theme_id) nav.openBucket(o.theme_id); }}>{o.theme}</a></> : null}</div><h1 style={{ fontSize: 24 }}>{titleOf(o)}</h1>
        <div className="row" style={{ marginTop: 6 }}><Badge e={data.why.epistemic} /><StatusBadge s={o.status} /><Confidence v={data.why.confidence} /></div></div>
        <div className="tabtools"><button className="btn" onClick={() => ed.setEdit({ type: data.type, obj: o })}>✎ Adjust</button><button className="btn" onClick={() => ed.remove(o)}>✕ Remove</button>{data.type !== "data_request" && <button className="btn primary" onClick={() => setForm({ scope: "item", object_id: o.id, theme_id: o.theme_id, label: titleOf(o) })}>Request data for this item</button>}</div></div>
      <div className="grid grid-2">
        <div className="card"><div className="eyebrow">Why am I seeing this?</div><p className="narrative" style={{ margin: "6px 0 0" }}>{data.why.reasoning ?? o.description ?? "—"}</p>
          {data.why.epistemic === "recommendation" && <div className="notice warn" style={{ marginTop: 8 }}>A proposal{data.why.rule ? ` (rule ${data.why.rule})` : ""}, not a decision, until you accept it.</div>}
          {data.why.epistemic === "inference" && <div className="notice warn" style={{ marginTop: 8 }}>An interpretation, not a stated fact. Check the evidence.</div>}
          <dl className="kv">
            {o.owner && <><dt>Owner</dt><dd>{o.owner}</dd></>}{o.decision_maker && <><dt>Decision maker</dt><dd>{o.decision_maker}</dd></>}{o.target_decision_maker && <><dt>Escalate to</dt><dd>{o.target_decision_maker}</dd></>}
            {o.requested_by && <><dt>Requested by</dt><dd>{o.requested_by}</dd></>}{o.scope && <><dt>Scope</dt><dd>{o.scope}</dd></>}{o.priority && <><dt>Priority</dt><dd>{o.priority}</dd></>}
            {(o.due_at ?? o.needed_by) && <><dt>Due</dt><dd>{fmtDate(o.due_at ?? o.needed_by)}</dd></>}{o.decision_date && <><dt>Decided</dt><dd>{fmtDate(o.decision_date)}</dd></>}
            {o.rationale && <><dt>Rationale</dt><dd>{o.rationale}</dd></>}{o.alternatives && o.alternatives.length > 0 && <><dt>Alternatives</dt><dd>{o.alternatives.join(" · ")}</dd></>}
            {o.suggested_next_step && <><dt>Next step</dt><dd>{o.suggested_next_step}</dd></>}{o.recommended_resolution && <><dt>Suggested resolution</dt><dd>{o.recommended_resolution}</dd></>}
            {o.notes && <><dt>Notes</dt><dd>{o.notes}</dd></>}
            {o.delivery && <><dt>Delivery</dt><dd>{o.delivery.status.replace("_", " ")}{o.delivery.endpoint ? ` → ${o.delivery.endpoint}` : ""}{o.delivery.external_id ? ` (ref ${o.delivery.external_id})` : ""}{o.delivery.error ? ` — ${o.delivery.error}` : ""}</dd></>}
            {o.stakeholders && o.stakeholders.length > 0 && <><dt>Stakeholders</dt><dd>{o.stakeholders.join(", ")}</dd></>}
            <dt>First detected</dt><dd>{fmtDateTime(data.why.first_seen)}</dd><dt>Last observed</dt><dd>{fmtDateTime(data.why.last_observed)}</dd>
            {o.mention_count !== undefined && <><dt>Mentions</dt><dd>{o.mention_count}</dd></>}{data.why.origin && <><dt>Origin</dt><dd>{data.why.origin.replace(/_/g, " ")}</dd></>}
          </dl>
          <FeedbackBar type={data.type} obj={o} onDone={() => { reload(); onChanged(); }} /></div>
        <div><div className="section-head"><h2>Evidence ({o.evidence_details.length})</h2></div>
          <div className="list">{o.evidence_details.length === 0 && <Empty>No evidence linked.</Empty>}{o.evidence_details.map((e) => <div key={e.evidence_id} className="item" style={{ cursor: "pointer" }} onClick={() => !e.missing && nav.openEvidence(e.evidence_id)}><div><div className="t">{e.label}{e.role === "contradicts" ? " · conflicts" : ""}</div><div className="d">{e.title}</div>{e.excerpt && <div className="small muted" style={{ fontStyle: "italic", marginTop: 4 }}>“{e.excerpt}”</div>}</div><div className="actions"><span className="btn link sm">Open →</span>{!e.missing && <RowTools onRemove={() => excludeEv(e)} />}</div></div>)}</div>
          {(reqs?.items.length ?? 0) > 0 && <><div className="section-head section"><h2>Data requests on this item</h2></div><div className="list">{reqs!.items.map((r) => <Row key={r.id} o={r} type="data_request" onClick={() => nav.openItem(r.id)} />)}</div></>}
          {data.related.length > 0 && <><div className="section-head section"><h2>Related items</h2></div><div className="list">{data.related.map((r) => <div key={r.id} className="item" style={{ cursor: "pointer" }} onClick={() => nav.openItem(r.id)}><div><div className="t">{r.title}</div><div className="meta"><span>{r.type.replace("_", " ")}</span></div></div><div className="actions"><span className="btn link sm">Open →</span></div></div>)}</div></>}
          <div className="section-head section"><h2>History</h2></div><div className="timeline">{data.journal.map((j) => <div key={j.id} className={`tl ${j.actor}`}><div className="small muted">{fmtDateTime(j.at)} · {j.actor}</div><div>{j.event.replace(/_/g, " ")}: {j.summary}</div></div>)}</div></div>
      </div>
      {form && <DataRequestForm target={form} endpoint={endpoint} onClose={() => setForm(undefined)} onDone={onChanged} />}
      {ed.drawers}
    </>
  );
}

/* ------------------------------ Level 4: Evidence ------------------------------ */
export function EvidenceTab({ id, nav, refreshKey, onChanged }: { id: string; nav: DrillNav; refreshKey: number; onChanged: () => void }) {
  const { data, loading, error } = useApi<{ evidence: EvidenceView; objects: Array<{ type: string; id: string; title: string }> }>(`/api/evidence/${id}`, [refreshKey]);
  const [ex, setEx] = useState(false);
  const exclude = async () => {
    const reason = window.prompt("Exclude this evidence from analysis? It is unlinked from every item and never re-ingested. Reason (optional):", "");
    if (reason === null) return;
    try { await api.post(`/api/evidence/${id}/exclude`, { reason }); setEx(true); onChanged(); } catch (x) { alert((x as Error).message); }
  };
  if (ex) return <div className="notice ok">Evidence excluded. It will not be used again. Use the level tabs to go back.</div>;
  if (error) return <div className="notice err">{/404/.test(error) ? "This evidence is no longer in the store (excluded or beyond retention)." : error}</div>;
  if (!data) return loading ? <Loading /> : null;
  const e = data.evidence;
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Level 4 · Source evidence · {e.provider_id}</div><h1 style={{ fontSize: 24 }}>{e.label} — {e.title}</h1><p>{e.participants.map((p) => p.name).join(", ")}</p></div>
        <div className="tabtools">{e.open_url ? <a className="btn primary" href={e.open_url} target="_blank" rel="noreferrer">Open in source system ↗</a> : <span className="badge neutral">No link supplied by the source</span>}<button className="btn" onClick={exclude}>✕ Exclude from analysis</button></div></div>
      <div className="grid grid-2">
        <div className="card"><div className="eyebrow">Source text{e.text ? "" : " (not retained)"}</div><pre style={{ whiteSpace: "pre-wrap", font: "inherit", margin: "8px 0 0" }}>{e.text ?? "Retention policy keeps metadata only for this item."}</pre>
          <dl className="kv"><dt>Type</dt><dd>{e.source_type.replace("_", " ")}</dd><dt>Occurred</dt><dd>{fmtDateTime(e.occurred_at)}</dd><dt>Thread</dt><dd>{e.thread_id ?? "—"}</dd>{e.structured && <><dt>Structured</dt><dd><code>{JSON.stringify(e.structured).slice(0, 200)}</code></dd></>}</dl></div>
        <div><div className="section-head"><h2>Items derived from this evidence ({data.objects.length})</h2></div><div className="list">{data.objects.length === 0 && <Empty>No tracked items reference this evidence.</Empty>}{data.objects.map((o) => <div key={o.id} className="item" style={{ cursor: "pointer" }} onClick={() => nav.openItem(o.id)}><div><div className="t">{o.title}</div><div className="meta"><span>{o.type.replace("_", " ")}</span></div></div><div className="actions"><span className="btn link sm">Open →</span></div></div>)}</div></div>
      </div>
    </>
  );
}
