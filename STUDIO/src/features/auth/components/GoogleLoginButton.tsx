/**
 * Google Login Button
 * 
 * Handles Google OAuth flow for both web and Tauri
 * - Web: Uses Google's popup flow
 * - Tauri: Opens system browser and handles deep link callback
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/features/auth/context/AuthContext";
import { Button } from "@/ui/primitives/Button";
import { Error } from "@/ui/icons";
import { apiManager } from "@/core/network/apiManager";
import { environmentService } from "@/core/platform/environmentService";
import { googleSDK } from "@/features/auth/services/googleSDK";
import { isFeatureEnabled } from "@/core/platform/featureManager";
import { logger } from "@/core/logging/logger";

let tauriOAuth: typeof import("@/features/auth/services/tauriOAuth") | null = null;

interface GoogleLoginButtonProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export const GoogleLoginButton = ({ onSuccess, onError }: GoogleLoginButtonProps) => {
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [hasAPIConfigured, setHasAPIConfigured] = useState(false);
  const [checkingAPI, setCheckingAPI] = useState(true);
  
  const isTauri = environmentService.isTauri();
  const useOneTap = isFeatureEnabled('googleOneTap');
  const useRedirect = isFeatureEnabled('googleRedirect');

  // Check API configuration
  useEffect(() => {
    const checkAPI = async () => {
      try {
        const hasAPI = await apiManager.isConfigured();
        setHasAPIConfigured(hasAPI);
        
      } catch (error) {
        logger.error('GoogleLoginButton', 'Failed to check API core/config', error);
        setHasAPIConfigured(false);
      } finally {
        setCheckingAPI(false);
      }
    };

    checkAPI();
  }, [isTauri]);

  // Get Google Client ID from API manager
  const getClientId = async () => {
    return await apiManager.getGoogleClientId();
  };

  const handleGoogleResponse = async (response: any) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await login(response.credential);
      
      if (result.success) {
        onSuccess?.();
      } else {
        // Handle specific error types
        let errorMsg = result.error || "Login failed";
        
        // Check for whitelist error
        if (errorMsg.toLowerCase().includes('whitelist') || 
            errorMsg.toLowerCase().includes('access denied') ||
            errorMsg.toLowerCase().includes('not authorized')) {
          errorMsg = "Access denied. Your email is not authorized.";
        }
        
        setError(errorMsg);
        onError?.(errorMsg);
      }
    } catch (err) {
      const errorMsg = "An unexpected error occurred";
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Tauri OAuth flow
  const handleTauriLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (!tauriOAuth) {
        tauriOAuth = await import("@/features/auth/services/tauriOAuth");
      }
      
      const result = await tauriOAuth.startGoogleOAuth();
      
      if (result.success && result.idToken) {
        const loginResult = await login(result.idToken);
        
        if (loginResult.success) {
          // Notify callback page of success
          try {
            localStorage.setItem('oauth_result', JSON.stringify({
              success: true
            }));
          } catch (e) {
            logger.warn('Login', 'Could not set localStorage', e);
          }
          
          onSuccess?.();
        } else {
          // Handle specific error types
          let errorMsg = loginResult.error || "Login failed";
          
          // Check for whitelist error
          if (errorMsg.toLowerCase().includes('whitelist') || 
              errorMsg.toLowerCase().includes('access denied') ||
              errorMsg.toLowerCase().includes('not authorized')) {
            errorMsg = "Access denied. Your email is not authorized.";
          }
          
          // Notify callback page of error
          try {
            localStorage.setItem('oauth_result', JSON.stringify({
              success: false,
              error: errorMsg
            }));
          } catch (e) {
            logger.warn('Login', 'Could not set localStorage', e);
          }
          
          setError(errorMsg);
          onError?.(errorMsg);
        }
      } else {
        const errorMsg = result.error || "Authentication failed";
        
        // Error already set in tauriOAuth.ts
        setError(errorMsg);
        onError?.(errorMsg);
      }
    } catch (err) {
      logger.error('Login', 'Error', err);
      const errorMsg = "An unexpected error occurred";
      
      // Notify callback page of error
      try {
        localStorage.setItem('oauth_result', JSON.stringify({
          success: false,
          error: errorMsg
        }));
      } catch (e) {
        logger.warn('Login', 'Could not set localStorage', e);
      }
      
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Skip Google button initialization if in Tauri
    if (isTauri) {
      setGoogleReady(true);
      return;
    }
    
    const initializeGoogle = async () => {
      const clientId = await getClientId();

      if (!clientId) {
        setError("Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID or configure in settings.");
        return;
      }

      try {
        // Always initialize so clientId is set — on mobile (redirect flow) this
        // returns early in googleSDK without loading the full Google SDK script
        await googleSDK.initialize(clientId, handleGoogleResponse);
        setGoogleReady(true);
      } catch (err) {
        logger.error('GoogleLoginButton', 'Failed to initialize Google SDK', err);
        setError("Failed to load Google Sign-In");
      }
    };

    initializeGoogle();
    // handleGoogleResponse is component-local (not useCallback'd; would re-init SDK on every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauri, useRedirect]);

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Google Button Container */}
      <div className="relative">
        {isTauri ? (
          /* Custom button for Tauri - Beautiful styling matching original shader buttons */
          <Button
            variant="ghost"
            onClick={handleTauriLogin}
            disabled={isLoading || checkingAPI || !hasAPIConfigured}
            whileHover={{ scale: hasAPIConfigured ? 1.02 : 1 }}
            className={`flex items-center !gap-3 !px-8 py-3 !rounded-full font-sans text-xs !transition-all !duration-200 backdrop-blur-sm tracking-wide ${
              hasAPIConfigured
                ? "!bg-black hover:!bg-surface-raised !text-on-emphasis cursor-pointer shadow-lg hover:shadow-xl"
                : "!bg-surface-raised !text-muted cursor-not-allowed"
            } disabled:opacity-50`}
          >
            {/* Google "G" — official 4-colour brand mark; brand hex required, no neutral-token equivalent (§17 brand-logo carve-out) */}
            {/* eslint-disable no-restricted-syntax */}
            <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.18L12.05 13.56c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.44 15.983 5.485 18 9.003 18z" fill="#34A853"/>
              <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.428 0 9.002 0 5.485 0 2.44 2.017.96 4.958L3.967 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335"/>
            </svg>
            {/* eslint-enable no-restricted-syntax */}
            Continue with Google
          </Button>
        ) : (
          /* Google's button for web - Beautiful custom styled to match shader buttons */
          <Button
            variant="ghost"
            onClick={() => {
              // Mobile: Use redirect flow
              if (useRedirect) {
                googleSDK.redirectToLogin();
                return;
              }

              // Desktop: Try One Tap first, fall back to redirect if suppressed
              if (useOneTap) {
                googleSDK.prompt(() => {
                  // One Tap was blocked/suppressed — fall back to redirect flow
                  googleSDK.redirectToLogin();
                });
              }
            }}
            disabled={isLoading || !googleReady || checkingAPI}
            whileHover={{ scale: 1.02 }}
            className="flex items-center !gap-3 !px-8 py-3 !rounded-full font-sans text-xs !transition-all !duration-200 backdrop-blur-sm !bg-black hover:!bg-surface-raised !text-on-emphasis cursor-pointer shadow-lg hover:shadow-xl disabled:opacity-50 tracking-wide"
          >
            {/* Google "G" — official 4-colour brand mark; brand hex required, no neutral-token equivalent (§17 brand-logo carve-out) */}
            {/* eslint-disable no-restricted-syntax */}
            <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.18L12.05 13.56c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.44 15.983 5.485 18 9.003 18z" fill="#34A853"/>
              <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.428 0 9.002 0 5.485 0 2.44 2.017.96 4.958L3.967 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335"/>
            </svg>
            {/* eslint-enable no-restricted-syntax */}
            Continue with Google
          </Button>
        )}
        
        {/* Loading Overlay */}
        <AnimatePresence>
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-surface-page bg-opacity-80 rounded-full"
            >
              <div className="w-5 h-5 border-2 border-surface-border border-t-black rounded-full animate-spin" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Error Message */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="p-4 bg-surface-raised border border-surface-border rounded-2xl max-w-sm shadow-sm"
          >
            <div className="flex items-start gap-3">
              <Error size="md" className="text-secondary flex-shrink-0 mt-0.5" />
              <p className="text-sm text-secondary leading-relaxed">
                {error}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Loading Text */}
      <AnimatePresence>
        {isLoading && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-sm text-secondary font-light"
          >
            Signing in...
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
};
