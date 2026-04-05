import { readRecentShortTerm, pruneShortTerm } from "./store.js";
import { logger } from "../logger.js";
import type { Config, Env, SessionKey } from "../types.js";
import { runSilentAgent } from "../agent/runner.js";

/**
 * Weekly memory consolidation: reads the last 7 days of short_term summaries
 * and asks the model to promote recurring/important items to long_term.
 *
 * Called by cron/service.ts on a weekly schedule.
 */
export async function runWeeklyConsolidation(config: Config, env: Env): Promise<void> {
  if (!config.memory.enabled) return;

  logger.info("weekly", "Running weekly memory consolidation");

  // Read last 7 days of short-term summaries
  const shortTermContent = await readRecentShortTerm(config.dataDir, 7);
  if (!shortTermContent.trim()) {
    logger.info("weekly", "No short-term memories to consolidate");
    return;
  }

  const prompt =
    `请审阅以下一周的对话摘要，找出反复出现的、重要的信息（如用户的固定偏好、重要事实、持续进行的项目），` +
    `使用 memory_save 工具将这些信息提升到长期记忆中。` +
    `只保存确实重要且多次体现的内容，不要保存一次性的琐事。\n\n` +
    `本周对话摘要：\n${shortTermContent}`;

  // Use a synthetic session key for the weekly consolidation run
  const weeklyKey: SessionKey = {
    channel: config.telegram ? "telegram" : "feishu",
    peerId: "__weekly__",
    chatId: "__weekly__",
  };

  try {
    await runSilentAgent({
      prompt,
      sessionKey: weeklyKey,
      config,
      env,
      dataDir: config.dataDir,
    });
    logger.info("weekly", "Weekly consolidation complete");
  } catch (err) {
    logger.error("weekly", "Weekly consolidation failed", err);
  }

  // Prune old short-term files
  await pruneShortTerm(config.dataDir, config.memory.shortTermDays);
  logger.info("weekly", `Pruned short-term files older than ${config.memory.shortTermDays} days`);
}
