import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { requireAuth } from "./auth.js";
import { getTelegramWebhookHandler } from "../channels/telegram.js";
import { getFeishuWebhookHandler } from "../channels/feishu.js";
import { getTelegramHealth } from "../channels/telegram.js";
import { getFeishuHealth } from "../channels/feishu.js";
import { listSessionKeys } from "../session/routing.js";
import { readTranscript, readMetadata } from "../session/store.js";
import { listJobs, runJobNow, setJobEnabled } from "../cron/service.js";
import { consolidateSession } from "../memory/consolidate.js";
import { runAgent } from "../agent/runner.js";
import {
  shortTermDir, longTermDir,
  shortTermFilePath,
} from "../memory/store.js";
import { logger } from "../logger.js";
import type { Config, Env, WsEvent, SessionKey } from "../types.js";

let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;

const UI_PATH = fileURLToPath(new URL("../../ui/index.html", import.meta.url));

// ── WebSocket event emitter ───────────────────────────────────────────────

export function emitWsEvent(event: WsEvent): void {
  if (!wss) return;
  const payload = JSON.stringify(event);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// ── Global Stats & Logs Buffer ──────────────────────────────────────────
const LOG_MAX = 50;
const logBuffer: string[] = [];
const stats = { totalRequests: 0, lastRequestTime: 'Never' };

const originalLog = console.log;
console.log = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const entry = msg; 
  logBuffer.push(entry);
  if (logBuffer.length > LOG_MAX) logBuffer.shift();
  originalLog.apply(console, args);
};

// ── Server startup ────────────────────────────────────────────────────────

export function startServer(config: Config, env: Env): void {
  const telegramHandler = config.telegram
    ? getTelegramWebhookHandler(config, env)
    : null;
  const feishuHandler = config.feishu
    ? getFeishuWebhookHandler(config, env)
    : null;

  const telegramPath = config.telegram?.webhookPath ?? "/telegram/webhook";
  const feishuPath = config.feishu?.webhookPath ?? "/feishu/events";

  httpServer = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // ✅ Enable CORS for all domains (or restrict to your specific domain)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle preflight requests (OPTIONS)
    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      // ── Channel webhooks (no auth — they do their own verification) ──
      if (method === "POST" && url === telegramPath && telegramHandler) {
        await telegramHandler(req, res);
        return;
      }
      if (method === "POST" && url.startsWith(feishuPath) && feishuHandler) {
        await feishuHandler(req, res);
        return;
      }

      // ── Health check (public) ──
      if (url === "/healthz" || url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          status: "ok", 
          version: "0.1.0",
          ts: new Date().toISOString() 
        }));
        return;
      }

      // ── Web UI (public, served as static HTML) ──
      if (url === "/" || url === "/ui" || url === "/index.html") {
        serveUi(res);
        return;
      }

      // ── API routes (require auth) ──
      if (url.startsWith("/api/")) {
        if (!requireAuth(req, res, env.minGateToken)) return;
        
        // Internal status/telemetry sub-router
        if (url === "/api/status") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            model: config.model.model,
            stats,
            logs: logBuffer
          }));
          return;
        }

        stats.totalRequests++;
        stats.lastRequestTime = new Date().toLocaleTimeString();

        await handleApi(url, method, req, res, config, env);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (err) {
      logger.error("server", "Unhandled request error", err);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  // WebSocket
  wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit("connection", ws, req);
    });
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error("server", `Port ${config.port} is already in use. Stop the other process first.`);
      process.exit(1);
    } else {
      throw err;
    }
  });

  httpServer.listen(config.port, () => {
    logger.info("server", `MinGate listening on port ${config.port}`);
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    wss?.close();
    if (httpServer) {
      httpServer.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// ── UI serving ────────────────────────────────────────────────────────────

function serveUi(res: http.ServerResponse): void {
  try {
    const html = fs.readFileSync(UI_PATH, "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(503);
    res.end("UI not found");
  }
}

// ── API routing ───────────────────────────────────────────────────────────

async function handleApi(
  url: string,
  method: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: Config,
  env: Env
): Promise<void> {
  const respond = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const readBodyJson = async (): Promise<unknown> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  };

  // GET /api/health
  if (url === "/api/health" && method === "GET") {
    const health = [
      config.telegram ? getTelegramHealth() : null,
      config.feishu ? getFeishuHealth() : null,
    ].filter(Boolean);
    respond(200, health);
    return;
  }

  // GET /api/config
  if (url === "/api/config" && method === "GET") {
    const redacted = {
      port: config.port,
      dataDir: config.dataDir,
      model: { provider: config.model.provider, model: config.model.model },
      memory: config.memory,
      cron: { jobs: config.cron.jobs.map(j => ({ ...j })) },
      telegram: config.telegram ? { allowFrom: config.telegram.allowFrom } : undefined,
      feishu: config.feishu ? { appId: config.feishu.appId, allowFrom: config.feishu.allowFrom } : undefined,
    };
    respond(200, redacted);
    return;
  }

  // GET /api/sessions
  if (url === "/api/sessions" && method === "GET") {
    const keys = await listSessionKeys(config.dataDir);
    const sessions = await Promise.all(keys.map(async (k) => {
      try {
        const metaPath = path.join(config.dataDir, "sessions", k, "metadata.json");
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        return { key: k, ...meta };
      } catch {
        return { key: k };
      }
    }));
    respond(200, sessions);
    return;
  }

  // GET /api/sessions/:key/transcript
  const transcriptMatch = url.match(/^\/api\/sessions\/([^/?]+)\/transcript(\?|$)/);
  if (transcriptMatch && method === "GET") {
    const keyStr = decodeURIComponent(transcriptMatch[1]!);
    const parts = keyStr.split("__");
    if (parts.length < 2) { respond(400, { error: "Invalid session key" }); return; }
    const sessionKey: SessionKey = {
      channel: parts[0] as "telegram" | "feishu",
      peerId: parts[1]!,
      chatId: parts[1]!,
    };
    const parsed = new URLSearchParams(url.split("?")[1] ?? "");
    const limit = parseInt(parsed.get("limit") ?? "50", 10);
    const offset = parseInt(parsed.get("offset") ?? "0", 10);
    const entries = await readTranscript(config.dataDir, sessionKey, limit, offset);
    respond(200, entries);
    return;
  }

  // GET /api/memory/short — list short_term files
  if (url === "/api/memory/short" && method === "GET") {
    const dir = shortTermDir(config.dataDir);
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort().reverse();
      respond(200, files.map(f => f.replace(".md", "")));
    } catch {
      respond(200, []);
    }
    return;
  }

  // GET /api/memory/short/:date
  const shortMemMatch = url.match(/^\/api\/memory\/short\/(\d{4}-\d{2}-\d{2})$/);
  if (shortMemMatch && method === "GET") {
    const date = shortMemMatch[1]!;
    const filePath = shortTermFilePath(config.dataDir, date);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      respond(200, { date, content });
    } catch {
      respond(404, { error: "Not found" });
    }
    return;
  }

  // GET /api/memory/long/:type (type = facts, preferences, projects/:name)
  const longMemMatch = url.match(/^\/api\/memory\/long\/(.+)$/);
  if (longMemMatch && method === "GET") {
    const typePath = longMemMatch[1]!;
    const filePath = path.join(longTermDir(config.dataDir), typePath.endsWith(".md") ? typePath : typePath + ".md");
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      respond(200, { content });
    } catch {
      respond(200, { content: "" });
    }
    return;
  }

  // PUT /api/memory/long/:type — write (full replace)
  if (longMemMatch && method === "PUT") {
    const typePath = longMemMatch[1]!;
    const filePath = path.join(longTermDir(config.dataDir), typePath.endsWith(".md") ? typePath : typePath + ".md");
    const body = await readBodyJson() as { content: string };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body.content, "utf-8");
    respond(200, { ok: true });
    return;
  }

  // GET /api/cron
  if (url === "/api/cron" && method === "GET") {
    respond(200, listJobs());
    return;
  }

  // POST /api/cron/:id/run
  const cronRunMatch = url.match(/^\/api\/cron\/([^/]+)\/run$/);
  if (cronRunMatch && method === "POST") {
    const jobId = decodeURIComponent(cronRunMatch[1]!);
    try {
      await runJobNow(jobId, config, env);
      respond(200, { ok: true });
    } catch (err) {
      respond(400, { error: String(err) });
    }
    return;
  }

  // PATCH /api/cron/:id — enable/disable
  const cronPatchMatch = url.match(/^\/api\/cron\/([^/]+)$/);
  if (cronPatchMatch && method === "PATCH") {
    const jobId = decodeURIComponent(cronPatchMatch[1]!);
    const body = await readBodyJson() as { enabled: boolean };
    try {
      setJobEnabled(jobId, body.enabled);
      respond(200, { ok: true });
    } catch (err) {
      respond(400, { error: String(err) });
    }
    return;
  }

  // POST /api/memory/consolidate/:key
  const consolidateMatch = url.match(/^\/api\/memory\/consolidate\/([^/]+)$/);
  if (consolidateMatch && method === "POST") {
    const keyStr = decodeURIComponent(consolidateMatch[1]!);
    const parts = keyStr.split("__");
    if (parts.length < 2) { respond(400, { error: "Invalid session key" }); return; }
    const sessionKey: SessionKey = {
      channel: parts[0] as "telegram" | "feishu",
      peerId: parts[1]!,
      chatId: parts[1]!,
    };
    consolidateSession(sessionKey, config, env).catch(err =>
      logger.error("server", "Manual consolidation failed", err)
    );
    respond(202, { ok: true, message: "Consolidation started" });
    return;
  }

  // POST /api/chat — web UI test chat
  if (url === "/api/chat" && method === "POST") {
    const body = await readBodyJson() as { text: string; sessionId?: string };
    if (!body.text?.trim()) { respond(400, { error: "text is required" }); return; }
    const sessionId = (body.sessionId || "webui").replace(/[^a-zA-Z0-9_-]/g, "_");
    const sessionKey: SessionKey = { channel: "telegram", peerId: sessionId, chatId: sessionId };
    let reply = "";
    let replyUsage: any = null;
    let lastRequest: any = null;
    let lastResponse: any = null;

    await runAgent({
      sessionKey,
      inboundMessage: {
        channel: "telegram",
        peerId: sessionId,
        chatId: sessionId,
        isDm: true,
        mentionedBot: false,
        rawMessageId: "",
        text: body.text,
      },
      config,
      env,
      dataDir: config.dataDir,
      sendMessage: async (msg) => { reply = msg.text; replyUsage = msg.usage; },
      onUsage: (usage) => { replyUsage = usage; },
      onInteraction: (req, res) => { lastRequest = req; lastResponse = res; },
    });
    if (reply.startsWith("__error_json__")) {
      try {
        const errorInfo = JSON.parse(reply.slice("__error_json__".length)) as { request: unknown; response: unknown };
        respond(200, { error: true, request: errorInfo.request, response: errorInfo.response, sessionId });
      } catch {
        respond(200, { error: true, reply: reply.slice("__error_json__".length), sessionId });
      }
    } else if (reply.startsWith("__error__")) {
      respond(200, { error: true, reply: reply.slice("__error__".length), sessionId });
    } else {
      respond(200, { reply, usage: replyUsage, request: lastRequest, response: lastResponse, sessionId });
    }
    return;
  }

  respond(404, { error: "Not found" });
}
