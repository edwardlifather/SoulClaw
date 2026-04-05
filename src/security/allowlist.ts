// ── Phone number normalization ────────────────────────────────────────────
// Normalizes phone numbers to E.164-ish format for comparison.
// Strips spaces, dashes, parentheses. Preserves leading +.

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-().]/g, "");
}

// ── Allowlist check ───────────────────────────────────────────────────────

/**
 * Returns true if peerId is in the allowFrom list.
 * Handles:
 *   - Phone numbers (normalized comparison)
 *   - Feishu open_ids (exact string match)
 *   - Telegram numeric user IDs as strings (exact match)
 *   - Wildcard "*" (accept everyone)
 */
export function isAllowed(peerId: string, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) return true;

  const normalizedPeer = normalizePhone(peerId);
  for (const allowed of allowFrom) {
    const normalizedAllowed = normalizePhone(allowed);
    if (normalizedPeer === normalizedAllowed) return true;
  }
  return false;
}
