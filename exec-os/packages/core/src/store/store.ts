import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema.js";
import {
  Evidence, Theme, ActionItem, Decision, Escalation, Risk, Recommendation, DataRequest, Signal,
  BusinessMetric, Summary, JournalEntry, Feedback, SyncState, Stakeholder, BucketSkill,
  type EvidenceRef, type ObjectType, type Horizon,
} from "../domain/index.js";
import { newId, nowIso } from "../util.js";
import type { ProviderInfo, HealthStatus } from "../providers/types.js";

type Row = Record<string, unknown>;

export type AnyObject = ActionItem | Decision | Escalation | Risk | Recommendation | DataRequest | Signal | BusinessMetric;

const SCHEMAS = {
  action: ActionItem, decision: Decision, escalation: Escalation, risk: Risk,
  recommendation: Recommendation, data_request: DataRequest, signal: Signal, metric: BusinessMetric,
} as const;

function titleOf(type: ObjectType, o: Row): string {
  switch (type) {
    case "action": return String(o.title ?? "");
    case "decision": return String(o.topic ?? "");
    case "escalation": return String(o.issue ?? "");
    case "risk": return String(o.title ?? "");
    case "recommendation": return String(o.recommendation ?? "");
    case "data_request": return String(o.request ?? "");
    case "signal": return String(o.statement ?? "");
    case "metric": return String(o.name ?? "");
    default: return "";
  }
}

export interface ObjectQuery {
  type: ObjectType;
  status?: string[];
  theme_id?: string;
  owner?: string;
  includeHidden?: boolean;
  updatedSince?: string;
  limit?: number;
}

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare("PRAGMA user_version").get() as Row;
    const current = Number(row.user_version ?? 0);
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
  }

  close(): void { this.db.close(); }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try { const r = fn(); this.db.exec("COMMIT"); return r; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  /* ----------------------------- kv ----------------------------------- */
  getKv(k: string): string | undefined {
    const r = this.db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as Row | undefined;
    return r ? String(r.v) : undefined;
  }
  setKv(k: string, v: string): void {
    this.db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, v);
  }

  /* --------------------------- evidence ------------------------------- */
  /** Insert evidence unless an identical id or content hash already exists. Returns true if inserted. */
  upsertEvidence(e: Evidence): { inserted: boolean; duplicateOf?: string; excluded?: boolean } {
    if (this.isEvidenceExcluded(e.evidence_id, e.content_hash)) return { inserted: false, excluded: true };
    const byId = this.db.prepare("SELECT evidence_id FROM evidence WHERE evidence_id = ?").get(e.evidence_id) as Row | undefined;
    if (byId) return { inserted: false, duplicateOf: e.evidence_id };
    const byHash = this.db.prepare("SELECT evidence_id FROM evidence WHERE content_hash = ?").get(e.content_hash) as Row | undefined;
    if (byHash) return { inserted: false, duplicateOf: String(byHash.evidence_id) };
    this.db.prepare(
      `INSERT INTO evidence(evidence_id, provider_id, source_type, occurred_at, retrieved_at, title, thread_id, content_hash, payload)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(e.evidence_id, e.provider_id, e.source_type, e.occurred_at, e.retrieved_at, e.title, e.thread_id ?? null, e.content_hash, JSON.stringify(e));
    this.db.prepare("INSERT INTO evidence_fts(evidence_id, title, text, participants) VALUES (?,?,?,?)").run(
      e.evidence_id, e.title, e.text ?? "", e.participants.map((p) => p.name).join(", "),
    );
    return { inserted: true };
  }

  getEvidence(id: string): Evidence | undefined {
    const r = this.db.prepare("SELECT payload FROM evidence WHERE evidence_id = ?").get(id) as Row | undefined;
    return r ? Evidence.parse(JSON.parse(String(r.payload))) : undefined;
  }

  getEvidenceMany(ids: string[]): Evidence[] {
    const out: Evidence[] = [];
    for (const id of ids) { const e = this.getEvidence(id); if (e) out.push(e); }
    return out;
  }

  listEvidence(opts: { since?: string; until?: string; provider_id?: string; limit?: number; unanalyzedOnly?: boolean } = {}): Evidence[] {
    const where: string[] = []; const args: unknown[] = [];
    if (opts.since) { where.push("occurred_at >= ?"); args.push(opts.since); }
    if (opts.until) { where.push("occurred_at < ?"); args.push(opts.until); }
    if (opts.provider_id) { where.push("provider_id = ?"); args.push(opts.provider_id); }
    if (opts.unanalyzedOnly) where.push("analyzed_at IS NULL");
    const sql = `SELECT payload FROM evidence ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY occurred_at ASC ${opts.limit ? "LIMIT " + opts.limit : ""}`;
    return (this.db.prepare(sql).all(...(args as never[])) as Row[]).map((r) => Evidence.parse(JSON.parse(String(r.payload))));
  }

  markAnalyzed(ids: string[], at: string = nowIso()): void {
    const st = this.db.prepare("UPDATE evidence SET analyzed_at = ? WHERE evidence_id = ?");
    for (const id of ids) st.run(at, id);
  }

  countEvidence(): number {
    return Number((this.db.prepare("SELECT COUNT(*) c FROM evidence").get() as Row).c);
  }

  searchEvidence(query: string, limit = 20): Evidence[] {
    const q = query.replace(/["']/g, " ").split(/\s+/).filter(Boolean).map((w) => `"${w}"`).join(" OR ");
    if (!q) return [];
    const rows = this.db.prepare(
      `SELECT e.payload FROM evidence_fts f JOIN evidence e ON e.evidence_id = f.evidence_id
       WHERE evidence_fts MATCH ? ORDER BY bm25(evidence_fts) LIMIT ?`,
    ).all(q, limit) as Row[];
    return rows.map((r) => Evidence.parse(JSON.parse(String(r.payload))));
  }

  purgeEvidenceBefore(iso: string): number {
    const ids = (this.db.prepare("SELECT evidence_id FROM evidence WHERE occurred_at < ?").all(iso) as Row[]).map((r) => String(r.evidence_id));
    if (ids.length === 0) return 0;
    const del = this.db.prepare("DELETE FROM evidence WHERE evidence_id = ?");
    const delF = this.db.prepare("DELETE FROM evidence_fts WHERE evidence_id = ?");
    const delL = this.db.prepare("DELETE FROM object_evidence WHERE evidence_id = ?");
    for (const id of ids) { del.run(id); delF.run(id); delL.run(id); }
    return ids.length;
  }

  /* ----------------------------- themes ------------------------------- */
  upsertTheme(t: Theme): void {
    this.db.prepare(
      `INSERT INTO themes(id, slug, name, pinned, hidden, updated_at, payload) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name, pinned=excluded.pinned, hidden=excluded.hidden, updated_at=excluded.updated_at, payload=excluded.payload`,
    ).run(t.id, t.slug, t.name, t.pinned ? 1 : 0, t.hidden ? 1 : 0, t.updated_at, JSON.stringify(t));
    const link = this.db.prepare("INSERT OR IGNORE INTO theme_evidence(theme_id, evidence_id) VALUES (?,?)");
    for (const ref of t.evidence) link.run(t.id, ref.evidence_id);
  }
  getTheme(id: string): Theme | undefined {
    const r = this.db.prepare("SELECT payload FROM themes WHERE id = ?").get(id) as Row | undefined;
    return r ? Theme.parse(JSON.parse(String(r.payload))) : undefined;
  }
  getThemeBySlug(slug: string): Theme | undefined {
    const r = this.db.prepare("SELECT payload FROM themes WHERE slug = ?").get(slug) as Row | undefined;
    return r ? Theme.parse(JSON.parse(String(r.payload))) : undefined;
  }
  listThemes(includeHidden = false): Theme[] {
    const rows = this.db.prepare(`SELECT payload FROM themes ${includeHidden ? "" : "WHERE hidden = 0"} ORDER BY pinned DESC, updated_at DESC`).all() as Row[];
    return rows.map((r) => Theme.parse(JSON.parse(String(r.payload))));
  }

  /* ----------------------------- objects ------------------------------ */
  upsertObject(type: ObjectType, obj: AnyObject): void {
    const schema = SCHEMAS[type as keyof typeof SCHEMAS];
    const parsed = schema.parse(obj) as Row;
    const p = parsed;
    this.db.prepare(
      `INSERT INTO objects(id, type, theme_id, status, owner, epistemic, confidence, title, created_at, updated_at, last_observed, due_at, hidden, fingerprint, payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET theme_id=excluded.theme_id, status=excluded.status, owner=excluded.owner, epistemic=excluded.epistemic,
         confidence=excluded.confidence, title=excluded.title, updated_at=excluded.updated_at, last_observed=excluded.last_observed,
         due_at=excluded.due_at, hidden=excluded.hidden, fingerprint=excluded.fingerprint, payload=excluded.payload`,
    ).run(
      String(p.id), type, (p.theme_id as string | undefined) ?? null, (p.status as string | undefined) ?? null,
      ((p.owner ?? p.decision_maker ?? p.suggested_owner) as string | undefined) ?? null,
      String(p.epistemic ?? "fact"), Number(p.confidence ?? 0.5), titleOf(type, p),
      String(p.created_at ?? p.as_of ?? nowIso()), String(p.updated_at ?? nowIso()), String(p.last_observed ?? p.as_of ?? nowIso()),
      (p.due_at as string | undefined) ?? (p.needed_by as string | undefined) ?? null, p.hidden ? 1 : 0,
      (p.fingerprint as string | undefined) ?? null, JSON.stringify(parsed),
    );
    const link = this.db.prepare("INSERT OR IGNORE INTO object_evidence(object_id, evidence_id, role, excerpt) VALUES (?,?,?,?)");
    for (const ref of (p.evidence as EvidenceRef[] | undefined) ?? []) link.run(String(p.id), ref.evidence_id, ref.role, ref.excerpt ?? null);
  }

  getObject<T extends AnyObject = AnyObject>(id: string): { type: ObjectType; object: T } | undefined {
    const r = this.db.prepare("SELECT type, payload FROM objects WHERE id = ?").get(id) as Row | undefined;
    if (!r) return undefined;
    const type = String(r.type) as ObjectType;
    const schema = SCHEMAS[type as keyof typeof SCHEMAS];
    return { type, object: schema.parse(JSON.parse(String(r.payload))) as unknown as T };
  }

  listObjects<T extends AnyObject = AnyObject>(q: ObjectQuery): T[] {
    const where: string[] = ["type = ?"]; const args: unknown[] = [q.type];
    if (!q.includeHidden) where.push("hidden = 0");
    if (q.status && q.status.length) { where.push(`status IN (${q.status.map(() => "?").join(",")})`); args.push(...q.status); }
    if (q.theme_id) { where.push("theme_id = ?"); args.push(q.theme_id); }
    if (q.owner) { where.push("LOWER(owner) = LOWER(?)"); args.push(q.owner); }
    if (q.updatedSince) { where.push("updated_at >= ?"); args.push(q.updatedSince); }
    const sql = `SELECT payload FROM objects WHERE ${where.join(" AND ")} ORDER BY updated_at DESC ${q.limit ? "LIMIT " + q.limit : ""}`;
    const schema = SCHEMAS[q.type as keyof typeof SCHEMAS];
    return (this.db.prepare(sql).all(...(args as never[])) as Row[]).map((r) => schema.parse(JSON.parse(String(r.payload))) as unknown as T);
  }

  countObjects(type: ObjectType, status?: string[]): number {
    const args: unknown[] = [type];
    let sql = "SELECT COUNT(*) c FROM objects WHERE type = ? AND hidden = 0";
    if (status && status.length) { sql += ` AND status IN (${status.map(() => "?").join(",")})`; args.push(...status); }
    return Number((this.db.prepare(sql).get(...(args as never[])) as Row).c);
  }

  /** All objects (any type) that reference a given evidence id. */
  objectsForEvidence(evidence_id: string): Array<{ type: ObjectType; id: string; title: string }> {
    const rows = this.db.prepare(
      "SELECT o.type, o.id, o.title FROM object_evidence oe JOIN objects o ON o.id = oe.object_id WHERE oe.evidence_id = ? AND o.hidden = 0",
    ).all(evidence_id) as Row[];
    return rows.map((r) => ({ type: String(r.type) as ObjectType, id: String(r.id), title: String(r.title) }));
  }

  objectsForTheme(theme_id: string): Record<string, number> {
    const rows = this.db.prepare("SELECT type, COUNT(*) c FROM objects WHERE theme_id = ? AND hidden = 0 GROUP BY type").all(theme_id) as Row[];
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.type)] = Number(r.c);
    return out;
  }

  /* --------------------------- summaries ------------------------------ */
  saveSummary(s: Summary): void {
    this.db.prepare("INSERT OR REPLACE INTO summaries(id, horizon, period_start, period_end, generated_at, payload) VALUES (?,?,?,?,?,?)")
      .run(s.id, s.horizon, s.period_start, s.period_end, s.generated_at, JSON.stringify(s));
  }
  latestSummary(h: Horizon): Summary | undefined {
    const r = this.db.prepare("SELECT payload FROM summaries WHERE horizon = ? ORDER BY generated_at DESC LIMIT 1").get(h) as Row | undefined;
    return r ? Summary.parse(JSON.parse(String(r.payload))) : undefined;
  }

  /* ----------------------------- journal ------------------------------ */
  journal(entry: Omit<JournalEntry, "id" | "at" | "evidence"> & { at?: string; evidence?: EvidenceRef[] }): JournalEntry {
    const full = JournalEntry.parse({ id: newId("jr"), at: entry.at ?? nowIso(), ...entry });
    this.db.prepare("INSERT INTO journal(id, at, object_type, object_id, event, actor, payload) VALUES (?,?,?,?,?,?,?)")
      .run(full.id, full.at, full.object_type, full.object_id, full.event, full.actor, JSON.stringify(full));
    return full;
  }
  listJournal(opts: { since?: string; object_id?: string; limit?: number } = {}): JournalEntry[] {
    const where: string[] = []; const args: unknown[] = [];
    if (opts.since) { where.push("at >= ?"); args.push(opts.since); }
    if (opts.object_id) { where.push("object_id = ?"); args.push(opts.object_id); }
    const sql = `SELECT payload FROM journal ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC LIMIT ${opts.limit ?? 500}`;
    return (this.db.prepare(sql).all(...(args as never[])) as Row[]).map((r) => JournalEntry.parse(JSON.parse(String(r.payload))));
  }
  purgeJournalBefore(iso: string): number {
    const r = this.db.prepare("DELETE FROM journal WHERE at < ?").run(iso);
    return Number(r.changes);
  }

  /* ----------------------------- feedback ----------------------------- */
  saveFeedback(f: Omit<Feedback, "id" | "at">): Feedback {
    const full = Feedback.parse({ id: newId("fb"), at: nowIso(), ...f });
    this.db.prepare("INSERT INTO feedback(id, at, object_type, object_id, kind, payload) VALUES (?,?,?,?,?,?)")
      .run(full.id, full.at, full.object_type, full.object_id, full.kind, JSON.stringify(full));
    return full;
  }
  listFeedback(object_id?: string): Feedback[] {
    const rows = (object_id
      ? this.db.prepare("SELECT payload FROM feedback WHERE object_id = ? ORDER BY at DESC").all(object_id)
      : this.db.prepare("SELECT payload FROM feedback ORDER BY at DESC").all()) as Row[];
    return rows.map((r) => Feedback.parse(JSON.parse(String(r.payload))));
  }

  suppress(fingerprint: string, kind: string, reason?: string): void {
    this.db.prepare("INSERT OR REPLACE INTO suppressions(fingerprint, kind, at, reason) VALUES (?,?,?,?)").run(fingerprint, kind, nowIso(), reason ?? null);
  }
  isSuppressed(fingerprint: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM suppressions WHERE fingerprint = ?").get(fingerprint);
  }
  addAlias(alias_id: string, canonical_id: string): void {
    this.db.prepare("INSERT OR REPLACE INTO aliases(alias_id, canonical_id, at) VALUES (?,?,?)").run(alias_id, canonical_id, nowIso());
  }
  resolveAlias(id: string): string {
    const r = this.db.prepare("SELECT canonical_id FROM aliases WHERE alias_id = ?").get(id) as Row | undefined;
    return r ? String(r.canonical_id) : id;
  }

  /* ---------------------------- sync state ---------------------------- */
  getSyncState(provider_id: string): SyncState {
    const r = this.db.prepare("SELECT payload FROM sync_state WHERE provider_id = ?").get(provider_id) as Row | undefined;
    return r ? SyncState.parse(JSON.parse(String(r.payload))) : SyncState.parse({ provider_id });
  }
  setSyncState(s: SyncState): void {
    this.db.prepare("INSERT OR REPLACE INTO sync_state(provider_id, payload) VALUES (?,?)").run(s.provider_id, JSON.stringify(s));
  }
  listSyncStates(): SyncState[] {
    return (this.db.prepare("SELECT payload FROM sync_state").all() as Row[]).map((r) => SyncState.parse(JSON.parse(String(r.payload))));
  }

  setSourceRegistry(info: ProviderInfo & { health?: HealthStatus; capabilities?: string[]; enabled: boolean }): void {
    this.db.prepare("INSERT OR REPLACE INTO source_registry(provider_id, payload, updated_at) VALUES (?,?,?)").run(info.id, JSON.stringify(info), nowIso());
  }
  listSourceRegistry(): Array<ProviderInfo & { health?: HealthStatus; capabilities?: string[]; enabled: boolean }> {
    return (this.db.prepare("SELECT payload FROM source_registry").all() as Row[]).map((r) => JSON.parse(String(r.payload)));
  }

  /* --------------------------- stakeholders --------------------------- */
  touchStakeholder(name: string, email: string | undefined, at: string): void {
    const key = (email ?? name).toLowerCase();
    const id = "st_" + Buffer.from(key).toString("base64url").slice(0, 24);
    const existing = this.db.prepare("SELECT payload FROM stakeholders WHERE id = ?").get(id) as Row | undefined;
    let s: Stakeholder;
    if (existing) {
      s = Stakeholder.parse(JSON.parse(String(existing.payload)));
      s.mention_count += 1;
      if (at > s.last_seen) s.last_seen = at;
      if (at < s.first_seen) s.first_seen = at;
    } else {
      s = Stakeholder.parse({ id, name, email, first_seen: at, last_seen: at, mention_count: 1 });
    }
    this.db.prepare("INSERT OR REPLACE INTO stakeholders(id, name, email, payload) VALUES (?,?,?,?)").run(id, s.name, s.email ?? null, JSON.stringify(s));
  }
  listStakeholders(limit = 50): Stakeholder[] {
    const rows = this.db.prepare("SELECT payload FROM stakeholders").all() as Row[];
    return rows.map((r) => Stakeholder.parse(JSON.parse(String(r.payload)))).sort((a, b) => b.mention_count - a.mention_count).slice(0, limit);
  }

  /* --------------------------- bucket skills -------------------------- */
  saveBucketSkill(sk: BucketSkill): void {
    this.db.prepare("INSERT OR REPLACE INTO bucket_skills(id, theme_id, version, status, generated_at, payload) VALUES (?,?,?,?,?,?)")
      .run(sk.id, sk.theme_id, sk.version, sk.status, sk.generated_at, JSON.stringify(sk));
  }
  currentBucketSkill(theme_id: string): BucketSkill | undefined {
    const r = this.db.prepare("SELECT payload FROM bucket_skills WHERE theme_id = ? ORDER BY version DESC LIMIT 1").get(theme_id) as Row | undefined;
    return r ? BucketSkill.parse(JSON.parse(String(r.payload))) : undefined;
  }
  listBucketSkillVersions(theme_id: string): BucketSkill[] {
    return (this.db.prepare("SELECT payload FROM bucket_skills WHERE theme_id = ? ORDER BY version DESC").all(theme_id) as Row[]).map((r) => BucketSkill.parse(JSON.parse(String(r.payload))));
  }

  /* --------------------------- evidence exclusion --------------------- */
  excludeEvidence(evidence_id: string, reason?: string): void {
    const e = this.getEvidence(evidence_id);
    this.db.prepare("INSERT OR REPLACE INTO excluded_evidence(evidence_id, content_hash, at, reason) VALUES (?,?,?,?)").run(evidence_id, e?.content_hash ?? null, nowIso(), reason ?? null);
    this.db.prepare("DELETE FROM object_evidence WHERE evidence_id = ?").run(evidence_id);
    this.db.prepare("DELETE FROM theme_evidence WHERE evidence_id = ?").run(evidence_id);
    this.db.prepare("DELETE FROM evidence_fts WHERE evidence_id = ?").run(evidence_id);
    this.db.prepare("DELETE FROM evidence WHERE evidence_id = ?").run(evidence_id);
    // Also strip the reference from object payloads so provenance stays consistent.
    const rows = this.db.prepare("SELECT id, type, payload FROM objects").all() as Row[];
    for (const r of rows) {
      const obj = JSON.parse(String(r.payload)) as { evidence?: EvidenceRef[] };
      if (!obj.evidence?.some((x) => x.evidence_id === evidence_id)) continue;
      obj.evidence = obj.evidence.filter((x) => x.evidence_id !== evidence_id);
      this.db.prepare("UPDATE objects SET payload = ? WHERE id = ?").run(JSON.stringify(obj), String(r.id));
    }
    for (const t of this.listThemes(true)) {
      if (!t.evidence.some((x) => x.evidence_id === evidence_id)) continue;
      t.evidence = t.evidence.filter((x) => x.evidence_id !== evidence_id);
      this.upsertTheme(t);
    }
  }
  isEvidenceExcluded(evidence_id: string, content_hash?: string): boolean {
    if (this.db.prepare("SELECT 1 FROM excluded_evidence WHERE evidence_id = ?").get(evidence_id)) return true;
    return !!(content_hash && this.db.prepare("SELECT 1 FROM excluded_evidence WHERE content_hash = ?").get(content_hash));
  }

  /* ------------------------------ stats ------------------------------- */
  stats(): Record<string, number> {
    const q = (sql: string) => Number((this.db.prepare(sql).get() as Row).c);
    return {
      evidence: q("SELECT COUNT(*) c FROM evidence"),
      themes: q("SELECT COUNT(*) c FROM themes WHERE hidden = 0"),
      actions: q("SELECT COUNT(*) c FROM objects WHERE type='action' AND hidden=0"),
      decisions: q("SELECT COUNT(*) c FROM objects WHERE type='decision' AND hidden=0"),
      escalations: q("SELECT COUNT(*) c FROM objects WHERE type='escalation' AND hidden=0"),
      risks: q("SELECT COUNT(*) c FROM objects WHERE type='risk' AND hidden=0"),
      recommendations: q("SELECT COUNT(*) c FROM objects WHERE type='recommendation' AND hidden=0"),
      data_requests: q("SELECT COUNT(*) c FROM objects WHERE type='data_request' AND hidden=0"),
      journal: q("SELECT COUNT(*) c FROM journal"),
    };
  }
}
