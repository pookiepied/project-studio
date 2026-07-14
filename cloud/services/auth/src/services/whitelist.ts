import { Env } from '../types';
import { isValidEmail } from '../utils/validation';

export async function isWhitelisted(email: string, env: Env): Promise<boolean> {
  if (!isValidEmail(email)) {
    return false;
  }

  const key = `whitelist:${email.toLowerCase()}`;
  
  try {
    const value = await env.AUTH_KV.get(key);
    return value === 'true';
  } catch {
    return false;
  }
}
