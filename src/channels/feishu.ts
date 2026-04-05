import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as lark from "@larksuiteoapi/node-sdk";
import { isAllowed } from "../security/allowlist.js";
import { createPairingCode, hasPendingCode } from "../security/pairing.js";
import { runAgent } from "../agent/runner.js";
import { touchSession } from "../memory/consolidate.js";
import { logger } from "../logger.js";
import type { Config, Env, InboundMessage, OutboundMessage, ChannelHealth } from "../types.js";

let larkClient: lark.Client | null = null;
const health: ChannelHealth = { channel: "feishu", connected: false };

// ── Init ──────────────────────────────────────────────────────────────────

export async function initFeishu(config: Config, env: Env): Promise<void> {
  if (!config.feishu || !env.feishuAppSecret) return;

  larkClient = new lark.Client({
    appId: config.feishu.appId,
    appSecret: env.feishuAppSecret,
    loggerLevel: lark.LoggerLevel.warn,
  });

  health.connected = true;
  logger.info("feishu", `Feishu client initialized for appId=${config.feishu.appId}`);
}

// ── Webhook HTTP handler (called by gateway/server.ts) ───────────────────

export function getFeishuWebhookHandler(
  config: Config,
  env: Env
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse) => {
    logger.info("feishu", `Received inbound webhook request to ${req.url}`);
    
    if (!config.feishu || !env.feishuVerificationToken) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feishu not configured or token missing" }));
      return;
    }

    // Read raw body first (needed for HMAC verification later if not a challenge)
    const rawBody = await readBody(req);
    let payload: Record<string, unknown> = {};

    try {
      if (rawBody.length > 0) {
        payload = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
      }
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON payload" }));
      return;
    }

    const challenge = payload["challenge"] || (payload["event"] as Record<string, unknown> | undefined)?.["challenge"];
    const headerToken = (payload["header"] as Record<string, unknown> | undefined)?.["token"] as string | undefined;
    const embeddedToken = (payload["token"] as string | undefined) || headerToken;

    // 1. Verify token
    if (!env.feishuVerificationToken || embeddedToken !== env.feishuVerificationToken) {
      logger.error("feishu", "Received event payload but embedded token does not match our Verification Token");
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Token mismatch" }));
      return;
    }

    // 2. URL verification challenge
    if (challenge) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ challenge }));
      return;
    }



    // Dispatch event
    res.writeHead(200);
    res.end("ok");

    // Handle asynchronously after responding (Feishu requires fast acknowledgement)
    setImmediate(() => {
      handleFeishuEvent(payload, config, env).catch(err => {
        logger.error("feishu", "Error handling event", err);
        health.lastError = String(err);
        health.lastErrorAt = new Date().toISOString();
      });
    });
  };
}

// ── Signature verification ────────────────────────────────────────────────

function verifyFeishuSignature(
  timestamp: string,
  nonce: string,
  verificationToken: string,
  body: Buffer,
  signature: string
): boolean {
  // Feishu signature: hex(sha256(timestamp + nonce + token + body))
  const content = timestamp + nonce + verificationToken + body.toString("utf-8");
  const expected = createHash("sha256")
    .update(content)
    .digest("hex");

  // Timing-safe comparison
  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

// ── Event handler ─────────────────────────────────────────────────────────

async function handleFeishuEvent(
  payload: Record<string, unknown>,
  config: Config,
  env: Env
): Promise<void> {
  if (!config.feishu) return;

  // Schema: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive
  const schema = payload["schema"] as string | undefined;
  const header = payload["header"] as Record<string, unknown> | undefined;
  const eventType = header?.["event_type"] as string | undefined;

  if (eventType !== "im.message.receive_v1") return;

  const event = payload["event"] as Record<string, unknown> | undefined;
  if (!event) return;

  const message = event["message"] as Record<string, unknown> | undefined;
  const sender = event["sender"] as Record<string, unknown> | undefined;
  if (!message || !sender) return;

  const openId = (sender["sender_id"] as Record<string, unknown>)?.["open_id"] as string | undefined;
  if (!openId) return;

  const chatId = (message["chat_id"] as string | undefined) ?? openId;
  const chatType = (message["chat_type"] as string | undefined) ?? "p2p";
  const isDm = chatType === "p2p";
  const msgType = (message["message_type"] as string | undefined) ?? "";

  // Extract text
  let text: string | undefined;
  let mentionedBot = isDm;
  const images: InboundMessage["images"] = [];

  try {
    const contentStr = (message["content"] as string | undefined) ?? "{}";
    const content = JSON.parse(contentStr) as Record<string, unknown>;

    if (msgType === "text") {
      text = (content["text"] as string ?? "").trim();
      // Check for @mentions in group messages
      if (!isDm) {
        const mentions = message["mentions"] as Array<Record<string, unknown>> | undefined;
        if (mentions) {
          for (const m of mentions) {
            if ((m["id"] as Record<string, unknown>)?.["app_id"] === config.feishu.appId) {
              mentionedBot = true;
              break;
            }
          }
        }
        // Remove @mention text from message
        if (text) text = text.replace(/@\S+\s*/g, "").trim();
      }
    } else if (msgType === "image") {
      // Download image from Feishu
      if (larkClient && content["image_key"]) {
        try {
          const imageKey = content["image_key"] as string;
          const msgId = message["message_id"] as string;
          const resp = await larkClient.im.messageResource.get({
            path: { message_id: msgId, file_key: imageKey },
            params: { type: "image" },
          });
          // The SDK returns an object with getReadableStream()
          if (resp) {
            const chunks: Buffer[] = [];
            const stream = (resp as unknown as { getReadableStream: () => import("stream").Readable }).getReadableStream();
            for await (const chunk of stream) {
              chunks.push(chunk as Buffer);
            }
            const base64 = Buffer.concat(chunks).toString("base64");
            images.push({ mediaType: "image/jpeg", base64 });
          }
        } catch (err) {
          logger.warn("feishu", "Failed to download image", err);
        }
      }
    }
  } catch (err) {
    logger.warn("feishu", "Failed to parse message content", err);
  }

  // In groups, only respond to @mentions
  if (!isDm && !mentionedBot) return;

  // Allowlist check
  if (!isAllowed(openId, config.feishu.allowFrom)) {
    if (isDm) {
      const alreadyPending = await hasPendingCode(config.dataDir, "feishu", openId);
      if (!alreadyPending) {
        const code = await createPairingCode(config.dataDir, "feishu", openId);
        await sendFeishu({
          channel: "feishu",
          peerId: openId,
          chatId,
          text: `你好！请将验证码 **${code}** 发送给管理员，由其通过 CLI 命令 \`soulclaw allow ${code}\` 将你加入白名单。验证码 1 小时内有效。`,
        });
      }
    }
    return;
  }

  const msgId = (message["message_id"] as string | undefined) ?? "";
  const inbound: InboundMessage = {
    channel: "feishu",
    peerId: openId,
    chatId,
    isDm,
    text: text || undefined,
    images: images.length > 0 ? images : undefined,
    mentionedBot,
    rawMessageId: msgId,
  };

  const sessionKey = { channel: "feishu" as const, peerId: openId, chatId };
  touchSession(sessionKey, config, env);

  await runAgent({
    sessionKey,
    inboundMessage: inbound,
    config,
    env,
    dataDir: config.dataDir,
    sendMessage: sendFeishu,
  });
}

// ── Send ──────────────────────────────────────────────────────────────────

export async function sendFeishu(msg: OutboundMessage): Promise<void> {
  if (!larkClient) throw new Error("Feishu client not initialized");

  const MAX_LENGTH = 4000; // Feishu text limit is ~4000 chars
  const chunks = splitText(msg.text, MAX_LENGTH);

  for (const chunk of chunks) {
    await larkClient.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: msg.chatId,
        msg_type: "text",
        content: JSON.stringify({ text: chunk }),
      },
    });
  }
}

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks.length > 0 ? chunks : [""];
}

// ── Utilities ─────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function stopFeishu(): void {
  larkClient = null;
  health.connected = false;
}

export function getFeishuHealth(): ChannelHealth {
  return { ...health };
}
