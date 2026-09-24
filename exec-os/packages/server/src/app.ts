import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  applyFeedback, askWithEvidence, evidenceLabel, FeedbackKind, Horizon, daysAgo, saveAppConfig, createDataRequest, recordDelivery, DataRequestInput,
  type ActionItem, type Decision, type Escalation, type Risk, type Recommendation, type DataRequest, type Signal, type BusinessMetric,
  type ObjectType, type Evidence, type EvidenceRef,
} from "@execos/core";
import type { Runtime } from "./runtime.js";
import { deleteLocalData } from "./runtime.js";

const APP_VERSION = "0.1.0";
const OBJECT_TYPES: ObjectType[] = ["action", "decision", "escalation", "risk", "recommendation", "data_request", "signal", "metric"];

function uiDist(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const c of [path.resolve(here, "..", "..", "ui", "dist"), path.resolve(here, "..", "ui", "dist")]) if (fs.existsSync(path.join(c, "index.html"))) return c;
  return undefined;
}

function titleOf(o: Record<string, unknown>): string {
  return String(o.title ?? o.topic ?? o.issue ?? o.recommendation ?? o.request ?? o.statement ?? o.name ?? "");
}

export function createApp(rt: Runtime): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  const { store } = rt;

  /* ---- loopback token auth for /api ---- */
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const hdr = req.headers["x-execos-token"] ?? (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);
    if (hdr !== rt.token) { reply.code(401).send({ error: "unauthorized", hint: "Open the app through the launcher (the URL carries the local token)." }); return reply; }
  });

  /* ---- evidence helpers ---- */
  const evidenceView = (e: Evidence, ref?: EvidenceRef) => {
    const provider = rt.providers.find((p) => p.id === e.provider_id);
    const url = provider?.openSourceUrl?.(e) ?? e.source_ref.url;
    return {
      evidence_id: e.evidence_id, provider_id: e.provider_id, source_type: e.source_type, occurred_at: e.occurred_at, retrieved_at: e.retrieved_at,
      title: e.title, participants: e.participants, thread_id: e.thread_id, label: evidenceLabel(e), role: ref?.role, excerpt: ref?.excerpt,
      text: e.text, structured: e.structured, open_url: url, sensitivity: e.sensitivity,
    };
  };
  const withEvidence = (o: Record<string, unknown>) => ({
    ...o,
    evidence_details: ((o.evidence as EvidenceRef[] | undefined) ?? []).map((r) => { const e = store.getEvidence(r.evidence_id); return e ? evidenceView(e, r) : { evidence_id: r.evidence_id, missing: true, label: "Evidence purged (beyond retention)" }; }),
    theme: o.theme_id ? store.getTheme(String(o.theme_id))?.name : undefined,
  });

  /* ---- status ---- */
  app.get("/api/status", async () => ({
    version: APP_VERSION,
    data_root: rt.paths.root,
    backend: { name: rt.backend.name, degraded: rt.degraded, probes: rt.backendProbes },
    sync: rt.orchestrator.status,
    last_sync_at: store.getKv("last_sync_at"),
    bootstrap_completed_at: store.getKv("bootstrap_completed_at"),
    stats: store.stats(),
    warnings: rt.warnings,
    sources: rt.providers.map((p) => ({ ...p.describe(), state: store.getSyncState(p.id) })),
    disabled_sources: rt.disabledProviders,
    user: rt.config.app.user,
  }));

  app.post("/api/sync", async (req) => {
    const body = z.object({ mode: z.enum(["bootstrap", "incremental"]).optional() }).parse(req.body ?? {});
    void rt.orchestrator.run(body.mode).catch((e) => { rt.logger.error("sync failed", { error: e }); rt.orchestrator.status = { ...rt.orchestrator.status, state: "error", last_error: (e as Error).message }; });
    return rt.orchestrator.status;
  });

  /* ---- brief ---- */
  app.get("/api/brief", async (req) => {
    const q = z.object({ horizon: Horizon.default("daily") }).parse(req.query ?? {});
    const summary = store.latestSummary(q.horizon);
    const now = new Date().toISOString();
    const recs = store.listObjects<Recommendation>({ type: "recommendation", status: ["proposed"], limit: 6 }).map((r) => withEvidence(r as unknown as Record<string, unknown>));
    const themes = store.listThemes().slice(0, 8).map((t) => ({ ...t, counts: store.objectsForTheme(t.id) }));
    const metrics = store.listObjects<BusinessMetric>({ type: "metric", limit: 8 });
    const upcoming = store.listEvidence({ since: now, until: daysAgo(-14).toISOString() }).filter((e) => e.source_type === "calendar_event").map((e) => evidenceView(e));
    const window = summary ? { start: summary.period_start, end: summary.period_end } : undefined;
    const changed = window ? store.listJournal({ since: window.start, limit: 60 }).filter((j) => ["detected", "status_changed", "accepted", "dismissed", "merged", "feedback"].includes(j.event) && j.object_type !== "sync" && j.object_type !== "conflict").map((j) => {
      const o = store.getObject(j.object_id); const r = (o?.object ?? {}) as Record<string, unknown>;
      return { ...j, title: j.object_type === "theme" ? store.getTheme(j.object_id)?.name ?? j.summary : titleOf(r) || j.summary, epistemic: r.epistemic, status: r.status };
    }) : [];
    return {
      horizon: q.horizon, summary,
      sections: summary ? summary.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, evidence_details: i.evidence.map((r) => { const e = store.getEvidence(r.evidence_id); return e ? evidenceView(e, r) : undefined; }).filter(Boolean) })) })) : [],
      recommendations: recs, themes, metrics, upcoming, changed,
    };
  });

  /* ---- themes ---- */
  app.get("/api/themes", async () => store.listThemes().map((t) => ({ ...t, counts: store.objectsForTheme(t.id) })));
  app.get("/api/themes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.getTheme(id);
    if (!t) return reply.code(404).send({ error: "not found" });
    const objects: Record<string, unknown[]> = {};
    for (const type of OBJECT_TYPES) objects[type] = store.listObjects({ type, theme_id: id }).map((o) => withEvidence(o as unknown as Record<string, unknown>));
    const evidence = store.getEvidenceMany(t.evidence.map((e) => e.evidence_id)).map((e) => evidenceView(e));
    const journal = store.listJournal({ since: daysAgo(rt.config.app.retention.journal_days).toISOString(), limit: 200 }).filter((j) => (j.object_type === "theme" && j.object_id === id) || (store.getObject(j.object_id)?.object as { theme_id?: string } | undefined)?.theme_id === id);
    return { theme: t, objects, evidence, journal };
  });

  /* ---- objects ---- */
  app.get("/api/objects/:type", async (req, reply) => {
    const { type } = req.params as { type: string };
    if (!OBJECT_TYPES.includes(type as ObjectType)) return reply.code(404).send({ error: "unknown type" });
    const q = z.object({ status: z.string().optional(), filter: z.string().optional(), theme_id: z.string().optional(), includeHidden: z.coerce.boolean().optional() }).parse(req.query ?? {});
    let list = store.listObjects({ type: type as ObjectType, status: q.status ? q.status.split(",") : undefined, theme_id: q.theme_id, includeHidden: q.includeHidden, limit: 500 }) as unknown as Record<string, unknown>[];
    if (type === "action" && q.filter) list = filterActions(list as unknown as ActionItem[], q.filter, rt) as unknown as Record<string, unknown>[];
    return list.map(withEvidence);
  });

  app.get("/api/object/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = store.getObject(store.resolveAlias(id));
    if (!found) return reply.code(404).send({ error: "not found" });
    const o = found.object as unknown as Record<string, unknown>;
    const related: Array<{ type: string; id: string; title: string }> = [];
    for (const ref of (o.evidence as EvidenceRef[] | undefined) ?? []) for (const r of store.objectsForEvidence(ref.evidence_id)) if (r.id !== found.object.id && !related.some((x) => x.id === r.id)) related.push(r);
    const why = {
      epistemic: o.epistemic, confidence: o.confidence, reasoning: o.reasoning ?? o.why_needed ?? o.rationale,
      rule: o.rule, first_seen: o.first_seen, last_observed: o.last_observed, origin: o.origin,
      evidence_summary: ((o.evidence as EvidenceRef[] | undefined) ?? []).map((r) => { const e = store.getEvidence(r.evidence_id); return e ? evidenceLabel(e) : "purged"; }),
    };
    return { type: found.type, object: withEvidence(o), why, related, journal: store.listJournal({ object_id: found.object.id, limit: 100 }), feedback: store.listFeedback(found.object.id) };
  });

  app.get("/api/evidence/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const e = store.getEvidence(id);
    if (!e) return reply.code(404).send({ error: "not found" });
    return { evidence: evidenceView(e), objects: store.objectsForEvidence(id) };
  });

  app.get("/api/evidence", async (req) => {
    const q = z.object({ q: z.string().optional(), since: z.string().optional(), provider: z.string().optional(), limit: z.coerce.number().default(50) }).parse(req.query ?? {});
    const list = q.q ? store.searchEvidence(q.q, q.limit) : store.listEvidence({ since: q.since, provider_id: q.provider, limit: q.limit }).reverse();
    return list.map((e) => evidenceView(e));
  });

  /* ---- data requests (bucket or item level) ---- */
  const drCfg = () => rt.config.app.data_requests;
  app.get("/api/data-requests", async (req) => {
    const q = z.object({ theme_id: z.string().optional(), object_id: z.string().optional(), status: z.string().optional() }).parse(req.query ?? {});
    let list = store.listObjects<DataRequest>({ type: "data_request", theme_id: q.theme_id, status: q.status ? q.status.split(",") : undefined, limit: 500 });
    if (q.object_id) list = list.filter((d) => d.object_id === q.object_id);
    return { endpoint: drCfg().endpoint_url || null, items: list.map((d) => withEvidence(d as unknown as Record<string, unknown>)) };
  });
  app.post("/api/data-requests", async (req, reply) => {
    const input = DataRequestInput.parse(req.body);
    const cfg = drCfg();
    const { request, payload } = createDataRequest(store, { ...input, owner: input.owner ?? (cfg.default_owner || undefined) }, rt.config.app.user);
    let delivery: DataRequest["delivery"] = { status: "not_configured" };
    if (cfg.endpoint_url) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), cfg.timeout_seconds * 1000);
      try {
        const res = await fetch(cfg.endpoint_url, { method: cfg.method, headers: { "content-type": "application/json", ...cfg.headers }, body: JSON.stringify(payload), signal: ctrl.signal });
        let external_id: string | undefined;
        try { const j = await res.clone().json() as Record<string, unknown>; external_id = typeof j.id === "string" ? j.id : typeof j.ticket === "string" ? j.ticket : undefined; } catch { /* non-json */ }
        delivery = res.ok ? { status: "delivered", endpoint: cfg.endpoint_url, at: new Date().toISOString(), response_status: res.status, external_id } : { status: "failed", endpoint: cfg.endpoint_url, at: new Date().toISOString(), response_status: res.status, error: `HTTP ${res.status}` };
      } catch (e) {
        delivery = { status: "failed", endpoint: cfg.endpoint_url, at: new Date().toISOString(), error: (e as Error).name === "AbortError" ? `timeout after ${cfg.timeout_seconds}s` : (e as Error).message };
      } finally { clearTimeout(t); }
      rt.logger.info("data request forwarded", { id: request.id, status: delivery.status, response_status: delivery.response_status });
    }
    const final = recordDelivery(store, request.id, delivery) ?? request;
    return reply.code(201).send({ ok: true, request: withEvidence(final as unknown as Record<string, unknown>), delivery, payload_preview: payload });
  });

  /* ---- executive drill-down summary (level 1) ---- */
  app.get("/api/exec", async () => {
    const now = new Date().toISOString();
    const summary = store.latestSummary("daily") ?? store.latestSummary("weekly");
    const themes = store.listThemes().map((t) => {
      const counts = store.objectsForTheme(t.id);
      const sources = new Set<string>();
      for (const r of t.evidence) { const e = store.getEvidence(r.evidence_id); if (e) sources.add(e.source_type); }
      const actions = store.listObjects<ActionItem>({ type: "action", theme_id: t.id });
      const decisions = store.listObjects<Decision>({ type: "decision", theme_id: t.id });
      const escalations = store.listObjects<Escalation>({ type: "escalation", theme_id: t.id });
      const reqs = store.listObjects<DataRequest>({ type: "data_request", theme_id: t.id });
      return {
        ...t, counts, derived_from: { evidence: t.evidence.length, source_types: [...sources] },
        attention: {
          overdue: actions.filter((a) => !["completed", "dismissed"].includes(a.status) && a.due_at && a.due_at < now).length,
          decisions_needed: decisions.filter((d) => d.status === "needed" || d.status === "pending_approval").length,
          escalations: escalations.filter((e) => e.status === "potential" || e.status === "active").length,
          open_requests: reqs.filter((r) => !["declined", "delivered"].includes(r.status)).length,
        },
      };
    });
    const pick = (type: ObjectType, status?: string[]) => store.listObjects({ type, status, limit: 50 }).map((o) => withEvidence(o as unknown as Record<string, unknown>));
    const overdue = (store.listObjects<ActionItem>({ type: "action" }).filter((a) => !["completed", "dismissed"].includes(a.status) && a.due_at && a.due_at < now)).map((o) => withEvidence(o as unknown as Record<string, unknown>));
    return {
      generated_at: summary?.generated_at, narrative: summary?.sections.find((s) => s.heading === "Highlights")?.narrative,
      coverage: summary?.coverage, backend: { name: rt.backend.name, degraded: rt.degraded },
      attention: { decisions_needed: pick("decision", ["needed", "pending_approval"]), escalations: pick("escalation", ["potential", "active"]), overdue_actions: overdue, recommendations: pick("recommendation", ["proposed"]), open_data_requests: pick("data_request", ["identified", "submitted", "accepted", "in_progress"]) },
      buckets: themes,
      metrics: store.listObjects<BusinessMetric>({ type: "metric", limit: 8 }),
      upcoming: store.listEvidence({ since: now, until: daysAgo(-14).toISOString() }).filter((e) => e.source_type === "calendar_event").map((e) => evidenceView(e)),
      data_request_endpoint: drCfg().endpoint_url || null,
    };
  });

  /* ---- feedback ---- */
  app.post("/api/feedback", async (req, reply) => {
    const body = z.object({ object_type: z.string(), object_id: z.string(), kind: FeedbackKind, payload: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
    const res = applyFeedback(store, body);
    if (!res.ok) return reply.code(400).send(res);
    return res;
  });

  /* ---- ask ---- */
  app.post("/api/ask", async (req) => {
    const body = z.object({ question: z.string().min(2).max(2000) }).parse(req.body);
    const a = await askWithEvidence(store, rt.backend, rt.orchestrator.skillContext(), body.question, rt.logger);
    return { ...a, evidence: a.evidence.map((e) => { const full = store.getEvidence(e.evidence_id); return full ? evidenceView(full) : e; }), backend: rt.backend.name, degraded: rt.degraded };
  });

  /* ---- journal / timeline ---- */
  app.get("/api/journal", async (req) => {
    const q = z.object({ days: z.coerce.number().default(rt.config.app.retention.journal_days), object_id: z.string().optional() }).parse(req.query ?? {});
    return store.listJournal({ since: daysAgo(q.days).toISOString(), object_id: q.object_id, limit: 500 }).map((j) => {
      const o = j.object_type === "theme" ? undefined : store.getObject(j.object_id);
      const r = (o?.object ?? {}) as Record<string, unknown>;
      return { ...j, title: j.object_type === "theme" ? store.getTheme(j.object_id)?.name : titleOf(r) || undefined, status: r.status, epistemic: r.epistemic };
    });
  });

  /* ---- sources ---- */
  app.get("/api/sources", async () => ({
    providers: rt.providers.map((p) => ({ ...p.describe(), enabled: true, state: store.getSyncState(p.id), registry: store.listSourceRegistry().find((r) => r.id === p.id) })),
    disabled: rt.disabledProviders,
    backend: { name: rt.backend.name, degraded: rt.degraded, probes: rt.backendProbes },
    config_files: rt.config.sources,
    stakeholders: store.listStakeholders(20),
  }));

  /* ---- settings ---- */
  const sanitized = () => {
    const a = rt.config.app;
    return { user: a.user, retention: a.retention, enabled_sources: a.enabled_sources, summaries: a.summaries, themes: a.themes, terminology: a.terminology, important_roles: a.important_roles, intelligence: { backend: a.intelligence.backend, copilot: { command: a.intelligence.copilot.command, model: a.intelligence.copilot.model } }, data_requests: { endpoint_url: a.data_requests.endpoint_url, method: a.data_requests.method, default_owner: a.data_requests.default_owner, has_headers: Object.keys(a.data_requests.headers).length > 0 }, server: a.server, logging: a.logging };
  };
  app.get("/api/settings", async () => ({ config: sanitized(), paths: rt.paths, warnings: rt.warnings, docs_inside_repo: false }));
  app.put("/api/settings", async (req) => {
    const body = z.object({
      user: z.object({ display_name: z.string(), email: z.string(), role: z.string(), team_members: z.array(z.string()) }).partial().optional(),
      retention: z.object({ lookback_days: z.number().int().min(1).max(365), journal_days: z.number().int().min(1).max(365), raw_text: z.enum(["trimmed", "full", "none"]) }).partial().optional(),
      summaries: z.object({ daily: z.boolean(), weekly: z.boolean(), monthly: z.boolean(), quarterly: z.boolean() }).partial().optional(),
      themes: z.object({ auto_discover: z.boolean(), pinned: z.array(z.string()) }).partial().optional(),
      enabled_sources: z.record(z.string(), z.boolean()).optional(),
      data_requests: z.object({ endpoint_url: z.string(), method: z.enum(["POST", "PUT"]), default_owner: z.string() }).partial().optional(),
    }).parse(req.body);
    const a = rt.config.app;
    if (body.user) Object.assign(a.user, body.user);
    if (body.retention) Object.assign(a.retention, body.retention);
    if (body.summaries) Object.assign(a.summaries, body.summaries);
    if (body.themes) Object.assign(a.themes, body.themes);
    if (body.enabled_sources) Object.assign(a.enabled_sources, body.enabled_sources);
    if (body.data_requests) Object.assign(a.data_requests, body.data_requests);
    saveAppConfig(rt.paths, a);
    return { ok: true, config: sanitized(), restart_required: !!body.enabled_sources };
  });

  app.post("/api/data/delete", async (req, reply) => {
    const body = z.object({ confirm: z.literal("DELETE"), include_config: z.boolean().default(false) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "confirmation required" });
    store.close();
    const removed = deleteLocalData(rt.paths, { includeConfig: body.data.include_config });
    rt.logger.warn("local data deleted by user", { removed: removed.length });
    setTimeout(() => process.exit(0), 300);
    return { ok: true, removed, message: "Local data deleted. ExecOS will exit; relaunch to start fresh." };
  });

  /* ---- static UI ---- */
  const dist = uiDist();
  if (dist) {
    app.register(fastifyStatic, { root: dist, prefix: "/", wildcard: true, index: ["index.html"] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({ message: "ExecOS API is running. UI is not built: run `npm run build` in exec-os/." }));
  }

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    rt.logger.error("request failed", { error: err });
    const status = err.statusCode ?? (err instanceof z.ZodError ? 400 : 500);
    reply.code(status).send({ error: err instanceof z.ZodError ? "invalid request" : err.message });
  });

  return app;
}

function filterActions(list: ActionItem[], filter: string, rt: Runtime): ActionItem[] {
  const now = new Date().toISOString(); const week = daysAgo(-7).toISOString();
  const me = rt.config.app.user.display_name.toLowerCase(); const meEmail = rt.config.app.user.email.toLowerCase();
  const team = rt.config.app.user.team_members.map((t) => t.toLowerCase());
  const open = (a: ActionItem) => !["completed", "dismissed"].includes(a.status);
  const isMe = (s?: string) => !!s && ((me && s.toLowerCase().includes(me)) || (meEmail && s.toLowerCase() === meEmail));
  switch (filter) {
    case "mine": return list.filter((a) => open(a) && (isMe(a.owner) || a.stakeholders.some(isMe)));
    case "team": return list.filter((a) => open(a) && team.some((t) => a.owner?.toLowerCase().includes(t) || a.stakeholders.some((s) => s.toLowerCase().includes(t))));
    case "overdue": return list.filter((a) => open(a) && a.due_at && a.due_at < now);
    case "week": return list.filter((a) => open(a) && a.due_at && a.due_at >= now && a.due_at < week);
    case "waiting": return list.filter((a) => ["detected", "blocked", "confirmed"].includes(a.status));
    case "escalated": return list.filter((a) => ["escalation_candidate", "escalated"].includes(a.status));
    case "completed": return list.filter((a) => a.status === "completed");
    default: return list.filter(open);
  }
}

export type { Decision, Escalation, Risk, DataRequest, Signal };
