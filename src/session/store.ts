import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sessionDir, transcriptPath, metadataPath } from "./routing.js";
import type { SessionKey, TranscriptEntry, ContentBlock, ModelUsage } from "../types.js";
import type { SessionMetadata } from "./routing.js";

// ── Write ─────────────────────────────────────────────────────────────────

export async function appendEntry(dataDir: string, key: SessionKey, entry: TranscriptEntry): Promise<void> {
  const dir = sessionDir(dataDir, key);
  await fs.mkdir(dir, { recursive: true });

  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(transcriptPath(dataDir, key), line, "utf-8");
  await updateMetadata(dataDir, key, entry);
}

export function makeUserEntry(
  text: string | undefined,
  blocks: ContentBlock[] | undefined,
  channel: TranscriptEntry["channel"],
  peerId: string,
  senderName?: string
): TranscriptEntry {
  return {
    id: randomUUID(),
    role: "user",
    text,
    blocks,
    timestamp: new Date().toISOString(),
    channel,
    peerId,
    senderName,
  };
}

export function makeAssistantEntry(text: string, usage?: ModelUsage, request?: any, response?: any): TranscriptEntry {
  return {
    id: randomUUID(),
    role: "assistant",
    text,
    timestamp: new Date().toISOString(),
    usage,
    request,
    response,
  };
}

export function makeToolUseEntry(id: string, name: string, input: Record<string, unknown>): TranscriptEntry {
  return {
    id: randomUUID(),
    role: "tool_use",
    blocks: [{ type: "tool_use", id, name, input }],
    timestamp: new Date().toISOString(),
  };
}

export function makeToolResultEntry(toolUseId: string, content: string): TranscriptEntry {
  return {
    id: randomUUID(),
    role: "tool_result",
    blocks: [{ type: "tool_result", toolUseId, content }],
    timestamp: new Date().toISOString(),
  };
}

// ── Read ──────────────────────────────────────────────────────────────────

export async function readTranscript(
  dataDir: string,
  key: SessionKey,
  limit?: number,
  offset = 0
): Promise<TranscriptEntry[]> {
  const filePath = transcriptPath(dataDir, key);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter(l => l.trim().length > 0);
    const parsed = lines.map(l => JSON.parse(l) as TranscriptEntry);
    if (limit !== undefined) {
      return parsed.slice(offset, offset + limit);
    }
    return parsed.slice(offset);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// Read the most recent N entries (for context building)
export async function readRecentTranscript(
  dataDir: string,
  key: SessionKey,
  maxEntries: number
): Promise<TranscriptEntry[]> {
  const all = await readTranscript(dataDir, key);
  return all.slice(-maxEntries);
}

// ── Metadata ──────────────────────────────────────────────────────────────

async function updateMetadata(
  dataDir: string,
  key: SessionKey,
  entry: TranscriptEntry
): Promise<void> {
  const filePath = metadataPath(dataDir, key);
  let meta: SessionMetadata;
  try {
    meta = JSON.parse(await fs.readFile(filePath, "utf-8")) as SessionMetadata;
    meta.lastActiveAt = entry.timestamp;
    meta.messageCount = (meta.messageCount ?? 0) + 1;
  } catch {
    meta = {
      channel: key.channel,
      peerId: key.peerId,
      chatId: key.chatId,
      isDm: key.peerId === key.chatId,
      createdAt: entry.timestamp,
      lastActiveAt: entry.timestamp,
      messageCount: 1,
    };
  }
  await fs.writeFile(filePath, JSON.stringify(meta, null, 2), "utf-8");
}

export async function readMetadata(
  dataDir: string,
  key: SessionKey
): Promise<SessionMetadata | null> {
  const filePath = metadataPath(dataDir, key);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as SessionMetadata;
  } catch {
    return null;
  }
}
