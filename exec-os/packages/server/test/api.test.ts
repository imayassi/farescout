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

describe("data requests at bucket and item level", () => {
  let dir: string; let rt: Runtime; let app: FastifyInstance; let headers: Record<string, string>;
  const received: unknown[] = [];
  let intake: import("node:http").Server; let intakeUrl: string;
  beforeAll(async () => {
    const http = await import("node:http");
    intake = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { received.push(JSON.parse(b)); res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "TICKET-42" })); }); });
    await new Promise<void>((r) => intake.listen(0, "127.0.0.1", r));
    intakeUrl = `http://127.0.0.1:${(intake.address() as { port: number }).port}/intake`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "execos-dr-"));
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "app.yaml"), YAML.stringify({ user: { display_name: "Business Manager" }, enabled_sources: { mock: true }, intelligence: { backend: "mock" }, data_requests: { endpoint_url: "", default_owner: "Tom Alvarez" } }));
    fs.writeFileSync(path.join(dir, "config", "mcp.yaml"), YAML.stringify({ providers: [{ id: "mock", type: "mock", enabled: true }] }));
    rt = await createRuntime({ dataRoot: dir, quiet: true });
    app = createApp(rt); headers = { "x-execos-token": rt.token };
    await rt.orchestrator.run("bootstrap");
  });
  afterAll(async () => { await app.close(); await rt.close(); intake.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("exposes the executive drill-down with buckets derived from evidence", async () => {
    const j = (await app.inject({ method: "GET", url: "/api/exec", headers })).json();
    expect(j.buckets.length).toBeGreaterThan(5);
    const forecast = j.buckets.find((b: { name: string }) => b.name === "Forecast");
    expect(forecast.derived_from.evidence).toBeGreaterThan(0);
    expect(forecast.derived_from.source_types.length).toBeGreaterThan(1);
    expect(forecast.attention.overdue).toBeGreaterThan(0);
    expect(j.attention.decisions_needed.length).toBeGreaterThan(0);
  });
  it("stores a bucket-level request locally when no endpoint is configured", async () => {
    const exec = (await app.inject({ method: "GET", url: "/api/exec", headers })).json();
    const bucket = exec.buckets.find((b: { name: string }) => b.name === "Forecast");
    const r = await app.inject({ method: "POST", url: "/api/data-requests", headers, payload: { scope: "bucket", theme_id: bucket.id, request: "Weekly volume vs forecast variance by tier", kind: "dashboard", priority: "high" } });
    expect(r.statusCode).toBe(201);
    const j = r.json();
    expect(j.delivery.status).toBe("not_configured");
    expect(j.request.scope).toBe("bucket"); expect(j.request.owner).toBe("Tom Alvarez"); expect(j.request.requested_by).toBe("Business Manager");
    expect(j.request.evidence_details.length).toBeGreaterThan(0);
    const list = (await app.inject({ method: "GET", url: `/api/data-requests?theme_id=${bucket.id}`, headers })).json();
    expect(list.items.some((d: { id: string }) => d.id === j.request.id)).toBe(true);
  });
  it("forwards an item-level request to the configured intake endpoint with bucket, item and evidence context", async () => {
    rt.config.app.data_requests.endpoint_url = intakeUrl;
    const overdue = (await app.inject({ method: "GET", url: "/api/objects/action?filter=overdue", headers })).json();
    const r = await app.inject({ method: "POST", url: "/api/data-requests", headers, payload: { scope: "item", object_id: overdue[0].id, request: "Pull the last 8 weeks of case volume by queue to support the re-baseline", kind: "data_pull", needed_by: "2026-10-01" } });
    expect(r.statusCode).toBe(201);
    const j = r.json();
    expect(j.delivery.status).toBe("delivered"); expect(j.delivery.external_id).toBe("TICKET-42");
    const sent = received[0] as { scope: string; item: { title: string }; bucket: { name: string }; evidence: unknown[]; source: string };
    expect(sent.scope).toBe("item"); expect(sent.item.title).toMatch(/forecast/i); expect(sent.bucket.name).toBe("Forecast"); expect(sent.evidence.length).toBeGreaterThan(0); expect(sent.source).toBe("execos");
    const stored = (await app.inject({ method: "GET", url: `/api/object/${j.request.id}`, headers })).json();
    expect(stored.object.delivery.status).toBe("delivered");
    expect(stored.journal.some((x: { actor: string }) => x.actor === "user")).toBe(true);
  });
  it("records a failed delivery without losing the request", async () => {
    rt.config.app.data_requests.endpoint_url = "http://127.0.0.1:9/nowhere";
    rt.config.app.data_requests.timeout_seconds = 2;
    const exec = (await app.inject({ method: "GET", url: "/api/exec", headers })).json();
    const r = await app.inject({ method: "POST", url: "/api/data-requests", headers, payload: { scope: "bucket", theme_id: exec.buckets[0].id, request: "Attrition by tenure band", kind: "analysis" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().delivery.status).toBe("failed");
    expect((await app.inject({ method: "GET", url: `/api/object/${r.json().request.id}`, headers })).statusCode).toBe(200);
  });
});

describe("playbooks and tab edit loop over the API", () => {
  let dir: string; let rt: Runtime; let app: FastifyInstance; let headers: Record<string, string>;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "execos-pbapi-"));
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "app.yaml"), YAML.stringify({ user: { display_name: "Alex Rivera" }, enabled_sources: { mock: true }, intelligence: { backend: "mock" }, themes: { pinned: ["Forecast"] } }));
    fs.writeFileSync(path.join(dir, "config", "mcp.yaml"), YAML.stringify({ providers: [{ id: "mock", type: "mock", enabled: true }] }));
    rt = await createRuntime({ dataRoot: dir, quiet: true }); app = createApp(rt); headers = { "x-execos-token": rt.token };
    await rt.orchestrator.run("bootstrap");
  });
  afterAll(async () => { await app.close(); await rt.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("serves a fixed playbook per bucket with a five-stage process and versions", async () => {
    const exec = (await app.inject({ method: "GET", url: "/api/exec", headers })).json();
    const forecast = exec.buckets.find((b: { name: string }) => b.name === "Forecast");
    expect(forecast.playbook.status).toBe("fixed"); expect(forecast.playbook.basis).toBe("history");
    const pb = (await app.inject({ method: "GET", url: `/api/themes/${forecast.id}/playbook`, headers })).json();
    expect(pb.playbook.steps.map((s: { stage: string }) => s.stage)).toEqual(["sense", "interpret", "decide", "align", "execute"]);
    expect(pb.playbook.evidence_details.length).toBeGreaterThan(0);
    const re = (await app.inject({ method: "POST", url: `/api/themes/${forecast.id}/playbook/regenerate`, headers, payload: { reason: "test" } })).json();
    expect(re.playbook.version).toBe(2);
    const ed = (await app.inject({ method: "PATCH", url: `/api/themes/${forecast.id}/playbook`, headers, payload: { user_notes: "Review with Marcus weekly" } })).json();
    expect(ed.playbook.user_adjusted).toBe(true); expect(ed.playbook.user_notes).toBe("Review with Marcus weekly");
    const list = (await app.inject({ method: "GET", url: "/api/playbooks", headers })).json();
    expect(list.find((x: { name: string }) => x.name === "Forecast").playbook.version).toBe(2);
  });
  it("adjusts, adds and removes items and buckets through the API", async () => {
    const overdue = (await app.inject({ method: "GET", url: "/api/objects/action?filter=overdue", headers })).json();
    const p = await app.inject({ method: "PATCH", url: `/api/object/${overdue[0].id}`, headers, payload: { owner: "Dana Okafor", status: "in_progress" } });
    expect(p.statusCode).toBe(200); expect(p.json().changed.sort()).toEqual(["owner", "status"]);
    const add = await app.inject({ method: "POST", url: "/api/objects", headers, payload: { type: "risk", title: "Contractor onboarding slips into surge", description: "Lead time 3 weeks", owner: "Riley Morgan" } });
    expect(add.statusCode).toBe(201); expect(add.json().object.epistemic).toBe("fact");
    const rm = await app.inject({ method: "DELETE", url: `/api/object/${add.json().object.id}?reason=duplicate`, headers });
    expect(rm.statusCode).toBe(200);
    const b = await app.inject({ method: "POST", url: "/api/themes", headers, payload: { name: "Partner program", description: "New" } });
    expect(b.statusCode).toBe(201);
    const pb = await app.inject({ method: "PATCH", url: `/api/themes/${b.json().theme.id}`, headers, payload: { current_state: "Kick-off next week" } });
    expect(pb.json().theme.current_state).toBe("Kick-off next week"); expect(pb.json().theme.locked_fields).toContain("current_state");
    const del = await app.inject({ method: "DELETE", url: `/api/themes/${b.json().theme.id}`, headers });
    expect(del.json().theme.hidden).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/themes", headers })).json().some((t: { name: string }) => t.name === "Partner program")).toBe(false);
  });
  it("excludes evidence and it disappears from items", async () => {
    const overdue = (await app.inject({ method: "GET", url: "/api/objects/action?filter=overdue", headers })).json();
    const evId = overdue[0].evidence_details[0].evidence_id;
    const r = await app.inject({ method: "POST", url: `/api/evidence/${evId}/exclude`, headers, payload: { reason: "personal" } });
    expect(r.json().removed).toBe(true);
    expect((await app.inject({ method: "GET", url: `/api/evidence/${evId}`, headers })).statusCode).toBe(404);
    const again = (await app.inject({ method: "GET", url: `/api/object/${overdue[0].id}`, headers })).json();
    expect(again.object.evidence_details.some((e: { evidence_id: string }) => e.evidence_id === evId)).toBe(false);
  });
});
