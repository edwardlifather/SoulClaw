import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolHandler } from "../../types.js";
import { logger } from "../../logger.js";

// ── list_files ──────────────────────────────────────────────────────────

export const listFilesDefinition: ToolDefinition = {
  name: "list_files",
  description: "Lists files and subdirectories in a given directory.",
  input_schema: {
    type: "object",
    properties: {
      dirPath: {
        type: "string",
        description: "Absolute or relative path to list (defaults to current dir).",
      },
    },
  },
};

export const listFilesHandler: ToolHandler = async (input) => {
  const dir = String(input["dirPath"] || ".").trim();
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const lines = entries.map(e => `${e.isDirectory() ? "[DIR] " : "      "}${e.name}`);
    return lines.length > 0 ? lines.join("\n") : "(Empty directory)";
  } catch (err) {
    return `Error listing directory: ${String(err)}`;
  }
};

// ── read_file ────────────────────────────────────────────────────────────

export const readFileDefinition: ToolDefinition = {
  name: "read_file",
  description: "Reads the content of a text file.",
  input_schema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Path to the file to read.",
      },
    },
    required: ["filePath"],
  },
};

export const readFileHandler: ToolHandler = async (input) => {
  const filePath = String(input["filePath"]).trim();
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (err) {
    return `Error reading file: ${String(err)}`;
  }
};

// ── write_file ───────────────────────────────────────────────────────────

export const writeFileDefinition: ToolDefinition = {
  name: "write_file",
  description: "Writes content to a file (overwrites existing). Creates directories if needed.",
  input_schema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Target file path.",
      },
      content: {
        type: "string",
        description: "Content to write.",
      },
    },
    required: ["filePath", "content"],
  },
};

export const writeFileHandler: ToolHandler = async (input) => {
  const filePath = String(input["filePath"]).trim();
  const content = String(input["content"]);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return `Successfully wrote to ${filePath}`;
  } catch (err) {
    return `Error writing file: ${String(err)}`;
  }
};
