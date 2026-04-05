// ── Config ────────────────────────────────────────────────────────────────

export type ModelProvider = "anthropic" | "openai";

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  maxTokens?: number;        // default 4096
  thinking?: boolean;        // Anthropic extended thinking (claude-3-7+ only)
  temperature?: number;      // ignored when thinking=true (forced to 1.0)
  baseUrl?: string;          // override API base URL (e.g. Google Gemini OpenAI-compat endpoint)
}

export interface MemoryConfig {
  enabled: boolean;
  shortTermDays: number;              // days to keep short_term files, default 14
  consolidateIdleMinutes: number;     // inactivity before consolidation, default 30
}

export interface CronJobConfig {
  id: string;
  schedule: string;                   // cron expression, e.g. "0 8 * * 1-5"
  prompt: string;
  deliverTo: {
    channel: ChannelId;
    peerId: string;
  };
  enabled?: boolean;                  // default true
  tz?: string;                        // timezone, e.g. "Asia/Shanghai"
}

export interface TelegramChannelConfig {
  allowFrom: string[];                // phone numbers or numeric user IDs as strings
  webhookPath?: string;               // default "/telegram/webhook"
}

export interface FeishuChannelConfig {
  appId: string;                      // public, safe in config.json
  allowFrom: string[];                // open_ids
  webhookPath?: string;               // default "/feishu/events"
}

export interface Config {
  port: number;                       // default 3000
  dataDir: string;                    // resolved absolute path to data directory
  telegram?: TelegramChannelConfig;
  feishu?: FeishuChannelConfig;
  model: ModelConfig;
  memory: MemoryConfig;
  cron: { jobs: CronJobConfig[] };
  addChannelContext: boolean;         // inject one-line channel context, default true
}

// Secrets live in Env, not Config — loaded from .env
export interface Env {
  minGateToken?: string;              // web UI / CLI auth token
  telegramBotToken?: string;
  telegramPublicUrl?: string;
  feishuAppSecret?: string;
  feishuVerificationToken?: string;
  modelApiKey: string;
}

// ── Channels ──────────────────────────────────────────────────────────────

export type ChannelId = "telegram" | "feishu";

export interface InboundMessage {
  channel: ChannelId;
  peerId: string;                     // user ID (phone for TG, open_id for Feishu)
  chatId: string;                     // group chat ID, or same as peerId for DMs
  isDm: boolean;
  text?: string;
  images?: Array<{ mediaType: string; base64: string }>;
  mentionedBot: boolean;
  senderName?: string;
  rawMessageId: string;               // channel-native ID, used for reply threading
}

export interface OutboundMessage {
  channel: ChannelId;
  peerId: string;
  chatId: string;
  text: string;
  replyToMessageId?: string;
  usage?: ModelUsage;
}

// ── Session / Transcript ──────────────────────────────────────────────────

export interface SessionKey {
  channel: ChannelId;
  peerId: string;
  chatId: string;
}

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Each line in transcript.jsonl
export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "tool_use" | "tool_result";
  // Simple text messages use `text`; multi-part (images, tool calls) use `blocks`
  text?: string;
  blocks?: ContentBlock[];
  timestamp: string;                  // ISO 8601
  usage?: ModelUsage;                 // Attached to assistant entries
  request?: any;
  response?: any;
  // For user entries: attach originating channel info
  channel?: ChannelId;
  peerId?: string;
  senderName?: string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; base64: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string };

// ── Memory ────────────────────────────────────────────────────────────────

export type MemoryType = "fact" | "preference" | "project";

export interface MemoryEntry {
  content: string;
  lastAccessed: string;               // ISO date string "YYYY-MM-DD"
  accessCount: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  filePath: string;
  index: number;                      // position in the entries array (for update)
}

// ── Agent / Runner ────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: RunnerContext
) => Promise<string>;

export interface RunnerOptions {
  sessionKey: SessionKey;
  inboundMessage: InboundMessage;
  config: Config;
  env: Env;
  dataDir: string;
  sendMessage: (msg: OutboundMessage) => Promise<string | void>;
  // Optional: for typewriter effect / real-time updates
  updateMessage?: (messageId: string, msg: OutboundMessage) => Promise<void>;
  // Callbacks for UI/logging
  onUsage?: (usage: ModelUsage) => void;
  onInteraction?: (request: unknown, response: unknown) => void;
  // If true, don't persist messages and inject silentPrompt instead of inbound message
  skipPersist?: boolean;
  silentPrompt?: string;
  skipHistory?: boolean;
  skipSkills?: boolean;
}

export interface RunnerContext extends RunnerOptions {
  lastActivityAt: number;
  skipPersist: boolean; // non-optional here
}

// ── Cron ──────────────────────────────────────────────────────────────────

export interface CronJobState {
  id: string;
  enabled: boolean;
  lastRunAt?: string;
  lastError?: string;
}

// ── Rate Limiting ─────────────────────────────────────────────────────────

export interface RateLimitEntry {
  attempts: number[];                 // timestamps of recent attempts
  lockedUntil?: number;               // epoch ms
}

// ── Health ────────────────────────────────────────────────────────────────

export interface ChannelHealth {
  channel: ChannelId;
  connected: boolean;
  lastErrorAt?: string;
  lastError?: string;
}

// ── Pairing ───────────────────────────────────────────────────────────────

export interface PairingRecord {
  code: string;
  channel: ChannelId;
  peerId: string;
  createdAt: string;
  expiresAt: string;
}

// ── WebSocket events pushed to UI ─────────────────────────────────────────

export type WsEvent =
  | { type: "session_update"; sessionKeyStr: string }
  | { type: "health"; health: ChannelHealth[] }
  | { type: "cron_run"; jobId: string; success: boolean; error?: string };
