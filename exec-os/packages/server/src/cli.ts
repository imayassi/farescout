#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { appPaths, resolveDataRoot } from "@execos/core";
import { createRuntime, deleteLocalData } from "./runtime.js";
import { createApp } from "./app.js";
import { runDoctor, formatChecks } from "./doctor.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "start";
const flag = (n: string) => args.includes(n);

function openWindow(url: string): void {
  if (process.platform === "win32") {
    const candidates = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA]
      .filter(Boolean).map((b) => `${b}\\Microsoft\\Edge\\Application\\msedge.exe`);
    const edge = candidates.find((f) => fs.existsSync(f));
    if (edge) { spawn(edge, [`--app=${url}`, "--window-size=1440,960"], { detached: true, stdio: "ignore" }).unref(); return; }
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

async function start(): Promise<void> {
  const rt = await createRuntime();
  const app = createApp(rt);
  const port = Number(process.env.EXECOS_PORT ?? rt.config.app.server.port);
  await app.listen({ host: "127.0.0.1", port });
  const url = `http://127.0.0.1:${port}/?token=${rt.token}`;
  for (const w of rt.warnings) console.error(`WARNING: ${w}`);
  console.log(`ExecOS running at ${url}`);
  console.log(`Data root: ${rt.paths.root}`);
  console.log(`Intelligence backend: ${rt.backend.name}${rt.degraded ? " (degraded)" : ""}`);
  if (flag("--open") || (rt.config.app.server.open_window && !flag("--no-open"))) openWindow(url);
  if (!flag("--no-sync")) void rt.orchestrator.run().catch((e) => rt.logger.error("startup sync failed", { error: e }));
  const shutdown = async () => { await app.close(); await rt.close(); process.exit(0); };
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
}

async function sync(): Promise<void> {
  const rt = await createRuntime({ quiet: flag("--quiet") });
  const r = await rt.orchestrator.run(flag("--bootstrap") ? "bootstrap" : undefined);
  console.log(JSON.stringify({ mode: r.mode, duration_ms: r.duration_ms, providers: r.providers, created: r.created, updated: r.updated, recommendations: r.recommendations_created, summaries: r.summaries, backend: r.backend, degraded: r.degraded }, null, 2));
  await rt.close();
}

async function doctor(): Promise<void> {
  const checks = await runDoctor(resolveDataRoot(), { probeMcp: flag("--probe-mcp") });
  console.log(formatChecks(checks));
  process.exit(checks.some((c) => !c.ok && c.level === "critical") ? 2 : 0);
}

async function del(): Promise<void> {
  const paths = appPaths(resolveDataRoot());
  if (!flag("--yes")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((res) => rl.question(`This deletes ALL ExecOS local data under ${paths.root} (config is kept unless --include-config). Type DELETE to confirm: `, res));
    rl.close();
    if (answer.trim() !== "DELETE") { console.log("Cancelled."); return; }
  }
  const removed = deleteLocalData(paths, { includeConfig: flag("--include-config") });
  console.log(removed.length ? `Removed:\n${removed.map((r) => `  ${r}`).join("\n")}` : "Nothing to remove.");
}

const commands: Record<string, () => Promise<void>> = { start, sync, doctor, "delete-data": del, paths: async () => console.log(JSON.stringify(appPaths(resolveDataRoot()), null, 2)) };
const run = commands[cmd];
if (!run) { console.error(`Unknown command "${cmd}". Usage: execos [start|sync|doctor|delete-data|paths] [--open|--no-open|--no-sync|--bootstrap|--probe-mcp|--yes|--include-config]`); process.exit(1); }
run().catch((e) => { console.error(`ExecOS ${cmd} failed: ${(e as Error).message}`); process.exit(1); });
