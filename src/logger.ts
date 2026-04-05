import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

let logFilePath: string | null = null;
let logStream: fs.WriteStream | null = null;

export function initLogger(dataDir: string): void {
  const logsDir = path.join(dataDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  logFilePath = path.join(logsDir, "soulclaw.log");
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });
}

function write(level: LogLevel, tag: string, msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  const extraStr = extra !== undefined ? " " + JSON.stringify(extra) : "";
  const line = `${ts} [${level.toUpperCase()}] [${tag}] ${msg}${extraStr}`;

  // Console output
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }

  // File output
  if (logStream) {
    logStream.write(line + "\n");
  }
}

export const logger = {
  debug: (tag: string, msg: string, extra?: unknown) => write("debug", tag, msg, extra),
  info:  (tag: string, msg: string, extra?: unknown) => write("info",  tag, msg, extra),
  warn:  (tag: string, msg: string, extra?: unknown) => write("warn",  tag, msg, extra),
  error: (tag: string, msg: string, extra?: unknown) => write("error", tag, msg, extra),
};
