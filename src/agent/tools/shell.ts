import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolHandler } from "../../types.js";
import { logger } from "../../logger.js";

const execAsync = promisify(exec);

// ── run_command ──────────────────────────────────────────────────────────

export const runCommandDefinition: ToolDefinition = {
  name: "run_command",
  description: "Executes a system shell command (Bash, CMD, or PowerShell), returning its output.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The full command line to execute.",
      },
    },
    required: ["command"],
  },
};

export const runCommandHandler: ToolHandler = async (input) => {
  const command = String(input["command"]).trim();
  try {
    const { stdout, stderr } = await execAsync(command);
    let out = stdout.trim();
    if (stderr.trim()) out += `\n\nStderr:\n${stderr.trim()}`;
    return out || "(No output)";
  } catch (err) {
    return `Error executing command: ${String(err)}`;
  }
};
