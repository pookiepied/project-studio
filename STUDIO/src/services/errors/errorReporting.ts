/**
 * Error Reporting Service
 * 
 * Centralized error logging and reporting integrated with the logger system.
 */

import { logger } from '../logging/logger';
import { unifiedStorage } from '../storage/unifiedStorageService';

interface ErrorContext {
  [key: string]: any;
}

interface ErrorReport {
  message: string;
  stack?: string;
  timestamp: number;
  context?: ErrorContext;
  userAgent: string;
  url: string;
  environment: string;
}

/**
 * Report an error to the error tracking service
 */
export function reportError(error: Error, context?: ErrorContext): void {
  const report: ErrorReport = {
    message: error.message,
    stack: error.stack,
    timestamp: Date.now(),
    context,
    userAgent: navigator.userAgent,
    url: window.location.href,
    environment: import.meta.env.MODE,
  };

  // Log through centralized logger
  logger.error('ErrorReporting', error.message, {
    stack: error.stack,
    context,
    url: window.location.href,
    userAgent: navigator.userAgent
  });

  // Store in errors.json for structured access
  storeErrorLocally(report).catch((err) => {
    logger.error('ErrorReporting', 'Failed to store error locally', err);
  });

  // In production, could send to external service
  if (import.meta.env.PROD) {
    sendToErrorAPI(report).catch((err) => {
      logger.error('ErrorReporting', 'Failed to send error report', err);
    });
  }
}

/**
 * Report a custom message (not an Error object)
 */
export function reportMessage(
  message: string,
  level: "info" | "warning" | "error" = "error",
  context?: ErrorContext
): void {
  const report = {
    message,
    level,
    timestamp: Date.now(),
    context,
    userAgent: navigator.userAgent,
    url: window.location.href,
    environment: import.meta.env.MODE,
  };

  // Log through centralized logger
  switch (level) {
    case 'info':
      logger.info('ErrorReporting', message, context);
      break;
    case 'warning':
      logger.warn('ErrorReporting', message, context);
      break;
    case 'error':
      logger.error('ErrorReporting', message, context);
      break;
  }

  if (import.meta.env.PROD) {
    sendToErrorAPI(report).catch((err) => {
      logger.error('ErrorReporting', 'Failed to send message report', err);
    });
  }
}

/**
 * Send error report to custom API endpoint
 */
async function sendToErrorAPI(report: any): Promise<void> {
  try {
    // Replace with your actual error reporting endpoint
    const endpoint = import.meta.env.VITE_ERROR_REPORTING_URL;
    
    if (!endpoint) {
      // No endpoint configured, skip
      return;
    }

    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(report),
    });
  } catch (error) {
    // Silently fail - don't want error reporting to break the app
    logger.warn('ErrorReporting', 'Error reporting API failed', error);
  }
}

/**
 * Store error in unified storage for debugging
 */
async function storeErrorLocally(report: ErrorReport): Promise<void> {
  try {
    const { fileLogger } = await import("../logging/fileLogger");
    await fileLogger.error(report.message, {
      stack: report.stack,
      context: report.context,
      url: report.url,
    });

    // Also store in errors.json for structured access
    const ERROR_LOG_PATH = "errors.json";
    
    // Read existing errors
    const errors = await unifiedStorage.readJSON<ErrorReport[]>(ERROR_LOG_PATH) || [];

    // Add new error
    errors.push(report);

    // Keep only last 10 errors
    const recentErrors = errors.slice(-10);

    // Save back to file
    await unifiedStorage.writeJSON(ERROR_LOG_PATH, recentErrors);
  } catch (error) {
    // Silently fail if storage is unavailable
    logger.warn('ErrorReporting', 'Failed to store error locally', error);
  }
}

/**
 * Get stored errors from unified storage (for debugging)
 */
export async function getStoredErrors(): Promise<ErrorReport[]> {
  try {
    const ERROR_LOG_PATH = "errors.json";
    return await unifiedStorage.readJSON<ErrorReport[]>(ERROR_LOG_PATH) || [];
  } catch (error) {
    logger.error('ErrorReporting', 'Failed to retrieve stored errors', error);
    return [];
  }
}

/**
 * Clear stored errors from unified storage
 */
export async function clearStoredErrors(): Promise<void> {
  try {
    const ERROR_LOG_PATH = "errors.json";
    await unifiedStorage.remove(ERROR_LOG_PATH);
    logger.info('ErrorReporting', 'Stored errors cleared');
  } catch (error) {
    logger.error('ErrorReporting', 'Failed to clear stored errors', error);
  }
}

/**
 * Initialize error reporting (call this in main.tsx)
 */
export function initErrorReporting(): void {
  // Global error handler for unhandled errors
  window.addEventListener("error", (event) => {
    reportError(event.error || new Error(event.message), {
      type: "unhandled_error",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  // Global handler for unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const error = event.reason instanceof Error 
      ? event.reason 
      : new Error(String(event.reason));

    reportError(error, {
      type: "unhandled_rejection",
    });
  });

  logger.info('ErrorReporting', 'Error reporting initialized');
}

/**
 * Example: Sentry initialization (commented out)
 * 
 * To use Sentry:
 * 1. Install: npm install @sentry/react
 * 2. Uncomment and configure below
 * 3. Replace reportError calls with Sentry.captureException
 */

/*
import * as Sentry from "@sentry/react";

export function initSentry(): void {
  if (import.meta.env.PROD) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 1.0,
      integrations: [
        new Sentry.BrowserTracing(),
        new Sentry.Replay(),
      ],
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
  }
}
*/
