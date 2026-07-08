/**
 * Tauri OAuth Service
 * 
 * Handles OAuth flow for Tauri by opening system browser
 * and using a local HTTP server to receive the callback
 */

import { invoke } from "@tauri-apps/api/core";
import { apiManager } from "../network/apiManager";
import { logger } from "../logging/logger";

/**
 * Get the Google Client ID from API manager
 */
async function getGoogleClientId(): Promise<string> {
  return await apiManager.getGoogleClientId();
}

interface OAuthResult {
  success: boolean;
  idToken?: string;
  error?: string;
}

/**
 * Start OAuth flow by opening system browser
 * Uses localhost callback server
 */
export async function startGoogleOAuth(): Promise<OAuthResult> {
  return new Promise((resolve) => {
    const runOAuth = async () => {
    try {
      // Generate state for CSRF protection
      const state = generateRandomState();
      
      // Store state for verification
      sessionStorage.setItem('oauth_state', state);
      
      // Use localhost callback (works with Google OAuth)
      const redirectUri = 'http://localhost:8765/oauth/callback';
      const scope = 'openid email profile';
      
      const clientId = await getGoogleClientId();
      
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'id_token');
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('nonce', generateRandomState());
      authUrl.searchParams.set('prompt', 'select_account');
      
      logger.debug('OAuth', 'Starting callback server first...');
      
      // Start server FIRST in background
      const serverPromise = invoke<string>('start_oauth_server', { state });
      
      // Wait longer for server to fully start and be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      logger.debug('OAuth', 'Server should be ready, now opening browser...');
      
      // Then open browser
      await invoke('plugin:opener|open_url', { url: authUrl.toString() });
      
      logger.debug('OAuth', 'Browser opened, waiting for callback...');
      
      // Wait for server to receive callback
      try {
        const result = await serverPromise;
        
        logger.debug('OAuth', 'Received callback from server');
        logger.debug('OAuth', 'Raw result', result);
        
        // Parse result
        const callbackData = JSON.parse(result);
        logger.debug('OAuth', 'Parsed callback data', callbackData);
        
        // Clean up
        sessionStorage.removeItem('oauth_state');
        
        if (callbackData.error) {
          logger.error('OAuth', 'Error from provider', callbackData.error);
          
          // Notify callback page of error
          try {
            localStorage.setItem('oauth_result', JSON.stringify({
              success: false,
              error: callbackData.error
            }));
          } catch (e) {
            logger.warn('OAuth', 'Could not set localStorage', e);
          }
          
          resolve({ success: false, error: callbackData.error });
          return;
        }
        
        if (!callbackData.id_token) {
          logger.error('OAuth', 'No ID token received');
          
          // Notify callback page of error
          try {
            localStorage.setItem('oauth_result', JSON.stringify({
              success: false,
              error: 'No authentication token received'
            }));
          } catch (e) {
            logger.warn('OAuth', 'Could not set localStorage', e);
          }
          
          resolve({ success: false, error: 'No authentication token received' });
          return;
        }
        
        logger.info('OAuth', 'Successfully received ID token');
        resolve({ success: true, idToken: callbackData.id_token });
        
      } catch (error) {
        logger.error('OAuth', 'Server error', error);
        sessionStorage.removeItem('oauth_state');
        
        // Notify callback page of error
        try {
          localStorage.setItem('oauth_result', JSON.stringify({
            success: false,
            error: 'Failed to receive authentication response'
          }));
        } catch (e) {
          logger.warn('OAuth', 'Could not set localStorage', e);
        }
        
        resolve({ success: false, error: 'Failed to receive authentication response' });
      }
      
    } catch (error) {
      logger.error('OAuth', 'Failed to start OAuth flow', error);
      
      // Notify callback page of error
      try {
        localStorage.setItem('oauth_result', JSON.stringify({
          success: false,
          error: 'Failed to open browser for authentication'
        }));
      } catch (e) {
        logger.warn('OAuth', 'Could not set localStorage', e);
      }
      
      resolve({ success: false, error: 'Failed to open browser for authentication' });
    }
    };

    runOAuth();
  });
}

/**
 * Generate random state for CSRF protection
 */
function generateRandomState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

