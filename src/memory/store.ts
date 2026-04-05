import fs from "node:fs/promises";
import path from "node:path";
import { contentSimilarity, searchEntries } from "./search.js";
import type { MemoryEntry, MemorySearchResult, MemoryType } from "../types.js";

// ── Entry format ──────────────────────────────────────────────────────────
//
// Each long_term file is a sequence of entries separated by comment markers:
//
//   <!-- entry: last_accessed=2026-03-28, access_count=7 -->
//   User is called Zhang San, works as a product manager in Beijing.
//
//   <!-- entry: last_accessed=2026-01-10, access_count=1 -->
//   User mentioned wanting to learn Rust.
//

const ENTRY_MARKER_RE = /<!-- entry: last_accessed=(\d{4}-\d{2}-\d{2}), access_count=(\d+) -->\n([\s\S]*?)(?=<!-- entry:|$)/g;

function formatEntry(entry: MemoryEntry): string {
  return `<!-- entry: last_accessed=${entry.lastAccessed}, access_count=${entry.accessCount} -->\n${entry.content.trim()}\n`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── File paths ────────────────────────────────────────────────────────────

export function memoryDir(dataDir: string): string {
  return path.join(dataDir, "memory");
}

export function shortTermDir(dataDir: string): string {
  return path.join(memoryDir(dataDir), "short_term");
}

export function longTermDir(dataDir: string): string {
  return path.join(memoryDir(dataDir), "long_term");
}

export function longTermFilePath(dataDir: string, type: MemoryType, project?: string): string {
  const base = longTermDir(dataDir);
  if (type === "project") {
    if (!project) throw new Error("project name required for type=project");
    return path.join(base, "projects", `${project}.md`);
  }
  return path.join(base, `${type}s.md`); // "facts.md" or "preferences.md"
}

export function shortTermFilePath(dataDir: string, date: string): string {
  return path.join(shortTermDir(dataDir), `${date}.md`);
}

// ── Per-file mutex ────────────────────────────────────────────────────────
// Prevents concurrent writes to the same file from interleaving.

const fileMutexes = new Map<string, Promise<void>>();

function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileMutexes.get(filePath) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>(r => { resolve = r; });
  fileMutexes.set(filePath, next);
  return prev.then(fn).finally(resolve) as Promise<T>;
}

// ── Parse / serialize ─────────────────────────────────────────────────────

export function parseEntries(fileContent: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  // Reset lastIndex before use
  ENTRY_MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTRY_MARKER_RE.exec(fileContent)) !== null) {
    const content = match[3]!.trim();
    if (content.length > 0) {
      entries.push({
        content,
        lastAccessed: match[1]!,
        accessCount: parseInt(match[2]!, 10),
      });
    }
  }
  return entries;
}

export function serializeEntries(entries: MemoryEntry[]): string {
  return entries.map(formatEntry).join("\n");
}

// ── Read ──────────────────────────────────────────────────────────────────

export async function readEntries(filePath: string): Promise<MemoryEntry[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseEntries(content);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// ── Write (with dedup) ────────────────────────────────────────────────────

const DEDUP_THRESHOLD = 0.8;

/**
 * Save a new memory entry. If a sufficiently similar entry already exists,
 * update it instead of appending (prevents repeated writes of identical facts).
 */
export async function saveEntry(
  filePath: string,
  content: string,
  type: MemoryType
): Promise<void> {
  await withFileLock(filePath, async () => {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const entries = await readEntries(filePath);
    const newEntry: MemoryEntry = {
      content: content.trim(),
      lastAccessed: today(),
      accessCount: 1,
    };

    // Check for duplicate
    let dupIndex = -1;
    let dupScore = 0;
    for (let i = 0; i < entries.length; i++) {
      const sim = contentSimilarity(content, entries[i]!.content);
      if (sim > dupScore) {
        dupScore = sim;
        dupIndex = i;
      }
    }

    if (dupIndex >= 0 && dupScore >= DEDUP_THRESHOLD) {
      // Update existing entry: Use the LATEST content (the user's latest update)
      const existing = entries[dupIndex]!;
      entries[dupIndex] = {
        content: content.trim(), // Use new phrasing
        lastAccessed: today(),
        accessCount: existing.accessCount + 1,
      };
    } else {
      entries.push(newEntry);
    }

    await fs.writeFile(filePath, serializeEntries(entries), "utf-8");
  });
}

// ── Update access metadata after search ──────────────────────────────────

export async function touchEntries(filePath: string, indices: number[]): Promise<void> {
  if (indices.length === 0) return;
  await withFileLock(filePath, async () => {
    const entries = await readEntries(filePath);
    for (const i of indices) {
      if (entries[i]) {
        entries[i]!.lastAccessed = today();
        entries[i]!.accessCount += 1;
      }
    }
    await fs.writeFile(filePath, serializeEntries(entries), "utf-8");
  });
}

// ── Search across all long_term files ────────────────────────────────────

export async function searchMemory(
  dataDir: string,
  query: string,
  topN = 5
): Promise<MemorySearchResult[]> {
  const ltDir = longTermDir(dataDir);
  const allResults: MemorySearchResult[] = [];

  let files: string[] = [];
  try {
    files = await collectMarkdownFiles(ltDir);
  } catch {
    return [];
  }

  for (const filePath of files) {
    const entries = await readEntries(filePath);
    const results = searchEntries(query, entries, filePath, { topN, minScore: 0.1 });
    allResults.push(...results);
  }

  // Re-rank across all files and return top N
  allResults.sort((a, b) => b.score - a.score);
  const top = allResults.slice(0, topN);

  // Update access metadata for returned entries
  const byFile = new Map<string, number[]>();
  for (const r of top) {
    const arr = byFile.get(r.filePath) ?? [];
    arr.push(r.index);
    byFile.set(r.filePath, arr);
  }
  await Promise.all([...byFile.entries()].map(([fp, idxs]) => touchEntries(fp, idxs)));

  return top;
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await collectMarkdownFiles(full));
    } else if (e.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

// ── Short-term append ─────────────────────────────────────────────────────

/**
 * Append a daily summary entry to short_term/{date}.md.
 * Multiple conversations on the same day are appended sequentially.
 */
export async function appendShortTerm(
  dataDir: string,
  summaryText: string,
  channel: string,
  peerId: string
): Promise<void> {
  const date = today();
  const filePath = shortTermFilePath(dataDir, date);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  const header = `## ${ts} [${channel}/${peerId}]\n`;
  await fs.appendFile(filePath, "\n" + header + summaryText.trim() + "\n", "utf-8");
}

// ── Short-term cleanup ────────────────────────────────────────────────────

export async function pruneShortTerm(dataDir: string, maxDays: number): Promise<void> {
  const dir = shortTermDir(dataDir);
  try {
    const files = await fs.readdir(dir);
    const cutoff = Date.now() - maxDays * 86400_000;
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// ── List projects ─────────────────────────────────────────────────────────

export async function listProjects(dataDir: string): Promise<string[]> {
  const projectsDir = path.join(longTermDir(dataDir), "projects");
  try {
    const files = await fs.readdir(projectsDir);
    return files.filter(f => f.endsWith(".md")).map(f => f.slice(0, -3));
  } catch {
    return [];
  }
}

// ── Read short_term files for weekly consolidation ────────────────────────

export async function readRecentShortTerm(dataDir: string, days: number): Promise<string> {
  const dir = shortTermDir(dataDir);
  const cutoff = Date.now() - days * 86400_000;
  let combined = "";
  try {
    const files = (await fs.readdir(dir)).filter(f => f.endsWith(".md")).sort();
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs >= cutoff) {
        combined += await fs.readFile(filePath, "utf-8") + "\n";
      }
    }
  } catch {
    // dir may not exist yet
  }
  return combined;
}
