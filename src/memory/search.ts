import type { MemoryEntry, MemorySearchResult } from "../types.js";

// ── Tokenization ──────────────────────────────────────────────────────────

/**
 * Extract tokens from a query string.
 * English: split on whitespace/punctuation.
 * Chinese: bigram (every two adjacent characters).
 * The combination handles mixed text naturally.
 *
 * Known limitation: bigram produces noise for short Chinese queries
 * (e.g. "经理" matches both "产品经理" and "总经理"). Acceptable for
 * personal use where the total entry count stays in the hundreds.
 * Upgrade path: replace this function with jieba when needed.
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  // English words (sequences of word characters)
  const wordMatches = lower.match(/[a-z0-9_'-]+/g);
  if (wordMatches) {
    for (const w of wordMatches) {
      if (w.length >= 2) tokens.add(w);
    }
  }

  // Chinese / CJK characters: bigrams
  // CJK Unified Ideographs range: \u4e00-\u9fff (and extensions)
  const cjkChars = lower.replace(/[^\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, " ").split(" ").join("");
  for (let i = 0; i < cjkChars.length - 1; i++) {
    tokens.add(cjkChars[i]! + cjkChars[i + 1]!);
  }
  // Also add single CJK characters for short queries (length 1)
  if (cjkChars.length === 1) {
    tokens.add(cjkChars);
  }

  return tokens;
}

// ── Scoring ───────────────────────────────────────────────────────────────

/**
 * Score a single entry against query tokens.
 * Returns a value >= 0; higher is more relevant.
 * Formula: (matched tokens / query tokens) * log(1 + access_count)
 */
export function scoreEntry(queryTokens: Set<string>, entry: MemoryEntry): number {
  if (queryTokens.size === 0) return 0;
  const entryTokens = tokenize(entry.content);
  let hits = 0;
  for (const qt of queryTokens) {
    if (entryTokens.has(qt)) hits++;
  }
  if (hits === 0) return 0;
  const matchRatio = hits / queryTokens.size;
  // Boost frequently-accessed entries slightly
  const accessBoost = Math.log1p(entry.accessCount);
  return matchRatio * (1 + 0.1 * accessBoost);
}

/**
 * Compute similarity between two content strings (for dedup).
 * Returns 0..1.
 */
export function contentSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) {
    if (tb.has(t)) shared++;
  }
  // Jaccard similarity
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

// ── Search ────────────────────────────────────────────────────────────────

export interface SearchOptions {
  topN?: number;          // default 5
  minScore?: number;      // default 0.1 — entries below this are excluded
}

/**
 * Search a list of entries and return ranked results.
 * Pure function — no I/O.
 */
export function searchEntries(
  query: string,
  entries: MemoryEntry[],
  filePath: string,
  options: SearchOptions = {}
): MemorySearchResult[] {
  const { topN = 5, minScore = 0.1 } = options;
  const queryTokens = tokenize(query);

  const scored: MemorySearchResult[] = entries
    .map((entry, index) => ({
      entry,
      score: scoreEntry(queryTokens, entry),
      filePath,
      index,
    }))
    .filter(r => r.score >= minScore);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
