/**
 * Security Middleware
 * 
 * Applies security policies configured in src/config/security.ts
 */

import { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import {
  CORS_CONFIG,
  SECURITY_HEADERS,
  REQUEST_LIMITS,
  buildCSPHeader,
  buildPermissionsPolicyHeader,
} from '../config/security';

/**
 * CORS middleware with whitelist
 * Configuration is in src/config/security.ts
 */
export function corsMiddleware() {
  return cors({
    origin: (origin) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return '*';
      
      // Check if origin is in whitelist
      if ((CORS_CONFIG.allowedOrigins as unknown as string[]).includes(origin)) {
        return origin;
      }
      
      // Allow localhost in development
      if (CORS_CONFIG.allowLocalhost) {
        if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
          return origin;
        }
      }

      // Allow Tauri desktop app — accept any Tauri scheme variant
      // (platform-specific: tauri://, https://tauri.localhost, http://tauri.localhost, etc.)
      if (origin.startsWith('tauri://') || origin.includes('tauri.localhost')) {
        return origin;
      }

      // Unknown origin — likely a native/desktop client
      // Security is JWT-based, not CORS-based
      return '*';
    },
    allowMethods: [...CORS_CONFIG.allowedMethods],
    allowHeaders: [...CORS_CONFIG.allowedHeaders],
    exposeHeaders: [...CORS_CONFIG.exposedHeaders],
    maxAge: CORS_CONFIG.maxAge,
    credentials: CORS_CONFIG.credentials,
  });
}

/**
 * Security headers middleware
 * Adds security-related HTTP headers to all responses
 * Configuration is in src/config/security.ts
 */
export async function securityHeaders(c: Context, next: Next) {
  await next();
  
  // Content Security Policy
  c.header('Content-Security-Policy', buildCSPHeader());
  
  // Prevent MIME type sniffing
  c.header('X-Content-Type-Options', SECURITY_HEADERS.contentTypeOptions);
  
  // Prevent clickjacking
  c.header('X-Frame-Options', SECURITY_HEADERS.frameOptions);
  
  // Enable XSS protection
  c.header('X-XSS-Protection', SECURITY_HEADERS.xssProtection);
  
  // Referrer policy
  c.header('Referrer-Policy', SECURITY_HEADERS.referrerPolicy);
  
  // Permissions policy
  c.header('Permissions-Policy', buildPermissionsPolicyHeader());
  
  // Strict Transport Security (HTTPS only)
  if (c.req.url.startsWith('https://')) {
    const { maxAge, includeSubDomains, preload } = SECURITY_HEADERS.hsts;
    const hstsValue = [
      `max-age=${maxAge}`,
      includeSubDomains ? 'includeSubDomains' : '',
      preload ? 'preload' : '',
    ].filter(Boolean).join('; ');
    
    c.header('Strict-Transport-Security', hstsValue);
  }
}

/**
 * Request ID middleware
 * Generates unique request ID for tracking and correlation
 */
export async function requestId(c: Context, next: Next) {
  // Generate unique request ID
  const reqId = crypto.randomUUID();
  
  // Store in context for use in error responses
  c.set('requestId', reqId);
  
  // Add to response headers
  c.header('x-request-id', reqId);
  
  await next();
}

/**
 * Request logging middleware
 * Logs all incoming requests with structured format
 */
export async function requestLogger(c: Context, next: Next) {
  const start = Date.now();
  const requestId = c.get('requestId') || 'unknown';
  
  // Log request
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    type: 'REQUEST',
    requestId,
    method: c.req.method,
    path: c.req.path,
    userAgent: c.req.header('user-agent'),
  }));
  
  await next();
  
  // Log response
  const duration = Date.now() - start;
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    type: 'RESPONSE',
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration: `${duration}ms`,
  }));
}

/**
 * Request size limit middleware
 * Prevents large payloads from consuming resources
 * Configuration is in src/config/security.ts
 */
export async function requestSizeLimit(c: Context, next: Next) {
  const contentLength = c.req.header('content-length');
  
  if (contentLength && parseInt(contentLength) > REQUEST_LIMITS.maxBodySize) {
    return c.json({
      code: 'VAL_004',
      message: 'Request body too large',
      details: `Maximum size is ${REQUEST_LIMITS.maxBodySize} bytes`,
      timestamp: new Date().toISOString(),
    }, 413);
  }
  
  await next();
}
