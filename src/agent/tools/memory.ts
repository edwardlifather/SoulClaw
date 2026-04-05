import fs from "node:fs/promises";
import { searchMemory, saveEntry, listProjects, longTermFilePath, readEntries, serializeEntries } from "../../memory/store.js";
import type { ToolDefinition, ToolHandler, MemoryType, MemoryEntry } from "../../types.js";

// ── memory_search ─────────────────────────────────────────────────────────

export const memorySearchDefinition: ToolDefinition = {
  name: "memory_search",
  description:
    "Search your long-term memory for information relevant to a query. " +
    "Returns matching memory entries as Markdown text. " +
    "Call this when you need to recall facts about the user, their preferences, or project details.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query — a phrase, topic, or question to look up in memory.",
      },
    },
    required: ["query"],
  },
};

export const memorySearchHandler: ToolHandler = async (input, ctx) => {
  if (!ctx.config.memory.enabled) {
    return "Memory is disabled in configuration.";
  }
  const query = String(input["query"] ?? "").trim();
  if (!query) return "Empty query.";

  const results = await searchMemory(ctx.dataDir, query, 5);
  if (results.length === 0) return "No relevant memories found.";

  const lines = results.map(r => `- ${r.entry.content}`);
  return lines.join("\n");
};

// ── memory_save ───────────────────────────────────────────────────────────

export const memorySaveDefinition: ToolDefinition = {
  name: "memory_save",
  description:
    "Save a new piece of information to long-term memory. " +
    'Use type="fact" for facts about the user (name, job, location). ' +
    'Use type="preference" for the user\'s preferences and habits. ' +
    'Use type="project" for project-specific context — also supply the project name. ' +
    "If a very similar memory already exists it will be updated rather than duplicated.",
  input_schema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The information to remember, written as a concise factual statement.",
      },
      type: {
        type: "string",
        enum: ["fact", "preference", "project"],
        description: 'Category: "fact", "preference", or "project".',
      },
      project: {
        type: "string",
        description: 'Project name (only required when type="project").',
      },
    },
    required: ["content", "type"],
  },
};

export const memorySaveHandler: ToolHandler = async (input, ctx) => {
  if (!ctx.config.memory.enabled) {
    return "Memory is disabled in configuration.";
  }
  const content = String(input["content"] ?? "").trim();
  if (!content) return "Content is empty, nothing saved.";

  const type = String(input["type"] ?? "") as MemoryType;
  if (!["fact", "preference", "project"].includes(type)) {
    return 'Invalid type. Must be "fact", "preference", or "project".';
  }

  const project = type === "project" ? String(input["project"] ?? "").trim() : undefined;
  if (type === "project" && !project) {
    return 'Project name is required when type="project".';
  }

  const filePath = longTermFilePath(ctx.dataDir, type, project);
  await saveEntry(filePath, content, type);
  return `Saved to memory (${type}${project ? "/" + project : ""}).`;
};

// ── memory_list_projects ──────────────────────────────────────────────────

export const memoryListProjectsDefinition: ToolDefinition = {
  name: "memory_list_projects",
  description: "List the names of all projects stored in long-term memory.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

export const memoryListProjectsHandler: ToolHandler = async (_input, ctx) => {
  if (!ctx.config.memory.enabled) {
    return "Memory is disabled in configuration.";
  }
  const projects = await listProjects(ctx.dataDir);
  if (projects.length === 0) return "No projects in memory yet.";
  return projects.join(", ");
};

// ── memory_delete ─────────────────────────────────────────────────────────

export const memoryDeleteDefinition: ToolDefinition = {
  name: "memory_delete",
  description:
    "Deletes a specific long-term memory entry. " +
    "Use this to remove outdated, duplicated, or incorrect information. " +
    "Supply the EXACT content (as returned by memory_search) that you want to delete.",
  input_schema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The memory statement to delete. Best to search for it first.",
      },
      type: {
        type: "string",
        enum: ["fact", "preference", "project"],
        description: "Memory category.",
      },
      project: {
        type: "string",
        description: "Project name (if type=project).",
      },
    },
    required: ["content", "type"],
  },
};

export const memoryDeleteHandler: ToolHandler = async (input, ctx) => {
  if (!ctx.config.memory.enabled) return "Memory disabled.";
  const content = String(input["content"] ?? "").trim();
  const type = String(input["type"] ?? "") as MemoryType;
  const project = type === "project" ? String(input["project"] ?? "").trim() : undefined;

  const filePath = longTermFilePath(ctx.dataDir, type, project);
  try {
    const entries = await readEntries(filePath);
    const initialCount = entries.length;
    const filtered = entries.filter((e: MemoryEntry) => e.content.trim().toLowerCase() !== content.toLowerCase());
    if (filtered.length === initialCount) {
      return "Memory not found for deletion. Check the spelling/content.";
    }
    await fs.writeFile(filePath, serializeEntries(filtered), "utf-8");
    return "Memory deleted successfully.";
  } catch (err) {
    return `Error deleting memory: ${String(err)}`;
  }
};
