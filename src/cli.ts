/**
 * SoulClaw CLI — minimal management tool.
 * Usage:
 *   soulclaw allow <code>      — approve a pairing code
 *   soulclaw list              — list sessions
 *   soulclaw jobs              — list cron jobs
 *   soulclaw version           — print version
 */
import path from "node:path";
import dotenv from "dotenv";
import { loadConfig, saveConfig, resolveDataDir } from "./config.js";
import { findPairingRecord, consumePairingRecord } from "./security/pairing.js";
import { listSessionKeys } from "./session/routing.js";
import { readMetadata } from "./session/store.js";

// Load environment dynamically from the data directory just like main.ts
const dataDir = resolveDataDir();
dotenv.config({ path: path.join(dataDir, ".env") });

const [,, command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "allow":
      await cmdAllow(args[0]);
      break;
    case "list":
      await cmdList();
      break;
    case "jobs":
      await cmdJobs();
      break;
    case "version":
      console.log("0.1.0");
      break;
    default:
      console.log(`SoulClaw CLI

Commands:
  allow <code>   Approve a pairing code and add the user to allowFrom
  list           List active sessions
  jobs           List cron jobs
  version        Print version
`);
  }
}

async function cmdAllow(code: string | undefined): Promise<void> {
  if (!code) {
    console.error("Usage: soulclaw allow <code>");
    process.exit(1);
  }

  const { config } = loadConfig();
  const record = await findPairingRecord(config.dataDir, code);

  if (!record) {
    console.error(`Pairing code "${code}" not found or expired.`);
    process.exit(1);
  }

  // Add peerId to allowFrom
  if (record.channel === "telegram" && config.telegram) {
    if (!config.telegram.allowFrom.includes(record.peerId)) {
      config.telegram.allowFrom.push(record.peerId);
      saveConfig(config);
      console.log(`✓ Added ${record.peerId} to telegram allowFrom`);
    } else {
      console.log(`${record.peerId} is already in telegram allowFrom`);
    }
  } else if (record.channel === "feishu" && config.feishu) {
    if (!config.feishu.allowFrom.includes(record.peerId)) {
      config.feishu.allowFrom.push(record.peerId);
      saveConfig(config);
      console.log(`✓ Added ${record.peerId} to feishu allowFrom`);
    } else {
      console.log(`${record.peerId} is already in feishu allowFrom`);
    }
  } else {
    console.error(`Channel "${record.channel}" is not configured.`);
    process.exit(1);
  }

  await consumePairingRecord(config.dataDir, code);
  console.log(`Pairing code consumed. Note: restart SoulClaw for the change to take effect.`);
}

async function cmdList(): Promise<void> {
  const { config } = loadConfig();
  const keys = await listSessionKeys(config.dataDir);

  if (keys.length === 0) {
    console.log("No sessions found.");
    return;
  }

  console.log(`Sessions (${keys.length}):`);
  for (const key of keys) {
    try {
      // Try to decode and show metadata
      const parts = key.split("__");
      const channel = parts[0] ?? "?";
      const chatId = parts[1] ?? "?";

      // Build a minimal session key for metadata lookup
      const sessionKey = { channel: channel as "telegram" | "feishu", peerId: chatId, chatId };
      const meta = await readMetadata(config.dataDir, sessionKey);

      if (meta) {
        console.log(`  ${channel}/${chatId}  msgs=${meta.messageCount}  last=${meta.lastActiveAt.slice(0, 10)}`);
      } else {
        console.log(`  ${key}`);
      }
    } catch {
      console.log(`  ${key}`);
    }
  }
}

async function cmdJobs(): Promise<void> {
  const { config } = loadConfig();

  if (config.cron.jobs.length === 0) {
    console.log("No cron jobs configured.");
    return;
  }

  console.log(`Cron jobs (${config.cron.jobs.length}):`);
  for (const job of config.cron.jobs) {
    const status = (job.enabled ?? true) ? "enabled" : "disabled";
    console.log(`  [${status}] ${job.id}  schedule="${job.schedule}"  to=${job.deliverTo.channel}/${job.deliverTo.peerId}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
