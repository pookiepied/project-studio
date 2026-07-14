import { Hono } from 'hono';
import { Env } from '../types';

export function registerCors(app: Hono<{ Bindings: Env }>) {
  app.use('/*', async (c, next) => {
    const origin = c.req.header('Origin');
    const allowedOrigins = c.env.FRONTEND_URL
      ? c.env.FRONTEND_URL.split(',').map(u => u.trim())
      : [];

    if (origin) {
      const isKnownOrigin = allowedOrigins.some(allowed => {
        if (allowed.includes('://')) return origin === allowed;
        return origin === `https://${allowed}` || origin.endsWith(`.${allowed}`);
      });

      if (isKnownOrigin) {
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Access-Control-Allow-Credentials', 'true');
      } else {
        // Unknown origin (e.g. Tauri desktop with platform-specific scheme).
        // Security relies on JWT + whitelist, not CORS.
        c.header('Access-Control-Allow-Origin', '*');
      }
    } else {
      c.header('Access-Control-Allow-Origin', '*');
    }

    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      c.header('Access-Control-Max-Age', '86400');
      return c.body(null, 204);
    }

    return await next();
  });
}
