/**
 * Tauri Configuration
 * 
 * Hard-coded configuration for the Tauri (desktop) application.
 * 
 * SECURITY NOTES:
 * - API_BASE_URL: Not sensitive - it's just an endpoint address
 * - GOOGLE_CLIENT_ID: Not sensitive - it's a public OAuth client identifier
 * 
 * These values are safe to hard-code because:
 * 1. The actual authentication is handled by OAuth (Google)
 * 2. JWT tokens are issued dynamically by the backend
 * 3. JWTs are stored securely in Tauri secure storage
 * 4. Only whitelisted users can receive JWTs
 */

export const TAURI_CONFIG = {
  /**
   * API Base URL - Clean base without path
   */
  API_BASE_URL: "https://api.pookiepied.dev",
  
  /**
   * Google OAuth Client ID
   * Public identifier for Google OAuth flow
   * This is safe to expose publicly
   */
  GOOGLE_CLIENT_ID: "452277877587-ipd7stb19ji5ehpq7jb6j2q42kqdp3ob.apps.googleusercontent.com",

} as const;

/**
 * API endpoints - Full paths for each feature
 */
export const API_ENDPOINTS = {
  // Auth service (separate worker)
  auth: `https://auth.pookiepied.dev`,

  // Chats storage — routed through the API (service binding to private ChatsStorage worker)
  chats: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/user/chats`,

  // OpenAI-compatible adapter endpoints (for chat, models, etc.)
  adapter: {
    base: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1`,
    chat: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/chat/completions`,
    models: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/models`,
    modes: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/modes`,
    audio: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/audio/transcriptions`,
    speech: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/audio/speech`,
    imageServe: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/images`,
    attachments: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/attachments`,
    mcp: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/mcp`,
    adminModes: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/admin/modes-config`,
    registryManagement: `${TAURI_CONFIG.API_BASE_URL}/studio/gateway/registry`,
    memories: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/user/memories`,
    tracking: {
      summary: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/tracking/summary`,
      usage: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/tracking/usage`,
      logs: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/tracking/logs`,
      credits: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/tracking/credits`,
      me: `${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/tracking/me`,
    },
  },
  
  // System endpoints
  health: `${TAURI_CONFIG.API_BASE_URL}/health`,
  status: `${TAURI_CONFIG.API_BASE_URL}/system/status`,
} as const;
