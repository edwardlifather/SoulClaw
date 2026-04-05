import type { ToolDefinition, ToolHandler } from "../../types.js";

// The send_message tool lets the AI proactively send a message to a
// specific channel/peer during a tool-calling loop (e.g. for cron jobs
// that need to send to a different target than the origin message).
// For normal replies within a conversation, the runner sends the
// assistant's final text directly — this tool is for explicit sends.

export const sendMessageDefinition: ToolDefinition = {
  name: "send_message",
  description:
    "Send a text message to the user via the configured channel. " +
    "Use this tool when you need to deliver a message as part of an automated task " +
    "(e.g. a scheduled job). In normal conversations you don't need to call this — " +
    "just write your reply as your response text.",
  input_schema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The message text to send.",
      },
    },
    required: ["text"],
  },
};

export const sendMessageHandler: ToolHandler = async (input, ctx) => {
  const text = String(input["text"] ?? "").trim();
  if (!text) return "Empty message, nothing sent.";

  await ctx.sendMessage({
    channel: ctx.sessionKey.channel,
    peerId: ctx.sessionKey.peerId,
    chatId: ctx.sessionKey.chatId,
    text,
  });
  return "Message sent.";
};
