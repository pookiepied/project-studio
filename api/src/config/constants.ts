/**
 * Application Constants
 * 
 * Centralized configuration values used throughout the application.
 * Modify these values to adjust system behavior and limits.
 */

/**
 * Authentication & Security Constants
 */
export const AUTH = {
  /** Maximum length for bearer tokens in characters */
  MAX_TOKEN_LENGTH: 2048,

  /** Minimum required length for JWT secret key for security */
  MIN_JWT_SECRET_LENGTH: 32,
} as const;

/**
 * Job Queue & Processing Constants
 */
export const JOB = {
  /** Maximum number of jobs returned in a single list request */
  MAX_LIMIT: 100,

  /** Default number of jobs returned when limit not specified */
  DEFAULT_LIMIT: 50,

  /** Maximum wait time in seconds for long-polling job requests */
  MAX_WAIT_SECONDS: 30,

  /** Polling interval in milliseconds when waiting for jobs */
  POLL_INTERVAL_MS: 1000,

  /**
   * A running job is considered stale if its heartbeat_at is older than this
   * threshold (or null). The reaper resets stale jobs back to 'queued' so
   * they can be reclaimed after an engine crash.
   * Value: 30 seconds — engine beats every 5s, so this allows ~6 missed beats.
   */
  HEARTBEAT_STALE_THRESHOLD_MS: 30_000,
} as const;

/**
 * Task Management Constants
 */
export const TASK = {
  /** Maximum number of tasks that can be registered at once */
  MAX_TASKS: 1000,
  
  /** TTL for task catalog in KV store (24 hours in seconds) */
  CATALOG_TTL: 86400,
} as const;

/**
 * Health Check & Monitoring Constants
 */
export const HEALTH = {
  /** Engine considered offline if not seen within this time (milliseconds) */
  ENGINE_TIMEOUT_MS: 60000,
  
  /** Database response time threshold for "operational" status (milliseconds) */
  DB_FAST_THRESHOLD_MS: 100,
  
  /** Database response time threshold for "degraded" status (milliseconds) */
  DB_SLOW_THRESHOLD_MS: 500,
} as const;

/**
 * Valid Job Status Values
 * Used for job lifecycle management and filtering
 */
export const VALID_JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type JobStatus = typeof VALID_JOB_STATUSES[number];

/**
 * Valid Job Result Status Values
 * Used when engine submits final job results
 */
export const VALID_RESULT_STATUSES = ['done', 'failed'] as const;
export type ResultStatus = typeof VALID_RESULT_STATUSES[number];

export const PATTERNS = {
  /** Job ID format: job_<uuid> */
  JOB_ID: /^job_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
} as const;
