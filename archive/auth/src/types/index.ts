export interface Env {
  AUTH_KV: KVNamespace;
  JWT_SECRET: string;
  TRACKER?: Fetcher;
  ENVIRONMENT?: string;
  FRONTEND_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /**
   * Public Google OAuth client for the desktop harness, which signs in with
   * PKCE and no client secret. Optional: unset simply means desktop login is
   * not enabled for this deployment.
   */
  GOOGLE_DESKTOP_CLIENT_ID?: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
  scope: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access';
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  iat: number;
  exp: number;
}

export type TokenPayload = AccessTokenPayload | RefreshTokenPayload;

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
  given_name?: string;
  family_name?: string;
}

export interface UserProfile {
  id: string;
  googleId: string;
  email: string;
  name: string;
  picture: string;
  role: string;
  status: 'active' | 'suspended';
  createdAt: string;
  lastLoginAt: string;
}

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  user: UserResponse;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface MeResponse {
  user: UserResponse;
}

export const TOKEN_EXPIRY = {
  ACCESS_TOKEN: 3600,
  REFRESH_TOKEN: 604800,
} as const;
