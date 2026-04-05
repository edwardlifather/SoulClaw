import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import { Bot, webhookCallback } from "grammy";
import { isAllowed } from "../security/allowlist.js";
import { createPairingCode, hasPendingCode } from "../security/pairing.js";
import { runAgent } from "../agent/runner.js";
import { touchSession } from "../memory/consolidate.js";
import { logger } from "../logger.js";
import type { Config, Env, InboundMessage, OutboundMessage, ChannelHealth } from "../types.js";

let bot: Bot | null = null;
let pollingRunner: any = null;
const health: ChannelHealth = { channel: "telegram", connected: false };

/**
 * Generate a valid Telegram secret_token from the bot token.
 * secret_token must be 1-256 characters, only A-Z, a-z, 0-9, _ and -.
 */
function getWebhookSecretToken(botToken: string): string {
  return createHash("sha256").update(botToken).digest("hex");
}

// ── Init ──────────────────────────────────────────────────────────────────

export async function initTelegram(config: Config, env: Env): Promise<void> {
  if (!config.telegram || !env.telegramBotToken) return;

  const agent = new https.Agent({ rejectUnauthorized: false });
  bot = new Bot(env.telegramBotToken, {
    client: { baseFetchConfig: { agent } },
  });

  // Attach error handler
  bot.catch((err) => {
    logger.error("telegram", `Bot error (polling/webhook):`, err.error);
    health.lastError = String(err.error);
    health.lastErrorAt = new Date().toISOString();
  });

  bot.on("message", async (ctx) => {
    try {
      await handleUpdate(ctx.message, config, env);
    } catch (err) {
      logger.error("telegram", "Error handling message", err);
    }
  });

  const webhookPath = config.telegram.webhookPath ?? "/telegram/webhook";
  
  // Choose mode: Webhook if URL is present, otherwise Polling
  const publicUrl = env.telegramPublicUrl;

  if (publicUrl) {
    const webhookUrl = publicUrl.replace(/\/$/, "") + webhookPath;
    try {
      await bot.api.setWebhook(webhookUrl, {
        secret_token: getWebhookSecretToken(env.telegramBotToken),
        drop_pending_updates: true,
      });
      health.connected = true;
      logger.info("telegram", `Telegram Webhook registered at ${webhookUrl}`);
    } catch (err) {
      health.connected = false;
      health.lastError = String(err);
      health.lastErrorAt = new Date().toISOString();
      logger.error("telegram", "Failed to register Telegram webhook", err);
    }
  } else {
    // Polling mode (Non-blocking background task)
    // We don't await this so main.ts can continue to start the server
    pollingRunner = bot.start({
      drop_pending_updates: true,
      onStart: (botInfo) => {
        logger.info("telegram", `Telegram Bot started in POLLING mode (no public URL). Bot name: @${botInfo.username}`);
      },
    }).catch(err => {
      logger.error("telegram", "Polling stopped with error", err);
      health.connected = false;
    });
    health.connected = true;
  }
}

// ── Webhook HTTP handler (called by gateway/server.ts) ───────────────────

export function getTelegramWebhookHandler(
  config: Config,
  env: Env
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  if (!bot) {
    return async (_req, res) => {
      res.writeHead(503);
      res.end("Telegram not configured");
    };
  }

  // If bot is already polling, webhook callbacks will fail. 
  // Return a dummy handler to allow the HTTP server to start.
  if (pollingRunner) {
    return async (_req, res) => {
      res.writeHead(503);
      res.end("Telegram is running in Polling mode — Webhook is disabled.");
    };
  }

  const secret = getWebhookSecretToken(env.telegramBotToken!);
  const cb = webhookCallback(bot, "http");

  return async (req: IncomingMessage, res: ServerResponse) => {
    // Verify secret token header
    const headerSecret = (req.headers as Record<string, string>)["x-telegram-bot-api-secret-token"];
    if (!headerSecret || !timingSafeEqualStrings(headerSecret, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
    await cb(req, res);
  };
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLen);
  const bufB = Buffer.alloc(maxLen);
  bufA.write(a);
  bufB.write(b);
  return timingSafeEqual(bufA, bufB);
}

// ── Message handler ───────────────────────────────────────────────────────

async function handleUpdate(
  message: import("grammy/types").Message,
  config: Config,
  env: Env
): Promise<void> {
  if (!config.telegram) return;

  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  const chatId = String(message.chat.id);
  // Use username if available, otherwise numeric ID
  const peerId = message.from?.username
    ? `@${message.from.username}`
    : String(message.from?.id ?? chatId);

  const text: string = message.text ?? message.caption ?? "";
  logger.info("telegram", `Received message from ${peerId}: ${text.slice(0, 50)}${text.length > 50 ? "..." : ""}`);

  // Mention detection
  const botUsername = (await bot!.api.getMe()).username ?? "";
  const mentionedBot = isGroup
    ? text.includes(`@${botUsername}`) || (message.reply_to_message?.from?.is_bot ?? false)
    : true;

  // In groups, only respond to mentions
  if (isGroup && !mentionedBot) return;

  // Allowlist check
  const allowed = isAllowed(peerId, config.telegram.allowFrom);
  if (!allowed) {
    // DM-only pairing flow
    if (!isGroup) {
      const alreadyPending = await hasPendingCode(config.dataDir, "telegram", peerId);
      if (!alreadyPending) {
        const code = await createPairingCode(config.dataDir, "telegram", peerId);
        await bot!.api.sendMessage(
          message.chat.id,
          `你好！请将验证码 **${code}** 发送给管理员，由其通过 CLI 命令 \`mingate allow ${code}\` 将你加入白名单。验证码 1 小时内有效。`,
          { parse_mode: "Markdown" }
        );
      }
    }
    return;
  }

  // Build inbound message
  const images: InboundMessage["images"] = [];
  if (message.photo) {
    const largest = message.photo[message.photo.length - 1];
    if (largest) {
      try {
        const fileInfo = await bot!.api.getFile(largest.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${env.telegramBotToken}/${fileInfo.file_path}`;
        const resp = await fetch(fileUrl);
        const arrayBuf = await resp.arrayBuffer();
        const base64 = Buffer.from(arrayBuf).toString("base64");
        images.push({ mediaType: "image/jpeg", base64 });
      } catch (err) {
        logger.warn("telegram", "Failed to download photo", err);
      }
    }
  }

  const inbound: InboundMessage = {
    channel: "telegram",
    peerId,
    chatId,
    isDm: !isGroup,
    text: text || undefined,
    images: images.length > 0 ? images : undefined,
    mentionedBot,
    senderName: message.from?.first_name,
    rawMessageId: String(message.message_id),
  };

  const sessionKey = { channel: "telegram" as const, peerId, chatId };

  // Touch idle timer for memory consolidation
  touchSession(sessionKey, config, env);

  await runAgent({
    sessionKey,
    inboundMessage: inbound,
    config,
    env,
    dataDir: config.dataDir,
    sendMessage: sendTelegram,
    updateMessage: updateTelegram,
  });
}

// ── Send ──────────────────────────────────────────────────────────────────

export async function sendTelegram(msg: OutboundMessage): Promise<string | void> {
  if (!bot) throw new Error("Telegram bot not initialized");

  const MAX_LENGTH = 4096;
  const text = msg.text;
  // If it looks like a number, use Number() to avoid potential issues with some versions of the API,
  // otherwise use the string (e.g. for usernames starting with @).
  const targetChatId = /^-?\d+$/.test(msg.chatId) ? Number(msg.chatId) : msg.chatId;

  // Telegram has a 4096 char limit; split if needed
  if (text.length <= MAX_LENGTH) {
    const res = await bot.api.sendMessage(targetChatId, text, {
      reply_parameters: msg.replyToMessageId
        ? { message_id: Number(msg.replyToMessageId) }
        : undefined,
    });
    return String(res.message_id);
  }

  // Split into chunks (only return ID for the first chunk for updates)
  let firstId: string | undefined;
  for (let i = 0; i < text.length; i += MAX_LENGTH) {
    const res = await bot.api.sendMessage(targetChatId, text.slice(i, i + MAX_LENGTH));
    if (!firstId) firstId = String(res.message_id);
  }
  return firstId;
}

export async function updateTelegram(messageId: string, msg: OutboundMessage): Promise<void> {
  if (!bot) throw new Error("Telegram bot not initialized");
  const targetChatId = /^-?\d+$/.test(msg.chatId) ? Number(msg.chatId) : msg.chatId;
  try {
    await bot.api.editMessageText(targetChatId, Number(messageId), msg.text);
  } catch (err) {
    // If text is same, just ignore
    const msg = String(err);
    if (!msg.includes("message is not modified")) throw err;
  }
}

export async function stopTelegram(): Promise<void> {
  if (!bot) return;
  try {
    await bot.api.deleteWebhook();
  } catch {
    // Ignore errors during shutdown
  }
  bot.stop();
  health.connected = false;
}

export function getTelegramHealth(): ChannelHealth {
  return { ...health };
}
