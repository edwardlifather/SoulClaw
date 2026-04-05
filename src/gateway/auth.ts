import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RateLimitEntry } from "../types.js";

// ── Bearer token check ────────────────────────────────────────────────────

/**
 * Check the Authorization: Bearer <token> header.
 * Returns true if auth passes (token matches or no token is configured).
 */
export function checkBearerToken(req: IncomingMessage, expectedToken: string | undefined): boolean {
  if (!expectedToken) return true; // No token configured — open access

  const authHeader = req.headers["authorization"] ?? "";
  const match = /^Bearer (.+)$/i.exec(authHeader);
  if (!match) return false;

  const provided = match[1]!;
  // Constant-time comparison — pad to equal length
  const maxLen = Math.max(provided.length, expectedToken.length);
  const a = Buffer.alloc(maxLen);
  const b = Buffer.alloc(maxLen);
  a.write(provided);
  b.write(expectedToken);
  return timingSafeEqual(a, b);
}

// ── Rate limiter ──────────────────────────────────────────────────────────

const WINDOW_MS = 60_000;         // 1 minute window
const MAX_ATTEMPTS = 20;          // max attempts per window
const LOCK_DURATION_MS = 300_000; // 5 minutes lockout

const rateLimitMap = new Map<string, RateLimitEntry>();

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) ?? { attempts: [] };

  // Check lock
  if (entry.lockedUntil && now < entry.lockedUntil) return false;

  // Remove stale attempts outside the window
  entry.attempts = entry.attempts.filter(ts => now - ts < WINDOW_MS);

  // Check limit
  if (entry.attempts.length >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCK_DURATION_MS;
    rateLimitMap.set(ip, entry);
    return false;
  }

  entry.attempts.push(now);
  rateLimitMap.set(ip, entry);
  return true;
}

// ── Auth middleware helper ────────────────────────────────────────────────

/**
 * Responds with 401/429 and returns false if auth fails.
 * Returns true if the request may proceed.
 */
export function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
  token: string | undefined
): boolean {
  const ip = getIp(req);

  if (!checkRateLimit(ip)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many requests" }));
    return false;
  }

  if (!checkBearerToken(req, token)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return false;
  }

  return true;
}

function getIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}
