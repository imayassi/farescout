import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Store, MockProvider, MockBackend, SyncOrchestrator, AppConfigSchema, silentLogger, applyFeedback, askWithEvidence,
  type ActionItem, type Decision, type Escalation, type Recommendation, type Risk, type DataRequest, normalizeEvidence, titleSimilarity,
} from "../src/index.js";

describe("vertical slice: mock provider → intelligence → state → provenance", () => {
  let dir: string; let store: Store; let orch: SyncOrchestrator; let mock: MockProvider;
  const app = AppConfigSchema.parse({ themes: { pinned: ["Forecast", "Budget", "AI"] }, summaries: { quarterly: true } });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "execos-test-"));
    store = new Store(path.join(dir, "t.sqlite"));
    mock = new MockProvider("mock");
    orch = new SyncOrchestrator({ store, providers: [mock], backend: new MockBackend(), app, logger: silentLogger, degraded: false });
  });
  afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("bootstraps 90 days of evidence and extracts structured objects", async () => {
    const r = await orch.run("bootstrap");
    expect(r.mode).toBe("bootstrap");
    expect(r.providers[0]?.status).toBe("ok");
    expect(store.countEvidence()).toBeGreaterThan(30);
    const actions = store.listObjects<ActionItem>({ type: "action" });
    const decisions = store.listObjects<Decision>({ type: "decision" });
    const escalations = store.listObjects<Escalation>({ type: "escalation" });
    expect(actions.length).toBeGreaterThan(4);
    expect(decisions.length).toBeGreaterThan(2);
    expect(escalations.length).toBeGreaterThan(0);
  });

  it("reconciles repeated mentions into one object with accumulated evidence and forward-only status", () => {
    const forecast = store.listObjects<ActionItem>({ type: "action" }).find((a) => /re-baselined H1 volume forecast/i.test(a.title));
    expect(forecast).toBeDefined();
    expect(forecast!.evidence.length).toBeGreaterThanOrEqual(5);
    expect(forecast!.mention_count).toBeGreaterThanOrEqual(4);
    expect(forecast!.owner).toBe("Marcus Chen");
    expect(["blocked", "escalation_candidate"]).toContain(forecast!.status);
    expect(forecast!.due_at! < new Date().toISOString()).toBe(true);
    const journal = store.listJournal({ object_id: forecast!.id });
    expect(journal.some((j) => j.event === "status_changed")).toBe(true);
    expect(journal.some((j) => j.event === "detected")).toBe(true);
  });

  it("marks the shipped hotfix completed and keeps it completed", () => {
    const hotfix = store.listObjects<ActionItem>({ type: "action" }).find((a) => /ticket-routing hotfix/i.test(a.title));
    expect(hotfix?.status).toBe("completed");
  });

  it("separates recorded decisions from decisions needing approval", () => {
    const d = store.listObjects<Decision>({ type: "decision" });
    const pause = d.find((x) => /Tier-2 hiring/i.test(x.topic));
    expect(pause?.status).toBe("recorded"); expect(pause?.epistemic).toBe("recorded_decision"); expect(pause?.decision_maker).toBe("Jordan Lee");
    const contractors = d.find((x) => /6 contractors/i.test(x.topic));
    expect(contractors?.status).toBe("pending_approval");
    const vendor = d.find((x) => /Meridian/i.test(x.topic));
    expect(vendor?.status).toBe("needed"); expect(vendor?.epistemic).toBe("inference");
  });

  it("produces rule-based recommendations with reasoning and evidence, never as decisions", () => {
    const recs = store.listObjects<Recommendation>({ type: "recommendation" });
    expect(recs.length).toBeGreaterThan(3);
    for (const r of recs) { expect(r.epistemic).toBe("recommendation"); expect(r.evidence.length).toBeGreaterThan(0); expect(r.reasoning.length).toBeGreaterThan(10); }
    expect(recs.some((r) => r.rule === "R3")).toBe(true);   // repeated dependency across sources
    expect(recs.some((r) => r.rule === "R6")).toBe(true);   // conflicting 8% vs 12%
    expect(recs.some((r) => r.rule === "R5")).toBe(true);   // metric moved
    expect(recs.some((r) => r.rule === "R1")).toBe(true);   // overdue commitment
  });

  it("creates an escalation candidate for the overdue commitment and discovers themes", () => {
    const esc = store.listObjects<Escalation>({ type: "escalation" });
    expect(esc.some((e) => /Overdue commitment/.test(e.issue) && e.status === "potential")).toBe(true);
    expect(esc.some((e) => /Contoso/.test(e.issue))).toBe(true);
    const themes = store.listThemes();
    expect(themes.find((t) => t.name === "Forecast")?.pinned).toBe(true);
    expect(themes.find((t) => t.name === "Vendor transition")?.discovered).toBe(true);
    const risks = store.listObjects<Risk>({ type: "risk" });
    expect(risks.length).toBeGreaterThan(1);
    const reqs = store.listObjects<DataRequest>({ type: "data_request" });
    expect(reqs.length).toBe(2);
  });

  it("answers 'why am I seeing this' through evidence links", () => {
    const esc = store.listObjects<Escalation>({ type: "escalation" }).find((e) => /Contoso/.test(e.issue))!;
    const evidence = store.getEvidenceMany(esc.evidence.map((e) => e.evidence_id));
    expect(evidence.length).toBe(esc.evidence.length);
    expect(evidence.every((e) => e.source_ref.url === undefined)).toBe(true);   // mock never fabricates links
    expect(store.objectsForEvidence(evidence[0]!.evidence_id).some((o) => o.id === esc.id)).toBe(true);
  });

  it("generates horizon summaries with attention counts and coverage", () => {
    for (const h of ["daily", "weekly", "monthly", "quarterly"] as const) {
      const s = store.latestSummary(h);
      expect(s).toBeDefined();
      expect(s!.attention.decisions_needed).toBeGreaterThan(0);
      expect(s!.coverage.providers[0]?.ok).toBe(true);
    }
    expect(store.latestSummary("daily")!.sections.find((s) => s.heading === "Upcoming")!.items.length).toBeGreaterThan(0);
  });

  it("is incremental: a second sync re-analyzes nothing and creates no duplicates", async () => {
    const before = store.stats();
    const r = await orch.run();
    expect(r.mode).toBe("incremental");
    expect(r.providers[0]?.items_new).toBe(0);
    expect(r.batches).toBe(0);
    const after = store.stats();
    expect(after.actions).toBe(before.actions); expect(after.decisions).toBe(before.decisions);
  });

  it("degrades gracefully when a provider fails: state is preserved and coverage is flagged", async () => {
    const before = store.stats();
    mock.simulateFailureOnce();
    const r = await orch.run();
    expect(r.providers[0]?.status).toBe("error");
    expect(store.stats().actions).toBe(before.actions);
    expect(store.latestSummary("daily")!.coverage.incomplete).toBe(true);
    expect(store.getSyncState("mock").last_error).toMatch(/simulated/);
  });

  it("applies human feedback and honours it on the next sync", async () => {
    const rec = store.listObjects<Recommendation>({ type: "recommendation" }).find((r) => r.rule === "R6")!;
    expect(applyFeedback(store, { object_type: "recommendation", object_id: rec.id, kind: "dismiss_recommendation", payload: { reason: "already reconciled" } }).ok).toBe(true);
    const accept = store.listObjects<Recommendation>({ type: "recommendation" }).find((r) => r.status === "proposed")!;
    const res = applyFeedback(store, { object_type: "recommendation", object_id: accept.id, kind: "accept_recommendation" });
    expect(res.ok).toBe(true);
    const created = store.getObject<ActionItem>(res.created_id!)!.object;
    expect(created.origin).toBe("accepted_recommendation"); expect(created.status).toBe("confirmed");
    const act = store.listObjects<ActionItem>({ type: "action" }).find((a) => a.status === "detected") ?? store.listObjects<ActionItem>({ type: "action" })[0]!;
    applyFeedback(store, { object_type: "action", object_id: act.id, kind: "wrong_owner", payload: { owner: "Dana Okafor" } });
    expect(store.getObject<ActionItem>(act.id)!.object.owner).toBe("Dana Okafor");
    await orch.run();
    expect(store.getObject<Recommendation>(rec.id)!.object.status).toBe("dismissed");
    expect(store.listJournal({}).some((j) => j.actor === "user" && j.event === "feedback")).toBe(true);
  });

  it("answers questions with citations from local evidence only", async () => {
    const a = await askWithEvidence(store, new MockBackend(), orch.skillContext(), "What is blocking the forecast?", silentLogger);
    expect(a.answer.length).toBeGreaterThan(10);
    expect(a.citations.length).toBeGreaterThan(0);
    expect(a.evidence.every((e) => !!store.getEvidence(e.evidence_id))).toBe(true);
  });

  it("supports Delete Local Data semantics: everything lives in the data dir", () => {
    expect(fs.existsSync(path.join(dir, "t.sqlite"))).toBe(true);
  });
});

describe("normalization and matching", () => {
  it("dedupes by content hash and produces stable ids", () => {
    const a = normalizeEvidence({ provider_id: "p", source_type: "email", occurred_at: "2026-01-01T00:00:00Z", title: "Hi", source_kind: "k", source_id: "1", text: "same" });
    const b = normalizeEvidence({ provider_id: "p", source_type: "email", occurred_at: "2026-01-01T00:00:00Z", title: "Hi", source_kind: "k", source_id: "2", text: "same" });
    expect(a.evidence_id).not.toBe(b.evidence_id);
    expect(a.content_hash).toBe(b.content_hash);
    expect(normalizeEvidence({ provider_id: "p", source_type: "email", occurred_at: "x", source_kind: "k", source_id: "1", text: "y".repeat(10000) }).text!.length).toBeLessThan(4100);
  });
  it("matches paraphrased titles", () => {
    expect(titleSimilarity("Deliver re-baselined H1 volume forecast", "Deliver the re-baselined H1 volume forecast")).toBeGreaterThan(0.7);
    expect(titleSimilarity("Ship the ticket-routing hotfix", "Approve 6 contractors for Q3 surge")).toBeLessThan(0.3);
  });
});
