/**
 * Network Service
 * Handles network connectivity checks and retry logic
 */

import { apiManager } from "./apiManager";
import { logger } from "../logging/logger";

export interface NetworkStatus {
  isOnline: boolean;
  apiReachable: boolean;
  lastChecked: Date;
}

class NetworkService {
  private checkInterval: number | null = null;
  private listeners: Set<(status: NetworkStatus) => void> = new Set();
  private currentStatus: NetworkStatus = {
    isOnline: navigator.onLine,
    apiReachable: false,
    lastChecked: new Date(),
  };

  constructor() {
    // Listen to browser online/offline events
    window.addEventListener("online", () => this.handleOnlineStatusChange(true));
    window.addEventListener("offline", () => this.handleOnlineStatusChange(false));
  }

  private handleOnlineStatusChange(isOnline: boolean) {
    logger.debug('Network', `Browser online status changed: ${isOnline}`);
    this.currentStatus.isOnline = isOnline;
    this.currentStatus.lastChecked = new Date();
    this.notifyListeners();
  }

  /**
   * Wait for network to be ready with exponential backoff
   * This is crucial for app startup, especially on system boot
   */
  async waitForNetwork(maxAttempts: number = 10, initialDelay: number = 500): Promise<boolean> {
    logger.debug('Network', 'Waiting for network to be ready...');
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Check browser online status first (fast check)
      if (!navigator.onLine) {
        logger.debug('Network', `Attempt ${attempt}/${maxAttempts}: Browser offline, waiting...`);
        await this.delay(initialDelay * Math.pow(1.5, attempt - 1));
        continue;
      }

      // Try to reach the API
      const apiReachable = await this.checkAPIReachability();
      
      if (apiReachable) {
        logger.debug('Network', `Network ready after ${attempt} attempt(s)`);
        this.currentStatus.apiReachable = true;
        this.currentStatus.lastChecked = new Date();
        this.notifyListeners();
        return true;
      }

      // Exponential backoff: 500ms, 750ms, 1125ms, 1687ms, 2531ms, etc.
      const delay = initialDelay * Math.pow(1.5, attempt - 1);
      logger.debug('Network', `Attempt ${attempt}/${maxAttempts}: API not reachable, retrying in ${Math.round(delay)}ms...`);
      await this.delay(delay);
    }

    logger.warn('Network', 'Network not ready after maximum attempts');
    return false;
  }

  /**
   * Check if API is reachable
   */
  async checkAPIReachability(): Promise<boolean> {
    try {
      // Get the health endpoint from API manager
      const endpoints = await apiManager.getEndpoints();
      if (!endpoints.health) {
        logger.debug('Network', 'No API configured');
        this.currentStatus.apiReachable = false;
        this.currentStatus.lastChecked = new Date();
        return false;
      }
      
      // Use a short timeout to fail fast
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(endpoints.health, {
        method: "GET",
        signal: controller.signal,
        // Prevent caching to get real network status
        cache: "no-cache",
        // Don't include auth headers for health check
        headers: {
          "Content-Type": "application/json",
        },
      });

      clearTimeout(timeoutId);
      
      const isReachable = response.ok;
      this.currentStatus.apiReachable = isReachable;
      this.currentStatus.lastChecked = new Date();
      
      logger.debug('Network', `API reachability check: ${isReachable ? 'SUCCESS' : 'FAILED'} (${response.status})`);
      
      return isReachable;
    } catch (error) {
      // Network error, timeout, or abort
      this.currentStatus.apiReachable = false;
      this.currentStatus.lastChecked = new Date();
      
      logger.warn('Network', 'API reachability check failed', error instanceof Error ? error.message : 'Unknown error');
      
      return false;
    }
  }

  /**
   * Get current network status
   */
  getStatus(): NetworkStatus {
    return { ...this.currentStatus };
  }

  /**
   * Subscribe to network status changes
   */
  subscribe(callback: (status: NetworkStatus) => void): () => void {
    this.listeners.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners of status change
   */
  private notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.currentStatus);
      } catch (error) {
        logger.error('Network', 'Error in listener callback', error);
      }
    });
  }

  /**
   * Start periodic network monitoring
   */
  startMonitoring(intervalMs: number = 30000) {
    if (this.checkInterval !== null) {
      return; // Already monitoring
    }

    logger.debug('Network', `Starting network monitoring (every ${intervalMs}ms)`);
    
    this.checkInterval = window.setInterval(async () => {
      await this.checkAPIReachability();
      this.notifyListeners();
    }, intervalMs);
  }

  /**
   * Stop periodic network monitoring
   */
  stopMonitoring() {
    if (this.checkInterval !== null) {
      logger.debug('Network', 'Stopping network monitoring');
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Utility: delay/sleep function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const networkService = new NetworkService();
