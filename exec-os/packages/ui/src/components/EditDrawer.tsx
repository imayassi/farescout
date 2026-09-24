import { useEffect, useState } from "react";
import { api, type Obj, titleOf } from "../api";

interface Field { key: string; label: string; kind: "text" | "textarea" | "date" | "select" | "list" | "number"; options?: string[] }
const STATUS: Record<string, string[]> = {
  action: ["detected", "confirmed", "assigned", "in_progress", "blocked", "escalation_candidate", "escalated", "completed", "dismissed"],
  decision: ["needed", "pending_approval", "recorded", "superseded"], escalation: ["potential", "active", "resolved", "dismissed"],
  risk: ["open", "mitigating", "closed"], data_request: ["identified", "submitted", "accepted", "in_progress", "delivered", "declined"],
};
const FIELDS: Record<string, Field[]> = {
  action: [{ key: "title", label: "Title", kind: "text" }, { key: "description", label: "Description", kind: "textarea" }, { key: "owner", label: "Owner", kind: "text" }, { key: "stakeholders", label: "Stakeholders (one per line)", kind: "list" }, { key: "due_at", label: "Due", kind: "date" }, { key: "status", label: "Status", kind: "select", options: STATUS.action }, { key: "theme_id", label: "Bucket", kind: "select" }],
  decision: [{ key: "topic", label: "Topic", kind: "text" }, { key: "decision", label: "Decision (as made)", kind: "textarea" }, { key: "decision_maker", label: "Decision maker", kind: "text" }, { key: "rationale", label: "Rationale", kind: "textarea" }, { key: "alternatives", label: "Alternatives (one per line)", kind: "list" }, { key: "needed_by", label: "Needed by", kind: "date" }, { key: "status", label: "Status", kind: "select", options: STATUS.decision }, { key: "theme_id", label: "Bucket", kind: "select" }],
  escalation: [{ key: "issue", label: "Issue", kind: "text" }, { key: "why_needed", label: "Why leadership attention is needed", kind: "textarea" }, { key: "owner", label: "Owner", kind: "text" }, { key: "target_decision_maker", label: "Escalate to", kind: "text" }, { key: "urgency", label: "Urgency", kind: "select", options: ["low", "medium", "high", "critical"] }, { key: "recommended_resolution", label: "Recommended resolution", kind: "textarea" }, { key: "status", label: "Status", kind: "select", options: STATUS.escalation }, { key: "theme_id", label: "Bucket", kind: "select" }],
  risk: [{ key: "title", label: "Title", kind: "text" }, { key: "description", label: "Description", kind: "textarea" }, { key: "owner", label: "Owner", kind: "text" }, { key: "likelihood", label: "Likelihood", kind: "select", options: ["low", "medium", "high"] }, { key: "impact", label: "Impact", kind: "select", options: ["low", "medium", "high"] }, { key: "trend", label: "Trend", kind: "select", options: ["rising", "stable", "falling"] }, { key: "status", label: "Status", kind: "select", options: STATUS.risk }, { key: "theme_id", label: "Bucket", kind: "select" }],
  recommendation: [{ key: "recommendation", label: "Recommendation", kind: "textarea" }, { key: "suggested_owner", label: "Suggested owner", kind: "text" }, { key: "suggested_next_step", label: "Suggested next step", kind: "textarea" }],
  data_request: [{ key: "request", label: "Request", kind: "textarea" }, { key: "owner", label: "Owner", kind: "text" }, { key: "kind", label: "Kind", kind: "select", options: ["analysis", "metric", "dashboard", "data_pull", "experiment", "forecast", "engineering", "powerbi"] }, { key: "priority", label: "Priority", kind: "select", options: ["low", "medium", "high"] }, { key: "needed_by", label: "Needed by", kind: "date" }, { key: "status", label: "Status", kind: "select", options: STATUS.data_request }, { key: "notes", label: "Notes", kind: "textarea" }, { key: "theme_id", label: "Bucket", kind: "select" }],
  signal: [{ key: "statement", label: "Statement", kind: "text" }, { key: "theme_id", label: "Bucket", kind: "select" }],
  metric: [{ key: "name", label: "Name", kind: "text" }, { key: "value", label: "Value", kind: "number" }, { key: "unit", label: "Unit", kind: "text" }, { key: "theme_id", label: "Bucket", kind: "select" }],
};

function useBuckets() {
  const [b, setB] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => { api.get<Array<{ id: string; name: string }>>("/api/themes").then(setB).catch(() => undefined); }, []);
  return b;
}

/** Adjust any field of an item. Edited fields are locked so later syncs never overwrite them. */
export function EditDrawer({ type, obj, onClose, onSaved }: { type: string; obj: Obj; onClose: () => void; onSaved: () => void }) {
  const fields = FIELDS[type] ?? [];
  const buckets = useBuckets();
  const init: Record<string, string> = {};
  for (const f of fields) { const v = (obj as unknown as Record<string, unknown>)[f.key]; init[f.key] = Array.isArray(v) ? v.join("\n") : f.kind === "date" && typeof v === "string" ? v.slice(0, 10) : v === undefined || v === null ? "" : String(v); }
  const [form, setForm] = useState(init); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const save = async () => {
    setBusy(true); setErr(undefined);
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      const v = form[f.key] ?? "";
      if (f.kind === "list") patch[f.key] = v.split("\n").map((x) => x.trim()).filter(Boolean);
      else if (f.kind === "date") patch[f.key] = v ? new Date(v + "T12:00:00Z").toISOString() : "";
      else if (f.kind === "number") patch[f.key] = Number(v);
      else patch[f.key] = v;
    }
    try { await api.patch(`/api/object/${obj.id}`, patch); onSaved(); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Adjust item">
        <button className="btn close" onClick={onClose}>Close</button>
        <div className="eyebrow">Adjust · {type.replace("_", " ")}</div>
        <h2>{titleOf(obj)}</h2>
        <div className="small muted" style={{ marginBottom: 8 }}>Fields you change are locked: the next sync will add evidence but never overwrite them.</div>
        {fields.map((f) => (
          <div key={f.key}><label className="small muted">{f.label}</label>
            {f.kind === "textarea" ? <textarea value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              : f.kind === "list" ? <textarea value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              : f.kind === "select" ? <select value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>{f.key === "theme_id" ? <><option value="">(no bucket)</option>{buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</> : f.options!.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}</select>
              : <input type={f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
          </div>
        ))}
        {err && <div className="notice err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button><button className="btn" onClick={onClose}>Cancel</button></div>
      </aside>
    </>
  );
}

/** Add an item by hand at bucket (or executive) level. */
export function AddDrawer({ themeId, onClose, onSaved }: { themeId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const buckets = useBuckets();
  const [type, setType] = useState("action"); const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [owner, setOwner] = useState(""); const [due, setDue] = useState(""); const [bucket, setBucket] = useState(themeId ?? ""); const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(undefined);
    try { const r = await api.post<{ object: { id: string } }>("/api/objects", { type, title, description, owner: owner || undefined, due_at: due ? new Date(due + "T12:00:00Z").toISOString() : undefined, theme_id: bucket || undefined, status: status || undefined }); onSaved(r.object.id); onClose(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Add item">
        <button className="btn close" onClick={onClose}>Close</button>
        <div className="eyebrow">Add to this tab</div><h2>New item</h2>
        <div className="small muted" style={{ marginBottom: 8 }}>Items you add are recorded as facts from you, with your name in the history.</div>
        <form onSubmit={save}>
          <label className="small muted">Type</label><select value={type} onChange={(e) => { setType(e.target.value); setStatus(""); }}>{["action", "decision", "escalation", "risk", "signal", "data_request"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select>
          <label className="small muted">Title</label><input required value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="small muted">Description / rationale</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="grid grid-2"><div><label className="small muted">{type === "decision" ? "Decision maker" : "Owner"}</label><input value={owner} onChange={(e) => setOwner(e.target.value)} /></div><div><label className="small muted">{type === "decision" ? "Needed by" : "Due"}</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div></div>
          <label className="small muted">Bucket</label><select value={bucket} onChange={(e) => setBucket(e.target.value)}><option value="">(no bucket)</option>{buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          {STATUS[type] && <><label className="small muted">Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">(default)</option>{STATUS[type]!.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></>}
          {err && <div className="notice err" style={{ marginTop: 8 }}>{err}</div>}
          <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy || !title.trim()}>{busy ? "Adding…" : "Add"}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
        </form>
      </aside>
    </>
  );
}

export function BucketDrawer({ theme, onClose, onSaved }: { theme?: { id: string; name: string; description: string; current_state?: string; what_changed?: string; pinned: boolean }; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(theme?.name ?? ""); const [description, setDescription] = useState(theme?.description ?? ""); const [state, setState] = useState(theme?.current_state ?? ""); const [changed, setChanged] = useState(theme?.what_changed ?? ""); const [pinned, setPinned] = useState(theme?.pinned ?? true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(undefined);
    try {
      if (theme) await api.patch(`/api/themes/${theme.id}`, { name, description, pinned, ...(state !== (theme.current_state ?? "") ? { current_state: state } : {}), ...(changed !== (theme.what_changed ?? "") ? { what_changed: changed } : {}) });
      else await api.post("/api/themes", { name, description, pinned });
      onSaved(); onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Bucket">
        <button className="btn close" onClick={onClose}>Close</button>
        <div className="eyebrow">{theme ? "Adjust bucket" : "Add bucket"}</div><h2>{theme?.name ?? "New bucket"}</h2>
        <form onSubmit={save}>
          <label className="small muted">Name</label><input required value={name} onChange={(e) => setName(e.target.value)} />
          <label className="small muted">Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          {theme && <><label className="small muted">Current state (override; leave as is to keep it computed)</label><textarea value={state} onChange={(e) => setState(e.target.value)} /><label className="small muted">What changed (override)</label><textarea value={changed} onChange={(e) => setChanged(e.target.value)} /></>}
          <label className="row"><input type="checkbox" style={{ width: "auto" }} checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pinned (always shown)</label>
          {err && <div className="notice err" style={{ marginTop: 8 }}>{err}</div>}
          <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy || name.trim().length < 2}>{busy ? "Saving…" : "Save"}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
        </form>
      </aside>
    </>
  );
}
