import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { createRuntime, type Runtime } from "../src/runtime.js";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

describe("loopback API", () => {
  let dir: string; let rt: Runtime; let app: FastifyInstance; let headers: Record<string, string>;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "execos-api-"));
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "app.yaml"), YAML.stringify({ enabled_sources: { mock: true, workiq: false, local_docs: false }, intelligence: { backend: "mock" }, themes: { pinned: ["Forecast", "Budget"] } }));
    fs.writeFileSync(path.join(dir, "config", "mcp.yaml"), YAML.stringify({ providers: [{ id: "mock", type: "mock", enabled: true }] }));
    rt = await createRuntime({ dataRoot: dir, quiet: true });
    app = createApp(rt);
    headers = { "x-execos-token": rt.token };
    await rt.orchestrator.run("bootstrap");
  });
  afterAll(async () => { await app.close(); await rt.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("rejects requests without the local token", async () => {
    const r = await app.inject({ method: "GET", url: "/api/status" });
    expect(r.statusCode).toBe(401);
  });
  it("reports status and sources", async () => {
    const r = await app.inject({ method: "GET", url: "/api/status", headers });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.stats.evidence).toBeGreaterThan(30);
    expect(j.backend.name).toBe("mock");
    expect(j.sources[0].state.last_status).toBe("ok");
    expect(j.data_root).toBe(dir);
  });
  it("serves the daily brief with attention counts and evidence-linked sections", async () => {
    const j = (await app.inject({ method: "GET", url: "/api/brief?horizon=daily", headers })).json();
    expect(j.summary.attention.decisions_needed).toBeGreaterThan(0);
    const attention = j.sections.find((s: { heading: string }) => s.heading === "Needs your attention");
    expect(attention.items.length).toBeGreaterThan(0);
    expect(attention.items[0].evidence_details.length).toBeGreaterThan(0);
    expect(j.upcoming.length).toBeGreaterThan(0);
  });
  it("filters actions and explains why an item is shown with real evidence and no fabricated links", async () => {
    const overdue = (await app.inject({ method: "GET", url: "/api/objects/action?filter=overdue", headers })).json();
    expect(overdue.length).toBeGreaterThan(0);
    const why = (await app.inject({ method: "GET", url: `/api/object/${overdue[0].id}`, headers })).json();
    expect(why.why.epistemic).toBe("extracted_action");
    expect(why.why.evidence_summary.length).toBe(why.object.evidence_details.length);
    expect(why.object.evidence_details.every((e: { open_url?: string }) => e.open_url === undefined)).toBe(true);
    expect(why.journal.some((j: { event: string }) => j.event === "detected")).toBe(true);
  });
  it("keeps decision kinds apart", async () => {
    const needed = (await app.inject({ method: "GET", url: "/api/objects/decision?status=needed,pending_approval", headers })).json();
    const made = (await app.inject({ method: "GET", url: "/api/objects/decision?status=recorded", headers })).json();
    expect(needed.length).toBeGreaterThan(0); expect(made.length).toBeGreaterThan(0);
    expect(made.every((d: { epistemic: string }) => d.epistemic === "recorded_decision")).toBe(true);
  });
  it("applies feedback through the API and journals it as a user action", async () => {
    const recs = (await app.inject({ method: "GET", url: "/api/objects/recommendation?status=proposed", headers })).json();
    const r = await app.inject({ method: "POST", url: "/api/feedback", headers, payload: { object_type: "recommendation", object_id: recs[0].id, kind: "accept_recommendation" } });
    expect(r.statusCode).toBe(200);
    const created = (await app.inject({ method: "GET", url: `/api/object/${r.json().created_id}`, headers })).json();
    expect(created.type).toBe("action"); expect(created.object.origin).toBe("accepted_recommendation");
    const journal = (await app.inject({ method: "GET", url: "/api/journal?days=1", headers })).json();
    expect(journal.some((j: { actor: string; event: string }) => j.actor === "user" && j.event === "accepted")).toBe(true);
  });
  it("answers questions with citations and validates bodies", async () => {
    const a = (await app.inject({ method: "POST", url: "/api/ask", headers, payload: { question: "What is blocking the forecast?" } })).json();
    expect(a.citations.length).toBeGreaterThan(0);
    expect((await app.inject({ method: "POST", url: "/api/ask", headers, payload: { question: "x" } })).statusCode).toBe(400);
  });
  it("updates settings without touching the repository", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/settings", headers, payload: { themes: { pinned: ["Forecast", "Budget", "Customer"] } } });
    expect(r.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(dir, "config", "app.yaml"), "utf8")).toMatch(/Customer/);
  });
});
