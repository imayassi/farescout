import { useCallback, useEffect, useState } from "react";
import { api, bootstrapToken, type Status } from "./api";
import { WhyDrawer } from "./components/common";
import { ExecutiveTab, BucketTab, ItemTab, EvidenceTab, type DrillNav } from "./pages/Drill";
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

const MORE: Array<[string, string]> = [["/brief", "Brief"], ["/themes", "Themes"], ["/actions", "Actions"], ["/decisions", "Decisions"], ["/escalations", "Escalations"], ["/risks", "Risks"], ["/recommendations", "Recommendations"], ["/data-requests", "Data requests"], ["/timeline", "Timeline"], ["/ask", "Ask"], ["/sources", "Sources"], ["/settings", "Settings"]];

export function App() {
  bootstrapToken();
  const [path, query, go] = useRoute();
  const [why, setWhy] = useState<string>();
  const [status, setStatus] = useState<Status>();
  const [statusErr, setStatusErr] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  // Remembered drill-down selections so the higher tabs stay reachable.
  const [sel, setSel] = useState<{ bucket?: { id: string; name?: string }; item?: { id: string; title?: string }; evidence?: { id: string; label?: string } }>({});
  const refreshStatus = useCallback(() => api.get<Status>("/api/status").then((s) => { setStatus(s); setStatusErr(undefined); }).catch((e) => setStatusErr((e as Error).message)), []);
  useEffect(() => { void refreshStatus(); api.get<{ config: { data_requests: { endpoint_url: string } } }>("/api/settings").then((s) => setEndpoint(s.config.data_requests.endpoint_url || null)).catch(() => undefined); }, [refreshStatus, refreshKey]);
  useEffect(() => {
    if (status?.sync.state !== "running") return;
    const t = setInterval(async () => { const s = await api.get<Status>("/api/status").catch(() => undefined); if (s) { setStatus(s); if (s.sync.state !== "running") setRefreshKey((k) => k + 1); } }, 1500);
    return () => clearInterval(t);
  }, [status?.sync.state]);
  const sync = async (mode?: string) => { await api.post("/api/sync", mode ? { mode } : {}); void refreshStatus(); };
  const onChanged = () => { setRefreshKey((k) => k + 1); void refreshStatus(); };
  const nav: DrillNav = {
    openBucket: (id) => { setSel((s) => ({ ...s, bucket: { id } })); go(`/bucket/${id}`); },
    openItem: (id) => { setSel((s) => ({ ...s, item: { id } })); go(`/item/${id}`); },
    openEvidence: (id) => { setSel((s) => ({ ...s, evidence: { id } })); go(`/evidence/${id}`); },
  };

  let page: React.ReactNode; let level = 0;
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/bucket\/(.+)$/))) { level = 2; page = <BucketTab id={m[1]!} nav={nav} refreshKey={refreshKey} endpoint={endpoint} onChanged={onChanged} />; }
  else if ((m = path.match(/^\/item\/(.+)$/))) { level = 3; page = <ItemTab id={m[1]!} nav={nav} refreshKey={refreshKey} endpoint={endpoint} onChanged={onChanged} />; }
  else if ((m = path.match(/^\/evidence\/(.+)$/))) { level = 4; page = <EvidenceTab id={m[1]!} nav={nav} refreshKey={refreshKey} />; }
  else if ((m = path.match(/^\/themes\/(.+)$/))) page = <ThemeDetail id={m[1]!} onWhy={setWhy} refreshKey={refreshKey} />;
  else switch (path) {
    case "/brief": page = <Home onWhy={setWhy} go={go} refreshKey={refreshKey} />; break;
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
    default: level = 1; page = <ExecutiveTab nav={nav} refreshKey={refreshKey} />;
  }

  const tabs: Array<{ n: number; label: string; href?: string; on: boolean }> = [
    { n: 1, label: "Executive", href: "#/", on: level === 1 },
    { n: 2, label: sel.bucket ? "Bucket" : "Bucket (pick one)", href: sel.bucket ? `#/bucket/${sel.bucket.id}` : undefined, on: level === 2 },
    { n: 3, label: sel.item ? "Item" : "Item (pick one)", href: sel.item ? `#/item/${sel.item.id}` : undefined, on: level === 3 },
    { n: 4, label: sel.evidence ? "Evidence" : "Evidence (pick one)", href: sel.evidence ? `#/evidence/${sel.evidence.id}` : undefined, on: level === 4 },
  ];
  return (
    <div className="shell drill">
      <header className="topbar">
        <div className="brand"><span className="mark">E</span><div><b>ExecOS</b><div className="small muted">Leadership team · operating intelligence</div></div></div>
        <nav className="leveltabs" aria-label="Drill-down levels">
          {tabs.map((t) => t.href ? <a key={t.n} href={t.href} className={t.on ? "on" : ""}><span className="n">{t.n}</span>{t.label}</a> : <span key={t.n} className="off"><span className="n">{t.n}</span>{t.label}</span>)}
        </nav>
        <details className="more"><summary>More</summary><div className="menu">{MORE.map(([p, l]) => <a key={p} href={`#${p}`} className={path === p ? "active" : ""}>{l}</a>)}</div></details>
        <div className="statusline small muted">
          {statusErr ? <span style={{ color: "var(--err)" }}>{statusErr}</span> : status ? <>
            {status.sync.state === "running" ? <><span className="spin" /> Syncing ({status.sync.phase})</> : status.last_sync_at ? `Synced ${new Date(status.last_sync_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Never synced"}
            {" · "}{status.stats.evidence} evidence · {status.backend.name}{status.backend.degraded ? " (degraded)" : ""}
            {status.sync.state !== "running" && <> · <button className="btn link sm" onClick={() => void sync()}>Sync now</button></>}
          </> : "Connecting…"}
        </div>
      </header>
      <main className="main">{page}</main>
      {why && <WhyDrawer id={why} onClose={() => setWhy(undefined)} onChanged={onChanged} />}
    </div>
  );
}
