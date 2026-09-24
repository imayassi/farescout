import { useState } from "react";
import { fmtDate, fmtDateTime, titleOf, type Obj, type Theme, type EvidenceView, type Epistemic } from "../api";
import { Badge, Empty, Loading, ObjectItem, useApi } from "../components/common";

type Horizon = "daily" | "weekly" | "monthly" | "quarterly";
interface Brief {
  horizon: Horizon;
  summary?: { attention: { decisions_needed: number; escalation_candidates: number; overdue_actions: number; new_risks: number }; generated_at: string; period_start: string; period_end: string; coverage: { incomplete: boolean; reasons: string[]; providers: Array<{ id: string; ok: boolean; message?: string }> } };
  sections: Array<{ heading: string; narrative?: string; items: Array<{ text: string; epistemic: Epistemic; object_type?: string; object_id?: string; evidence_details: EvidenceView[] }> }>;
  recommendations: Obj[]; themes: Theme[]; metrics: Obj[]; upcoming: EvidenceView[];
  changed: Array<{ id: string; at: string; event: string; object_type: string; object_id: string; title: string; epistemic?: Epistemic; status?: string; actor: string }>;
}

export function Home({ onWhy, go, refreshKey }: { onWhy: (id: string) => void; go: (path: string) => void; refreshKey: number }) {
  const [h, setH] = useState<Horizon>("daily");
  const { data, loading, error } = useApi<Brief>(`/api/brief?horizon=${h}`, [refreshKey]);
  const s = data?.summary;
  const section = (name: string) => data?.sections.find((x) => x.heading === name);
  const highlights = section("Highlights");
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Executive brief</div><h1>{h === "daily" ? "Today" : h === "weekly" ? "This week" : h === "monthly" ? "This month" : "This quarter"}</h1>
          <p>{s ? `Generated ${fmtDateTime(s.generated_at)} for ${fmtDate(s.period_start)} – ${fmtDate(s.period_end)}.` : "No brief yet. Run a sync from Sources."}</p></div>
        <div className="tabs">{(["daily", "weekly", "monthly", "quarterly"] as Horizon[]).map((x) => <button key={x} className={x === h ? "on" : ""} onClick={() => setH(x)}>{x[0]!.toUpperCase() + x.slice(1)}</button>)}</div>
      </div>
      {error && <div className="notice err">{error}</div>}
      {loading && !data && <Loading />}
      {s?.coverage.incomplete && <div className="notice warn" style={{ marginBottom: 14 }}>Coverage is incomplete: {s.coverage.reasons.join(" · ") || s.coverage.providers.filter((p) => !p.ok).map((p) => `${p.id}: ${p.message}`).join(" · ")}. Nothing has been fabricated to fill the gaps.</div>}
      {s && (
        <div className="grid grid-4">
          <div className="card stat hot" onClick={() => go("/decisions")} style={{ cursor: "pointer" }}><span className="n">{s.attention.decisions_needed}</span><span className="l">decisions need you</span></div>
          <div className="card stat hot" onClick={() => go("/escalations")} style={{ cursor: "pointer" }}><span className="n">{s.attention.escalation_candidates}</span><span className="l">escalation candidates</span></div>
          <div className="card stat hot" onClick={() => go("/actions?filter=overdue")} style={{ cursor: "pointer" }}><span className="n">{s.attention.overdue_actions}</span><span className="l">overdue actions</span></div>
          <div className="card stat" onClick={() => go("/risks")} style={{ cursor: "pointer" }}><span className="n">{s.attention.new_risks}</span><span className="l">new risks this period</span></div>
        </div>
      )}
      {highlights?.narrative && <div className="card section"><div className="eyebrow">Narrative</div><p className="narrative" style={{ margin: "6px 0 0" }}>{highlights.narrative}</p><div className="small muted" style={{ marginTop: 8 }}>Narrative text is generated; every claim below links to evidence.</div></div>}
      <div className="grid grid-2 section">
        <div>
          <div className="section-head"><h2>Needs your attention</h2></div>
          <div className="list">
            {(section("Needs your attention")?.items ?? []).length === 0 && <Empty>Nothing needs your attention right now.</Empty>}
            {(section("Needs your attention")?.items ?? []).map((i, k) => (
              <div className="item" key={k}><div><div className="t">{i.text}</div><div className="meta"><Badge e={i.epistemic} /><span>{i.evidence_details.length} evidence</span></div></div>
                <div className="actions">{i.object_id && <button className="why" onClick={() => onWhy(i.object_id!)}>Why am I seeing this?</button>}</div></div>
            ))}
          </div>
          <div className="section-head section"><h2>What's changed</h2><span className="small muted">{data?.changed.length ?? 0} events</span></div>
          <div className="timeline">
            {(data?.changed ?? []).length === 0 && <Empty>No changes in this period.</Empty>}
            {(data?.changed ?? []).slice(0, 12).map((c) => (
              <div key={c.id} className={`tl ${c.actor}`}><div className="small muted">{fmtDateTime(c.at)} · {c.object_type} · {c.event.replace(/_/g, " ")}</div>
                <div>{c.title} {c.epistemic && <Badge e={c.epistemic} />}{c.object_type !== "theme" && c.object_type !== "sync" && <> <button className="why" onClick={() => onWhy(c.object_id)}>why?</button></>}</div></div>
            ))}
          </div>
        </div>
        <div>
          <div className="section-head"><h2>Recommendations</h2><button className="btn link sm" onClick={() => go("/recommendations")}>All →</button></div>
          <div className="list">
            {(data?.recommendations ?? []).length === 0 && <Empty>No open recommendations.</Empty>}
            {(data?.recommendations ?? []).slice(0, 4).map((r) => <ObjectItem key={r.id} o={r} type="recommendation" onWhy={onWhy} />)}
          </div>
          <div className="section-head section"><h2>Upcoming</h2></div>
          <div className="list">
            {(data?.upcoming ?? []).length === 0 && <Empty>No calendar items in the next two weeks.</Empty>}
            {(data?.upcoming ?? []).map((u) => <div key={u.evidence_id} className="item"><div><div className="t">{u.title}</div><div className="meta"><span>{new Date(u.occurred_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><span>{u.participants.length} attendees</span></div></div></div>)}
          </div>
        </div>
      </div>
      <div className="section"><div className="section-head"><h2>Key themes</h2><button className="btn link sm" onClick={() => go("/themes")}>All →</button></div>
        <div className="grid grid-4">
          {(data?.themes ?? []).map((t) => (
            <div key={t.id} className="card theme-card" onClick={() => go(`/themes/${t.id}`)}>
              <div className="row" style={{ justifyContent: "space-between" }}><h3>{t.name}</h3>{t.pinned ? <span className="badge neutral">pinned</span> : <span className="badge inference">discovered</span>}</div>
              <div className="small">{t.what_changed || <span className="muted">No change this week</span>}</div>
              <div className="small muted">{t.current_state}</div>
            </div>
          ))}
        </div>
      </div>
      {(data?.metrics ?? []).length > 0 && <div className="section"><div className="section-head"><h2>Metrics</h2></div>
        <div className="grid grid-4">{data!.metrics.map((m) => <div key={m.id} className="card stat"><span className="n" style={{ fontSize: 26 }}>{m.value}{m.unit === "%" ? "%" : ""}</span><span className="l">{titleOf(m)}{m.delta !== undefined && <b style={{ color: m.delta > 0 ? "var(--err)" : "var(--ok)", marginLeft: 6 }}>{m.delta > 0 ? "▲" : "▼"} {(Math.abs(m.delta) * 100).toFixed(1)}%</b>}</span><button className="why" onClick={() => onWhy(m.id)}>source</button></div>)}</div></div>}
    </>
  );
}
