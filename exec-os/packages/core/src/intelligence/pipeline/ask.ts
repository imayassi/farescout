import type { Store, AnyObject } from "../../store/store.js";
import type { IntelligenceBackend } from "../backends/types.js";
import { answerWithEvidence, type AnswerOutput, type SkillContext } from "../skills/index.js";
import type { Logger } from "../../logging/logger.js";
import type { ObjectType } from "../../domain/index.js";

/** Secondary conversational interface: retrieve locally (FTS + tracked objects), then answer with citations. */
export async function askWithEvidence(store: Store, backend: IntelligenceBackend, ctx: SkillContext, question: string, logger: Logger): Promise<AnswerOutput & { evidence: Array<{ evidence_id: string; title: string; source_type: string; occurred_at: string }> }> {
  const evidence = store.searchEvidence(question, 25);
  const types: ObjectType[] = ["action", "decision", "escalation", "risk", "recommendation", "data_request", "signal"];
  const objects: Array<{ type: string; id: string; title: string; status?: string; owner?: string; epistemic: string; evidence_ids: string[] }> = [];
  const q = question.toLowerCase();
  const words = q.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
  for (const t of types) {
    for (const o of store.listObjects<AnyObject>({ type: t, limit: 300 })) {
      const r = o as unknown as Record<string, unknown>;
      const title = String(r.title ?? r.topic ?? r.issue ?? r.recommendation ?? r.request ?? r.statement ?? "");
      const hay = `${title} ${String(r.description ?? r.reasoning ?? "")}`.toLowerCase();
      const hit = words.some((w) => hay.includes(w)) || (r.evidence as Array<{ evidence_id: string }> | undefined)?.some((e) => evidence.some((x) => x.evidence_id === e.evidence_id));
      if (hit) objects.push({ type: t, id: String(r.id), title, status: r.status as string | undefined, owner: (r.owner ?? r.decision_maker) as string | undefined, epistemic: String(r.epistemic), evidence_ids: ((r.evidence as Array<{ evidence_id: string }> | undefined) ?? []).map((e) => e.evidence_id) });
    }
  }
  const out = await backend.runSkill(answerWithEvidence, {
    question,
    evidence: evidence.map((e) => ({ evidence_id: e.evidence_id, source_type: e.source_type, occurred_at: e.occurred_at, title: e.title, participants: e.participants.map((p) => p.name), text: e.text })),
    objects: objects.slice(0, 40),
  }, ctx, { logger });
  const cited = out.citations.map((c) => store.getEvidence(c.evidence_id)).filter((e): e is NonNullable<typeof e> => !!e);
  return { ...out, evidence: cited.map((e) => ({ evidence_id: e.evidence_id, title: e.title, source_type: e.source_type, occurred_at: e.occurred_at })) };
}
