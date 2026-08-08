/**
 * Global Error Handler
 * Catches and processes all unhandled errors in the application
 */

import { errorNotificationService } from './errorNotificationService';
import { logger } from '../logging/logger';

class GlobalErrorHandler {
  private initialized = false;

  /**
   * Initialize global error handling
   */
  initialize() {
    if (this.initialized) return;

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      logger.error('GlobalError', 'Unhandled promise rejection', event.reason);
      
      // Prevent default browser behavior
      event.preventDefault();
      
      // Handle the error through our service
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      errorNotificationService.handleError(error, {
        component: 'global',
        operation: 'unhandled_promise_rejection'
      });
    });

    // Handle uncaught JavaScript errors
    window.addEventListener('error', (event) => {
      logger.error('GlobalError', 'Uncaught error', event.error);
      
      const error = event.error instanceof Error ? event.error : new Error(event.message);
      errorNotificationService.handleError(error, {
        component: 'global',
        operation: 'uncaught_error',
        metadata: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        }
      });
    });

    // Handle React error boundary errors (if using React 18+)
    if (typeof window !== 'undefined' && 'reportError' in window) {
      const originalReportError = window.reportError;
      window.reportError = (error: any) => {
        logger.error('GlobalError', 'React error boundary', error);
        
        const errorObj = error instanceof Error ? error : new Error(String(error));
        errorNotificationService.handleError(errorObj, {
          component: 'react',
          operation: 'error_boundary'
        });
        
        // Call original function
        originalReportError.call(window, error);
      };
    }

    this.initialized = true;
    logger.info('GlobalError', 'Global error handler initialized');
  }

  /**
   * Manually report an error
   */
  reportError(error: Error | string, context?: {
    component?: string;
    operation?: string;
    metadata?: Record<string, any>;
  }) {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    errorNotificationService.handleError(errorObj, context || {});
  }

  /**
   * Create a wrapper for async functions to catch errors
   */
  wrapAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    context?: { component?: string; operation?: string }
  ): T {
    return (async (...args: Parameters<T>) => {
      try {
        return await fn(...args);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        this.reportError(errorObj, context);
        throw error; // Re-throw to maintain original behavior
      }
    }) as T;
  }

  /**
   * Create a wrapper for sync functions to catch errors
   */
  wrapSync<T extends (...args: any[]) => any>(
    fn: T,
    context?: { component?: string; operation?: string }
  ): T {
    return ((...args: Parameters<T>) => {
      try {
        return fn(...args);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        this.reportError(errorObj, context);
        throw error; // Re-throw to maintain original behavior
      }
    }) as T;
  }
}

export const globalErrorHandler = new GlobalErrorHandler();