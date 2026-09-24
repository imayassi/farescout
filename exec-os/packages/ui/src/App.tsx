import { useCallback, useEffect, useState } from "react";
import { api, bootstrapToken, type Status } from "./api";
import { WhyDrawer } from "./components/common";
import { Home } from "./pages/Home";
import { Actions, DataRequests, Decisions, Escalations, Recommendations, Risks } from "./pages/Centers";
import { ThemeDetail, Themes } from "./pages/Themes";
import { Ask, Settings, Sources, Timeline } from "./pages/Misc";

/** Minimal hash router: #/path?query */
function useRoute(): [string, URLSearchParams, (p: string) => void] {
  const parse = () => { const h = window.location.hash.replace(/^#/, "") || "/"; const [p, q] = h.split("?"); return [p!, new URLSearchParams(q ?? "")] as const; };
  const [[path, query], set] = useState(parse);
  useEffect(() => { const f = () => set(parse()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return [path, query, (p) => { window.location.hash = p; }];
}

const NAV: Array<[string, string, string?]> = [["/", "Home"], ["/themes", "Themes"], ["/actions", "Actions", "actions"], ["/decisions", "Decisions", "decisions"], ["/escalations", "Escalations", "escalations"], ["/risks", "Risks", "risks"], ["/recommendations", "Recommendations", "recommendations"], ["/data-requests", "Data requests", "data_requests"], ["/timeline", "Timeline"], ["/ask", "Ask"], ["/sources", "Sources"], ["/settings", "Settings"]];

export function App() {
  bootstrapToken();
  const [path, query, go] = useRoute();
  const [why, setWhy] = useState<string>();
  const [status, setStatus] = useState<Status>();
  const [statusErr, setStatusErr] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshStatus = useCallback(() => api.get<Status>("/api/status").then((s) => { setStatus(s); setStatusErr(undefined); }).catch((e) => setStatusErr((e as Error).message)), []);
  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  // Poll while a sync is running so pages refresh when it completes.
  useEffect(() => {
    if (status?.sync.state !== "running") return;
    const t = setInterval(async () => { const s = await api.get<Status>("/api/status").catch(() => undefined); if (s) { setStatus(s); if (s.sync.state !== "running") setRefreshKey((k) => k + 1); } }, 1500);
    return () => clearInterval(t);
  }, [status?.sync.state]);
  const sync = async (mode?: string) => { await api.post("/api/sync", mode ? { mode } : {}); void refreshStatus(); };
  const onChanged = () => { setRefreshKey((k) => k + 1); void refreshStatus(); };

  let page: React.ReactNode;
  const m = path.match(/^\/themes\/(.+)$/);
  if (m) page = <ThemeDetail id={m[1]!} onWhy={setWhy} refreshKey={refreshKey} />;
  else switch (path) {
    case "/themes": page = <Themes go={go} refreshKey={refreshKey} />; break;
    case "/actions": page = <Actions onWhy={setWhy} refreshKey={refreshKey} query={query.get("filter") ?? undefined} />; break;
    case "/decisions": page = <Decisions onWhy={setWhy} refreshKey={refreshKey} />; break;
    case "/escalations": page = <Escalations onWhy={setWhy} refreshKey={refreshKey} />; break;
    case "/risks": page = <Risks onWhy={setWhy} refreshKey={refreshKey} />; break;
    case "/recommendations": page = <Recommendations onWhy={setWhy} refreshKey={refreshKey} />; break;
    case "/data-requests": page = <DataRequests onWhy={setWhy} refreshKey={refreshKey} />; break;
    case "/timeline": page = <Timeline onWhy={setWhy} refreshKey={refreshKey} />; break;
    case "/ask": page = <Ask onWhy={setWhy} />; break;
    case "/sources": page = <Sources status={status} onSync={sync} refreshKey={refreshKey} />; break;
    case "/settings": page = <Settings status={status} />; break;
    default: page = <Home onWhy={setWhy} go={go} refreshKey={refreshKey} />;
  }

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand"><span className="mark">E</span><div><b>ExecOS</b><div className="small muted">Operating intelligence</div></div></div>
        {NAV.map(([p, label, statKey]) => <a key={p} href={`#${p}`} className={path === p || (p !== "/" && path.startsWith(p + "/")) ? "active" : ""}>{label}{statKey && status?.stats[statKey] !== undefined && <span className="count">{status.stats[statKey]}</span>}</a>)}
        <div className="sep" />
        <div className="foot">
          {statusErr ? <span style={{ color: "var(--err)" }}>{statusErr}</span> : status ? <>
            <div>{status.sync.state === "running" ? <><span className="spin" /> Syncing ({status.sync.phase})</> : status.last_sync_at ? `Last sync ${new Date(status.last_sync_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Never synced"}</div>
            <div>{status.stats.evidence} evidence · {status.backend.name}{status.backend.degraded ? " (degraded)" : ""}</div>
            <div>{status.sources.map((s) => `${s.id}: ${s.state.last_status}`).join(" · ")}</div>
            {status.sync.state !== "running" && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => void sync()}>Sync now</button>}
            {status.warnings.length > 0 && <div style={{ color: "var(--warn)", marginTop: 6 }}>{status.warnings.length} warning(s) — see Settings</div>}
          </> : "Connecting…"}
        </div>
      </nav>
      <main className="main">{page}</main>
      {why && <WhyDrawer id={why} onClose={() => setWhy(undefined)} onChanged={onChanged} />}
    </div>
  );
}
