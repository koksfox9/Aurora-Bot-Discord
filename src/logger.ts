type LogLevel = "debug" | "info" | "warn" | "error";

const rank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";

function log(level: LogLevel, message: string, meta?: unknown) {
  if (rank[level] < rank[currentLevel]) return;

  const line = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta && typeof meta === "object" ? { meta } : {})
  };

  const output = JSON.stringify(line);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => log("debug", message, meta),
  info: (message: string, meta?: unknown) => log("info", message, meta),
  warn: (message: string, meta?: unknown) => log("warn", message, meta),
  error: (message: string, meta?: unknown) => log("error", message, meta)
};
