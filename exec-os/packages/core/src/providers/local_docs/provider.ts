import fs from "node:fs";
import path from "node:path";
import type { Evidence } from "../../domain/index.js";
import type { Capability, Cursor, EvidenceBatch, FetchContext, HealthStatus, ProviderInfo, RetrievalWindow, SourceProvider } from "../types.js";
import { normalizeEvidence, type RawTextPolicy } from "../normalize.js";

const TEXT_EXT = new Set([".md", ".txt", ".markdown", ".csv", ".json", ".yaml", ".yml"]);
const MAX_BYTES = 2_000_000;

/**
 * Reads private context documents from a directory that lives OUTSIDE the repository
 * (default: %LOCALAPPDATA%\ExecOS\docs). Only plain-text formats are parsed in Phase 1;
 * .docx/.pdf are listed as "unsupported" so the user knows they were not read.
 */
export class LocalDocsProvider implements SourceProvider {
  readonly id: string;
  constructor(id: string, private readonly directory: string, private readonly rawTextPolicy: RawTextPolicy = "trimmed", private readonly insideRepo = false) {
    this.id = id;
  }

  describe(): ProviderInfo {
    return { id: this.id, kind: "local_docs", label: "Local documents", description: this.directory, adapter: "local_docs" };
  }

  async checkHealth(): Promise<HealthStatus> {
    if (!fs.existsSync(this.directory)) {
      return { ok: false, message: `Directory not found: ${this.directory}`, remediation: "Create the directory or set providers[local_docs].directory" };
    }
    const warn = this.insideRepo ? " (WARNING: directory is inside a git repository; ensure it is git-ignored)" : "";
    return { ok: true, message: `${this.listFiles().length} readable document(s)${warn}` };
  }

  async discoverCapabilities(): Promise<Capability[]> { return ["files.list"]; }

  private listFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 6) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name.startsWith(".") || ent.name === "README.md") continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full, depth + 1);
        else if (TEXT_EXT.has(path.extname(ent.name).toLowerCase())) out.push(full);
      }
    };
    if (fs.existsSync(this.directory)) walk(this.directory, 0);
    return out;
  }

  async *fetchSince(cursor: Cursor, window: RetrievalWindow, ctx: FetchContext): AsyncIterable<EvidenceBatch> {
    const seen = (cursor.mtimes as Record<string, number> | undefined) ?? {};
    const next: Record<string, number> = { ...seen };
    const items: Evidence[] = [];
    const notes: string[] = [];
    for (const file of this.listFiles()) {
      try {
        const st = fs.statSync(file);
        if (st.size > MAX_BYTES) { notes.push(`skipped (too large): ${path.basename(file)}`); continue; }
        const rel = path.relative(this.directory, file);
        if (seen[rel] === st.mtimeMs) continue;
        const text = fs.readFileSync(file, "utf8");
        next[rel] = st.mtimeMs;
        items.push(normalizeEvidence({
          provider_id: this.id, source_type: "document",
          occurred_at: st.mtime.toISOString(), title: path.basename(file),
          source_kind: "file", source_id: rel, path: file, text,
          structured: { bytes: st.size, ext: path.extname(file) },
        }, this.rawTextPolicy));
      } catch (e) {
        ctx.logger.warn("local doc unreadable", { file: path.basename(file), error: e });
      }
    }
    void window;
    yield { items, next_cursor: { mtimes: next }, notes };
  }

  openSourceUrl(evidence: Evidence): string | undefined {
    return evidence.source_ref.path ? "file:///" + evidence.source_ref.path.replace(/\\/g, "/") : undefined;
  }
}
