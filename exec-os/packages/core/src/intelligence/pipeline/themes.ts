import type { Store } from "../../store/store.js";
import { Theme, type EvidenceRef, type ActionItem, type Decision, type Escalation, type Risk } from "../../domain/index.js";
import { newId, nowIso, slugify, titleSimilarity } from "../../util.js";

/** Ensure pinned themes exist (from config) and return a resolver from theme-hint names to theme ids. */
export function ensurePinnedThemes(store: Store, pinned: string[]): void {
  const now = nowIso();
  for (const name of pinned) {
    const slug = slugify(name);
    const existing = store.getThemeBySlug(slug);
    if (existing) { if (!existing.pinned) { existing.pinned = true; store.upsertTheme(existing); } continue; }
    store.upsertTheme(Theme.parse({ id: newId("thm"), name, slug, pinned: true, discovered: false, created_at: now, updated_at: now }));
  }
}

export function resolveThemeName(store: Store, name: string): Theme | undefined {
  const slug = slugify(name);
  const exact = store.getThemeBySlug(slug);
  if (exact) return exact;
  for (const t of store.listThemes(true)) if (titleSimilarity(t.name, name) >= 0.7) return t;
  return undefined;
}

/** Create/refresh discovered themes from batch theme hints. Returns a resolver for observation theme hints. */
export function applyThemeHints(store: Store, hints: Array<{ name: string; description: string; evidence_ids: string[] }>, autoDiscover: boolean): (names: string[]) => string | undefined {
  const now = nowIso();
  for (const h of hints) {
    if (!h.name.trim()) continue;
    let t = resolveThemeName(store, h.name);
    if (!t) {
      if (!autoDiscover) continue;
      t = Theme.parse({ id: newId("thm"), name: h.name.trim(), slug: slugify(h.name), pinned: false, discovered: true, description: h.description, created_at: now, updated_at: now });
      store.journal({ object_type: "theme", object_id: t.id, event: "detected", actor: "system", summary: `Theme discovered: ${t.name}`, evidence: h.evidence_ids.map((id) => ({ evidence_id: id, role: "supports" as const })) });
    }
    if (!t.description && h.description) t.description = h.description;
    const seen = new Set(t.evidence.map((e) => e.evidence_id));
    const add: EvidenceRef[] = h.evidence_ids.filter((id) => !seen.has(id)).map((id) => ({ evidence_id: id, role: "supports" as const }));
    if (add.length) { t.evidence = [...t.evidence, ...add]; t.updated_at = now; }
    store.upsertTheme(t);
  }
  return (names: string[]) => {
    for (const n of names) { const t = resolveThemeName(store, n); if (t) return t.id; }
    return undefined;
  };
}

/** Recompute each theme's "current state" and "what changed" from its objects and recent journal. */
export function refreshThemeStates(store: Store, sinceIso: string): void {
  const now = nowIso();
  for (const t of store.listThemes(true)) {
    const actions = store.listObjects<ActionItem>({ type: "action", theme_id: t.id });
    const decisions = store.listObjects<Decision>({ type: "decision", theme_id: t.id });
    const escalations = store.listObjects<Escalation>({ type: "escalation", theme_id: t.id });
    const risks = store.listObjects<Risk>({ type: "risk", theme_id: t.id });
    const open = actions.filter((a) => !["completed", "dismissed"].includes(a.status));
    const overdue = open.filter((a) => a.due_at && a.due_at < now);
    const needed = decisions.filter((d) => d.status === "needed" || d.status === "pending_approval");
    const potential = escalations.filter((e) => e.status === "potential" || e.status === "active");
    const openRisks = risks.filter((r) => r.status !== "closed");
    const parts: string[] = [];
    if (open.length) parts.push(`${open.length} open action${open.length > 1 ? "s" : ""}${overdue.length ? ` (${overdue.length} overdue)` : ""}`);
    if (needed.length) parts.push(`${needed.length} decision${needed.length > 1 ? "s" : ""} needed`);
    if (potential.length) parts.push(`${potential.length} escalation${potential.length > 1 ? "s" : ""}`);
    if (openRisks.length) parts.push(`${openRisks.length} open risk${openRisks.length > 1 ? "s" : ""}`);
    const recorded = decisions.filter((d) => d.status === "recorded");
    if (recorded.length) parts.push(`${recorded.length} recorded decision${recorded.length > 1 ? "s" : ""}`);
    t.current_state = parts.length ? parts.join(" · ") : "No tracked items yet";
    const changes = store.listJournal({ since: sinceIso, limit: 2000 }).filter((j) => {
      if (j.object_type === "theme") return j.object_id === t.id;
      const o = store.getObject(j.object_id); return o && (o.object as { theme_id?: string }).theme_id === t.id;
    });
    const statusChanges = changes.filter((j) => j.event === "status_changed").length;
    const detected = changes.filter((j) => j.event === "detected").length;
    const updated = changes.filter((j) => j.event === "updated").length;
    const wc: string[] = [];
    if (detected) wc.push(`${detected} new item${detected > 1 ? "s" : ""}`);
    if (statusChanges) wc.push(`${statusChanges} status change${statusChanges > 1 ? "s" : ""}`);
    if (updated) wc.push(`${updated} item${updated > 1 ? "s" : ""} with new evidence`);
    t.what_changed = wc.length ? wc.join(", ") : "";
    const total = t.evidence.length + actions.length + decisions.length + escalations.length + risks.length;
    t.confidence = Math.min(0.95, 0.4 + total * 0.05);
    t.updated_at = now;
    store.upsertTheme(t);
  }
}
