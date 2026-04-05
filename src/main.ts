import "dotenv/config";
import { loadConfig } from "./config.js";
import { initLogger, logger } from "./logger.js";
import { initTelegram, stopTelegram } from "./channels/telegram.js";
import { initFeishu, stopFeishu } from "./channels/feishu.js";
import { initCron, stopCron } from "./cron/service.js";
import { startServer, stopServer, emitWsEvent } from "./gateway/server.js";
import { clearAllTimers } from "./memory/consolidate.js";

async function main(): Promise<void> {
  // Load config and env
  const { config, env } = loadConfig();

  // Init logger
  initLogger(config.dataDir);
  logger.info("main", "MinGate starting up", { port: config.port, dataDir: config.dataDir });

  // Init channels
  await initTelegram(config, env);
  await initFeishu(config, env);

  // Init cron
  initCron(config, env, emitWsEvent);

  // Start HTTP/WS server
  startServer(config, env);

  logger.info("main", "MinGate ready");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info("main", `Received ${signal}, shutting down...`);
    clearAllTimers();
    stopCron();
    await stopTelegram();
    stopFeishu();
    await stopServer();
    logger.info("main", "Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => { shutdown("SIGTERM").catch(console.error); });
  process.on("SIGINT",  () => { shutdown("SIGINT").catch(console.error); });
}

main().catch(err => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
