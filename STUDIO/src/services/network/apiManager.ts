/**
 * API Manager Service
 * Handles dynamic API endpoint switching and configuration
 */

import { environmentService } from '../platform/environmentService';
import { logger } from '../logging/logger';
import { TAURI_CONFIG, API_ENDPOINTS } from '../../config/tauriConfig';

interface APIEndpoints {
  auth: string;
  chats: string;
  chat: string;
  models: string;
  modes: string;
  audio: string;
  health: string;
  memories: string;
  mcp: string;
  adminModes: string;
  tracking: {
    summary: string;
    usage: string;
    logs: string;
    credits: string;
    me: string;
  };
}

class APIManager {
  private currentConfig: {
    baseUrl: string;
    jwtSecret?: string;
    customClientId?: string;
  } | null = null;

  /**
   * Get current API configuration
   */
  async getConfig() {
    if (this.currentConfig) {
      return this.currentConfig;
    }

    // For web version, use environment variables
    if (environmentService.isWeb()) {
      const webApiUrl = import.meta.env.VITE_API_BASE_URL;
      
      if (webApiUrl) {
        this.currentConfig = {
          baseUrl: webApiUrl
          // No jwtSecret - web version uses JWT tokens only
        };
        logger.info('APIManager', 'Using web environment API (JWT-only):', webApiUrl);
        return this.currentConfig;
      } else {
        logger.error('APIManager', 'Web API URL not configured');
        throw new Error('VITE_API_BASE_URL not configured for web version');
      }
    }

    // For Tauri version, use hard-coded configuration
    // This is secure because:
    // - API URL is not sensitive (just an endpoint address)
    // - Authentication is handled by OAuth (Google)
    // - JWTs are issued dynamically by the backend
    // - Tokens are stored securely in Tauri secure storage
    this.currentConfig = {
      baseUrl: TAURI_CONFIG.API_BASE_URL,
      customClientId: TAURI_CONFIG.GOOGLE_CLIENT_ID
    };
    
    logger.info('APIManager', 'Using hard-coded Tauri config:', TAURI_CONFIG.API_BASE_URL);
    return this.currentConfig;
  }

  /**
   * Get API endpoints for current configuration
   */
  async getEndpoints(): Promise<APIEndpoints> {
    // For Tauri, use pre-defined endpoints from config
    if (environmentService.isTauri()) {
      return {
        auth: API_ENDPOINTS.auth,
        chats: API_ENDPOINTS.chats,
        chat: API_ENDPOINTS.adapter.chat,
        models: API_ENDPOINTS.adapter.models,
        modes: API_ENDPOINTS.adapter.modes,
        audio: API_ENDPOINTS.adapter.audio,
        health: API_ENDPOINTS.health,
        memories: API_ENDPOINTS.adapter.memories,
        mcp: API_ENDPOINTS.adapter.mcp,
        adminModes: API_ENDPOINTS.adapter.adminModes,
        tracking: API_ENDPOINTS.adapter.tracking,
      };
    }

    // For web, use dynamic config
    const config = await this.getConfig();

    if (!config.baseUrl) {
      // Return empty endpoints if no API is configured
      const empty = { summary: "", usage: "", logs: "", credits: "", me: "" };
      return {
        auth: "",
        chats: "",
        chat: "",
        models: "",
        modes: "",
        audio: "",
        health: "",
        memories: "",
        mcp: "",
        adminModes: "",
        tracking: empty,
      };
    }

    const baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    const trackingBase = `${baseUrl}/adapters/openai/v1/tracking`;

    // Auth and chats are on separate domains
    return {
      auth: 'https://auth.pookiepied.dev',
      chats: `${baseUrl}/adapters/openai/v1/user/chats`,
      chat: `${baseUrl}/adapters/openai/v1/chat/completions`,
      models: `${baseUrl}/adapters/openai/v1/models`,
      modes: `${baseUrl}/adapters/openai/v1/modes`,
      audio: `${baseUrl}/adapters/openai/v1/audio/transcriptions`,
      health: `${baseUrl}/health`,
      memories: `${baseUrl}/adapters/openai/v1/user/memories`,
      mcp: `${baseUrl}/adapters/openai/v1/mcp`,
      adminModes: `${baseUrl}/adapters/openai/v1/admin/modes-config`,
      tracking: {
        summary: `${trackingBase}/summary`,
        usage: `${trackingBase}/usage`,
        logs: `${trackingBase}/logs`,
        credits: `${trackingBase}/credits`,
        me: `${trackingBase}/me`,
      },
    };
  }

  /**
   * Make authenticated API request
   * Note: For Tauri, we don't add JWT secret to requests - 
   * JWT is handled via Authorization header set by the token manager
   */
  async makeRequest(endpoint: string, options: RequestInit = {}) {
    // Add default headers
    options.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const response = await fetch(endpoint, options);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Reset configuration (force reload on next request)
   */
  resetConfig() {
    this.currentConfig = null;
  }

  async getGoogleClientId(): Promise<string> {
    // For web version, use environment variable (required for web)
    if (environmentService.isWeb()) {
      const webClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      if (webClientId) {
        return webClientId;
      } else {
        logger.error('APIManager', 'VITE_GOOGLE_CLIENT_ID not configured for web version');
        throw new Error('Google Client ID not configured for web version');
      }
    }

    // For Tauri version, use hard-coded client ID
    return TAURI_CONFIG.GOOGLE_CLIENT_ID;
  }

  /**
   * Check if API is configured
   */
  async isConfigured(): Promise<boolean> {
    // For web version, check if API URL and Google Client ID are set
    if (environmentService.isWeb()) {
      return !!(
        import.meta.env.VITE_API_BASE_URL && 
        import.meta.env.VITE_GOOGLE_CLIENT_ID
      );
    }

    // For Tauri version, API is always configured via hard-coded config
    return true;
  }

}

export const apiManager = new APIManager();