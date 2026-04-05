import path from "node:path";
import type { ChannelId, SessionKey } from "../types.js";

// ── Session key encoding ──────────────────────────────────────────────────
//
// Session keys must be safe as filesystem directory names.
// Encoding rules (stable — never change once sessions exist):
//   "/"  → "__"
//   "+"  → "p"   (phone numbers start with +)
//   " "  → "_"
// Format: {channel}__{encodedChatId}
// DM:    telegram__p8613800000000
// Group: telegram__g123456789
// Feishu DM:    feishu__ou_xxxx
// Feishu Group: feishu__c_xxxx

export function encodeSessionKey(key: SessionKey): string {
  const encoded = encodeId(key.chatId);
  return `${key.channel}__${encoded}`;
}

export function decodeSessionKey(str: string): SessionKey {
  const sep = str.indexOf("__");
  if (sep === -1) throw new Error(`Invalid session key: ${str}`);
  const channel = str.slice(0, sep) as ChannelId;
  const chatId = decodeId(str.slice(sep + 2));

  // Derive peerId: for DMs chatId == peerId; for groups we store separately
  // In encoding, groups are prefixed with "g" (Telegram) or "c" (Feishu)
  // The session store keeps metadata.json with peerId for groups
  return { channel, peerId: chatId, chatId };
}

function encodeId(id: string): string {
  return id.replace(/\+/g, "p").replace(/\//g, "__").replace(/ /g, "_");
}

function decodeId(encoded: string): string {
  // We can't perfectly reverse "p" → "+" because "p" might be a real char,
  // but for phone numbers that's fine: we only use this for display/lookup
  return encoded;
}

export function sessionDir(dataDir: string, key: SessionKey): string {
  return path.join(dataDir, "sessions", encodeSessionKey(key));
}

export function transcriptPath(dataDir: string, key: SessionKey): string {
  return path.join(sessionDir(dataDir, key), "transcript.jsonl");
}

export function metadataPath(dataDir: string, key: SessionKey): string {
  return path.join(sessionDir(dataDir, key), "metadata.json");
}

// ── Session metadata ──────────────────────────────────────────────────────

export interface SessionMetadata {
  channel: ChannelId;
  peerId: string;
  chatId: string;
  isDm: boolean;
  createdAt: string;
  lastActiveAt: string;
  messageCount: number;
}

// ── List all sessions ─────────────────────────────────────────────────────

export async function listSessionKeys(dataDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const sessionsDir = path.join(dataDir, "sessions");
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}
