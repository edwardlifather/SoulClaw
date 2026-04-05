import { Cron } from "croner";
import { runAgent } from "../agent/runner.js";
import { runWeeklyConsolidation } from "../memory/weekly.js";
import { sendTelegram } from "../channels/telegram.js";
import { sendFeishu } from "../channels/feishu.js";
import { logger } from "../logger.js";
import type { Config, Env, CronJobState, OutboundMessage, WsEvent } from "../types.js";

type WsEventEmitter = (event: WsEvent) => void;

// ── Cron service ──────────────────────────────────────────────────────────

const jobs = new Map<string, { cron: Cron; state: CronJobState }>();
let emit: WsEventEmitter | null = null;

export function initCron(config: Config, env: Env, wsEmit: WsEventEmitter): void {
  emit = wsEmit;

  // User-defined jobs
  for (const jobConfig of config.cron.jobs) {
    registerJob(jobConfig.id, jobConfig.schedule, jobConfig.tz, jobConfig.enabled ?? true, async () => {
      logger.info("cron", `Running job: ${jobConfig.id}`);
      const sessionKey = {
        channel: jobConfig.deliverTo.channel,
        peerId: jobConfig.deliverTo.peerId,
        chatId: jobConfig.deliverTo.peerId,
      };

      const sendFn = jobConfig.deliverTo.channel === "telegram" ? sendTelegram : sendFeishu;

      await runAgent({
        sessionKey,
        inboundMessage: {
          channel: jobConfig.deliverTo.channel,
          peerId: jobConfig.deliverTo.peerId,
          chatId: jobConfig.deliverTo.peerId,
          isDm: true,
          mentionedBot: true,
          rawMessageId: "",
          text: jobConfig.prompt,
        },
        config,
        env,
        dataDir: config.dataDir,
        sendMessage: sendFn,
      });
    }, jobConfig.id);
  }

  // Weekly memory consolidation (every Sunday at 03:00)
  if (config.memory.enabled) {
    registerJob("__weekly_memory__", "0 3 * * 0", undefined, true, async () => {
      await runWeeklyConsolidation(config, env);
    }, "__weekly_memory__");
  }

  logger.info("cron", `Initialized ${jobs.size} cron job(s)`);
}

function registerJob(
  id: string,
  schedule: string,
  tz: string | undefined,
  enabled: boolean,
  fn: () => Promise<void>,
  jobId: string
): void {
  const state: CronJobState = { id: jobId, enabled };

  if (!enabled) {
    jobs.set(jobId, { cron: new Cron(schedule, { paused: true, timezone: tz }), state });
    return;
  }

  const cron = new Cron(schedule, { timezone: tz }, async () => {
    state.lastRunAt = new Date().toISOString();
    try {
      await fn();
      state.lastError = undefined;
      emit?.({ type: "cron_run", jobId, success: true });
    } catch (err) {
      state.lastError = String(err);
      emit?.({ type: "cron_run", jobId, success: false, error: String(err) });
      logger.error("cron", `Job ${jobId} failed`, err);
    }
  });

  jobs.set(jobId, { cron, state });
}

// ── Public API ────────────────────────────────────────────────────────────

export function listJobs(): CronJobState[] {
  return [...jobs.values()].map(j => ({ ...j.state }));
}

export async function runJobNow(jobId: string, config: Config, env: Env): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const jobConfig = config.cron.jobs.find(j => j.id === jobId);
  if (!jobConfig) throw new Error(`Job config not found: ${jobId}`);

  job.state.lastRunAt = new Date().toISOString();
  try {
    const sessionKey = {
      channel: jobConfig.deliverTo.channel,
      peerId: jobConfig.deliverTo.peerId,
      chatId: jobConfig.deliverTo.peerId,
    };
    const sendFn = jobConfig.deliverTo.channel === "telegram" ? sendTelegram : sendFeishu;

    await runAgent({
      sessionKey,
      inboundMessage: {
        channel: jobConfig.deliverTo.channel,
        peerId: jobConfig.deliverTo.peerId,
        chatId: jobConfig.deliverTo.peerId,
        isDm: true,
        mentionedBot: true,
        rawMessageId: "",
        text: jobConfig.prompt,
      },
      config,
      env,
      dataDir: config.dataDir,
      sendMessage: sendFn,
    });
    job.state.lastError = undefined;
  } catch (err) {
    job.state.lastError = String(err);
    throw err;
  }
}

export function setJobEnabled(jobId: string, enabled: boolean): void {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  job.state.enabled = enabled;
  if (enabled) {
    job.cron.resume();
  } else {
    job.cron.pause();
  }
}

export function stopCron(): void {
  for (const { cron } of jobs.values()) {
    cron.stop();
  }
  jobs.clear();
}
