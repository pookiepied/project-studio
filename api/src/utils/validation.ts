/**
 * Validation Utilities
 * 
 * Input validation and sanitization functions.
 * These functions use constants from src/config/constants.ts
 */

import { AUTH, PATTERNS, VALID_JOB_STATUSES, VALID_RESULT_STATUSES, type JobStatus, type ResultStatus } from '../config/constants';

// Re-export types for convenience
export type { JobStatus, ResultStatus };
export { VALID_JOB_STATUSES, VALID_RESULT_STATUSES };

/**
 * Safely parse JSON data with validation
 * @param data - JSON string to parse
 * @returns Parsed object or null if invalid
 */
export function parseJobData(data: string): Record<string, unknown> | null {
  if (!data || typeof data !== 'string') {
    return null;
  }
  
  try {
    const parsed = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Validate job ID format
 * @param jobId - Job ID to validate
 * @returns True if valid job ID format
 */
export function isValidJobId(jobId: string): boolean {
  return typeof jobId === 'string' && PATTERNS.JOB_ID.test(jobId);
}

/**
 * Sanitize and validate limit parameter
 * @param limitParam - Raw limit parameter from query string
 * @param defaultLimit - Default value if not provided
 * @param maxLimit - Maximum allowed value
 * @returns Sanitized limit value
 */
export function sanitizeLimit(limitParam: string | undefined, defaultLimit: number, maxLimit: number): number {
  if (!limitParam) {
    return defaultLimit;
  }
  
  const parsed = parseInt(limitParam, 10);
  if (isNaN(parsed) || parsed < 1) {
    return defaultLimit;
  }
  
  return Math.min(parsed, maxLimit);
}

/**
 * Sanitize and validate wait parameter for long-polling
 * @param waitParam - Raw wait parameter from query string
 * @param maxWait - Maximum allowed wait time
 * @returns Sanitized wait value in seconds
 */
export function sanitizeWaitSeconds(waitParam: string | undefined, maxWait: number): number {
  if (!waitParam) {
    return 0;
  }
  
  const parsed = parseInt(waitParam, 10);
  if (isNaN(parsed) || parsed < 0) {
    return 0;
  }
  
  return Math.min(parsed, maxWait);
}

/**
 * Validate that a value is a non-empty string
 * @param value - Value to check
 * @returns Type guard for non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate that a value is a plain object (not array or null)
 * @param value - Value to check
 * @returns Type guard for plain object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate token length is within acceptable range
 * @param token - Token string to validate
 * @returns True if token length is valid
 */
export function isValidTokenLength(token: string): boolean {
  return token.length > 0 && token.length <= AUTH.MAX_TOKEN_LENGTH;
}

/**
 * Validate JWT secret meets minimum security requirements
 * @param secret - JWT secret to validate
 * @returns True if secret meets requirements
 */
export function isValidJwtSecret(secret: string): boolean {
  return secret.length >= AUTH.MIN_JWT_SECRET_LENGTH;
}
