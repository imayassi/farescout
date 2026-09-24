import type { Evidence } from "../../domain/index.js";

export interface Batch { id: string; evidence: Evidence[] }

/**
 * Group evidence into analysis batches: chronological, thread-affine, bounded by item count and
 * character budget so a batch always fits one model call. Metrics are small and can pack densely.
 */
export function buildBatches(evidence: Evidence[], limits: { max_items: number; max_chars: number }): Batch[] {
  const sorted = [...evidence].sort((a, b) => (a.thread_id ?? "").localeCompare(b.thread_id ?? "") || a.occurred_at.localeCompare(b.occurred_at));
  // Keep thread locality but emit in chronological order of the first item.
  const batches: Batch[] = [];
  let cur: Evidence[] = []; let chars = 0; let n = 0;
  const flush = () => { if (cur.length) { batches.push({ id: `b${batches.length + 1}`, evidence: cur }); cur = []; chars = 0; } };
  for (const e of sorted) {
    const size = (e.text?.length ?? 0) + e.title.length + 200;
    if (cur.length && (cur.length >= limits.max_items || chars + size > limits.max_chars)) flush();
    cur.push(e); chars += size; n++;
  }
  flush();
  void n;
  return batches.sort((a, b) => a.evidence[0]!.occurred_at.localeCompare(b.evidence[0]!.occurred_at)).map((b, i) => ({ ...b, id: `batch-${i + 1}` }));
}
