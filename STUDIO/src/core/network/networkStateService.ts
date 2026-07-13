/**
 * Network State Management Service
 * Handles connectivity monitoring and graceful degradation
 */

import { logger } from '../logging/logger';

interface NetworkState {
  isOnline: boolean;
  isConnecting: boolean;
  lastConnected: number | null;
  connectionQuality: "excellent" | "good" | "poor" | "offline";
  retryCount: number;
  maxRetries: number;
}

interface NetworkStateListener {
  onStateChange: (state: NetworkState) => void;
  onConnectionLost: () => void;
  onConnectionRestored: () => void;
}

class NetworkStateManager {
  private state: NetworkState = {
    isOnline: navigator.onLine,
    isConnecting: false,
    lastConnected: navigator.onLine ? Date.now() : null,
    connectionQuality: "excellent",
    retryCount: 0,
    maxRetries: 3
  };

  private listeners: Set<NetworkStateListener> = new Set();
  private healthCheckInterval: number | null = null;
  private reconnectTimeout: number | null = null;
  private qualityCheckInterval: number | null = null;

  constructor() {
    this.setupEventListeners();
    this.startHealthCheck();
    this.startQualityMonitoring();
  }

  /**
   * Setup browser network event listeners
   */
  private setupEventListeners(): void {
    window.addEventListener("online", this.handleOnline.bind(this));
    window.addEventListener("offline", this.handleOffline.bind(this));
    
    // Listen for visibility changes to check connection when tab becomes active
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.checkConnection();
      }
    });
  }

  /**
   * Handle online event
   */
  private handleOnline(): void {
    logger.debug('Network', 'Browser reports online');
    this.updateState({
      isOnline: true,
      lastConnected: Date.now(),
      retryCount: 0
    });
    
    // Verify actual connectivity
    this.checkConnection();
    
    this.notifyListeners("onConnectionRestored");
  }

  /**
   * Handle offline event
   */
  private handleOffline(): void {
    logger.debug('Network', 'Browser reports offline');
    this.updateState({
      isOnline: false,
      connectionQuality: "offline"
    });
    
    this.notifyListeners("onConnectionLost");
    this.scheduleReconnect();
  }

  /**
   * Check actual network connectivity
   */
  async checkConnection(): Promise<boolean> {
    try {
      // Use a lightweight endpoint to check connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch("/api/health", {
        method: "HEAD",
        signal: controller.signal,
        cache: "no-cache"
      });
      
      clearTimeout(timeoutId);
      
      const isConnected = response.ok;
      const quality = this.assessConnectionQuality(response);
      
      this.updateState({
        isOnline: isConnected,
        connectionQuality: quality,
        lastConnected: isConnected ? Date.now() : this.state.lastConnected,
        retryCount: isConnected ? 0 : this.state.retryCount
      });
      
      return isConnected;
    } catch (error) {
      logger.warn('Network', 'Connection check failed', error);
      
      this.updateState({
        isOnline: false,
        connectionQuality: "offline"
      });
      
      return false;
    }
  }

  /**
   * Assess connection quality based on response time
   */
  private assessConnectionQuality(response: Response): NetworkState["connectionQuality"] {
    // This is a simplified quality assessment
    // In a real implementation, you'd measure actual response times
    
    if (!response.ok) return "offline";
    
    // For now, assume good quality if we get a response
    // Could be enhanced with actual timing measurements
    return "good";
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = window.setInterval(() => {
      if (this.state.isOnline) {
        this.checkConnection();
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Start connection quality monitoring
   */
  private startQualityMonitoring(): void {
    this.qualityCheckInterval = window.setInterval(() => {
      if (this.state.isOnline) {
        this.measureConnectionQuality();
      }
    }, 60000); // Check quality every minute
  }

  /**
   * Measure connection quality with timing
   */
  private async measureConnectionQuality(): Promise<void> {
    try {
      const startTime = performance.now();
      const response = await fetch("/api/health", {
        method: "HEAD",
        cache: "no-cache"
      });
      const endTime = performance.now();
      
      const responseTime = endTime - startTime;
      let quality: NetworkState["connectionQuality"];
      
      if (!response.ok) {
        quality = "offline";
      } else if (responseTime < 200) {
        quality = "excellent";
      } else if (responseTime < 1000) {
        quality = "good";
      } else {
        quality = "poor";
      }
      
      this.updateState({ connectionQuality: quality });
    } catch (error) {
      this.updateState({ connectionQuality: "poor" });
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.state.retryCount >= this.state.maxRetries) {
      logger.debug('Network', 'Max retries reached, stopping reconnection attempts');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.state.retryCount), 30000); // Exponential backoff, max 30s
    
    logger.debug('Network', `Scheduling reconnection attempt ${this.state.retryCount + 1} in ${delay}ms`);
    
    this.reconnectTimeout = window.setTimeout(async () => {
      this.updateState({
        isConnecting: true,
        retryCount: this.state.retryCount + 1
      });
      
      const connected = await this.checkConnection();
      
      this.updateState({ isConnecting: false });
      
      if (!connected) {
        this.scheduleReconnect();
      } else {
        this.notifyListeners("onConnectionRestored");
      }
    }, delay);
  }

  /**
   * Update internal state and notify listeners
   */
  private updateState(updates: Partial<NetworkState>): void {
    const previousState = { ...this.state };
    this.state = { ...this.state, ...updates };
    
    // Notify listeners of state change
    this.listeners.forEach(listener => {
      try {
        listener.onStateChange(this.state);
      } catch (error) {
        logger.error('Network', 'Listener error', error);
      }
    });
    
    // Log significant state changes
    if (previousState.isOnline !== this.state.isOnline) {
      logger.info('Network', `State changed: ${previousState.isOnline ? "online" : "offline"} -> ${this.state.isOnline ? "online" : "offline"}`);
    }
  }

  /**
   * Notify listeners of specific events
   */
  private notifyListeners(event: "onConnectionLost" | "onConnectionRestored"): void {
    this.listeners.forEach(listener => {
      try {
        listener[event]?.();
      } catch (error) {
        logger.error('Network', `Listener ${event} error`, error);
      }
    });
  }

  /**
   * Add network state listener
   */
  addListener(listener: NetworkStateListener): () => void {
    this.listeners.add(listener);
    
    // Immediately notify of current state
    listener.onStateChange(this.state);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current network state
   */
  getState(): NetworkState {
    return { ...this.state };
  }

  /**
   * Force connection check
   */
  async forceCheck(): Promise<boolean> {
    return this.checkConnection();
  }

  /**
   * Check if we can make network requests
   */
  canMakeRequests(): boolean {
    return this.state.isOnline && !this.state.isConnecting;
  }

  /**
   * Get offline duration in milliseconds
   */
  getOfflineDuration(): number | null {
    if (this.state.isOnline || !this.state.lastConnected) {
      return null;
    }
    
    return Date.now() - this.state.lastConnected;
  }

  /**
   * Check if we should use offline mode
   */
  shouldUseOfflineMode(): boolean {
    const offlineDuration = this.getOfflineDuration();
    
    // Use offline mode if we've been offline for more than 10 seconds
    // or if we've exceeded retry attempts
    return !this.state.isOnline && (
      (offlineDuration !== null && offlineDuration > 10000) ||
      this.state.retryCount >= this.state.maxRetries
    );
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.qualityCheckInterval) {
      clearInterval(this.qualityCheckInterval);
    }
    
    window.removeEventListener("online", this.handleOnline.bind(this));
    window.removeEventListener("offline", this.handleOffline.bind(this));
    
    this.listeners.clear();
  }
}

export const networkStateManager = new NetworkStateManager();
