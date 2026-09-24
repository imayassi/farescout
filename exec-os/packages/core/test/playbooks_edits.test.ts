import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { Store, MockProvider, MockBackend, SyncOrchestrator, AppConfigSchema, silentLogger, editObject, removeObject, createManualObject, editTheme, createTheme, excludeEvidence, regenerateBucketSkill, editBucketSkill, type ActionItem, type Recommendation } from "../src/index.js";

describe("bucket playbooks: generated once from history, then fixed", () => {
  let dir: string; let store: Store; let orch: SyncOrchestrator;
  const app = AppConfigSchema.parse({ user: { display_name: "Alex Rivera" }, themes: { pinned: ["Forecast", "Budget", "Empty bucket"] }, important_roles: [{ title: "Vice President", name: "Jordan Lee" }] });
  beforeAll(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "execos-pb-")); store = new Store(path.join(dir, "t.sqlite")); orch = new SyncOrchestrator({ store, providers: [new MockProvider("mock")], backend: new MockBackend(), app, logger: silentLogger, degraded: false }); await orch.run("bootstrap"); });
  afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("derives a history-based playbook for a rich bucket and an assumption for an empty one", () => {
    const forecast = store.listThemes().find((t) => t.name === "Forecast")!;
    const sk = store.currentBucketSkill(forecast.id)!;
    expect(sk.status).toBe("fixed"); expect(sk.version).toBe(1); expect(sk.basis).toBe("history");
    expect(sk.steps.length).toBe(5); expect(sk.steps.map((s) => s.stage)).toEqual(["sense", "interpret", "decide", "align", "execute"]);
    expect(sk.owners.primary).toBe("Marcus Chen");
    expect(sk.cadence.forums.some((f) => /Operations Review/.test(f))).toBe(true);
    expect(sk.escalation_path[0]!.to).toBe("Jordan Lee");
    expect(sk.signals_to_watch.some((s) => /volume/i.test(s.name))).toBe(true);
    expect(sk.evidence.length).toBeGreaterThan(0); expect(sk.epistemic).toBe("inference");
    const empty = store.listThemes().find((t) => t.name === "Empty bucket")!;
    const es = store.currentBucketSkill(empty.id)!;
    expect(es.basis).toBe("assumption"); expect(es.steps.every((s) => s.basis === "assumption")).toBe(true); expect(es.owners.primary).toBeUndefined();
  });
  it("never regenerates a fixed playbook on later syncs, but the user can regenerate and edit", async () => {
    const forecast = store.listThemes().find((t) => t.name === "Forecast")!;
    const before = store.currentBucketSkill(forecast.id)!;
    await orch.run();
    expect(store.currentBucketSkill(forecast.id)!.id).toBe(before.id);
    const v2 = regenerateBucketSkill(store, forecast.id, orch.skillContext(), "test");
    expect(v2.version).toBe(2); expect(store.listBucketSkillVersions(forecast.id).length).toBe(2);
    const edited = editBucketSkill(store, forecast.id, { cadence: { review: "daily", forums: ["Daily huddle"], rationale: "set by user" } });
    expect(edited.user_adjusted).toBe(true); expect(edited.cadence.review).toBe("daily");
    await orch.run();
    expect(store.currentBucketSkill(forecast.id)!.cadence.review).toBe("daily");
  });
});

describe("tab feedback loop: add / remove / adjust with locked fields", () => {
  let dir: string; let store: Store; let orch: SyncOrchestrator;
  const app = AppConfigSchema.parse({ user: { display_name: "Alex Rivera" }, themes: { pinned: ["Forecast"] } });
  beforeAll(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "execos-ed-")); store = new Store(path.join(dir, "t.sqlite")); orch = new SyncOrchestrator({ store, providers: [new MockProvider("mock")], backend: new MockBackend(), app, logger: silentLogger, degraded: false }); await orch.run("bootstrap"); });
  afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("adjusts an item and keeps the edit through a full rescan", async () => {
    const a = store.listObjects<ActionItem>({ type: "action" }).find((x) => /re-baselined/.test(x.title))!;
    const r = editObject(store, a.id, { owner: "Priya Natarajan", status: "in_progress", due_at: "2030-01-01T00:00:00.000Z" });
    expect(r.changed.sort()).toEqual(["due_at", "owner", "status"]);
    await orch.run("bootstrap");
    const after = store.getObject<ActionItem>(a.id)!.object;
    expect(after.owner).toBe("Priya Natarajan"); expect(after.status).toBe("in_progress"); expect(after.due_at).toBe("2030-01-01T00:00:00.000Z");
    expect(after.locked_fields).toContain("owner");
  });
  it("removes an item and it does not come back", async () => {
    const a = store.listObjects<ActionItem>({ type: "action" }).find((x) => /retention conversations/i.test(x.title))!;
    removeObject(store, a.id, "not relevant");
    await orch.run("bootstrap");
    expect(store.listObjects<ActionItem>({ type: "action" }).some((x) => /retention conversations/i.test(x.title))).toBe(false);
    expect(store.getObject<ActionItem>(a.id)!.object.hidden).toBe(true);
  });
  it("adds items and buckets by hand, marked as user-origin facts", () => {
    const b = createTheme(store, { name: "Partner program", description: "New bucket" });
    expect(b.origin).toBe("user"); expect(b.pinned).toBe(true);
    const { object } = createManualObject(store, { type: "action", title: "Draft partner tiering proposal", description: "", theme_id: b.id, owner: "Riley Morgan", evidence_ids: [] }, "Alex Rivera");
    expect((object as ActionItem).origin).toBe("user"); expect((object as ActionItem).epistemic).toBe("fact"); expect((object as ActionItem).theme_id).toBe(b.id);
    expect(store.listJournal({ object_id: object.id }).some((j) => j.actor === "user")).toBe(true);
  });
  it("adjusts and removes buckets; hidden buckets are not rediscovered", async () => {
    const budget = store.listThemes().find((t) => t.name === "Budget")!;
    editTheme(store, budget.id, { description: "Opex envelope and reductions", current_state: "Under review by Priya" });
    await orch.run();
    const t = store.getTheme(budget.id)!;
    expect(t.description).toBe("Opex envelope and reductions"); expect(t.current_state).toBe("Under review by Priya");
    const vendor = store.listThemes().find((x) => x.name === "Vendor transition")!;
    editTheme(store, vendor.id, { hidden: true });
    await orch.run("bootstrap");
    expect(store.listThemes().some((x) => x.name === "Vendor transition")).toBe(false);
  });
  it("excludes evidence: it is unlinked everywhere and not re-ingested", async () => {
    const a = store.listObjects<ActionItem>({ type: "action" }).find((x) => /re-baselined/.test(x.title))!;
    const evId = a.evidence[0]!.evidence_id;
    const n = store.countEvidence();
    excludeEvidence(store, evId, "personal");
    expect(store.getEvidence(evId)).toBeUndefined();
    expect(store.getObject<ActionItem>(a.id)!.object.evidence.some((e) => e.evidence_id === evId)).toBe(false);
    await orch.run("bootstrap");
    expect(store.getEvidence(evId)).toBeUndefined(); expect(store.countEvidence()).toBe(n - 1);
  });
  it("proposes a playbook refresh only when an assumption-based playbook gains history", () => {
    const recs = store.listObjects<Recommendation>({ type: "recommendation", includeHidden: true });
    expect(recs.filter((r) => r.rule === "R8").every((r) => r.epistemic === "recommendation")).toBe(true);
  });
});
