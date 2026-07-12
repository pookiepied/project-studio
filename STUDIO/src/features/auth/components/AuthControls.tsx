import { useState } from "react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { Button } from "@/ui/primitives/Button";
import { logger } from "@/core/logging/logger";

let tauriOAuth: typeof import("@/features/auth/services/tauriOAuth") | null = null;

export const AuthControls = () => {
  const { login, isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLogin = async () => {
    setIsLoading(true);
    setLoginError(null);
    try {
      if (!tauriOAuth) {
        tauriOAuth = await import("@/features/auth/services/tauriOAuth");
      }
      const result = await tauriOAuth.startGoogleOAuth();
      if (result.success && result.idToken) {
        const loginResult = await login(result.idToken);
        if (!loginResult.success) {
          setLoginError(loginResult.error || "Login failed");
        }
      } else {
        setLoginError(result.error || "Sign-in failed");
      }
    } catch (error) {
      logger.error('AuthControls', 'Login error:', error);
      setLoginError(error instanceof Error ? error.message : "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthenticated) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        whileHover={{ scale: 1.02 }}
        onClick={handleLogin}
        disabled={isLoading}
        className="flex items-center gap-2 px-3 py-1.5 text-sm !bg-gray-100 hover:!bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
      >
        <svg width="16" height="16" viewBox="0 0 24 24">
          {/* Google "G" — official 4-colour brand mark; brand hex required, no neutral-token equivalent (§17 brand-logo carve-out) */}
          {/* eslint-disable no-restricted-syntax */}
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          {/* eslint-enable no-restricted-syntax */}
        </svg>
        <span className="text-gray-700">{isLoading ? "Signing in…" : "Sign in"}</span>
      </Button>
      {loginError && (
        <p className="text-xs text-secondary max-w-[200px] text-right leading-tight">{loginError}</p>
      )}
    </div>
  );
};
