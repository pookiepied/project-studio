import { GoogleUserInfo } from '../types';

interface GoogleTokenInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  aud?: string;
  exp?: number;
  iss?: string;
}

const GOOGLE_ISSUER = ['accounts.google.com', 'https://accounts.google.com'];
const MAX_TOKEN_LENGTH = 2048;

/**
 * Accepts an ID token issued to any of the given client IDs.
 *
 * There is more than one, because the web app and the desktop harness must use
 * different Google OAuth clients: a desktop client is public and uses PKCE with
 * no client secret, which is the only safe option for software running on a
 * user's machine. Reusing the web client would mean shipping its secret.
 *
 * Only client IDs configured on this worker are accepted, so the audience check
 * still pins tokens to Project Studio's own OAuth clients.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientIds: readonly (string | undefined)[],
): Promise<GoogleUserInfo | null> {
  const allowedAudiences = clientIds.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (allowedAudiences.length === 0) {
    return null;
  }

  if (!idToken || typeof idToken !== 'string' || idToken.length > MAX_TOKEN_LENGTH) {
    return null;
  }

  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json() as GoogleTokenInfo;
    
    if (!data.sub || !data.email || !data.email_verified) {
      return null;
    }
    
    if (!data.aud || !allowedAudiences.includes(data.aud)) {
      return null;
    }

    if (data.iss && !GOOGLE_ISSUER.includes(data.iss)) {
      return null;
    }
    
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return {
      sub: data.sub,
      email: data.email,
      email_verified: data.email_verified,
      name: data.name || data.email,
      picture: data.picture || '',
      ...(data.given_name && { given_name: data.given_name }),
      ...(data.family_name && { family_name: data.family_name })
    };
  } catch {
    return null;
  }
}
