import { Context } from 'hono';
import { Env } from '../types';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60000,
  maxRequests: 10
};

export async function rateLimit(
  c: Context<{ Bindings: Env }>,
  config: RateLimitConfig = DEFAULT_CONFIG
): Promise<boolean> {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const key = `ratelimit:${ip}`;
  
  try {
    const current = await c.env.AUTH_KV.get(key);
    const count = current ? parseInt(current, 10) : 0;
    
    if (count >= config.maxRequests) {
      return false;
    }
    
    const ttl = Math.floor(config.windowMs / 1000);
    await c.env.AUTH_KV.put(key, String(count + 1), { expirationTtl: ttl });
    
    return true;
  } catch {
    return true;
  }
}
