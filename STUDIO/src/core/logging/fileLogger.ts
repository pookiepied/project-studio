/**
 * File-based Logger for Production
 *
 * Writes to the logical path `logs/app.log`, which unifiedStorage resolves
 * against the platform's app data directory (or browser storage on web).
 * Automatically rotates logs when they get too large.
 */

import { unifiedStorage } from "../storage/unifiedStorageService";

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: any;
}

class FileLogger {
  private logPath = "logs/app.log";
  private maxLogSize = 1024 * 1024; // 1MB
  private maxLogs = 5; // Keep last 5 log files
  private queue: LogEntry[] = [];
  private isWriting = false;

  /**
   * Log a message
   */
  async log(level: LogLevel, message: string, context?: any): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    // Add to queue
    this.queue.push(entry);

    // Process queue
    await this.processQueue();
  }

  /**
   * Process the log queue
   */
  private async processQueue(): Promise<void> {
    if (this.isWriting || this.queue.length === 0) {
      return;
    }

    this.isWriting = true;

    try {
      // Get all queued entries
      const entries = [...this.queue];
      this.queue = [];

      // Format entries
      const formatted = entries
        .map((entry) => this.formatEntry(entry))
        .join("\n");

      // Read existing log
      let existingLog = (await unifiedStorage.readText(this.logPath)) || "";

      // Check if log is too large
      if (existingLog.length > this.maxLogSize) {
        await this.rotateLogs();
        existingLog = "";
      }

      // Append new entries
      const newLog = existingLog + (existingLog ? "\n" : "") + formatted;

      // Write to file
      await unifiedStorage.writeText(this.logPath, newLog);
    } catch (error) {
      // Fallback to console if file logging fails
      console.error("[FileLogger] Failed to write log:", error);
      this.queue.forEach((entry) => {
        console.log(this.formatEntry(entry));
      });
      this.queue = [];
    } finally {
      this.isWriting = false;

      // Process remaining queue if any
      if (this.queue.length > 0) {
        setTimeout(() => this.processQueue(), 100);
      }
    }
  }

  /**
   * Format a log entry
   */
  private formatEntry(entry: LogEntry): string {
    let formatted = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;

    if (entry.context) {
      try {
        formatted += ` | Context: ${JSON.stringify(entry.context)}`;
      } catch {
        formatted += ` | Context: [Unable to stringify]`;
      }
    }

    return formatted;
  }

  /**
   * Rotate logs when they get too large
   */
  private async rotateLogs(): Promise<void> {
    try {
      // Shift existing logs
      for (let i = this.maxLogs - 1; i > 0; i--) {
        const oldPath = i === 1 ? this.logPath : `logs/app.${i - 1}.log`;
        const newPath = `logs/app.${i}.log`;

        const exists = await unifiedStorage.exists(oldPath);
        if (exists) {
          const content = await unifiedStorage.readText(oldPath);
          if (content) {
            await unifiedStorage.writeText(newPath, content);
          }
        }
      }

      // Delete oldest log
      const oldestPath = `logs/app.${this.maxLogs}.log`;
      const exists = await unifiedStorage.exists(oldestPath);
      if (exists) {
        await unifiedStorage.remove(oldestPath);
      }
    } catch (error) {
      console.error("[FileLogger] Failed to rotate logs:", error);
    }
  }

  /**
   * Get recent logs
   */
  async getRecentLogs(lines: number = 100): Promise<string> {
    try {
      const content = await unifiedStorage.readText(this.logPath);
      if (!content) return "No logs available";

      const allLines = content.split("\n");
      const recentLines = allLines.slice(-lines);
      return recentLines.join("\n");
    } catch (error) {
      return `Failed to read logs: ${error}`;
    }
  }

  /**
   * Clear all logs
   */
  async clearLogs(): Promise<void> {
    try {
      await unifiedStorage.remove(this.logPath);
      for (let i = 1; i <= this.maxLogs; i++) {
        await unifiedStorage.remove(`logs/app.${i}.log`);
      }
    } catch (error) {
      console.error("[FileLogger] Failed to clear logs:", error);
    }
  }

  // Convenience methods
  debug(message: string, context?: any): Promise<void> {
    return this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: any): Promise<void> {
    return this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: any): Promise<void> {
    return this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: any): Promise<void> {
    return this.log(LogLevel.ERROR, message, context);
  }
}

// Export singleton instance
export const fileLogger = new FileLogger();

/**
 * Initialize file logging (call this in main.tsx)
 */
export function initFileLogging(): void {
  // Log app start
  fileLogger.info("Application started", {
    version: "0.1.4",
    environment: import.meta.env.MODE,
    userAgent: navigator.userAgent,
  });

  // Intercept console methods in production
  if (import.meta.env.PROD) {
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;

    console.error = (...args: any[]) => {
      originalConsoleError(...args);
      fileLogger.error(args.join(" "));
    };

    console.warn = (...args: any[]) => {
      originalConsoleWarn(...args);
      fileLogger.warn(args.join(" "));
    };

    console.log = (...args: any[]) => {
      originalConsoleLog(...args);
      if (import.meta.env.DEV) {
        fileLogger.debug(args.join(" "));
      }
    };
  }

  // Initialization complete
}
