import { useEffect, useState } from "react";
import { api, fmtDateTime, type JournalEntry, type Status, type EvidenceView } from "../api";
import { Badge, Empty, EvidenceCard, Loading, useApi } from "../components/common";

export function Timeline({ onWhy, refreshKey }: { onWhy: (id: string) => void; refreshKey: number }) {
  const [days, setDays] = useState(30);
  const { data, loading } = useApi<JournalEntry[]>(`/api/journal?days=${days}`, [refreshKey]);
  const [filter, setFilter] = useState("all");
  const list = (data ?? []).filter((j) => filter === "all" ? j.object_type !== "sync" : filter === "user" ? j.actor === "user" : filter === "sync" ? j.object_type === "sync" : j.event === filter);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Journal</div><h1>Timeline</h1><p>When was this first detected? Who committed? Has the status changed? Was it dismissed before? The journal answers with history, not regenerated summaries.</p></div>
        <div className="tabs">{[7, 30, 90].map((d) => <button key={d} className={d === days ? "on" : ""} onClick={() => setDays(d)}>{d} days</button>)}</div></div>
      <div className="chips" style={{ marginBottom: 14 }}>{[["all", "All"], ["detected", "Detected"], ["status_changed", "Status changes"], ["feedback", "Your corrections"], ["user", "All user actions"], ["sync", "Syncs"]].map(([k, l]) => <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k!)}>{l}</button>)}</div>
      {loading && !data && <Loading />}
      <div className="timeline">
        {list.length === 0 && <Empty>No journal entries.</Empty>}
        {list.map((j) => <div key={j.id} className={`tl ${j.actor}`}><div className="small muted">{fmtDateTime(j.at)} · {j.actor} · {j.object_type}</div>
          <div>{j.event.replace(/_/g, " ")}{j.title ? `: ${j.title}` : j.summary ? `: ${j.summary}` : ""} {j.epistemic && <Badge e={j.epistemic} />} {j.before?.status && j.after?.status ? <span className="small muted">({String(j.before.status)} → {String(j.after.status)})</span> : null} {j.object_type !== "theme" && j.object_type !== "sync" && j.object_type !== "conflict" && <button className="why" onClick={() => onWhy(j.object_id)}>why?</button>}</div>
          {j.title && j.summary && j.event !== "detected" && <div className="small muted">{j.summary}</div>}</div>)}
      </div>
    </>
  );
}

export function Ask({ onWhy }: { onWhy: (id: string) => void }) {
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const [res, setRes] = useState<{ answer: string; confidence: number; gaps: string[]; citations: Array<{ evidence_id: string; why: string }>; related_objects: Array<{ type: string; id: string }>; evidence: EvidenceView[]; backend: string; degraded: boolean }>();
  const examples = ["What decisions were made about capacity this month?", "What commitments did I make last week?", "What issues have been mentioned repeatedly but not resolved?", "What is blocking the forecast?", "What changed in the budget during the last 30 days?"];
  const run = async (question: string) => { setBusy(true); setErr(undefined); setQ(question); try { setRes(await api.post("/api/ask", { question })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Secondary interface</div><h1>Ask</h1><p>Questions are answered only from local evidence and tracked items, with citations. The command center, not this box, is the primary experience.</p></div></div>
      <div className="card"><form onSubmit={(e) => { e.preventDefault(); if (q.trim()) void run(q.trim()); }} className="row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about decisions, commitments, blockers, a project…" /><button className="btn primary" disabled={busy || !q.trim()}>{busy ? "Thinking…" : "Ask"}</button></form>
        <div className="chips" style={{ marginTop: 10 }}>{examples.map((x) => <button key={x} className="chip" onClick={() => void run(x)}>{x}</button>)}</div></div>
      {err && <div className="notice err section">{err}</div>}
      {res && (
        <div className="grid grid-2 section">
          <div className="card"><div className="row" style={{ justifyContent: "space-between" }}><div className="eyebrow">Answer</div><span className="small muted">via {res.backend}{res.degraded ? " (degraded)" : ""} · confidence {(res.confidence * 100).toFixed(0)}%</span></div>
            <pre style={{ whiteSpace: "pre-wrap", font: "inherit", margin: "8px 0 0" }}>{res.answer}</pre>
            {res.gaps.length > 0 && <div className="notice warn" style={{ marginTop: 10 }}>Gaps: {res.gaps.join(" · ")}</div>}
            {res.related_objects.length > 0 && <div className="chips" style={{ marginTop: 10 }}>{res.related_objects.map((r) => <button key={r.id} className="chip" onClick={() => onWhy(r.id)}>{r.type} · why?</button>)}</div>}</div>
          <div><div className="section-head"><h2>Cited evidence ({res.evidence.length})</h2></div>{res.evidence.length === 0 && <Empty>No citations.</Empty>}{res.evidence.map((e) => <EvidenceCard key={e.evidence_id} e={e} />)}</div>
        </div>
      )}
    </>
  );
}

export function Sources({ status, onSync, refreshKey }: { status?: Status; onSync: (mode?: string) => void; refreshKey: number }) {
  const { data, loading } = useApi<{ providers: Array<{ id: string; kind: string; label: string; description?: string; adapter?: string; tools?: string[]; state: { last_status: string; last_sync_at?: string; last_error?: string; cursor: Record<string, unknown>; stats: { items_new: number; items_seen: number; duration_ms: number } }; registry?: { health?: { ok: boolean; message?: string; remediation?: string; auth_required?: boolean }; capabilities?: string[] } }>; disabled: string[]; backend: { name: string; degraded: boolean; probes: Array<{ name: string; available: boolean; detail?: string; remediation?: string }> }; config_files: { appFile: string; mcpFile: string }; stakeholders: Array<{ name: string; mention_count: number; email?: string }> }>("/api/sources", [refreshKey, status?.sync.state]);
  const sync = status?.sync;
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Sense</div><h1>Sources</h1><p>Where signals come from, how fresh they are, and what is missing. A source that fails never destroys previously generated state.</p></div>
        <div className="row"><button className="btn" onClick={() => onSync()} disabled={sync?.state === "running"}>{sync?.state === "running" ? <><span className="spin" /> Syncing… {sync.phase}</> : "Sync now"}</button><button className="btn" onClick={() => { if (confirm("Re-run the full 90-day bootstrap? Existing items are updated, not duplicated.")) onSync("bootstrap"); }} disabled={sync?.state === "running"}>Full rescan</button></div></div>
      {sync?.state === "running" && <div className="notice">Phase: {sync.phase} · providers {sync.progress.providers_done}/{sync.progress.providers_total} · batches {sync.progress.batches_done}/{sync.progress.batches_total}</div>}
      {sync?.last_error && <div className="notice err">Last sync error: {sync.last_error}</div>}
      {sync?.last_result && <div className="notice ok" style={{ marginTop: 8 }}>Last sync ({sync.last_result.mode}) took {(sync.last_result.duration_ms / 1000).toFixed(1)}s: {sync.last_result.created} new item(s), {sync.last_result.updated} updated. {sync.last_result.providers.map((p) => `${p.id}: ${p.status} (${p.items_new} new of ${p.items_seen})`).join(" · ")}</div>}
      {loading && !data && <Loading />}
      <div className="section grid grid-2">
        {(data?.providers ?? []).map((p) => (
          <div key={p.id} className="card"><div className="row" style={{ justifyContent: "space-between" }}><h2>{p.label}</h2><span className={`badge ${p.state.last_status === "ok" ? "fact" : p.state.last_status === "never" ? "neutral" : "potential_escalation"}`}>{p.state.last_status}</span></div>
            <div className="small muted">{p.description}{p.adapter ? ` · adapter: ${p.adapter}` : ""}</div>
            <dl className="kv"><dt>Last sync</dt><dd>{p.state.last_sync_at ? fmtDateTime(p.state.last_sync_at) : "never"}</dd><dt>Last run</dt><dd>{p.state.stats.items_new} new of {p.state.stats.items_seen} seen · {p.state.stats.duration_ms} ms</dd>
              {p.registry?.capabilities && <><dt>Capabilities</dt><dd>{p.registry.capabilities.join(", ") || "—"}</dd></>}{p.tools && p.tools.length > 0 && <><dt>MCP tools</dt><dd className="small">{p.tools.join(", ")}</dd></>}
              {p.registry?.health && <><dt>Health</dt><dd>{p.registry.health.message}{p.registry.health.remediation && <div className="notice warn" style={{ marginTop: 4 }}>{p.registry.health.remediation}</div>}</dd></>}
              {p.state.last_error && <><dt>Error</dt><dd style={{ color: "var(--err)" }}>{p.state.last_error}</dd></>}
              {Object.keys(p.state.cursor).length > 0 && <><dt>Cursor</dt><dd className="small muted"><code>{JSON.stringify(p.state.cursor).slice(0, 120)}</code></dd></>}</dl></div>
        ))}
        {(data?.disabled ?? []).map((id) => <div key={id} className="card" style={{ opacity: .7 }}><h2>{id}</h2><div className="small muted">Disabled in configuration.</div></div>)}
      </div>
      <div className="section grid grid-2">
        <div className="card"><h2>Intelligence backend</h2><div className="small muted" style={{ marginBottom: 8 }}>{data?.backend.name}{data?.backend.degraded ? " — degraded: no model analysis, rules only" : ""}</div>
          {(data?.backend.probes ?? []).map((p) => <div key={p.name} className="small" style={{ marginBottom: 6 }}><span className={`badge ${p.available ? "fact" : "neutral"}`}>{p.name}</span> {p.detail}{!p.available && p.remediation && <div className="muted">→ {p.remediation}</div>}</div>)}</div>
        <div className="card"><h2>People in the evidence</h2><div className="small muted" style={{ marginBottom: 8 }}>As named by the sources (no directory lookup).</div><div className="chips">{(data?.stakeholders ?? []).map((s) => <span key={s.name} className="chip">{s.name} · {s.mention_count}</span>)}</div></div>
      </div>
    </>
  );
}

export function Settings({ status }: { status?: Status }) {
  const { data, reload } = useApi<{ config: { user: { display_name: string; email: string; role: string; team_members: string[] }; retention: { lookback_days: number; journal_days: number; raw_text: string }; summaries: Record<string, boolean>; themes: { auto_discover: boolean; pinned: string[] }; enabled_sources: Record<string, boolean>; intelligence: { backend: string; copilot: { command: string; model: string } } }; paths: Record<string, string>; warnings: string[] }>("/api/settings");
  const [form, setForm] = useState<typeof data extends infer T ? T extends { config: infer C } ? C : never : never>();
  const [msg, setMsg] = useState<string>();
  useEffect(() => { if (data) setForm(structuredClone(data.config)); }, [data]);
  if (!data || !form) return <Loading />;
  const save = async () => { try { const r = await api.put<{ restart_required: boolean }>("/api/settings", { user: form.user, retention: form.retention, summaries: form.summaries, themes: form.themes, enabled_sources: form.enabled_sources }); setMsg(r.restart_required ? "Saved. Restart ExecOS for source changes to apply." : "Saved."); reload(); } catch (e) { setMsg((e as Error).message); } };
  const wipe = async () => {
    if (prompt("This permanently deletes all local ExecOS data (evidence, items, journal, logs, Copilot session state). Configuration is kept. Type DELETE to confirm.") !== "DELETE") return;
    try { const r = await api.post<{ message: string }>("/api/data/delete", { confirm: "DELETE" }); alert(r.message); } catch (e) { alert((e as Error).message); }
  };
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Configuration</div><h1>Settings</h1><p>Everything here is stored outside the repository in your local application-data folder.</p></div></div>
      {data.warnings.map((w) => <div key={w} className="notice warn" style={{ marginBottom: 8 }}>{w}</div>)}
      <div className="grid grid-2">
        <div className="card"><h2>You</h2>
          <label className="small muted">Display name</label><input value={form.user.display_name} onChange={(e) => setForm({ ...form, user: { ...form.user, display_name: e.target.value } })} />
          <label className="small muted">Email</label><input value={form.user.email} onChange={(e) => setForm({ ...form, user: { ...form.user, email: e.target.value } })} />
          <label className="small muted">Role</label><input value={form.user.role} onChange={(e) => setForm({ ...form, user: { ...form.user, role: e.target.value } })} />
          <label className="small muted">Team members (one per line, used by "My team")</label><textarea value={form.user.team_members.join("\n")} onChange={(e) => setForm({ ...form, user: { ...form.user, team_members: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } })} /></div>
        <div className="card"><h2>Themes & horizons</h2>
          <label className="small muted">Pinned themes (one per line)</label><textarea value={form.themes.pinned.join("\n")} onChange={(e) => setForm({ ...form, themes: { ...form.themes, pinned: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } })} />
          <label className="row"><input type="checkbox" style={{ width: "auto" }} checked={form.themes.auto_discover} onChange={(e) => setForm({ ...form, themes: { ...form.themes, auto_discover: e.target.checked } })} /> Auto-discover additional themes</label>
          <div className="row" style={{ marginTop: 8 }}>{["daily", "weekly", "monthly", "quarterly"].map((h) => <label key={h} className="row"><input type="checkbox" style={{ width: "auto" }} checked={!!form.summaries[h]} onChange={(e) => setForm({ ...form, summaries: { ...form.summaries, [h]: e.target.checked } })} /> {h}</label>)}</div></div>
        <div className="card"><h2>Retention</h2>
          <label className="small muted">Source analysis window (days)</label><input type="number" value={form.retention.lookback_days} onChange={(e) => setForm({ ...form, retention: { ...form.retention, lookback_days: Number(e.target.value) } })} />
          <label className="small muted">Journal view (days)</label><input type="number" value={form.retention.journal_days} onChange={(e) => setForm({ ...form, retention: { ...form.retention, journal_days: Number(e.target.value) } })} />
          <label className="small muted">Raw source text kept per evidence item</label><select value={form.retention.raw_text} onChange={(e) => setForm({ ...form, retention: { ...form.retention, raw_text: e.target.value } })}><option value="trimmed">trimmed (first 4,000 characters)</option><option value="full">full</option><option value="none">none (metadata only)</option></select></div>
        <div className="card"><h2>Sources</h2>{Object.entries(form.enabled_sources).map(([k, v]) => <label key={k} className="row"><input type="checkbox" style={{ width: "auto" }} checked={v} onChange={(e) => setForm({ ...form, enabled_sources: { ...form.enabled_sources, [k]: e.target.checked } })} /> {k}</label>)}
          <div className="small muted" style={{ marginTop: 8 }}>Provider commands and endpoints are edited in <code>{data.paths.mcpConfigFile}</code>. Intelligence backend: <code>{form.intelligence.backend}</code> via <code>{form.intelligence.copilot.command}</code>.</div></div>
      </div>
      <div className="row section"><button className="btn primary" onClick={save}>Save</button>{msg && <span className="small muted">{msg}</span>}</div>
      <div className="card section"><h2>Privacy & local data</h2>
        <dl className="kv">{Object.entries(data.paths).filter(([k]) => ["root", "config", "data", "cache", "logs", "docs", "copilotHome"].includes(k)).map(([k, v]) => <><dt key={k + "t"}>{k}</dt><dd key={k + "d"}><code>{v}</code></dd></>)}</dl>
        <div className="small muted">Logs contain metadata only; message bodies are redacted by the logger. Nothing is sent anywhere except through GitHub Copilot and the MCP servers you configured.</div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn" style={{ color: "var(--err)", borderColor: "var(--err)" }} onClick={wipe}>Delete local data…</button><span className="small muted">Version {status?.version}</span></div></div>
    </>
  );
}
