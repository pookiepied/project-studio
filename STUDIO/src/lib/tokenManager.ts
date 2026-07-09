/**
 * Token Manager
 * Handles JWT token storage and refresh logic
 * 
 * Security:
 * - Uses encrypted storage for web (AES-256-GCM encryption)
 * - Uses Tauri secure storage for desktop
 * - Automatic token refresh before expiry
 * - Token rotation on refresh (old tokens invalidated)
 * - No localStorage fallback for sensitive data
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/core/logging/logger";
import { encryptData, decryptData } from "../core/storage/secureStorage";
import { isFeatureEnabled } from "@/core/platform/featureManager";
import { STORAGE_KEYS, TOKEN_LIMITS } from "@/core/config/constants";
import type { AccessTokenPayload, RefreshTokenPayload } from "@/types";

const ACCESS_TOKEN_KEY = STORAGE_KEYS.ACCESS_TOKEN;
const REFRESH_TOKEN_KEY = STORAGE_KEYS.REFRESH_TOKEN;
const USER_INFO_KEY = STORAGE_KEYS.USER_INFO;
const TOKEN_REFRESH_THRESHOLD = TOKEN_LIMITS.TOKEN_REFRESH_THRESHOLD;

// Storage type indicators
const STORAGE_TYPE_ENCRYPTED = "encrypted_v1";
const STORAGE_TYPE_TAURI = "tauri_secure";

interface TokenPayload {
  sub: string;
  type: "access" | "refresh";
  iat: number;
  exp: number;
  jti?: string;
}

interface UserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
}

/**
 * Decode JWT without verification (just to read claims).
 * Handles both standard base64 and base64url encoding (RFC 7515).
 */
function decodeToken(token: string): TokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64: replace - with + and _ with /, then pad to multiple of 4
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Check if token is expired or about to expire
 */
function isTokenExpiringSoon(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  
  const expiryTime = payload.exp * 1000; // Convert to milliseconds
  const now = Date.now();
  
  return expiryTime - now < TOKEN_REFRESH_THRESHOLD;
}

/**
 * Store data securely (encrypted for web, Tauri secure storage for desktop)
 * SECURITY: No fallback to localStorage for sensitive data
 */
async function storeSecureData(key: string, value: string): Promise<void> {
  if (isFeatureEnabled('secureStorage')) {
    try {
      await invoke("store_secure", { key, value });
      logger.debug('TokenManager', `Stored ${key} in Tauri secure storage`);
    } catch (error) {
      logger.error('TokenManager', `Failed to store ${key} in Tauri secure storage`, error);
      // SECURITY FIX: No fallback to localStorage - fail securely
      throw new Error(`Secure storage failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    // Web version: Use encrypted storage with strong warning
    try {
      const encrypted = await encryptData(value);
      const storageData = {
        type: STORAGE_TYPE_ENCRYPTED,
        data: encrypted,
        timestamp: Date.now()
      };
      localStorage.setItem(key, JSON.stringify(storageData));
      logger.warn('TokenManager', `Stored encrypted ${key} in localStorage - web version has reduced security`);
    } catch (error) {
      logger.error('TokenManager', `Failed to encrypt and store ${key}`, error);
      // SECURITY FIX: Fail securely instead of storing unencrypted
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Retrieve data securely (decrypt for web, Tauri secure storage for desktop)
 */
async function getSecureData(key: string): Promise<string | null> {
  if (isFeatureEnabled('secureStorage')) {
    try {
      const value = await invoke<string>("get_secure", { key });
      if (value) {
        logger.debug('TokenManager', `Retrieved ${key} from Tauri secure storage`);
        return value;
      }
      return null;
    } catch (error) {
      logger.warn('TokenManager', `Failed to retrieve ${key} from Tauri secure storage`, error);
      return null;
    }
  } else {
    try {
      const storedData = localStorage.getItem(key);
      if (!storedData) {
        return null;
      }

      const parsed = JSON.parse(storedData);
      
      // Handle legacy unencrypted data (migrate to encrypted)
      if (typeof parsed === 'string') {
        logger.warn('TokenManager', `Found legacy unencrypted ${key}, migrating to encrypted storage`);
        await storeSecureData(key, parsed);
        return parsed;
      }

      // Handle encrypted data
      if (parsed.type === STORAGE_TYPE_ENCRYPTED && parsed.data) {
        const decrypted = await decryptData(parsed.data);
        logger.debug('TokenManager', `Retrieved and decrypted ${key} from localStorage`);
        return decrypted;
      }

      logger.warn('TokenManager', `Unknown storage format for ${key}`);
      return null;
    } catch (error) {
      logger.error('TokenManager', `Failed to retrieve and decrypt ${key}`, error);
      return null;
    }
  }
}

/**
 * Remove data securely
 * Includes fallback from delete_secure to remove_secure for compatibility
 */
async function removeSecureData(key: string): Promise<void> {
  if (isFeatureEnabled('secureStorage')) {
    try {
      await invoke("delete_secure", { key });
      logger.debug('TokenManager', `Removed ${key} from Tauri secure storage`);
    } catch (error) {
      // Fallback to remove_secure if delete_secure doesn't exist
      try {
        await invoke("remove_secure", { key });
        logger.debug('TokenManager', `Removed ${key} from Tauri secure storage (via remove_secure)`);
      } catch (fallbackError) {
        // Both commands failed — throw so clearTokens() knows the token was NOT removed.
        logger.error('TokenManager', `Failed to remove ${key} from Tauri secure storage`, fallbackError);
        throw new Error(`Could not remove ${key} from secure storage`);
      }
    }
  } else {
    localStorage.removeItem(key);
    logger.debug('TokenManager', `Removed ${key} from localStorage`);
  }
}
/**
 * Store tokens securely
 */
async function storeTokens(accessToken: string, refreshToken: string | null, userInfo?: UserInfo): Promise<void> {
  try {
    await storeSecureData(ACCESS_TOKEN_KEY, accessToken);
    
    // Only store refresh token if it's not null
    if (refreshToken) {
      await storeSecureData(REFRESH_TOKEN_KEY, refreshToken);
    }
    
    if (userInfo) {
      await storeSecureData(USER_INFO_KEY, JSON.stringify(userInfo));
    }
    
    logger.info('TokenManager', 'Tokens stored securely');
  } catch (error) {
    logger.error('TokenManager', 'Failed to store tokens securely', error);
    throw error;
  }
}

/**
 * Get access token
 */
async function getAccessToken(): Promise<string | null> {
  return await getSecureData(ACCESS_TOKEN_KEY);
}

/**
 * Get refresh token
 */
async function getRefreshToken(): Promise<string | null> {
  return await getSecureData(REFRESH_TOKEN_KEY);
}

/**
 * Clear all tokens (logout). Throws if any token could not be removed,
 * so callers know the logout was not fully clean.
 */
async function clearTokens(): Promise<void> {
  const errors: string[] = [];

  for (const key of [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_INFO_KEY]) {
    try {
      await removeSecureData(key);
    } catch (error) {
      errors.push(key);
      logger.error('TokenManager', `Failed to clear ${key}`, error);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Logout incomplete — could not remove: ${errors.join(', ')}`);
  }

  logger.info('TokenManager', 'All tokens cleared');
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    logger.warn('TokenManager', 'No refresh token available');
    return null;
  }
  
  try {
    const { apiManager } = await import("@/core/network/apiManager");
    const endpoints = await apiManager.getEndpoints();
    
    if (!endpoints.auth) {
      logger.error('TokenManager', 'No API configured for token refresh');
      return null;
    }
    
    const response = await fetch(`${endpoints.auth}/refresh`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        // Send refresh token in body for desktop app compatibility
        // This follows OAuth 2.0 token refresh for native apps
        "Accept": "application/json"
      },
      body: JSON.stringify({ refreshToken }),
      // Note: For desktop apps, we send token in body (not cookies)
      // The auth worker should accept this format for non-browser clients
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('TokenManager', 'Token refresh failed', {
        status: response.status,
        error: errorText
      });
      // 401 = refresh token is invalid/expired (e.g. secret rotated) — clear tokens so
      // the app transitions to unauthenticated state instead of looping on 401 forever.
      if (response.status === 401) {
        await clearTokens();
      }
      return null;
    }
    
    const data = await response.json();
    
    // Store new tokens (token rotation - old refresh token is now invalid)
    await storeTokens(data.accessToken, data.refreshToken);
    
    logger.info('TokenManager', 'Tokens refreshed successfully');
    return data.accessToken;
  } catch (error) {
    logger.error('TokenManager', 'Token refresh error', error);
    await clearTokens();
    return null;
  }
}

/**
 * Get valid access token (auto-refresh if needed)
 */
async function getValidAccessToken(): Promise<string | null> {
  let accessToken = await getAccessToken();
  
  if (!accessToken) {
    logger.warn('TokenManager', 'No access token found');
    return null;
  }
  
  // Check if token is expiring soon
  if (isTokenExpiringSoon(accessToken)) {
    logger.debug('TokenManager', 'Access token expiring soon, refreshing');
    accessToken = await refreshAccessToken();
  }
  
  return accessToken;
}

/**
 * Get the current user's ID directly from the JWT sub claim.
 * More reliable than getStoredUserInfo() — works even after token refresh
 * (which doesn't re-store userInfo).
 */
async function getUserId(): Promise<string | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  const payload = decodeToken(accessToken);
  return payload?.sub ?? null;
}

/**
 * Get user info from access token
 */
async function getUserInfo(): Promise<{ email: string } | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  
  const payload = decodeToken(accessToken);
  if (!payload) return null;
  
  // Check access token for email first
  const accessPayload = payload as AccessTokenPayload & { email?: string };
  if (accessPayload.email) {
    return { email: accessPayload.email };
  }
  
  // Fallback: check refresh token for email
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    const refreshPayload = decodeToken(refreshToken);
    const refreshTyped = refreshPayload as RefreshTokenPayload & { email?: string };
    if (refreshTyped?.email) {
      return { email: refreshTyped.email };
    }
  }
  
  // Final fallback: use sub (user ID) - less ideal
  return { email: (payload as any).email || payload.sub };
}

/**
 * Check if user is authenticated
 */
async function isAuthenticated(): Promise<boolean> {
  const accessToken = await getAccessToken();
  const refreshToken = await getRefreshToken();
  
  // Must have at least an access token
  if (!accessToken) return false;
  
  // Try to decode the token
  const payload = decodeToken(accessToken);
  
  if (!payload) {
    // If we can't decode, assume it's a valid non-JWT token (like the one from your API)
    // Check if we have a refresh token
    if (refreshToken) {
      const refreshPayload = decodeToken(refreshToken);
      if (refreshPayload) {
        const refreshExpiry = refreshPayload.exp * 1000;
        const now = Date.now();
        if (refreshExpiry <= now) return false;
      }
    }
    // If we can't decode but have an access token, consider it valid
    // This handles cases where the token is not a JWT (like "fake" tokens or opaque tokens)
    return true;
  }
  
  // It's a JWT, check expiration
  const accessExpiry = payload.exp * 1000;
  const now = Date.now();
  
  if (accessExpiry <= now) {
    // Token expired - check if refresh token can help
    if (refreshToken) {
      const refreshPayload = decodeToken(refreshToken);
      if (refreshPayload) {
        const refreshExpiry = refreshPayload.exp * 1000;
        if (refreshExpiry > now) return true;
      }
    }
    return false;
  }
  
  return true;
}

/**
 * Get stored user info
 */
async function getStoredUserInfo(): Promise<UserInfo | null> {
  try {
    const userInfoStr = await getSecureData(USER_INFO_KEY);
    return userInfoStr ? JSON.parse(userInfoStr) : null;
  } catch (error) {
    logger.error('TokenManager', 'Failed to get stored user info', error);
    return null;
  }
}

/**
 * Get storage security information for debugging
 */
async function getStorageSecurityInfo(): Promise<{
  platform: 'tauri' | 'web';
  storageType: string;
  encryptionEnabled: boolean;
  tokensPresent: {
    accessToken: boolean;
    refreshToken: boolean;
    userInfo: boolean;
  };
}> {
  const platform = isFeatureEnabled('secureStorage') ? 'tauri' : 'web';
  
  const tokensPresent = {
    accessToken: (await getAccessToken()) !== null,
    refreshToken: (await getRefreshToken()) !== null,
    userInfo: (await getStoredUserInfo()) !== null,
  };

  if (platform === 'tauri') {
    return {
      platform,
      storageType: STORAGE_TYPE_TAURI,
      encryptionEnabled: true,
      tokensPresent,
    };
  } else {
    // Check if we have encrypted storage
    const accessTokenData = localStorage.getItem(ACCESS_TOKEN_KEY);
    let encryptionEnabled = false;
    let storageType = 'localStorage_plain';

    if (accessTokenData) {
      try {
        const parsed = JSON.parse(accessTokenData);
        if (parsed.type === STORAGE_TYPE_ENCRYPTED) {
          encryptionEnabled = true;
          storageType = STORAGE_TYPE_ENCRYPTED;
        }
      } catch {
        // Legacy plain text storage
      }
    }

    return {
      platform,
      storageType,
      encryptionEnabled,
      tokensPresent,
    };
  }
}

export const tokenManager = {
  storeTokens,
  getAccessToken: getValidAccessToken, // Always returns valid token or null (auto-refreshes)
  getRawAccessToken: getAccessToken,   // Returns stored token without auto-refresh (use at logout)
  getRefreshToken,
  clearTokens,
  refreshAccessToken,
  getUserId,
  getUserInfo,
  getStoredUserInfo,
  isAuthenticated,
  getStorageSecurityInfo,
};
