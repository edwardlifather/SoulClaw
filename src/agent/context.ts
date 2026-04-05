import type { TranscriptEntry, ContentBlock, Config } from "../types.js";
import type { ToolDefinition } from "../types.js";

// ── Token estimation ──────────────────────────────────────────────────────
// Rough heuristic: 4 chars ≈ 1 token for English, 2 chars ≈ 1 token for CJK.

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f]/g;

export function estimateTokens(text: string): number {
  const cjkCount = (text.match(CJK_RE) ?? []).length;
  const rest = text.length - cjkCount;
  return Math.ceil(cjkCount / 2 + rest / 4);
}

function entryTokens(entry: TranscriptEntry): number {
  const text = entry.text ?? (entry.blocks ? JSON.stringify(entry.blocks) : "");
  return estimateTokens(text) + 10; // 10 tokens overhead per message
}

// ── Context window trim ───────────────────────────────────────────────────

// Budget constants (tokens)
const SYSTEM_PROMPT_RESERVE = 1000;   // reserved for soul.md + channel context
const TOOL_DEFS_RESERVE = 500;        // reserved for tool definitions
const HEADROOM = 200;

export function computeContextBudget(modelMaxTokens: number): number {
  // Rough rule: Reserve up to 25% for output, at least 1024 tokens if possible.
  const reserveForOutput = Math.min(Math.floor(modelMaxTokens * 0.25), 1024);
  const availableInput = modelMaxTokens - reserveForOutput - SYSTEM_PROMPT_RESERVE - TOOL_DEFS_RESERVE - HEADROOM;

  // Ensure we always have at least 500 tokens for context if the model allows it.
  return Math.max(500, availableInput);
}

/**
 * Trim the transcript to fit within the token budget.
 * Always keeps the most recent entries. Returns the trimmed array.
 * If trimming occurs, prepends a synthetic summary entry (caller must
 * supply the summarizer or pass null to skip summarization).
 */
export function trimTranscript(
  entries: TranscriptEntry[],
  budget: number
): TranscriptEntry[] {
  if (entries.length === 0) return [];

  // Walk backwards from the end, accumulate until we hit the budget.
  // Always keep at least the last entry (the current user message).
  let total = 0;
  let cutIndex = entries.length - 1; // guaranteed minimum: last entry
  for (let i = entries.length - 1; i >= 0; i--) {
    const t = entryTokens(entries[i]!);
    if (total + t > budget && i < entries.length - 1) {
      cutIndex = i + 1;
      break;
    }
    total += t;
    if (i === 0) cutIndex = 0;
  }

  return entries.slice(cutIndex);
}

// ── Convert transcript entries to model API messages ─────────────────────

export interface ApiMessage {
  role: "user" | "assistant";
  content: string | ApiContentBlock[];
}

export interface ApiContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | ApiContentBlock[];
  source?: { type: "base64"; media_type: string; data: string };
  tool_use_id?: string;
}

/**
 * Convert our TranscriptEntry[] into the message format expected by
 * Anthropic messages API. Tool calls and results are handled per the
 * Anthropic API spec (tool_use in assistant turn, tool_result in user turn).
 */
export function transcriptToAnthropicMessages(entries: TranscriptEntry[]): ApiMessage[] {
  const messages: ApiMessage[] = [];

  for (const entry of entries) {
    if (entry.role === "user") {
      const blocks: ApiContentBlock[] = [];
      if (entry.text) {
        blocks.push({ type: "text", text: entry.text });
      }
      if (entry.blocks) {
        for (const b of entry.blocks) {
          if (b.type === "image") {
            blocks.push({ type: "image", source: { type: "base64", media_type: b.mediaType, data: b.base64 } });
          } else if (b.type === "tool_result") {
            blocks.push({ type: "tool_result", tool_use_id: b.toolUseId, content: b.content });
          }
        }
      }
      messages.push({ role: "user", content: blocks.length === 1 && blocks[0]!.type === "text" ? blocks[0]!.text! : blocks });
    } else if (entry.role === "assistant") {
      messages.push({ role: "assistant", content: entry.text ?? "" });
    } else if (entry.role === "tool_use") {
      // Assistant message with tool_use blocks
      const blocks: ApiContentBlock[] = entry.blocks
        ? entry.blocks.filter(b => b.type === "tool_use").map(b => {
            if (b.type !== "tool_use") throw new Error("unexpected");
            return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input };
          })
        : [];
      if (blocks.length > 0) {
        messages.push({ role: "assistant", content: blocks });
      }
    } else if (entry.role === "tool_result") {
      // User message with tool_result blocks
      const blocks: ApiContentBlock[] = entry.blocks
        ? entry.blocks.filter(b => b.type === "tool_result").map(b => {
            if (b.type !== "tool_result") throw new Error("unexpected");
            return { type: "tool_result" as const, tool_use_id: b.toolUseId, content: b.content };
          })
        : [];
      if (blocks.length > 0) {
        messages.push({ role: "user", content: blocks });
      }
    }
  }

  // Anthropic requires the first message to be from "user" and messages must alternate.
  // Merge consecutive same-role messages if needed.
  return mergeConsecutiveSameRole(messages);
}

function mergeConsecutiveSameRole(messages: ApiMessage[]): ApiMessage[] {
  if (messages.length === 0) return [];
  const result: ApiMessage[] = [messages[0]!];
  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = messages[i]!;
    if (prev.role === curr.role) {
      // Merge content
      const prevContent = Array.isArray(prev.content) ? prev.content : [{ type: "text" as const, text: prev.content as string }];
      const currContent = Array.isArray(curr.content) ? curr.content : [{ type: "text" as const, text: curr.content as string }];
      prev.content = [...prevContent, ...currContent];
    } else {
      result.push(curr);
    }
  }
  return result;
}

/**
 * Convert our TranscriptEntry[] to OpenAI chat messages format.
 * OpenAI uses a simpler format: role/content pairs, tool_calls in assistant messages.
 */
export function transcriptToOpenAIMessages(entries: TranscriptEntry[]): object[] {
  const messages: object[] = [];

  for (const entry of entries) {
    if (entry.role === "user") {
      const contentParts: object[] = [];
      if (entry.text) contentParts.push({ type: "text", text: entry.text });
      if (entry.blocks) {
        for (const b of entry.blocks) {
          if (b.type === "image") {
            contentParts.push({ type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.base64}` } });
          }
        }
      }
      messages.push({ role: "user", content: contentParts.length === 1 ? (contentParts[0] as { text: string }).text : contentParts });
    } else if (entry.role === "assistant") {
      messages.push({ role: "assistant", content: entry.text ?? "" });
    } else if (entry.role === "tool_use") {
      const toolCalls = (entry.blocks ?? []).filter(b => b.type === "tool_use").map(b => {
        if (b.type !== "tool_use") throw new Error("unexpected");
        return { id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } };
      });
      messages.push({ role: "assistant", content: null, tool_calls: toolCalls });
    } else if (entry.role === "tool_result") {
      for (const b of (entry.blocks ?? [])) {
        if (b.type !== "tool_result") continue;
        messages.push({ role: "tool", tool_call_id: b.toolUseId, content: b.content });
      }
    }
  }

  return messages;
}

// ── Build tool definitions for API payload ────────────────────────────────

export function toolsToAnthropicFormat(tools: ToolDefinition[]): object[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

export function toolsToOpenAIFormat(tools: ToolDefinition[]): object[] {
  return tools.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ── Build system prompt ───────────────────────────────────────────────────

export function buildSystemPrompt(
  soul: string,
  inboundMessage: { channel: string; chatId: string; isDm: boolean } | null,
  addChannelContext: boolean
): string {
  const parts: string[] = [];
  if (soul) parts.push(soul);
  if (addChannelContext && inboundMessage) {
    const ctx = inboundMessage.isDm
      ? `当前对话来自 ${inboundMessage.channel} 私信`
      : `当前对话来自 ${inboundMessage.channel} 群组 ${inboundMessage.chatId}`;
    parts.push(ctx);
  }
  return parts.join("\n\n");
}
