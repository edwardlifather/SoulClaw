import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ChannelId, PairingRecord } from "../types.js";

// ── Pairing code format ───────────────────────────────────────────────────
// 8 characters from an unambiguous alphabet (no 0/O/1/I/l)
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return code;
}

// ── Storage ───────────────────────────────────────────────────────────────

function pairingFilePath(dataDir: string): string {
  return path.join(dataDir, "pairing.json");
}

async function readRecords(dataDir: string): Promise<PairingRecord[]> {
  const filePath = pairingFilePath(dataDir);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as PairingRecord[];
  } catch {
    return [];
  }
}

async function writeRecords(dataDir: string, records: PairingRecord[]): Promise<void> {
  await fs.writeFile(pairingFilePath(dataDir), JSON.stringify(records, null, 2), "utf-8");
}

function isExpired(record: PairingRecord): boolean {
  return Date.now() > new Date(record.expiresAt).getTime();
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Create a new pairing record for an unknown sender.
 * Returns the generated code to send back to the user.
 */
export async function createPairingCode(
  dataDir: string,
  channel: ChannelId,
  peerId: string
): Promise<string> {
  const records = await readRecords(dataDir);

  // Remove expired records and any existing record for this peer
  const now = Date.now();
  const fresh = records.filter(r => !isExpired(r) && !(r.channel === channel && r.peerId === peerId));

  const code = generateCode();
  const record: PairingRecord = {
    code,
    channel,
    peerId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(now + EXPIRY_MS).toISOString(),
  };
  fresh.push(record);
  await writeRecords(dataDir, fresh);
  return code;
}

/**
 * Look up a pairing record by code.
 * Returns the record if found and not expired, null otherwise.
 */
export async function findPairingRecord(
  dataDir: string,
  code: string
): Promise<PairingRecord | null> {
  const records = await readRecords(dataDir);
  const record = records.find(r => r.code === code.toUpperCase());
  if (!record || isExpired(record)) return null;
  return record;
}

/**
 * Consume a pairing record (remove it after approval).
 */
export async function consumePairingRecord(dataDir: string, code: string): Promise<void> {
  const records = await readRecords(dataDir);
  const filtered = records.filter(r => r.code !== code.toUpperCase());
  await writeRecords(dataDir, filtered);
}

/**
 * Check if a pairing code is already pending for this peer.
 * Used to avoid sending a new code on every message from the same unknown sender.
 */
export async function hasPendingCode(
  dataDir: string,
  channel: ChannelId,
  peerId: string
): Promise<boolean> {
  const records = await readRecords(dataDir);
  return records.some(r => r.channel === channel && r.peerId === peerId && !isExpired(r));
}
