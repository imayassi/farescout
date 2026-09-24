import { useState } from "react";
import { api, fmtDateTime, type EvidenceView } from "../api";
import { Empty, Loading, useApi } from "./common";

export interface PlaybookStep { n: number; stage: string; title: string; description: string; trigger?: string; owner?: string; output?: string; basis: "history" | "assumption" }
export interface Playbook {
  id: string; theme_id: string; version: number; status: "draft" | "fixed"; generated_at: string; fixed_at?: string; generated_by: string; basis: "history" | "assumption" | "mixed";
  history_depth: { evidence: number; objects: number; days: number }; purpose: string;
  cadence: { review: string; forums: string[]; rationale: string }; owners: { primary?: string; stakeholders: string[]; rationale: string };
  signals_to_watch: Array<{ name: string; source_types: string[]; threshold?: string; rationale: string }>; steps: PlaybookStep[];
  escalation_path: Array<{ condition: string; to: string; within_days?: number }>; decision_rights: Array<{ decision: string; maker: string }>;
  recurring_blockers: string[]; confidence: number; rationale: string; user_adjusted: boolean; user_notes?: string; evidence_details: EvidenceView[]; minimums: { evidence: number; objects: number };
}
const STAGES = [["sense", "Sense"], ["interpret", "Interpret"], ["decide", "Decide"], ["align", "Align"], ["execute", "Execute & learn"]] as const;

/** Visual playbook: the five-stage operating loop specialised for one bucket, plus cadence, owners, signals and escalation. */
export function PlaybookPanel({ themeId, themeName, onEvidence, onChanged }: { themeId: string; themeName: string; onEvidence: (id: string) => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi<{ playbook: Playbook; versions: Array<{ version: number; generated_at: string; basis: string; generated_by: string; user_adjusted: boolean }> }>(`/api/themes/${themeId}/playbook`);
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  const regenerate = async () => {
    const reason = window.prompt("Regenerate the playbook from current history? This creates a new version; the current one is kept in history. Reason (optional):", "more history available");
    if (reason === null) return;
    setBusy(true); try { await api.post(`/api/themes/${themeId}/playbook/regenerate`, { reason }); setMsg("Regenerated."); reload(); onChanged(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  if (error) return <div className="card"><div className="eyebrow">Playbook</div><div className="small muted" style={{ marginTop: 6 }}>{/404/.test(error) ? "No playbook yet — it is generated on the next sync once the bucket exists." : error}</div></div>;
  if (loading || !data) return <Loading />;
  const p = data.playbook;
  const basisBadge = p.basis === "history" ? <span className="badge fact">derived from history</span> : p.basis === "mixed" ? <span className="badge inference">partly from history</span> : <span className="badge inference">best assumption</span>;
  return (
    <div className="card playbook">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><div className="eyebrow">Playbook · how to manage {themeName}</div>
          <div className="row" style={{ marginTop: 6 }}>{basisBadge}<span className={`badge ${p.status === "fixed" ? "neutral" : "inference"}`}>{p.status === "fixed" ? `fixed · v${p.version}` : `draft · v${p.version}`}</span>{p.user_adjusted && <span className="badge neutral">adjusted by you</span>}<span className="small muted">generated {fmtDateTime(p.generated_at)} by {p.generated_by} · confidence {(p.confidence * 100).toFixed(0)}%</span></div></div>
        <div className="row"><button className="btn" disabled={busy} onClick={() => setEditing((e) => !e)}>{editing ? "Close editor" : "Adjust"}</button><button className="btn" disabled={busy} onClick={regenerate}>Regenerate</button></div>
      </div>
      <p className="narrative" style={{ margin: "10px 0 4px" }}>{p.purpose}</p>
      <div className="small muted">{p.rationale} History used: {p.history_depth.evidence} evidence, {p.history_depth.objects} tracked items over {p.history_depth.days} day(s). Fixed playbooks are never regenerated automatically.</div>
      {msg && <div className="small muted" style={{ marginTop: 4 }}>{msg}</div>}

      <div className="flow section" role="list" aria-label="Operating loop for this bucket">
        {STAGES.map(([key, label], i) => {
          const step = p.steps.find((s) => s.stage === key);
          return (
            <div key={key} className={`flow-step ${step?.basis ?? "assumption"}`} role="listitem">
              <div className="flow-head"><span className="n">{String(i + 1).padStart(2, "0")}</span><b>{label}</b>{step && <span className={`badge ${step.basis === "history" ? "fact" : "inference"}`} title={step.basis === "history" ? "Derived from this bucket's history" : "Standard loop; no history for this stage yet"}>{step.basis}</span>}</div>
              {step ? <>
                <div className="t">{step.title}</div>
                <div className="small muted">{step.description}</div>
                <dl className="kv compact">{step.trigger && <><dt>Trigger</dt><dd>{step.trigger}</dd></>}{step.owner && <><dt>Owner</dt><dd>{step.owner}</dd></>}{step.output && <><dt>Output</dt><dd>{step.output}</dd></>}</dl>
              </> : <div className="small muted">No step defined.</div>}
              {i < STAGES.length - 1 && <span className="flow-arrow" aria-hidden>→</span>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-3 section">
        <div><h3>Cadence</h3><div className="small"><b>{p.cadence.review}</b> review{p.cadence.forums.length ? ` · ${p.cadence.forums.join(", ")}` : ""}</div><div className="small muted">{p.cadence.rationale}</div></div>
        <div><h3>Owners</h3><div className="small"><b>{p.owners.primary ?? "— none observed"}</b>{p.owners.stakeholders.length ? ` · with ${p.owners.stakeholders.join(", ")}` : ""}</div><div className="small muted">{p.owners.rationale}</div></div>
        <div><h3>Escalation path</h3>{p.escalation_path.length === 0 && <div className="small muted">None defined.</div>}<div className="chain">{p.escalation_path.map((e, i) => <div key={i} className="small"><span className="muted">if</span> {e.condition} <span className="muted">→</span> <b>{e.to}</b>{e.within_days ? <span className="muted"> within {e.within_days}d</span> : null}</div>)}</div></div>
      </div>
      <div className="grid grid-3 section">
        <div><h3>Signals to watch</h3>{p.signals_to_watch.length === 0 && <div className="small muted">None yet.</div>}<ul className="small" style={{ paddingLeft: 18, margin: "4px 0" }}>{p.signals_to_watch.map((s, i) => <li key={i}><b>{s.name}</b>{s.threshold ? ` — ${s.threshold}` : ""}<div className="muted">{s.rationale}{s.source_types.length ? ` (${s.source_types.map((x) => x.replace("_", " ")).join(", ")})` : ""}</div></li>)}</ul></div>
        <div><h3>Decision rights</h3>{p.decision_rights.length === 0 && <div className="small muted">No decisions recorded yet; agree them at the next review.</div>}<ul className="small" style={{ paddingLeft: 18, margin: "4px 0" }}>{p.decision_rights.map((d, i) => <li key={i}>{d.decision} <span className="muted">→</span> <b>{d.maker}</b></li>)}</ul></div>
        <div><h3>Recurring blockers</h3>{p.recurring_blockers.length === 0 && <div className="small muted">None observed.</div>}<ul className="small" style={{ paddingLeft: 18, margin: "4px 0" }}>{p.recurring_blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
      </div>
      {p.user_notes && <div className="notice section">Your notes: {p.user_notes}</div>}
      <div className="row section" style={{ justifyContent: "space-between" }}>
        <div className="small muted">Based on {p.evidence_details.length} evidence item(s): {p.evidence_details.slice(0, 6).map((e) => <button key={e.evidence_id} className="btn link sm" onClick={() => onEvidence(e.evidence_id)}>{e.label}</button>)}</div>
        <div className="small muted">Versions: {data.versions.map((v) => `v${v.version} (${v.basis}${v.user_adjusted ? ", adjusted" : ""})`).join(" · ")}</div>
      </div>
      {editing && <PlaybookEditor p={p} themeId={themeId} onDone={() => { setEditing(false); reload(); onChanged(); }} />}
    </div>
  );
}

function PlaybookEditor({ p, themeId, onDone }: { p: Playbook; themeId: string; onDone: () => void }) {
  const [purpose, setPurpose] = useState(p.purpose); const [review, setReview] = useState(p.cadence.review); const [forums, setForums] = useState(p.cadence.forums.join("\n"));
  const [primary, setPrimary] = useState(p.owners.primary ?? ""); const [stakeholders, setStakeholders] = useState(p.owners.stakeholders.join("\n"));
  const [steps, setSteps] = useState<PlaybookStep[]>(p.steps.map((s) => ({ ...s }))); const [escal, setEscal] = useState(p.escalation_path.map((e) => `${e.condition} -> ${e.to}${e.within_days ? ` (${e.within_days}d)` : ""}`).join("\n"));
  const [signals, setSignals] = useState(p.signals_to_watch.map((s) => `${s.name}${s.threshold ? ` | ${s.threshold}` : ""}`).join("\n")); const [blockers, setBlockers] = useState(p.recurring_blockers.join("\n")); const [notes, setNotes] = useState(p.user_notes ?? "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true); setErr(undefined);
    try {
      await api.patch(`/api/themes/${themeId}/playbook`, {
        purpose, cadence: { review, forums: lines(forums), rationale: "Set by the user." }, owners: { primary: primary || undefined, stakeholders: lines(stakeholders), rationale: "Set by the user." },
        steps, user_notes: notes || undefined, recurring_blockers: lines(blockers),
        signals_to_watch: lines(signals).map((l) => { const [name, threshold] = l.split("|").map((x) => x.trim()); return { name: name!, threshold: threshold || undefined, source_types: [], rationale: "Set by the user." }; }),
        escalation_path: lines(escal).map((l) => { const m = l.match(/^(.*?)\s*->\s*(.*?)(?:\s*\((\d+)d\))?$/); return m ? { condition: m[1]!.trim(), to: m[2]!.trim(), within_days: m[3] ? Number(m[3]) : undefined } : { condition: l, to: "" }; }).filter((e) => e.to),
      });
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="section" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div className="eyebrow">Adjust the playbook (your changes are kept; syncs never overwrite them)</div>
      <label className="small muted">Purpose</label><textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      <div className="grid grid-2">
        <div><label className="small muted">Review cadence</label><select value={review} onChange={(e) => setReview(e.target.value)}>{["daily", "weekly", "biweekly", "monthly", "quarterly"].map((x) => <option key={x}>{x}</option>)}</select><label className="small muted">Forums (one per line)</label><textarea value={forums} onChange={(e) => setForums(e.target.value)} /></div>
        <div><label className="small muted">Primary owner</label><input value={primary} onChange={(e) => setPrimary(e.target.value)} /><label className="small muted">Stakeholders (one per line)</label><textarea value={stakeholders} onChange={(e) => setStakeholders(e.target.value)} /></div>
      </div>
      <h3 style={{ marginTop: 10 }}>Steps</h3>
      {steps.map((s, i) => <div key={s.n} className="grid grid-3" style={{ marginBottom: 6 }}>
        <div><label className="small muted">{i + 1}. {s.stage} — title</label><input value={s.title} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} /></div>
        <div><label className="small muted">Description</label><input value={s.description} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} /></div>
        <div className="grid grid-2"><div><label className="small muted">Trigger</label><input value={s.trigger ?? ""} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, trigger: e.target.value || undefined } : x))} /></div><div><label className="small muted">Owner</label><input value={s.owner ?? ""} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, owner: e.target.value || undefined } : x))} /></div></div>
      </div>)}
      <div className="grid grid-3">
        <div><label className="small muted">Signals to watch (name | threshold, one per line)</label><textarea value={signals} onChange={(e) => setSignals(e.target.value)} /></div>
        <div><label className="small muted">Escalation path (condition -&gt; person (Nd), one per line)</label><textarea value={escal} onChange={(e) => setEscal(e.target.value)} /></div>
        <div><label className="small muted">Recurring blockers (one per line)</label><textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} /></div>
      </div>
      <label className="small muted">Your notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      {err && <div className="notice err">{err}</div>}
      <div className="row" style={{ marginTop: 8 }}><button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save playbook"}</button><button className="btn" onClick={onDone}>Cancel</button></div>
    </div>
  );
}

export function PlaybookOverview({ go }: { go: (p: string) => void }) {
  const { data, loading } = useApi<Array<{ theme_id: string; name: string; playbook: { version: number; status: string; basis: string; generated_by: string; user_adjusted: boolean; confidence: number; cadence: string; owner?: string } | null }>>("/api/playbooks");
  if (loading || !data) return <Loading />;
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Operating model</div><h1>Bucket playbooks</h1><p>One playbook per bucket: derived from history when there is enough of it, otherwise a best assumption. Generated once, then fixed until you regenerate or adjust it.</p></div></div>
      {data.length === 0 && <Empty>No buckets yet.</Empty>}
      <table><thead><tr><th>Bucket</th><th>Version</th><th>Basis</th><th>Cadence</th><th>Owner</th><th>Confidence</th><th></th></tr></thead>
        <tbody>{data.map((r) => <tr key={r.theme_id} style={{ cursor: "pointer" }} onClick={() => go(`/bucket/${r.theme_id}`)}><td><b>{r.name}</b></td><td>{r.playbook ? `v${r.playbook.version} · ${r.playbook.status}${r.playbook.user_adjusted ? " · adjusted" : ""}` : "—"}</td><td>{r.playbook?.basis ?? "not generated"}</td><td>{r.playbook?.cadence ?? ""}</td><td>{r.playbook?.owner ?? ""}</td><td>{r.playbook ? `${(r.playbook.confidence * 100).toFixed(0)}%` : ""}</td><td className="small muted">Open →</td></tr>)}</tbody></table>
    </>
  );
}
