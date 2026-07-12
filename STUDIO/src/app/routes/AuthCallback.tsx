/**
 * OAuth Callback Page
 * 
 * Handles the redirect callback from Google OAuth (mobile flow)
 * Extracts ID token from URL hash and completes authentication
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { googleSDK } from "@/features/auth/services/googleSDK";
import { logger } from "@/core/logging/logger";
import { SplashScreen } from "@/ui/feedback/SplashScreen";
import { Button } from "@/ui/primitives/Button";

export const AuthCallback = () => {
  const { login } = useAuth();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        logger.info('AuthCallback', 'Processing OAuth callback');
        
        // Extract ID token from URL hash
        const { idToken, error } = googleSDK.handleCallback(window.location.hash);
        
        if (error || !idToken) {
          logger.error('AuthCallback', 'Failed to extract ID token', error);
          setErrorMessage(error || 'Failed to complete authentication');
          setStatus('error');
          return;
        }
        
        // Login with ID token
        logger.info('AuthCallback', 'Logging in with ID token');
        const result = await login(idToken);
        
        if (result.success) {
          logger.info('AuthCallback', 'Login successful, redirecting to home');
          setStatus('success');

          setTimeout(() => {
            window.location.href = '/';
          }, 1000);
        } else {
          logger.error('AuthCallback', 'Login failed', result.error);
          const msg = result.error || 'Login failed';
          setErrorMessage(msg);
          setStatus('error');
        }
      } catch (err) {
        logger.error('AuthCallback', 'Unexpected error', err);
        setErrorMessage('An unexpected error occurred');
        setStatus('error');
      }
    };

    handleCallback();
  }, [login]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        {status === 'processing' && (
          <>
            <SplashScreen />
            <p className="mt-4 text-sm text-gray-600">Completing sign in...</p>
          </>
        )}
        
        {status === 'success' && (
          <>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-raised flex items-center justify-center">
              <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-900">Sign in successful!</p>
            <p className="mt-2 text-sm text-gray-600">Redirecting...</p>
          </>
        )}
        
        {status === 'error' && (
          <>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-raised flex items-center justify-center">
              <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-900">Sign in failed</p>
            <p className="mt-2 text-sm text-gray-600">{errorMessage}</p>
            <Button
              onClick={() => {
                // Store the error so the login page can surface a toast notification.
                try {
                  sessionStorage.setItem('studio_auth_error', errorMessage);
                } catch { /* storage unavailable */ }
                window.location.href = '/';
              }}
              className="mt-6 h-auto rounded-full px-6 py-2 text-sm bg-black text-white hover:bg-gray-800"
            >
              Return to home
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
