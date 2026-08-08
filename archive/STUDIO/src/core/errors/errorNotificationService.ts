import { toast } from 'sonner';

interface ErrorNotification {
  title: string;
  message: string;
  type: 'error' | 'warning' | 'info';
  category?: 'network' | 'storage' | 'api' | 'encryption' | 'general';
}

interface ErrorContext {
  component?: string;
  operation?: string;
  userId?: string;
  timestamp?: Date;
  metadata?: Record<string, any>;
  category?: 'network' | 'storage' | 'api' | 'encryption' | 'general';
}

class ErrorNotificationService {
  private errorLog: Array<{ error: Error; context: ErrorContext; timestamp: Date }> = [];
  private maxLogSize = 100;

  handleError(error: Error | string, context: ErrorContext = {}) {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    const timestamp = new Date();
    this.logError(errorObj, context, timestamp);

    const category = this.categorizeError(errorObj);
    switch (category) {
      case 'network':    this.showNetworkError(errorObj.message);    break;
      case 'storage':    this.showStorageError(errorObj.message);    break;
      case 'api':        this.showAPIError(errorObj.message);        break;
      case 'encryption': this.showEncryptionError(errorObj.message); break;
      default:           this.showGenericError(errorObj.message);
    }
  }

  showAPIConfigurationError() {
    this.showError({ title: "API Not Configured", message: "Please configure your API settings to use cloud features.", type: 'error', category: 'api' });
  }

  showNetworkError(message?: string) {
    this.showError({ title: "Connection Failed", message: message || "Check your internet connection and API configuration.", type: 'error', category: 'network' });
  }

  showStorageError(message?: string) {
    this.showError({ title: "Storage Error", message: message || "Failed to access local storage. Some features may not work properly.", type: 'warning', category: 'storage' });
  }

  showEncryptionError(message?: string) {
    this.showError({ title: "Security Error", message: message || "Failed to encrypt/decrypt sensitive data. Using fallback storage.", type: 'warning', category: 'encryption' });
  }

  showAPIError(message?: string) {
    if (this.isConfigurationError(message || '')) { this.showAPIConfigurationError(); return; }
    this.showError({ title: "API Error", message: message || "API request failed. Please check your configuration.", type: 'error', category: 'api' });
  }

  showTranscriptionError(error: string) {
    if (this.isAPIError(error)) { this.showAPIConfigurationError(); return; }
    this.showError({ title: "Transcription Failed", message: error || "Failed to transcribe audio. Please try again.", type: 'error' });
  }

  showModelLoadingError() {
    this.showError({ title: "No Models Available", message: "Configure your API to access AI models.", type: 'warning', category: 'api' });
  }

  showCORSError() {
    this.showError({ title: "CORS Error", message: "Cross-origin request blocked. Check your API configuration and CORS settings.", type: 'error', category: 'network' });
  }

  showGenericError(message: string) {
    this.showError({ title: "Error", message: message || "An unexpected error occurred.", type: 'error', category: 'general' });
  }

  private showError(notification: ErrorNotification) {
    const message = `${notification.title}: ${notification.message}`;
    if (notification.type === 'error') {
      toast.error(message, { duration: 8000 });
    } else if (notification.type === 'warning') {
      toast.warning(message, { duration: 5000 });
    } else {
      toast.info(message, { duration: 5000 });
    }
  }

  private categorizeError(error: Error): ErrorContext['category'] {
    const msg = error.message.toLowerCase();
    if (msg.includes('cors') || msg.includes('cross-origin')) return 'network';
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('connection')) return 'network';
    if (msg.includes('storage') || msg.includes('tauri') || msg.includes('file')) return 'storage';
    if (msg.includes('encrypt') || msg.includes('decrypt') || msg.includes('aes')) return 'encryption';
    if (msg.includes('api') || msg.includes('unauthorized') || msg.includes('authentication')) return 'api';
    return 'general';
  }

  private isAPIError(error: string): boolean {
    const keywords = ['api not configured', 'no provider', 'unauthorized', 'api key', 'authentication', 'network error', 'fetch failed', 'connection refused'];
    return keywords.some(k => error.toLowerCase().includes(k));
  }

  private isConfigurationError(error: string): boolean {
    const keywords = ['not configured', 'missing api key', 'invalid endpoint', 'configuration required'];
    return keywords.some(k => error.toLowerCase().includes(k));
  }

  private logError(error: Error, context: ErrorContext, timestamp: Date) {
    this.errorLog.push({ error, context, timestamp });
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }
    console.group(`[Error] ${error.name || 'Error'} at ${timestamp.toISOString()}`);
    console.error('Message:', error.message);
    if (error.stack) console.error('Stack:', error.stack);
    if (Object.keys(context).length > 0) console.error('Context:', context);
    console.groupEnd();
  }

  getRecentErrors(count: number = 10) {
    return this.errorLog.slice(-count);
  }

  clearErrorLog() {
    this.errorLog = [];
  }
}

export const errorNotificationService = new ErrorNotificationService();
