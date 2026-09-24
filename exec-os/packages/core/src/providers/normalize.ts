import { Evidence, type Participant, type SourceType } from "../domain/index.js";
import { nowIso, sha256 } from "../util.js";

export interface RawItem {
  provider_id: string;
  source_type: SourceType;
  occurred_at: string;
  title?: string;
  participants?: Participant[];
  thread_id?: string;
  source_kind: string;
  source_id: string;
  url?: string;
  path?: string;
  text?: string;
  structured?: Record<string, unknown>;
  sensitivity?: { label?: string; confidential?: boolean };
}

export type RawTextPolicy = "trimmed" | "full" | "none";
const TRIM_CHARS = 4000;

/** Build a normalized Evidence record with a stable id and a content hash for dedupe. */
export function normalizeEvidence(raw: RawItem, policy: RawTextPolicy = "trimmed"): Evidence {
  const evidence_id = "ev_" + sha256(`${raw.provider_id}|${raw.source_kind}|${raw.source_id}`).slice(0, 20);
  const basis = `${raw.source_type}|${raw.occurred_at}|${(raw.title ?? "").trim()}|${(raw.text ?? "").trim()}`;
  const content_hash = sha256(basis).slice(0, 24);
  let text = raw.text;
  if (policy === "none") text = undefined;
  else if (policy === "trimmed" && text && text.length > TRIM_CHARS) text = text.slice(0, TRIM_CHARS) + "…";
  return Evidence.parse({
    evidence_id,
    provider_id: raw.provider_id,
    source_type: raw.source_type,
    occurred_at: raw.occurred_at,
    retrieved_at: nowIso(),
    title: raw.title ?? "",
    participants: raw.participants ?? [],
    thread_id: raw.thread_id,
    source_ref: { kind: raw.source_kind, id: raw.source_id, url: raw.url, path: raw.path },
    text,
    structured: raw.structured,
    sensitivity: raw.sensitivity ?? {},
    content_hash,
  });
}

/** Human label for provenance lists: "Email — Sep 12". */
export function evidenceLabel(e: Pick<Evidence, "source_type" | "occurred_at">): string {
  const names: Record<SourceType, string> = {
    email: "Email", teams_message: "Teams message", teams_thread: "Teams thread", meeting: "Meeting notes",
    calendar_event: "Calendar", document: "Document", metric: "Metric", copilot_answer: "Copilot answer",
    tracker_item: "Tracker",
  };
  const d = new Date(e.occurred_at);
  const date = isNaN(d.getTime()) ? e.occurred_at : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${names[e.source_type]} — ${date}`;
}
