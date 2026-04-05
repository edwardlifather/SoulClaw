import url from "node:url";
import https from "node:https";
import type { ToolDefinition, ToolHandler } from "../../types.js";
import { logger } from "../../logger.js";

// ── fetch_url ────────────────────────────────────────────────────────────

export const fetchUrlDefinition: ToolDefinition = {
  name: "fetch_url",
  description: "Fetches content from a public URL.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to fetch (e.g., https://example.com).",
      },
      format: {
        type: "string",
        enum: ["text", "json"],
        description: "Output format.",
      },
    },
    required: ["url"],
  },
};

export const fetchUrlHandler: ToolHandler = async (input) => {
  const targetUrl = String(input["url"]).trim();
  const format = String(input["format"] || "text");
  try {
    return new Promise((resolve, reject) => {
      https.get(targetUrl, { timeout: 10000 }, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
          if (format === "json") {
            try { resolve(JSON.stringify(JSON.parse(body), null, 2)); }
            catch { resolve(body); }
          } else {
            resolve(body.slice(0, 5000) + (body.length > 5000 ? "\n...(truncated)" : ""));
          }
        });
      }).on("error", reject);
    });
  } catch (err) {
    return `Error fetching URL: ${String(err)}`;
  }
};
