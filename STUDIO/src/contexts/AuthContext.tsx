import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from "react";
import { tokenManager } from "../utils/tokenManager";
import { unifiedStorage } from "../core/storage/unifiedStorageService";

interface DecodedToken {
  sub: string;
  email?: string;
  role?: string;
  exp?: number;
  iat?: number;
  type?: string;
}

function decodeTokenPayload(token: string | null): DecodedToken | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1])) as DecodedToken;
  } catch {
    return null;
  }
}
import { apiManager } from "../core/network/apiManager";
import { logger } from "../core/logging/logger";

interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  /** Role from JWT payload — 'admin' | 'user'. Present after login; undefined until auth resolves. */
  role?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isGuestMode: boolean;
  login: (googleIdToken: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  setGuestMode: (enabled: boolean) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false); // Changed to false - let App.tsx handle initial loading
  const [isGuestMode, setIsGuestModeState] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        setIsLoading(true);
        logger.info('Auth', 'Checking authentication status...');
        
        const authenticated = await tokenManager.isAuthenticated();
        logger.info('Auth', `isAuthenticated result: ${authenticated}`);

        if (authenticated) {
          // Verify the token is actually usable by attempting a refresh if needed.
          // This catches the case where the JWT secret was rotated: local expiry check
          // passes, but the stored refresh token is now cryptographically invalid.
          const validToken = await tokenManager.getAccessToken();
          if (!validToken) {
            logger.warn('Auth', 'Token refresh failed on startup — clearing session');
            setIsLoading(false);
            return;
          }

          const userInfo = await tokenManager.getUserInfo();
          logger.info('Auth', 'User info from token', userInfo);

          if (userInfo) {
            // Try to get full user info from stored data
            const storedUser = await tokenManager.getStoredUserInfo();
            logger.info('Auth', 'Stored user info', storedUser);

            if (storedUser) {
              // Enrich stored user with role from the live token (token is source of truth for role)
              const tokenPayload = decodeTokenPayload(validToken);
              setUser({ ...storedUser, role: tokenPayload?.role });
              logger.info('Auth', 'User loaded from storage');
            } else {
              // Fallback to basic info from token — decode sub as id
              const tokenPayload = decodeTokenPayload(validToken);
              const fallbackUser = {
                id: tokenPayload?.sub ?? "",
                email: userInfo.email,
                name: userInfo.email.split("@")[0],
                picture: undefined,
                role: tokenPayload?.role,
              };
              setUser(fallbackUser);
              logger.info('Auth', 'User created from token fallback', fallbackUser);
            }

            // Switch storage to cloud now that we have a valid session
            try {
              const endpoints = await apiManager.getEndpoints();
              await unifiedStorage.enableCloudStorage(
                endpoints.chats,
                () => tokenManager.getAccessToken()
              );
            } catch (err) {
              logger.warn('Auth', 'Failed to enable cloud storage on startup', err);
            }
          }
        } else {
          logger.info('Auth', 'Not authenticated, user stays null');
        }
      } catch (error) {
        logger.error('Auth', 'Failed to check authentication', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = useCallback(async (googleIdToken: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);
      
      const endpoints = await apiManager.getEndpoints();

      const response = await fetch(`${endpoints.auth}/google`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: googleIdToken }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error('Auth', 'Login failed', errorData);
        return {
          success: false,
          error: errorData.error || errorData.message || `Login failed (${response.status})`
        };
      }

      const data = await response.json();

      if (!data.accessToken) {
        logger.error('Auth', 'Login response missing accessToken', data);
        return { success: false, error: "Login response missing accessToken" };
      }
      
      // Refresh token can be in response body (desktop apps) or cookie (browser)
      const refreshToken = data.refreshToken || null;

      try {
        await tokenManager.storeTokens(data.accessToken, refreshToken, {
          id: data.user?.id ?? "",
          email: data.user?.email,
          name: data.user?.name,
          picture: data.user?.picture,
        });
      } catch (storageError) {
        logger.error('Auth', 'Token storage failed', storageError);
        return { success: false, error: `Failed to store tokens: ${storageError instanceof Error ? storageError.message : String(storageError)}` };
      }
      
      // Role comes from the server response and is also embedded in the JWT.
      // We prefer the response value since the token may not be decoded yet.
      const userData = {
        id: data.user?.id ?? "",
        email: data.user?.email || 'unknown',
        name: data.user?.name || 'User',
        picture: data.user?.picture,
        role: data.user?.role,
      };
      
      logger.info('Auth', 'Setting user data', userData);

      setUser(userData);

      // Switch storage to cloud now that the user is authenticated
      try {
        const endpoints = await apiManager.getEndpoints();
        await unifiedStorage.enableCloudStorage(
          endpoints.chats,
          () => tokenManager.getAccessToken()
        );
      } catch (err) {
        logger.warn('Auth', 'Failed to enable cloud storage on login', err);
      }

      logger.info('Auth', 'Login complete, user set');

      return { success: true };
    } catch (error) {
      logger.error('Auth', 'Login error', error);
      return { 
        success: false, 
        error: "Network error. Please try again." 
      };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      setIsLoading(true);

      if (isGuestMode) {
        setIsGuestModeState(false);
        setUser(null);
        return;
      }

      // Read both tokens before clearing storage so we can send them to the server.
      // getRawAccessToken skips the auto-refresh path — we don't want to refresh at logout.
      const [accessToken, refreshToken] = await Promise.all([
        tokenManager.getRawAccessToken(),
        tokenManager.getRefreshToken(),
      ]);

      try {
        const endpoints = await apiManager.getEndpoints();
        await apiManager.makeRequest(`${endpoints.auth}/logout`, {
          method: "POST",
          body: JSON.stringify({ refreshToken, accessToken }),
        });
      } catch (error) {
        logger.warn('Auth', 'Logout endpoint failed', error);
      }

      // Always clear UI state first — even if storage clear fails the user is
      // considered logged out in this session.
      setUser(null);
      unifiedStorage.disableCloudStorage();

      // Clear secure token storage.
      try {
        await tokenManager.clearTokens();
      } catch (error) {
        // clearTokens now throws if any key could not be removed.
        // Log it prominently — a retained token is a security issue.
        logger.error('Auth', 'SECURITY: Token clear failed — tokens may persist in storage', error);
      }

      // Clear all localStorage caches (models, etc.)
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) keysToRemove.push(key);
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        logger.debug('Auth', 'Cleared localStorage cache');
      } catch (e) {
        logger.warn('Auth', 'Failed to clear localStorage', e);
      }

    } catch (error) {
      logger.error('Auth', 'Logout error', error);
      // Ensure UI state is cleared even if something unexpected threw.
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [isGuestMode]);

  const refreshAuth = useCallback(async () => {
    try {
      const authenticated = await tokenManager.isAuthenticated();
      
      if (!authenticated) {
        setUser(null);
        return;
      }
      
        const storedUser = await tokenManager.getStoredUserInfo();
        if (storedUser) {
          setUser(storedUser);
        } else {
          const userInfo = await tokenManager.getUserInfo();
          if (userInfo) {
            setUser({
              id: "",
              email: userInfo.email,
              name: userInfo.email.split("@")[0],
              picture: undefined,
            });
          }
        }
    } catch (error) {
      logger.error('Auth', 'Failed to refresh auth', error);
      setUser(null);
    }
  }, []);

  const setGuestMode = useCallback((enabled: boolean) => {
    setIsGuestModeState(enabled);
    if (enabled) {
      setUser({
        id: "",
        email: "guest@local",
        name: "Guest User",
        picture: "",
      });
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user || isGuestMode,
        isLoading,
        isGuestMode,
        login,
        logout,
        refreshAuth,
        setGuestMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
