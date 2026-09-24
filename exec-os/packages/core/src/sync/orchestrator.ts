/**
 * Sync orchestrator: sense → interpret → (rules) → summarize, incrementally, with graceful degradation.
 * A failing provider never destroys existing state; coverage gaps are recorded, not hidden.
 */
import type { Store } from "../store/store.js";
import type { SourceProvider, HealthStatus } from "../providers/types.js";
import type { IntelligenceBackend } from "../intelligence/backends/types.js";
import type { AppConfig } from "../config/schema.js";
import type { Logger } from "../logging/logger.js";
import type { Evidence, Horizon } from "../domain/index.js";
import { analyzeBatch, type SkillContext } from "../intelligence/skills/index.js";
import { buildBatches } from "../intelligence/pipeline/batching.js";
import { reconcileObservations } from "../intelligence/pipeline/reconcile.js";
import { applyThemeHints, ensurePinnedThemes, refreshThemeStates } from "../intelligence/pipeline/themes.js";
import { runRules } from "../intelligence/pipeline/rules.js";
import { buildSummary } from "../intelligence/pipeline/summaries.js";
import { daysAgo, nowIso } from "../util.js";

export interface SyncStatus {
  state: "idle" | "running" | "error";
  phase?: string;
  started_at?: string;
  finished_at?: string;
  last_error?: string;
  progress: { providers_done: number; providers_total: number; batches_done: number; batches_total: number };
  last_result?: SyncResult;
}

export interface SyncResult {
  mode: "bootstrap" | "incremental";
  started_at: string; finished_at: string; duration_ms: number;
  providers: Array<{ id: string; status: "ok" | "partial" | "error" | "auth_required" | "unavailable"; items_seen: number; items_new: number; message?: string; notes?: string[] }>;
  batches: number; observations: number; created: number; updated: number;
  recommendations_created: number; escalations_created: number;
  summaries: Horizon[];
  backend: string; degraded: boolean;
}

export interface OrchestratorDeps {
  store: Store; providers: SourceProvider[]; backend: IntelligenceBackend; app: AppConfig; logger: Logger; degraded: boolean;
  contextExcerpt?: () => string | undefined; now?: () => Date;
}

export class SyncOrchestrator {
  status: SyncStatus = { state: "idle", progress: { providers_done: 0, providers_total: 0, batches_done: 0, batches_total: 0 } };
  private running: Promise<SyncResult> | undefined;
  constructor(private readonly d: OrchestratorDeps) {}

  skillContext(): SkillContext {
    const a = this.d.app;
    return {
      today: (this.d.now?.() ?? new Date()).toISOString().slice(0, 10),
      user: { display_name: a.user.display_name, role: a.user.role, email: a.user.email, team_members: a.user.team_members },
      terminology: a.terminology, important_roles: a.important_roles, pinned_themes: a.themes.pinned,
      known_themes: this.d.store.listThemes().map((t) => t.name), org_context_excerpt: this.d.contextExcerpt?.(),
    };
  }

  run(mode?: "bootstrap" | "incremental"): Promise<SyncResult> {
    if (this.running) return this.running;
    this.running = this.execute(mode).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async execute(modeArg?: "bootstrap" | "incremental"): Promise<SyncResult> {
    const { store, providers, backend, app, logger } = this.d;
    const now = this.d.now?.() ?? new Date();
    const started = nowIso();
    const t0 = Date.now();
    const mode = modeArg ?? (store.getKv("bootstrap_completed_at") ? "incremental" : "bootstrap");
    this.status = { state: "running", phase: "sense", started_at: started, progress: { providers_done: 0, providers_total: providers.length, batches_done: 0, batches_total: 0 } };
    store.journal({ object_type: "sync", object_id: mode, event: "sync_started", actor: "system", summary: `${mode} sync started` });
    const result: SyncResult = { mode, started_at: started, finished_at: "", duration_ms: 0, providers: [], batches: 0, observations: 0, created: 0, updated: 0, recommendations_created: 0, escalations_created: 0, summaries: [], backend: backend.name, degraded: this.d.degraded };
    const window = { since: daysAgo(app.retention.lookback_days, now).toISOString(), until: daysAgo(-30, now).toISOString() };
    const healthById: Array<{ id: string; health: HealthStatus }> = [];
    const partialReasons: string[] = [];

    /* ---------------- SENSE ---------------- */
    const newEvidence: Evidence[] = [];
    for (const p of providers) {
      const st = store.getSyncState(p.id);
      const pt0 = Date.now();
      let seen = 0, added = 0; const notes: string[] = []; let partial = false;
      try {
        const health = await p.checkHealth();
        healthById.push({ id: p.id, health });
        const caps = await p.discoverCapabilities().catch(() => []);
        store.setSourceRegistry({ ...p.describe(), health, capabilities: caps, enabled: true });
        if (!health.ok && !health.auth_required) throw Object.assign(new Error(health.message ?? "unavailable"), { unavailable: true });
        if (health.auth_required && !health.ok) throw Object.assign(new Error(health.message ?? "authentication required"), { auth: true });
        let cursor = st.cursor;
        for await (const batch of p.fetchSince(cursor, window, { logger: logger.child(p.id) })) {
          for (const e of batch.items) {
            seen++;
            const r = store.upsertEvidence(e);
            if (r.inserted) { added++; newEvidence.push(e); for (const person of e.participants) store.touchStakeholder(person.name, person.email, e.occurred_at); }
          }
          cursor = batch.next_cursor;
          if (batch.partial) partial = true;
          if (batch.notes?.length) notes.push(...batch.notes);
        }
        store.setSyncState({ provider_id: p.id, cursor, last_sync_at: nowIso(), last_status: partial ? "partial" : "ok", last_error: undefined, stats: { items_seen: seen, items_new: added, duration_ms: Date.now() - pt0 } });
        result.providers.push({ id: p.id, status: partial ? "partial" : "ok", items_seen: seen, items_new: added, notes, message: health.message });
        if (partial) partialReasons.push(`${p.id}: partial coverage${notes[0] ? ` (${notes[0]})` : ""}`);
      } catch (e) {
        const err = e as Error & { auth?: boolean; unavailable?: boolean };
        const status = err.auth ? "auth_required" : err.unavailable ? "unavailable" : "error";
        logger.warn("provider failed; continuing with others", { provider: p.id, status, error: err });
        // Keep the previous cursor and state: nothing is destroyed.
        store.setSyncState({ ...st, last_sync_at: nowIso(), last_status: status, last_error: err.message });
        result.providers.push({ id: p.id, status, items_seen: seen, items_new: added, message: err.message });
        if (!healthById.some((h) => h.id === p.id)) healthById.push({ id: p.id, health: { ok: false, message: err.message } });
        partialReasons.push(`${p.id}: ${status} — ${err.message}`);
      }
      this.status.progress.providers_done++;
    }

    /* ---------------- INTERPRET ---------------- */
    this.status.phase = "interpret";
    ensurePinnedThemes(store, app.themes.pinned);
    const pending = store.listEvidence({ unanalyzedOnly: true, since: window.since });
    const batches = buildBatches(pending, app.intelligence.batch);
    this.status.progress.batches_total = batches.length;
    result.batches = batches.length;
    const ctx = this.skillContext();
    for (const b of batches) {
      try {
        const existing = [
          ...store.listObjects({ type: "action", limit: 200 }).map((o) => ({ type: "action", id: (o as { id: string }).id, title: (o as { title: string }).title, status: (o as { status?: string }).status, owner: (o as { owner?: string }).owner })),
          ...store.listObjects({ type: "decision", limit: 100 }).map((o) => ({ type: "decision", id: (o as { id: string }).id, title: (o as { topic: string }).topic, status: (o as { status?: string }).status })),
          ...store.listObjects({ type: "escalation", limit: 100 }).map((o) => ({ type: "escalation", id: (o as { id: string }).id, title: (o as { issue: string }).issue, status: (o as { status?: string }).status })),
        ];
        const analysis = await backend.runSkill(analyzeBatch, {
          batch_id: b.id,
          evidence: b.evidence.map((e) => ({ evidence_id: e.evidence_id, source_type: e.source_type, occurred_at: e.occurred_at, title: e.title, participants: e.participants.map((p) => p.name), thread_id: e.thread_id, text: e.text, structured: e.structured })),
          existing_items: existing,
        }, ctx, { logger, batchEvidence: b.evidence.map((e) => ({ evidence_id: e.evidence_id, source_ref_id: e.source_ref.id, source_type: e.source_type, title: e.title, text: e.text, occurred_at: e.occurred_at })) });
        const resolver = applyThemeHints(store, analysis.themes, app.themes.auto_discover);
        const valid = analysis.observations.filter((o) => o.evidence_ids.every((id) => !!store.getEvidence(id)));
        const rr = store.transaction(() => reconcileObservations(store, valid, resolver, logger, now.toISOString()));
        result.observations += valid.length; result.created += rr.created; result.updated += rr.updated;
        for (const c of analysis.conflicts) store.journal({ object_type: "conflict", object_id: b.id, event: "detected", actor: "system", summary: c.statement, evidence: c.evidence_ids.map((id) => ({ evidence_id: id, role: "contradicts" as const })) });
        store.markAnalyzed(b.evidence.map((e) => e.evidence_id));
      } catch (e) {
        logger.error("batch analysis failed; evidence left for next sync", { batch: b.id, error: e });
        partialReasons.push(`Analysis of ${b.evidence.length} item(s) failed: ${(e as Error).message}`);
      }
      this.status.progress.batches_done++;
    }

    /* ---------------- DECIDE (rules) ---------------- */
    this.status.phase = "decide";
    const rules = runRules(store, now);
    result.recommendations_created = rules.recommendations_created; result.escalations_created = rules.escalations_created;
    refreshThemeStates(store, daysAgo(7, now).toISOString());

    /* ---------------- ALIGN (summaries) ---------------- */
    this.status.phase = "summarize";
    const coverage = healthById.map((h) => ({ id: h.id, ok: h.health.ok, message: h.health.message }));
    const horizons: Horizon[] = (["daily", "weekly", "monthly", "quarterly"] as Horizon[]).filter((h) => app.summaries[h]);
    for (const h of horizons) {
      try { await buildSummary(store, backend, ctx, h, coverage, partialReasons, logger, now); result.summaries.push(h); }
      catch (e) { logger.error("summary failed", { horizon: h, error: e }); }
    }

    /* ---------------- LEARN (retention, bookkeeping) ---------------- */
    this.status.phase = "retention";
    const purgedEv = store.purgeEvidenceBefore(daysAgo(app.retention.lookback_days, now).toISOString());
    const purgedJr = store.purgeJournalBefore(daysAgo(app.retention.journal_keep_days, now).toISOString());
    if (purgedEv || purgedJr) store.journal({ object_type: "sync", object_id: mode, event: "purged", actor: "system", summary: `Purged ${purgedEv} evidence, ${purgedJr} journal entries beyond retention` });
    if (mode === "bootstrap") store.setKv("bootstrap_completed_at", nowIso());
    store.setKv("last_sync_at", nowIso());

    result.finished_at = nowIso(); result.duration_ms = Date.now() - t0;
    store.journal({ object_type: "sync", object_id: mode, event: "sync_completed", actor: "system", summary: `${result.created} new, ${result.updated} updated, ${newEvidence.length} new evidence`, after: { providers: result.providers.map((p) => ({ id: p.id, status: p.status, new: p.items_new })) } });
    this.status = { state: "idle", finished_at: result.finished_at, started_at: started, progress: this.status.progress, last_result: result };
    logger.info("sync complete", { mode, duration_ms: result.duration_ms, created: result.created, updated: result.updated, evidence_new: newEvidence.length });
    return result;
  }
}
