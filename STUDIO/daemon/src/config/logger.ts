import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private isDev = process.env.NODE_ENV === 'development';

  private formatMessage(level: LogLevel, component: string, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${component}]${dataStr} ${message}`;
  }

  debug(component: string, message: string, data?: unknown) {
    const formatted = this.formatMessage('debug', component, message, data);
    if (this.isDev) console.debug(formatted);
  }

  info(component: string, message: string, data?: unknown) {
    const formatted = this.formatMessage('info', component, message, data);
    console.log(formatted);
  }

  warn(component: string, message: string, data?: unknown) {
    const formatted = this.formatMessage('warn', component, message, data);
    console.warn(formatted);
  }

  error(component: string, message: string, data?: unknown) {
    const formatted = this.formatMessage('error', component, message, data);
    console.error(formatted);
  }
}

export const logger = new Logger();
