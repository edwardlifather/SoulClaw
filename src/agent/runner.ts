import { loadSoul } from "../config.js";
import { logger } from "../logger.js";
import {
  appendEntry, readRecentTranscript,
  makeUserEntry, makeAssistantEntry, makeToolUseEntry, makeToolResultEntry,
} from "../session/store.js";
import {
  trimTranscript, computeContextBudget,
  transcriptToAnthropicMessages, transcriptToOpenAIMessages,
  toolsToAnthropicFormat, toolsToOpenAIFormat,
  buildSystemPrompt,
} from "./context.js";
import {
  memorySearchDefinition, memorySearchHandler,
  memorySaveDefinition, memorySaveHandler,
  memoryListProjectsDefinition, memoryListProjectsHandler,
  memoryDeleteDefinition, memoryDeleteHandler,
} from "./tools/memory.js";
import { sendMessageDefinition, sendMessageHandler } from "./tools/send_message.js";
import {
  listFilesDefinition, listFilesHandler,
  readFileDefinition, readFileHandler,
  writeFileDefinition, writeFileHandler,
} from "./tools/fs.js";
import { runCommandDefinition, runCommandHandler } from "./tools/shell.js";
import { fetchUrlDefinition, fetchUrlHandler } from "./tools/http.js";

import type {
  RunnerOptions, RunnerContext, ToolDefinition, ToolHandler,
  TranscriptEntry, ContentBlock, ModelUsage,
} from "../types.js";
import type { ApiContentBlock } from "./context.js";

// ── Tool registry ─────────────────────────────────────────────────────────

const TOOLS: Array<{ definition: ToolDefinition; handler: ToolHandler }> = [
  { definition: memorySearchDefinition,       handler: memorySearchHandler },
  { definition: memorySaveDefinition,         handler: memorySaveHandler },
  { definition: memoryDeleteDefinition,       handler: memoryDeleteHandler },
  { definition: memoryListProjectsDefinition, handler: memoryListProjectsHandler },
  { definition: sendMessageDefinition,        handler: sendMessageHandler },
  { definition: listFilesDefinition,          handler: listFilesHandler },
  { definition: readFileDefinition,           handler: readFileHandler },
  { definition: writeFileDefinition,          handler: writeFileHandler },
  { definition: runCommandDefinition,         handler: runCommandHandler },
  { definition: fetchUrlDefinition,           handler: fetchUrlHandler },
];

// ── Max iterations per run (prevents infinite tool loops) ─────────────────
const MAX_TOOL_ITERATIONS = 10;

// ── Main entry point ──────────────────────────────────────────────────────

export async function runAgent(options: RunnerOptions): Promise<void> {
  const { sessionKey, inboundMessage, config, env, dataDir, sendMessage, skipPersist = false } = options;

  const ctx: RunnerContext = {
    ...options,
    lastActivityAt: Date.now(),
    skipPersist,
  };

  logger.info("runner", `Running agent for ${sessionKey.channel}/${sessionKey.peerId}`);

  // 1. Persist the inbound user message (skip for silent consolidation runs)
  if (!skipPersist) {
    const blocks: ContentBlock[] = [];
    if (inboundMessage.images?.length) {
      for (const img of inboundMessage.images) {
        blocks.push({ type: "image", mediaType: img.mediaType, base64: img.base64 });
      }
    }
    const userEntry = makeUserEntry(
      inboundMessage.text,
      blocks.length > 0 ? blocks : undefined,
      inboundMessage.channel,
      inboundMessage.peerId,
      inboundMessage.senderName,
    );
    await appendEntry(dataDir, sessionKey, userEntry);
  }

  // 2. Load transcript + trim to context budget
  const allEntries = await readRecentTranscript(dataDir, sessionKey, 200);
  const budget = computeContextBudget(config.model.maxTokens ?? 4096);
  const contextEntries = trimTranscript(allEntries, budget);

  // 3. Build system prompt
  const soul = loadSoul(dataDir);
  const systemPrompt = buildSystemPrompt(
    soul,
    skipPersist ? null : {
      channel: inboundMessage.channel,
      chatId: inboundMessage.chatId,
      isDm: inboundMessage.isDm,
    },
    config.addChannelContext
  );

  // 4. Run the agentic loop
  const provider = config.model.provider;
  if (provider === "anthropic") {
    await runAnthropicLoop(ctx, contextEntries, systemPrompt);
  } else {
    await runOpenAILoop(ctx, contextEntries, systemPrompt);
  }
}

// ── Anthropic loop ────────────────────────────────────────────────────────

async function runAnthropicLoop(
  ctx: RunnerContext,
  contextEntries: TranscriptEntry[],
  systemPrompt: string
): Promise<void> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: ctx.env.modelApiKey });

  const toolDefs = toolsToAnthropicFormat(TOOLS.map(t => t.definition));
  let messages = transcriptToAnthropicMessages(contextEntries);

  // For silent (consolidation) runs, inject the prompt as a user message
  if (ctx.silentPrompt) {
    messages = [...messages, { role: "user", content: ctx.silentPrompt }];
  }

  let iterations = 0;
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const modelConfig = ctx.config.model;
    const requestParams: Record<string, unknown> = {
      model: modelConfig.model,
      max_tokens: modelConfig.maxTokens ?? 4096,
      system: systemPrompt || undefined,
      messages,
      tools: toolDefs,
    };

    // Thinking mode
    if (modelConfig.thinking) {
      requestParams["thinking"] = { type: "enabled", budget_tokens: 2000 };
      requestParams["temperature"] = 1; // required for thinking
      // max_tokens must exceed thinking budget
      const minTokens = 2000 + 1024;
      if ((requestParams["max_tokens"] as number) < minTokens) {
        requestParams["max_tokens"] = minTokens;
      }
    } else if (modelConfig.temperature !== undefined) {
      requestParams["temperature"] = modelConfig.temperature;
    }

    // Stream the response
    let assistantText = "";
    const toolUseBlocks: Array<{ id: string; name: string; inputJson: string }> = [];
    let stopReason: string | null = null;
    let usage: ModelUsage | undefined;
    let fullRespChunks: object[] = [];

    try {
      const stream = await client.messages.stream(requestParams as unknown as Parameters<typeof client.messages.stream>[0]);

      for await (const event of stream) {
        fullRespChunks.push(event);
        if (event.type === "message_start") {
          usage = {
            promptTokens: event.message.usage.input_tokens,
            completionTokens: 0,
            totalTokens: event.message.usage.input_tokens,
          };
        } else if (event.type === "message_delta") {
          if (usage) {
            usage.completionTokens = event.usage.output_tokens;
            usage.totalTokens = usage.promptTokens + usage.completionTokens;
          }
          stopReason = event.delta.stop_reason ?? null;
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            assistantText += event.delta.text;
          } else if (event.delta.type === "input_json_delta") {
            // Accumulate tool input JSON
            const last = toolUseBlocks[toolUseBlocks.length - 1];
            if (last) last.inputJson += event.delta.partial_json;
          }
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            toolUseBlocks.push({ id: event.content_block.id, name: event.content_block.name, inputJson: "" });
          }
        }
      }
      if (ctx.onInteraction) ctx.onInteraction(requestParams, fullRespChunks);
      if (usage && ctx.onUsage) ctx.onUsage(usage);
    } catch (err) {
      logger.error("runner", "Anthropic API error", err);
      if (ctx.onInteraction) ctx.onInteraction(requestParams, { error: String(err) });
      const detail = err instanceof Error ? err.message : String(err);
      await ctx.sendMessage({ channel: ctx.sessionKey.channel, peerId: ctx.sessionKey.peerId, chatId: ctx.sessionKey.chatId, text: `__error__${detail}` });
      return;
    }

    // Persist assistant text if any, and track whether we added a plain text message
    let addedPlainTextMsg = false;
    if (assistantText) {
      if (!ctx.skipPersist) {
        const assistantEntry = makeAssistantEntry(assistantText, usage);
        await appendEntry(ctx.dataDir, ctx.sessionKey, assistantEntry);
      }

      // Add to messages for next turn
      messages = [...messages, { role: "assistant", content: assistantText }];
      addedPlainTextMsg = true;
    }

    // If no tool calls or end of conversation, deliver reply and exit
    if (stopReason !== "tool_use" || toolUseBlocks.length === 0) {
      if (assistantText) {
        await ctx.sendMessage({
          channel: ctx.sessionKey.channel,
          peerId: ctx.sessionKey.peerId,
          chatId: ctx.sessionKey.chatId,
          text: assistantText,
          replyToMessageId: ctx.inboundMessage.rawMessageId,
          usage,
        });
      }
      return;
    }

    // Process tool calls
    const toolResultsForApi: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    const toolUseApiBlocks: Array<{ type: "tool_use"; id: string; name: string; input: Record<string, unknown> }> = [];

    for (const tu of toolUseBlocks) {
      let input: Record<string, unknown> = {};
      try {
        input = tu.inputJson ? JSON.parse(tu.inputJson) as Record<string, unknown> : {};
      } catch {
        input = {};
      }

      toolUseApiBlocks.push({ type: "tool_use", id: tu.id, name: tu.name, input });

      // Persist tool_use entry
      if (!ctx.skipPersist) {
        await appendEntry(ctx.dataDir, ctx.sessionKey, makeToolUseEntry(tu.id, tu.name, input));
      }

      // Execute tool
      const tool = TOOLS.find(t => t.definition.name === tu.name);
      let result: string;
      if (tool) {
        try {
          result = await tool.handler(input, ctx);
        } catch (err) {
          result = `Tool error: ${(err as Error).message}`;
        }
      } else {
        result = `Unknown tool: ${tu.name}`;
      }

      // Persist tool_result entry
      if (!ctx.skipPersist) {
        await appendEntry(ctx.dataDir, ctx.sessionKey, makeToolResultEntry(tu.id, result));
      }

      toolResultsForApi.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }

    // Add assistant tool_use + user tool_results to messages for next API call
    // First, rebuild the assistant message to include both text and tool_use blocks
    const assistantBlocks: ApiContentBlock[] = [];
    if (assistantText) assistantBlocks.push({ type: "text", text: assistantText });
    assistantBlocks.push(...toolUseApiBlocks);

    // Replace the plain text assistant message (if added) with the full blocks version
    if (addedPlainTextMsg) {
      messages = messages.slice(0, -1);
    }
    messages = [...messages, { role: "assistant", content: assistantBlocks }];
    messages = [...messages, { role: "user", content: toolResultsForApi }];
  }

  logger.warn("runner", `Max tool iterations (${MAX_TOOL_ITERATIONS}) reached for session`, ctx.sessionKey);
}

// ── OpenAI loop ───────────────────────────────────────────────────────────

async function runOpenAILoop(
  ctx: RunnerContext,
  contextEntries: TranscriptEntry[],
  systemPrompt: string
): Promise<void> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: ctx.env.modelApiKey,
    baseURL: ctx.config.model.baseUrl,
  });

  const toolDefs = toolsToOpenAIFormat(TOOLS.map(t => t.definition));
  let messages: object[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages = [...messages, ...transcriptToOpenAIMessages(contextEntries)];

  if (ctx.silentPrompt) {
    messages = [...messages, { role: "user", content: ctx.silentPrompt }];
  }

  let iterations = 0;
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const modelConfig = ctx.config.model;
    let assistantText = "";
    const toolCalls: Array<{ id: string; name: string; argsJson: string }> = [];

    const requestBody = {
      model: modelConfig.model,
      max_tokens: modelConfig.maxTokens ?? 4096,
      temperature: modelConfig.temperature ?? 1,
      messages,
      tools: toolDefs,
      stream_options: { include_usage: true }, // Needed for token usage in stream
    };

    let usage: ModelUsage | undefined;
    let sentMsgId: string | undefined;
    let fullRespChunks: object[] = [];

    try {
      const stream = await client.chat.completions.create({
        ...(requestBody as Parameters<typeof client.chat.completions.create>[0]),
        stream: true,
      });

      let lastUpdateAt = 0;

      for await (const chunk of stream) {
        fullRespChunks.push(chunk);
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          assistantText += delta.content;
          // Typewriter effect for Telegram/Feishu
          if (ctx.updateMessage && assistantText.length > 5 && Date.now() - lastUpdateAt > 1000) {
            try {
              if (!sentMsgId) {
                const res = await ctx.sendMessage({
                  channel: ctx.sessionKey.channel,
                  peerId: ctx.sessionKey.peerId,
                  chatId: ctx.sessionKey.chatId,
                  text: assistantText + " ▌", // Add cursor
                  replyToMessageId: ctx.inboundMessage.rawMessageId,
                });
                if (res) sentMsgId = res;
              } else {
                await ctx.updateMessage(sentMsgId, {
                  channel: ctx.sessionKey.channel,
                  peerId: ctx.sessionKey.peerId,
                  chatId: ctx.sessionKey.chatId,
                  text: assistantText + " ▌",
                });
              }
              lastUpdateAt = Date.now();
            } catch (err) {
              logger.warn("runner", "Failed to update streaming message", err);
            }
          }
        }
        // DeepSeek-style reasoning content support (or any provider using 'thought')
        const reasoning = (delta as any).reasoning_content || (delta as any).thought;
        if (reasoning) assistantText += `\n\n<thinking>\n${reasoning}\n</thinking>\n\n`;

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id ?? "", name: tc.function?.name ?? "", argsJson: "" };
            }
            if (tc.function?.arguments) toolCalls[idx]!.argsJson += tc.function.arguments;
            if (tc.id) toolCalls[idx]!.id = tc.id;
            if (tc.function?.name) toolCalls[idx]!.name = tc.function.name;
          }
        }
      }
      if (ctx.onInteraction) ctx.onInteraction(requestBody, fullRespChunks);
      if (usage && ctx.onUsage) ctx.onUsage(usage);
    } catch (err) {
      // ... catch logic ...
      logger.error("runner", "OpenAI API error", err);
      if (ctx.onInteraction) ctx.onInteraction(requestBody, { error: String(err) });
      const errObj = err as Record<string, unknown>;
      let rawBody: unknown = errObj["error"];
      try {
        const response = errObj["response"] as Response | undefined;
        if (response?.text) rawBody = JSON.parse(await response.text());
      } catch { /* ignore */ }
      const realStatus = (errObj["status"] as number) === 400 && rawBody == null
        ? "unknown (possibly 429 quota exceeded)"
        : errObj["status"];
      const errorInfo = {
        request: requestBody,
        response: {
          message: errObj["message"] ?? String(err),
          status: realStatus,
          error: rawBody,
          headers: errObj["headers"],
        },
      };
      await ctx.sendMessage({ channel: ctx.sessionKey.channel, peerId: ctx.sessionKey.peerId, chatId: ctx.sessionKey.chatId, text: `__error_json__${JSON.stringify(errorInfo)}` });
      return;
    }

    if (assistantText && !ctx.skipPersist) {
      await appendEntry(ctx.dataDir, ctx.sessionKey, makeAssistantEntry(assistantText, usage, requestBody, fullRespChunks));
    }

    const validToolCalls = toolCalls.filter(tc => tc.id && tc.name);

    if (validToolCalls.length === 0) {
      if (assistantText) {
        if (sentMsgId && ctx.updateMessage) {
          // Final update to remove the cursor
          await ctx.updateMessage(sentMsgId, {
            channel: ctx.sessionKey.channel,
            peerId: ctx.sessionKey.peerId,
            chatId: ctx.sessionKey.chatId,
            text: assistantText,
            usage,
          });
        } else {
          await ctx.sendMessage({
            channel: ctx.sessionKey.channel,
            peerId: ctx.sessionKey.peerId,
            chatId: ctx.sessionKey.chatId,
            text: assistantText,
            replyToMessageId: ctx.inboundMessage.rawMessageId,
            usage,
          });
        }
      }
      return;
    }

    // Build assistant message with tool_calls
    const assistantMsg: Record<string, unknown> = { role: "assistant", content: assistantText || null };
    assistantMsg["tool_calls"] = validToolCalls.map(tc => ({
      id: tc.id, type: "function",
      function: { name: tc.name, arguments: tc.argsJson },
    }));
    messages = [...messages, assistantMsg];

    // Persist and execute tools
    for (const tc of validToolCalls) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.argsJson) as Record<string, unknown>; } catch { input = {}; }

      if (!ctx.skipPersist) {
        await appendEntry(ctx.dataDir, ctx.sessionKey, makeToolUseEntry(tc.id, tc.name, input));
      }

      const tool = TOOLS.find(t => t.definition.name === tc.name);
      let result: string;
      try {
        result = tool ? await tool.handler(input, ctx) : `Unknown tool: ${tc.name}`;
      } catch (err) {
        result = `Tool error: ${(err as Error).message}`;
      }

      if (!ctx.skipPersist) {
        await appendEntry(ctx.dataDir, ctx.sessionKey, makeToolResultEntry(tc.id, result));
      }
      messages = [...messages, { role: "tool", tool_call_id: tc.id, content: result }];
    }
  }

  logger.warn("runner", `Max tool iterations (${MAX_TOOL_ITERATIONS}) reached`, ctx.sessionKey);
}

// ── Silent run (for memory consolidation) ─────────────────────────────────

export interface SilentRunOptions {
  prompt: string;
  sessionKey: RunnerOptions["sessionKey"];
  config: RunnerOptions["config"];
  env: RunnerOptions["env"];
  dataDir: string;
}

/**
 * Run a silent agent pass. Returns the final assistant text (if any),
 * so callers can capture the summary without a second model call.
 */
export async function runSilentAgent(options: SilentRunOptions): Promise<string> {
  const dummyMessage: import("../types.js").InboundMessage = {
    channel: options.sessionKey.channel,
    peerId: options.sessionKey.peerId,
    chatId: options.sessionKey.chatId,
    isDm: true,
    mentionedBot: false,
    rawMessageId: "",
    text: options.prompt,
  };

  let captured = "";
  await runAgent({
    sessionKey: options.sessionKey,
    inboundMessage: dummyMessage,
    config: options.config,
    env: options.env,
    dataDir: options.dataDir,
    sendMessage: async (msg) => { captured = msg.text; },
    skipPersist: true,
    silentPrompt: options.prompt,
  });
  return captured;
}
