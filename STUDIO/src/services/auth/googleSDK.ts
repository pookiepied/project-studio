/**
 * Google SDK Manager
 * Singleton to ensure Google SDK is only initialized once
 * Supports both One Tap (desktop) and redirect flow (mobile)
 */

import { logger } from '../logging/logger';
import { isFeatureEnabled } from '../platform/featureManager';

class GoogleSDKManager {
  private isInitialized = false;
  private isLoading = false;
  private initPromise: Promise<void> | null = null;
  private callback: ((response: any) => void) | null = null;
  private clientId: string | null = null;

  /**
   * Initialize Google SDK (only once)
   */
  async initialize(clientId: string, callback: (response: any) => void): Promise<void> {
    this.clientId = clientId;
    
    // If already initialized, just update callback
    if (this.isInitialized) {
      logger.debug('GoogleSDK', 'Already initialized, updating callback');
      this.callback = callback;
      return;
    }

    // If currently loading, wait for it
    if (this.isLoading && this.initPromise) {
      logger.debug('GoogleSDK', 'Already loading, waiting...');
      await this.initPromise;
      this.callback = callback;
      return;
    }

    // Check if we should use redirect flow (mobile)
    if (isFeatureEnabled('googleRedirect')) {
      logger.info('GoogleSDK', 'Mobile detected - using redirect flow');
      this.isInitialized = true;
      this.callback = callback;
      return;
    }

    // Desktop: Use One Tap flow
    this.isLoading = true;
    this.callback = callback;

    this.initPromise = new Promise((resolve, reject) => {
      logger.debug('GoogleSDK', 'Starting One Tap initialization');

      // Check if SDK is already loaded
      if (window.google?.accounts?.id) {
        logger.debug('GoogleSDK', 'SDK already loaded, initializing');
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response: any) => this.handleOneTapCallback(response),
        });
        this.isInitialized = true;
        this.isLoading = false;
        resolve();
        return;
      }

      // Check if script is already in DOM
      const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existingScript) {
        logger.debug('GoogleSDK', 'Script already in DOM, waiting for load');
        
        const checkLoaded = setInterval(() => {
          if (window.google?.accounts?.id) {
            clearInterval(checkLoaded);
            window.google.accounts.id.initialize({
              client_id: clientId,
              callback: (response: any) => this.handleOneTapCallback(response),
            });
            this.isInitialized = true;
            this.isLoading = false;
            resolve();
          }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkLoaded);
          if (!this.isInitialized) {
            this.isLoading = false;
            reject(new Error('Google SDK load timeout'));
          }
        }, 10000);
        return;
      }

      // Load script
      logger.debug('GoogleSDK', 'Loading script');
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;

      script.onload = () => {
        if (!window.google) {
          this.isLoading = false;
          reject(new Error('Google SDK failed to load'));
          return;
        }

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response: any) => this.handleOneTapCallback(response),
        });
        this.isInitialized = true;
        this.isLoading = false;
        logger.info('GoogleSDK', 'Initialized successfully');
        resolve();
      };

      script.onerror = () => {
        this.isLoading = false;
        reject(new Error('Failed to load Google SDK script'));
      };

      document.body.appendChild(script);
    });

    return this.initPromise;
  }

  /**
   * Handle callback from Google SDK (One Tap flow)
   */
  private handleOneTapCallback(response: any) {
    if (this.callback) {
      this.callback(response);
    }
  }

  /**
   * Trigger Google One Tap prompt (desktop only)
   * @param onFallback - Called when One Tap is suppressed/not displayed, use to fall back to redirect
   */
  prompt(onFallback?: () => void) {
    if (isFeatureEnabled('googleRedirect')) {
      logger.warn('GoogleSDK', 'Cannot use prompt on mobile - use redirectToLogin instead');
      return;
    }

    if (window.google?.accounts?.id) {
      window.google.accounts.id.prompt((notification: any) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          logger.info('GoogleSDK', 'One Tap suppressed:',
            notification.getNotDisplayedReason?.() || notification.getSkippedReason?.() || 'unknown reason'
          );
          onFallback?.();
        }
      });
    } else {
      logger.warn('GoogleSDK', 'Cannot prompt - SDK not initialized');
      onFallback?.();
    }
  }

  /**
   * Redirect to Google OAuth (mobile flow)
   */
  redirectToLogin() {
    if (!this.clientId) {
      logger.error('GoogleSDK', 'Cannot redirect - client ID not set');
      return;
    }

    logger.info('GoogleSDK', 'Redirecting to Google OAuth');

    // Build OAuth URL
    const redirectUri = `${window.location.origin}/oauth/callback`;
    const state = this.generateState();
    const nonce = this.generateState();

    // Store state for verification — use localStorage because sessionStorage
    // can be cleared by mobile browsers during cross-origin OAuth redirects
    localStorage.setItem('google_oauth_state', state);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'id_token');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('prompt', 'select_account');

    // Redirect
    window.location.href = authUrl.toString();
  }

  /**
   * Handle OAuth callback (mobile flow)
   */
  handleCallback(hash: string): { idToken: string | null; error: string | null } {
    try {
      // Parse hash fragment
      const params = new URLSearchParams(hash.substring(1));
      
      const idToken = params.get('id_token');
      const state = params.get('state');
      const error = params.get('error');

      // Verify state
      const storedState = localStorage.getItem('google_oauth_state');
      if (state !== storedState) {
        logger.error('GoogleSDK', 'State mismatch - possible CSRF attack');
        return { idToken: null, error: 'State verification failed' };
      }

      // Clear state
      localStorage.removeItem('google_oauth_state');

      if (error) {
        logger.error('GoogleSDK', 'OAuth error:', error);
        return { idToken: null, error };
      }

      if (!idToken) {
        logger.error('GoogleSDK', 'No ID token in callback');
        return { idToken: null, error: 'No ID token received' };
      }

      logger.info('GoogleSDK', 'OAuth callback successful');
      return { idToken, error: null };
    } catch (err) {
      logger.error('GoogleSDK', 'Failed to parse callback', err);
      return { idToken: null, error: 'Failed to parse callback' };
    }
  }

  /**
   * Generate random state for CSRF protection
   */
  private generateState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Check if using redirect flow
   */
  isUsingRedirect(): boolean {
    return isFeatureEnabled('googleRedirect');
  }
}

// Singleton instance
export const googleSDK = new GoogleSDKManager();

// Type declarations
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, config: any) => void;
          prompt: (callback?: (notification: any) => void) => void;
        };
      };
    };
  }
}
