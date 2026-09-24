import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export type LogLevel = "error" | "warn" | "info" | "debug";
const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/** Field names whose values are never written to logs (content, not metadata). */
const REDACTED_FIELDS = new Set([
  "body", "text", "content", "subject", "prompt", "answer", "participants", "title",
  "description", "question", "rationale", "reasoning", "summary", "payload", "excerpt",
]);

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    const h = createHash("sha256").update(value).digest("hex").slice(0, 8);
    return `<redacted len=${value.length} sha=${h}>`;
  }
  if (Array.isArray(value)) return `<redacted array len=${value.length}>`;
  if (value && typeof value === "object") return `<redacted object>`;
  return value;
}

export function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACTED_FIELDS.has(k.toLowerCase())) out[k] = redact(v);
    else if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Error)) {
      out[k] = sanitizeFields(v as Record<string, unknown>);
    } else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else out[k] = v;
  }
  return out;
}

export interface Logger {
  level: LogLevel;
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(opts: { level?: LogLevel; dir?: string; scope?: string; stderr?: boolean } = {}): Logger {
  const level = opts.level ?? "info";
  const scope = opts.scope ?? "execos";
  let stream: fs.WriteStream | undefined;
  if (opts.dir) {
    fs.mkdirSync(opts.dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    stream = fs.createWriteStream(path.join(opts.dir, `execos-${day}.log`), { flags: "a" });
  }
  const write = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] > ORDER[level]) return;
    const rec = { t: new Date().toISOString(), lvl, scope, msg, ...(fields ? sanitizeFields(fields) : {}) };
    const line = JSON.stringify(rec);
    if (stream) stream.write(line + "\n");
    if (opts.stderr !== false) process.stderr.write(line + "\n");
  };
  const make = (s: string): Logger => ({
    level,
    error: (m, f) => write("error", m, f),
    warn: (m, f) => write("warn", m, f),
    info: (m, f) => write("info", m, f),
    debug: (m, f) => write("debug", m, f),
    child: (c) => createLogger({ ...opts, scope: `${s}:${c}` }),
  });
  return make(scope);
}

export const silentLogger: Logger = {
  level: "error",
  error() {}, warn() {}, info() {}, debug() {},
  child() { return silentLogger; },
};
