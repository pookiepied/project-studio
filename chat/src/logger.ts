type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private log(level: LogLevel, message: string, context?: LogContext) {
    const logData = {
      timestamp: new Date().toISOString(),
      level,
      message,
      worker: "ai",
      ...context,
    };
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(JSON.stringify(logData));
  }

  info(message: string, context?: LogContext) {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log("warn", message, context);
  }

  error(message: string, context?: LogContext | unknown) {
    if (context instanceof Error) {
      this.log("error", message, { error: context.message, stack: context.stack });
    } else {
      this.log("error", message, context as LogContext);
    }
  }

  debug(message: string, context?: LogContext) {
    this.log("debug", message, context);
  }
}

export const logger = new Logger();
