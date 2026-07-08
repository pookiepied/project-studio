/**
 * Centralized Error System
 * 
 * Provides consistent, user-friendly error responses with error codes
 * for programmatic error handling and proper logging.
 */

/**
 * Error codes for programmatic error identification
 */
export enum ErrorCode {
  // Authentication Errors (1000-1099)
  UNAUTHORIZED = 'AUTH_001',
  INVALID_TOKEN = 'AUTH_002',
  TOKEN_EXPIRED = 'AUTH_003',
  AUTH_NOT_CONFIGURED = 'AUTH_004',
  INVALID_CREDENTIALS = 'AUTH_005',
  
  // Validation Errors (1100-1199)
  INVALID_INPUT = 'VAL_001',
  MISSING_REQUIRED_FIELD = 'VAL_002',
  INVALID_FORMAT = 'VAL_003',
  VALUE_TOO_LARGE = 'VAL_004',
  VALUE_TOO_SMALL = 'VAL_005',
  INVALID_JSON = 'VAL_006',
  
  // Resource Errors (1200-1299)
  NOT_FOUND = 'RES_001',
  ALREADY_EXISTS = 'RES_002',
  CANNOT_MODIFY = 'RES_003',
  RESOURCE_LOCKED = 'RES_004',
  
  // System Errors (1300-1399)
  INTERNAL_ERROR = 'SYS_001',
  DATABASE_ERROR = 'SYS_002',
  SERVICE_UNAVAILABLE = 'SYS_003',
  EXTERNAL_SERVICE_ERROR = 'SYS_004',
  
  // Rate Limiting (1400-1499)
  RATE_LIMIT_EXCEEDED = 'RATE_001',
  QUOTA_EXCEEDED = 'RATE_002',
}

/**
 * User-friendly error messages mapped to error codes
 */
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // Authentication
  [ErrorCode.UNAUTHORIZED]: 'Authentication required. Please provide valid credentials.',
  [ErrorCode.INVALID_TOKEN]: 'Invalid authentication token. Please check your credentials.',
  [ErrorCode.TOKEN_EXPIRED]: 'Your session has expired. Please sign in again.',
  [ErrorCode.AUTH_NOT_CONFIGURED]: 'Authentication service is temporarily unavailable. Please try again later.',
  [ErrorCode.INVALID_CREDENTIALS]: 'Invalid credentials provided.',
  
  // Validation
  [ErrorCode.INVALID_INPUT]: 'The provided input is invalid. Please check your request.',
  [ErrorCode.MISSING_REQUIRED_FIELD]: 'Required field is missing. Please provide all required information.',
  [ErrorCode.INVALID_FORMAT]: 'Invalid format. Please check the documentation for correct format.',
  [ErrorCode.VALUE_TOO_LARGE]: 'Value exceeds maximum allowed size.',
  [ErrorCode.VALUE_TOO_SMALL]: 'Value is below minimum required size.',
  [ErrorCode.INVALID_JSON]: 'Invalid JSON format in request body.',
  
  // Resources
  [ErrorCode.NOT_FOUND]: 'The requested resource was not found.',
  [ErrorCode.ALREADY_EXISTS]: 'A resource with this identifier already exists.',
  [ErrorCode.CANNOT_MODIFY]: 'This resource cannot be modified in its current state.',
  [ErrorCode.RESOURCE_LOCKED]: 'This resource is currently locked by another operation.',
  
  // System
  [ErrorCode.INTERNAL_ERROR]: 'An unexpected error occurred. Our team has been notified.',
  [ErrorCode.DATABASE_ERROR]: 'Database operation failed. Please try again.',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable. Please try again later.',
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 'External service error. Please try again.',
  
  // Rate Limiting
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Too many requests. Please slow down and try again later.',
  [ErrorCode.QUOTA_EXCEEDED]: 'Usage quota exceeded. Please upgrade your plan or try again later.',
};

/**
 * HTTP status codes mapped to error codes
 */
const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
  // 401 Unauthorized
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.INVALID_TOKEN]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  
  // 400 Bad Request
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.MISSING_REQUIRED_FIELD]: 400,
  [ErrorCode.INVALID_FORMAT]: 400,
  [ErrorCode.VALUE_TOO_LARGE]: 400,
  [ErrorCode.VALUE_TOO_SMALL]: 400,
  [ErrorCode.INVALID_JSON]: 400,
  
  // 404 Not Found
  [ErrorCode.NOT_FOUND]: 404,
  
  // 409 Conflict
  [ErrorCode.ALREADY_EXISTS]: 409,
  [ErrorCode.CANNOT_MODIFY]: 409,
  [ErrorCode.RESOURCE_LOCKED]: 409,
  
  // 500 Internal Server Error
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.DATABASE_ERROR]: 500,
  
  // 503 Service Unavailable
  [ErrorCode.AUTH_NOT_CONFIGURED]: 503,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 503,
  
  // 429 Too Many Requests
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.QUOTA_EXCEEDED]: 429,
};

/**
 * Standardized error response structure
 */
export interface ApiErrorResponse {
  /** Error code for programmatic handling */
  code: ErrorCode;
  
  /** User-friendly error message */
  message: string;
  
  /** Optional additional context (never includes sensitive data) */
  details?: string;
  
  /** Request ID for tracking (if available) */
  requestId?: string;
  
  /** Timestamp of error */
  timestamp: string;
}

/**
 * Create a standardized API error response
 * 
 * @param code - Error code from ErrorCode enum
 * @param details - Optional additional context (sanitized)
 * @param requestId - Optional request ID for tracking
 * @returns Standardized error response object
 */
export function createApiError(
  code: ErrorCode,
  details?: string,
  requestId?: string
): ApiErrorResponse {
  return {
    code,
    message: ERROR_MESSAGES[code],
    details: details ? sanitizeErrorDetails(details) : undefined,
    requestId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get HTTP status code for an error code
 * 
 * @param code - Error code
 * @returns HTTP status code
 */
export function getStatusCode(code: ErrorCode): number {
  return ERROR_STATUS_CODES[code] || 500;
}

/**
 * Sanitize error details to prevent information leakage
 * Removes sensitive information like file paths, stack traces, etc.
 * 
 * @param details - Raw error details
 * @returns Sanitized details safe for client
 */
function sanitizeErrorDetails(details: string): string {
  // Remove file paths
  let sanitized = details.replace(/\/[^\s]+\.(ts|js|json)/g, '[file]');
  
  // Remove stack traces
  sanitized = sanitized.replace(/at\s+[^\n]+/g, '');
  
  // Remove line numbers
  sanitized = sanitized.replace(/:\d+:\d+/g, '');
  
  // Truncate if too long
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 197) + '...';
  }
  
  return sanitized.trim();
}

/**
 * Log error for monitoring and debugging
 * In production, this should integrate with error tracking service
 * 
 * @param error - Error object or message
 * @param context - Additional context
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  
  // Structured logging for easy parsing
  console.error(JSON.stringify({
    timestamp,
    level: 'ERROR',
    message: errorMessage,
    stack,
    context,
  }));
}

/**
 * Map common errors to error codes
 * 
 * @param error - Error object or message
 * @returns Appropriate error code
 */
export function mapErrorToCode(error: unknown): ErrorCode {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('not found')) return ErrorCode.NOT_FOUND;
    if (message.includes('already exists')) return ErrorCode.ALREADY_EXISTS;
    if (message.includes('unauthorized')) return ErrorCode.UNAUTHORIZED;
    if (message.includes('invalid token')) return ErrorCode.INVALID_TOKEN;
    if (message.includes('expired')) return ErrorCode.TOKEN_EXPIRED;
    if (message.includes('required')) return ErrorCode.MISSING_REQUIRED_FIELD;
    if (message.includes('invalid')) return ErrorCode.INVALID_INPUT;
    if (message.includes('database')) return ErrorCode.DATABASE_ERROR;
  }
  
  return ErrorCode.INTERNAL_ERROR;
}

/**
 * Create error response from unknown error
 * Automatically maps error to appropriate code and sanitizes details
 * 
 * @param error - Unknown error object
 * @param requestId - Optional request ID
 * @returns Standardized error response
 */
export function handleUnknownError(error: unknown, requestId?: string): ApiErrorResponse {
  const code = mapErrorToCode(error);
  const details = error instanceof Error ? error.message : String(error);
  
  // Log the error for monitoring
  logError(error, { code, requestId });
  
  return createApiError(code, details, requestId);
}
