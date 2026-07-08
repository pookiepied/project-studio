import { Env, UserProfile, GoogleUserInfo, GoogleTokens } from '../types';
import { isValidEmail, sanitizeString, isValidUserId } from '../utils/validation';

function generateUserId(): string {
  return `user_${crypto.randomUUID()}`;
}

export async function getUserByEmail(email: string, env: Env): Promise<UserProfile | null> {
  if (!isValidEmail(email)) {
    return null;
  }

  const key = `user:${email.toLowerCase()}`;
  
  try {
    const data = await env.AUTH_KV.get(key, 'json');
    if (!data) return null;
    
    const user = data as UserProfile;
    if (!user.id || !user.email || !user.role) {
      return null;
    }
    
    return user;
  } catch {
    return null;
  }
}

export async function getUserById(userId: string, env: Env): Promise<UserProfile | null> {
  if (!isValidUserId(userId)) {
    return null;
  }

  const key = `user_id:${userId}`;
  
  try {
    const email = await env.AUTH_KV.get(key);
    if (!email) return null;
    
    return await getUserByEmail(email, env);
  } catch {
    return null;
  }
}

export async function upsertUser(
  googleInfo: GoogleUserInfo,
  env: Env
): Promise<UserProfile> {
  const email = googleInfo.email.toLowerCase();
  
  if (!isValidEmail(email)) {
    throw new Error('Invalid email address');
  }

  let user = await getUserByEmail(email, env);
  const now = new Date().toISOString();
  
  if (user) {
    user.name = sanitizeString(googleInfo.name, 255);
    user.picture = sanitizeString(googleInfo.picture, 2048);
    user.lastLoginAt = now;
  } else {
    user = {
      id: generateUserId(),
      googleId: googleInfo.sub,
      email,
      name: sanitizeString(googleInfo.name, 255),
      picture: sanitizeString(googleInfo.picture, 2048),
      role: 'user',
      status: 'active',
      createdAt: now,
      lastLoginAt: now
    };
  }
  
  const userKey = `user:${email}`;
  const userIdKey = `user_id:${user.id}`;
  
  await Promise.all([
    env.AUTH_KV.put(userKey, JSON.stringify(user)),
    env.AUTH_KV.put(userIdKey, email)
  ]);

  return user;
}

/** Store Google OAuth tokens for a user (keyed by userId, separate from user profile). */
export async function storeGoogleTokens(
  userId: string,
  tokens: GoogleTokens,
  env: Env
): Promise<void> {
  await env.AUTH_KV.put(
    `google_tokens:${userId}`,
    JSON.stringify(tokens),
    { expirationTtl: 30 * 24 * 3600 } // 30 days
  );
}

/** Retrieve stored Google OAuth tokens for a user, or null if not connected. */
export async function getGoogleTokens(
  userId: string,
  env: Env
): Promise<GoogleTokens | null> {
  try {
    return await env.AUTH_KV.get(`google_tokens:${userId}`, 'json') as GoogleTokens | null;
  } catch {
    return null;
  }
}

