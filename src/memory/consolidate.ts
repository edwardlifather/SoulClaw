import { readRecentTranscript } from "../session/store.js";
import { appendShortTerm } from "./store.js";
import { runSilentAgent } from "../agent/runner.js";
import { logger } from "../logger.js";
import type { SessionKey, Config, Env } from "../types.js";

// ── Idle timer map ────────────────────────────────────────────────────────
// One timer per active session. Reset on every inbound message.

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function sessionKeyStr(key: SessionKey): string {
  return `${key.channel}/${key.chatId}`;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Called after every inbound message is processed.
 * Resets the idle timer for the session.
 */
export function touchSession(key: SessionKey, config: Config, env: Env): void {
  if (!config.memory.enabled) return;

  const keyStr = sessionKeyStr(key);
  const existing = timers.get(keyStr);
  if (existing) clearTimeout(existing);

  const delayMs = config.memory.consolidateIdleMinutes * 60_000;
  const timer = setTimeout(() => {
    timers.delete(keyStr);
    consolidateSession(key, config, env).catch(err => {
      logger.error("consolidate", `Error consolidating session ${keyStr}`, err);
    });
  }, delayMs);

  timers.set(keyStr, timer);
}

/**
 * Cancel all pending consolidation timers (for graceful shutdown).
 */
export function clearAllTimers(): void {
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
}

/**
 * Manually trigger consolidation for a session (e.g. from the Web UI).
 */
export async function consolidateSession(key: SessionKey, config: Config, env: Env): Promise<void> {
  if (!config.memory.enabled) return;

  logger.info("consolidate", `Consolidating session ${sessionKeyStr(key)}`);

  // Fetch the last 50 transcript entries
  const entries = await readRecentTranscript(config.dataDir, key, 50);
  if (entries.length === 0) {
    logger.info("consolidate", "No entries to consolidate");
    return;
  }

  // Build a text representation of the conversation
  const convoText = entries
    .filter(e => e.role === "user" || e.role === "assistant")
    .map(e => {
      const who = e.role === "user" ? (e.senderName ?? "用户") : "AI";
      const text = e.text ?? "[工具调用]";
      return `${who}: ${text}`;
    })
    .join("\n");

  const prompt =
    `请将以下对话总结为简洁的日记条目（3-5句话），用第三人称描述用户的行为和AI的帮助内容。\n\n` +
    `关于记忆管理：\n` +
    `1. 如果对话中出现了关于用户的【新事实】（姓名、职业、年龄、地点等）或【偏好】：\n` +
    `   - 请先使用 memory_search 查找是否有旧的、矛盾的记忆。\n` +
    `   - 如果发现旧信息（如：以前是50岁，现在说是20岁），请使用 memory_delete 删掉旧条目。\n` +
    `   - 然后使用 memory_save 保存最新的信息。\n` +
    `2. 最后输出总结文本（即使调用了工具，也必须输出总结）。\n\n` +
    `对话内容：\n${convoText}`;

  try {
    // Single model call: silent agent will call memory_save for facts/preferences,
    // and its final text reply is the summary we store in short_term.
    const summaryText = await runSilentAgent({
      prompt,
      sessionKey: key,
      config,
      env,
      dataDir: config.dataDir,
    });

    if (summaryText) {
      await appendShortTerm(config.dataDir, summaryText, key.channel, key.peerId);
      logger.info("consolidate", `Short-term memory updated for ${sessionKeyStr(key)}`);
    }
  } catch (err) {
    logger.error("consolidate", "Consolidation failed", err);
  }
}
