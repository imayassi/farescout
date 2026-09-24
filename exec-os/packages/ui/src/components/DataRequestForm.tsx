import { useState } from "react";
import { api } from "../api";

export interface DrTarget { scope: "bucket" | "item"; theme_id?: string; object_id?: string; label: string }

/** Raise a data / analytics request for a bucket or an item. Stored locally; forwarded if an intake endpoint is configured. */
export function DataRequestForm({ target, endpoint, onClose, onDone }: { target: DrTarget; endpoint: string | null; onClose: () => void; onDone: () => void }) {
  const [request, setRequest] = useState(""); const [kind, setKind] = useState("analysis"); const [priority, setPriority] = useState("medium");
  const [neededBy, setNeededBy] = useState(""); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ delivery: { status: string; endpoint?: string; error?: string; external_id?: string; response_status?: number }; request: { id: string } }>(); const [err, setErr] = useState<string>();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(undefined);
    try {
      const r = await api.post<typeof result>("/api/data-requests", { scope: target.scope, theme_id: target.theme_id, object_id: target.object_id, request, kind, priority, needed_by: neededBy || undefined, notes: notes || undefined });
      setResult(r); onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Data request">
        <button className="btn close" onClick={onClose}>Close</button>
        <div className="eyebrow">Data / analytics request · {target.scope} level</div>
        <h2>{target.label}</h2>
        <div className="notice" style={{ margin: "10px 0" }}>{endpoint ? <>Will be stored locally and sent to <code>{endpoint}</code> with the bucket, item and evidence context attached.</> : <>No intake endpoint is configured: the request is stored locally and listed under this {target.scope}. Set <code>data_requests.endpoint_url</code> in Settings to push requests to your data team.</>}</div>
        {!result ? (
          <form onSubmit={submit}>
            <label className="small muted">What do you need?</label>
            <textarea required value={request} onChange={(e) => setRequest(e.target.value)} placeholder="e.g. Weekly case volume vs forecast variance by tier, refreshed weekly" />
            <div className="grid grid-2" style={{ marginTop: 8 }}>
              <div><label className="small muted">Kind</label><select value={kind} onChange={(e) => setKind(e.target.value)}>{["analysis", "metric", "dashboard", "data_pull", "experiment", "forecast", "engineering", "powerbi"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select></div>
              <div><label className="small muted">Priority</label><select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></div>
            </div>
            <label className="small muted">Needed by</label><input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            <label className="small muted">Notes for the data team (optional)</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            {err && <div className="notice err" style={{ marginTop: 8 }}>{err}</div>}
            <div className="row" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy || request.trim().length < 3}>{busy ? "Sending…" : endpoint ? "Send request" : "Save request"}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
          </form>
        ) : (
          <div>
            <div className={`notice ${result.delivery.status === "delivered" ? "ok" : result.delivery.status === "failed" ? "err" : ""}`}>
              {result.delivery.status === "delivered" && <>Delivered to the intake endpoint{result.delivery.external_id ? ` (reference ${result.delivery.external_id})` : ""}.</>}
              {result.delivery.status === "failed" && <>Stored locally, but delivery failed: {result.delivery.error ?? `HTTP ${result.delivery.response_status}`}. It stays listed here so it is not lost.</>}
              {result.delivery.status === "not_configured" && <>Saved locally under this {target.scope}.</>}
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>Request id <code>{result.request.id}</code></div>
            <div className="row" style={{ marginTop: 12 }}><button className="btn primary" onClick={onClose}>Done</button></div>
          </div>
        )}
      </aside>
    </>
  );
}
