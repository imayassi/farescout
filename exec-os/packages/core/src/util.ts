import { createHash, randomUUID } from "node:crypto";

export const nowIso = (): string => new Date().toISOString();
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "theme";
}

export function daysAgo(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Normalize a title for entity resolution. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|to|for|of|on|in|and|with|by|is|are|be|please|need|needs|re|fw|fwd)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(s: string): Set<string> {
  const t = new Set<string>();
  const padded = `  ${s} `;
  for (let i = 0; i < padded.length - 2; i++) t.add(padded.slice(i, i + 3));
  return t;
}

/** Jaccard similarity on character trigrams of normalized titles (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const ta = trigrams(normalizeTitle(a));
  const tb = trigrams(normalizeTitle(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(" ").filter((w) => w.length > 2));
  const tb = new Set(normalizeTitle(b).split(" ").filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export function truncate(s: string | undefined, n: number): string | undefined {
  if (s === undefined) return undefined;
  return s.length <= n ? s : s.slice(0, n) + "…";
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
