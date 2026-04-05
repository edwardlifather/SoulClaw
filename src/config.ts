import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Config, Env, ModelProvider } from "./types.js";

// ── Path resolution ───────────────────────────────────────────────────────

function resolveDataDir(): string {
  // Priority: SOULCLAW_DATA_DIR env var > ~/.soulclaw
  const fromEnv = process.env["SOULCLAW_DATA_DIR"];
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".soulclaw");
}

export function getConfigPath(dataDir: string): string {
  return path.join(dataDir, "config.json");
}

export function getSoulPath(dataDir: string): string {
  return path.join(dataDir, "soul.md");
}

// ── Config loading ────────────────────────────────────────────────────────

export function loadConfig(): { config: Config; env: Env } {
  const dataDir = resolveDataDir();

  // Ensure data directory exists
  fs.mkdirSync(dataDir, { recursive: true });

  const configPath = getConfigPath(dataDir);
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath}\n` +
      `Create it based on the example in the repository.`
    );
  }

  const raw: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const config = validateConfig(raw, dataDir);
  const env = loadEnv();
  validateEnv(env, config);

  return { config, env };
}

// ── Validation ────────────────────────────────────────────────────────────

function validateConfig(raw: unknown, dataDir: string): Config {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("config.json must be a JSON object");
  }
  const r = raw as Record<string, unknown>;

  const port = typeof r["port"] === "number" ? r["port"] : 3000;

  // model (required)
  const modelRaw = r["model"];
  if (typeof modelRaw !== "object" || modelRaw === null) {
    throw new Error('config.json: "model" section is required');
  }
  const m = modelRaw as Record<string, unknown>;
  const provider = m["provider"];
  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error('config.json: model.provider must be "anthropic" or "openai"');
  }
  if (typeof m["model"] !== "string" || !m["model"]) {
    throw new Error('config.json: model.model (model name string) is required');
  }
  const model = {
    provider: provider as ModelProvider,
    model: m["model"] as string,
    maxTokens: typeof m["maxTokens"] === "number" ? m["maxTokens"] : 4096,
    thinking: m["thinking"] === true,
    temperature: typeof m["temperature"] === "number" ? m["temperature"] : undefined,
    baseUrl: typeof m["baseUrl"] === "string" ? m["baseUrl"] : undefined,
  };

  // memory (optional, defaults applied)
  const memRaw = r["memory"];
  const mem = typeof memRaw === "object" && memRaw !== null
    ? memRaw as Record<string, unknown> : {};
  const memory = {
    enabled: mem["enabled"] !== false,
    shortTermDays: typeof mem["shortTermDays"] === "number" ? mem["shortTermDays"] : 14,
    consolidateIdleMinutes: typeof mem["consolidateIdleMinutes"] === "number"
      ? mem["consolidateIdleMinutes"] : 30,
  };

  // cron (optional)
  const cronRaw = r["cron"];
  const cronObj = typeof cronRaw === "object" && cronRaw !== null
    ? cronRaw as Record<string, unknown> : {};
  const jobs = Array.isArray(cronObj["jobs"]) ? cronObj["jobs"] : [];
  const validatedJobs = jobs.map((j: unknown, i: number) => {
    if (typeof j !== "object" || j === null) throw new Error(`cron.jobs[${i}] must be an object`);
    const job = j as Record<string, unknown>;
    if (typeof job["id"] !== "string") throw new Error(`cron.jobs[${i}].id is required`);
    if (typeof job["schedule"] !== "string") throw new Error(`cron.jobs[${i}].schedule is required`);
    if (typeof job["prompt"] !== "string") throw new Error(`cron.jobs[${i}].prompt is required`);
    const dt = job["deliverTo"];
    if (typeof dt !== "object" || dt === null) throw new Error(`cron.jobs[${i}].deliverTo is required`);
    const deliverTo = dt as Record<string, unknown>;
    if (deliverTo["channel"] !== "telegram" && deliverTo["channel"] !== "feishu") {
      throw new Error(`cron.jobs[${i}].deliverTo.channel must be "telegram" or "feishu"`);
    }
    if (typeof deliverTo["peerId"] !== "string") {
      throw new Error(`cron.jobs[${i}].deliverTo.peerId is required`);
    }
    return {
      id: job["id"] as string,
      schedule: job["schedule"] as string,
      prompt: job["prompt"] as string,
      deliverTo: { channel: deliverTo["channel"] as "telegram" | "feishu", peerId: deliverTo["peerId"] as string },
      enabled: job["enabled"] !== false,
      tz: typeof job["tz"] === "string" ? job["tz"] : undefined,
    };
  });

  // telegram (optional)
  let telegram: Config["telegram"] = undefined;
  if (r["telegram"]) {
    const t = r["telegram"] as Record<string, unknown>;
    if (!Array.isArray(t["allowFrom"])) throw new Error('config.json: telegram.allowFrom must be an array');
    telegram = {
      allowFrom: t["allowFrom"] as string[],
      webhookPath: typeof t["webhookPath"] === "string" ? t["webhookPath"] : "/telegram/webhook",
    };
  }

  // feishu (optional)
  let feishu: Config["feishu"] = undefined;
  if (r["feishu"]) {
    const f = r["feishu"] as Record<string, unknown>;
    if (typeof f["appId"] !== "string") throw new Error('config.json: feishu.appId is required');
    if (!Array.isArray(f["allowFrom"])) throw new Error('config.json: feishu.allowFrom must be an array');
    feishu = {
      appId: f["appId"] as string,
      allowFrom: f["allowFrom"] as string[],
      webhookPath: typeof f["webhookPath"] === "string" ? f["webhookPath"] : "/feishu/events",
    };
  }

  // Both are optional (standalone Web UI mode)

  return {
    port,
    dataDir,
    telegram,
    feishu,
    model,
    memory,
    cron: { jobs: validatedJobs },
    addChannelContext: r["addChannelContext"] !== false,
  };
}

function loadEnv(): Env {
  return {
    minGateToken: process.env["MINGATE_TOKEN"] || undefined,
    telegramBotToken: process.env["TELEGRAM_BOT_TOKEN"] || undefined,
    telegramPublicUrl: process.env["TELEGRAM_PUBLIC_URL"] || undefined,
    feishuAppSecret: process.env["FEISHU_APP_SECRET"] || undefined,
    feishuVerificationToken: process.env["FEISHU_VERIFICATION_TOKEN"] || undefined,
    modelApiKey: process.env["MODEL_API_KEY"] ?? "",
  };
}

function validateEnv(env: Env, config: Config): void {
  if (!env.modelApiKey) {
    throw new Error("MODEL_API_KEY environment variable is required");
  }
  if (config.telegram && !env.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required when telegram is configured");
  }
  if (config.feishu && !env.feishuAppSecret) {
    throw new Error("FEISHU_APP_SECRET is required when feishu is configured");
  }
  if (config.feishu && !env.feishuVerificationToken) {
    throw new Error("FEISHU_VERIFICATION_TOKEN is required when feishu is configured");
  }
}

// ── soul.md loading ───────────────────────────────────────────────────────

export function loadSoul(dataDir: string): string {
  const soulPath = getSoulPath(dataDir);
  if (!fs.existsSync(soulPath)) return "";
  return fs.readFileSync(soulPath, "utf-8").trim();
}

// ── Config serialization (for CLI allow command) ──────────────────────────

export function saveConfig(config: Config): void {
  // Read the raw file, patch only allowFrom fields, preserve everything else
  const configPath = getConfigPath(config.dataDir);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;

  if (config.telegram) {
    const t = (raw["telegram"] ?? {}) as Record<string, unknown>;
    t["allowFrom"] = config.telegram.allowFrom;
    raw["telegram"] = t;
  }
  if (config.feishu) {
    const f = (raw["feishu"] ?? {}) as Record<string, unknown>;
    f["allowFrom"] = config.feishu.allowFrom;
    raw["feishu"] = f;
  }

  fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
}
