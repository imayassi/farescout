import { api, fmtDateTime, type Obj, type Theme, type EvidenceView, type JournalEntry } from "../api";
import { Empty, EvidenceCard, Loading, ObjectItem, useApi } from "../components/common";

export function Themes({ go, refreshKey }: { go: (p: string) => void; refreshKey: number }) {
  const { data, loading, reload } = useApi<Theme[]>("/api/themes", [refreshKey]);
  const pin = async (t: Theme, e: React.MouseEvent) => { e.stopPropagation(); await api.post("/api/feedback", { object_type: "theme", object_id: t.id, kind: t.pinned ? "unpin_theme" : "pin_theme" }); reload(); };
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Interpret</div><h1>Themes</h1><p>Business domains discovered from the evidence, plus the ones you pinned. Each card shows what changed and the current state.</p></div></div>
      {loading && !data && <Loading />}
      <div className="grid grid-3">
        {(data ?? []).map((t) => (
          <div key={t.id} className="card theme-card" onClick={() => go(`/themes/${t.id}`)}>
            <div className="row" style={{ justifyContent: "space-between" }}><h2>{t.name}</h2><button className="btn sm" onClick={(e) => pin(t, e)}>{t.pinned ? "Unpin" : "Pin"}</button></div>
            <div className="small muted">{t.description}</div>
            <div className="small"><b>Changed:</b> {t.what_changed || "—"}</div>
            <div className="small"><b>State:</b> {t.current_state}</div>
            <div className="counts">{Object.entries(t.counts).map(([k, v]) => <span key={k} className="badge neutral">{v} {k.replace("_", " ")}{v > 1 ? "s" : ""}</span>)}{!t.pinned && <span className="badge inference">discovered</span>}</div>
          </div>
        ))}
        {data && data.length === 0 && <Empty>No themes yet — run a sync.</Empty>}
      </div>
    </>
  );
}

export function ThemeDetail({ id, onWhy, refreshKey }: { id: string; onWhy: (id: string) => void; refreshKey: number }) {
  const { data, loading, error } = useApi<{ theme: Theme; objects: Record<string, Obj[]>; evidence: EvidenceView[]; journal: JournalEntry[] }>(`/api/themes/${id}`, [refreshKey]);
  if (error) return <div className="notice err">{error}</div>;
  if (loading || !data) return <Loading />;
  const t = data.theme;
  const groups: Array<[string, string]> = [["decision", "Decisions"], ["action", "Actions"], ["escalation", "Escalations"], ["risk", "Risks"], ["recommendation", "Recommendations"], ["data_request", "Data requests"], ["signal", "Signals"], ["metric", "Metrics"]];
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Theme {t.pinned ? "· pinned" : "· discovered"}</div><h1>{t.name}</h1><p>{t.description}</p></div></div>
      <div className="grid grid-2">
        <div className="card"><div className="eyebrow">What changed (7 days)</div><p style={{ margin: "6px 0 0" }}>{t.what_changed || "No change recorded."}</p></div>
        <div className="card"><div className="eyebrow">Current state</div><p style={{ margin: "6px 0 0" }}>{t.current_state}</p></div>
      </div>
      {groups.map(([k, label]) => (data.objects[k]?.length ?? 0) > 0 && (
        <div className="section" key={k}><div className="section-head"><h2>{label}</h2></div><div className="list">{data.objects[k]!.map((o) => <ObjectItem key={o.id} o={o} type={k} onWhy={onWhy} />)}</div></div>
      ))}
      <div className="grid grid-2 section">
        <div><div className="section-head"><h2>Evidence ({data.evidence.length})</h2></div>{data.evidence.slice(0, 20).map((e) => <EvidenceCard key={e.evidence_id} e={e} />)}</div>
        <div><div className="section-head"><h2>History</h2></div><div className="timeline">{data.journal.slice(0, 30).map((j) => <div key={j.id} className={`tl ${j.actor}`}><div className="small muted">{fmtDateTime(j.at)} · {j.object_type}</div><div>{j.event.replace(/_/g, " ")}: {j.summary}</div></div>)}</div></div>
      </div>
    </>
  );
}
