/**
 * Centralized Logging Service
 * Replaces scattered console.log statements with proper logging
 */

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data?: any;
  timestamp: number;
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private isDevelopment: boolean = false;
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  constructor() {
    // Detect environment using Vite's environment variables
    this.isDevelopment = import.meta.env.DEV || 
                        import.meta.env.MODE === 'development';
    
    // Set appropriate log level
    this.level = this.isDevelopment ? LogLevel.DEBUG : LogLevel.WARN;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private addLog(level: LogLevel, module: string, message: string, data?: any) {
    const entry: LogEntry = {
      level,
      module,
      message,
      data,
      timestamp: Date.now()
    };

    this.logs.push(entry);
    
    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  debug(module: string, message: string, data?: any) {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    
    this.addLog(LogLevel.DEBUG, module, message, data);
    if (this.isDevelopment) {
      console.log(`[${module}] ${message}`, data || '');
    }
  }

  info(module: string, message: string, data?: any) {
    if (!this.shouldLog(LogLevel.INFO)) return;
    
    this.addLog(LogLevel.INFO, module, message, data);
    if (this.isDevelopment) {
      console.log(`[${module}] ${message}`, data || '');
    }
  }

  warn(module: string, message: string, data?: any) {
    if (!this.shouldLog(LogLevel.WARN)) return;
    
    this.addLog(LogLevel.WARN, module, message, data);
    console.warn(`[${module}] ${message}`, data || '');
  }

  error(module: string, message: string, error?: any) {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    
    this.addLog(LogLevel.ERROR, module, message, error);
    console.error(`[${module}] ${message}`, error || '');
  }

  /**
   * Get recent logs for debugging
   */
  getLogs(level?: LogLevel): LogEntry[] {
    if (level !== undefined) {
      return this.logs.filter(log => log.level >= level);
    }
    return [...this.logs];
  }

  /**
   * Clear all logs
   */
  clearLogs() {
    this.logs = [];
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel) {
    this.level = level;
  }
}

export const logger = new Logger();
