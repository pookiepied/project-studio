/**
 * Security Configuration
 * 
 * Centralized security settings for CORS, CSP, and other security policies.
 * Modify these values to match your deployment requirements.
 */

/**
 * CORS (Cross-Origin Resource Sharing) Configuration
 */
export const CORS_CONFIG = {
  /**
   * Allowed Origins - Whitelist of domains that can access this API
   * Add your frontend domains here
   */
  allowedOrigins: [
    'https://yourdomain.com',
    'https://app.yourdomain.com',
    'https://studio.yourdomain.com',
    // Temp access for local development on port 18789
    'http://localhost:18789',
    'http://127.0.0.1:18789',
    // Add more allowed origins as needed
  ],

  /**
   * Allow localhost in development
   * Set to false in production for security
   */
  allowLocalhost: true,

  /**
   * Allowed HTTP methods
   */
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const,

  /**
   * Allowed request headers
   */
  allowedHeaders: ['Content-Type', 'Authorization'] as const,

  /**
   * Headers exposed to the client
   */
  exposedHeaders: ['x-request-id'] as const,

  /**
   * Preflight cache duration (in seconds)
   * 86400 = 24 hours
   */
  maxAge: 86400,

  /**
   * Allow credentials (cookies, authorization headers)
   */
  credentials: true,
} as const;

/**
 * Content Security Policy (CSP) Configuration
 * 
 * Defines what resources can be loaded and from where.
 * Helps prevent XSS attacks and other code injection attacks.
 */
export const CSP_CONFIG = {
  /**
   * Default source for all resource types
   */
  defaultSrc: ["'self'"],

  /**
   * JavaScript sources
   */
  scriptSrc: ["'self'"],

  /**
   * CSS sources
   * 'unsafe-inline' allows inline styles (needed for some frameworks)
   */
  styleSrc: ["'self'", "'unsafe-inline'"],

  /**
   * Image sources
   */
  imgSrc: ["'self'", 'data:', 'https:'],

  /**
   * Font sources
   */
  fontSrc: ["'self'"],

  /**
   * AJAX, WebSocket, and EventSource connections
   */
  connectSrc: ["'self'"],

  /**
   * Frame ancestors (who can embed this in an iframe)
   * 'none' prevents all framing (recommended)
   */
  frameAncestors: ["'none'"],
} as const;

/**
 * Security Headers Configuration
 */
export const SECURITY_HEADERS = {
  /**
   * X-Content-Type-Options
   * Prevents MIME type sniffing
   */
  contentTypeOptions: 'nosniff',

  /**
   * X-Frame-Options
   * Prevents clickjacking attacks
   * Options: 'DENY', 'SAMEORIGIN', 'ALLOW-FROM uri'
   */
  frameOptions: 'DENY',

  /**
   * X-XSS-Protection
   * Enables browser's XSS filter
   * Note: Modern browsers use CSP instead, but this provides fallback
   */
  xssProtection: '1; mode=block',

  /**
   * Referrer-Policy
   * Controls how much referrer information is sent
   */
  referrerPolicy: 'strict-origin-when-cross-origin',

  /**
   * Permissions-Policy (formerly Feature-Policy)
   * Controls which browser features can be used
   */
  permissionsPolicy: {
    geolocation: [],
    microphone: [],
    camera: [],
    payment: [],
    usb: [],
    magnetometer: [],
    gyroscope: [],
    accelerometer: [],
  },

  /**
   * Strict-Transport-Security (HSTS)
   * Forces HTTPS connections
   * Only applied when request is over HTTPS
   */
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
} as const;

/**
 * Request Size Limits
 */
export const REQUEST_LIMITS = {
  /**
   * Maximum request body size (in bytes)
   * 10MB = 10 * 1024 * 1024
   */
  maxBodySize: 10 * 1024 * 1024,

  /**
   * Maximum JSON payload size (in bytes)
   * 5MB = 5 * 1024 * 1024
   */
  maxJsonSize: 5 * 1024 * 1024,
} as const;

/**
 * Rate Limiting Configuration (for future implementation)
 */
export const RATE_LIMIT_CONFIG = {
  /**
   * Enable rate limiting
   */
  enabled: false,

  /**
   * Maximum requests per window
   */
  maxRequests: 100,

  /**
   * Time window in seconds
   */
  windowSeconds: 60,

  /**
   * Rate limit by IP address
   */
  byIp: true,

  /**
   * Rate limit by user ID (for authenticated requests)
   */
  byUser: true,
} as const;

/**
 * IP Whitelist Configuration (for future implementation)
 * 
 * Note: IP whitelisting is typically handled at the Cloudflare level,
 * not in application code. Configure this in Cloudflare dashboard:
 * Security > WAF > Tools > IP Access Rules
 */
export const IP_WHITELIST = {
  /**
   * Enable IP whitelisting
   */
  enabled: false,

  /**
   * Allowed IP addresses or CIDR ranges
   */
  allowedIps: [
    // '192.168.1.0/24',
    // '10.0.0.1',
  ],
} as const;

/**
 * Helper function to build CSP header string
 */
export function buildCSPHeader(): string {
  const directives = [
    `default-src ${CSP_CONFIG.defaultSrc.join(' ')}`,
    `script-src ${CSP_CONFIG.scriptSrc.join(' ')}`,
    `style-src ${CSP_CONFIG.styleSrc.join(' ')}`,
    `img-src ${CSP_CONFIG.imgSrc.join(' ')}`,
    `font-src ${CSP_CONFIG.fontSrc.join(' ')}`,
    `connect-src ${CSP_CONFIG.connectSrc.join(' ')}`,
    `frame-ancestors ${CSP_CONFIG.frameAncestors.join(' ')}`,
  ];
  
  return directives.join('; ') + ';';
}

/**
 * Helper function to build Permissions-Policy header string
 */
export function buildPermissionsPolicyHeader(): string {
  const policies = Object.entries(SECURITY_HEADERS.permissionsPolicy)
    .map(([feature, allowlist]) => {
      const value = allowlist.length > 0 ? allowlist.join(' ') : '';
      return `${feature}=(${value})`;
    });
  
  return policies.join(', ');
}
