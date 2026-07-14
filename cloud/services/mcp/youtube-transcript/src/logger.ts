type Level = "info" | "warn" | "error" | "debug";

function emit(level: Level, msg: string, data?: Record<string, unknown>): void {
  const entry = JSON.stringify({ level, msg, ...data, ts: Date.now() });
  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

export const logger = {
  info:  (msg: string, data?: Record<string, unknown>) => emit("info",  msg, data),
  warn:  (msg: string, data?: Record<string, unknown>) => emit("warn",  msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit("error", msg, data),
  debug: (msg: string, data?: Record<string, unknown>) => emit("debug", msg, data),
};
