/**
 * UI/UX chrome constants — UI config, file limits, success/error toast copy.
 *
 * Split out of the historical config/constants.ts monolith during Phase 5 (T5.1)
 * per the §2 placement rule. Co-located siblings: app.ts, network.ts, models.ts,
 * splashTiming.ts — all re-exported by `core/config/constants/index.ts`.
 */

// UI Configuration
export const UI_CONFIG = {
  /** Threshold for collapsing code blocks */
  CODE_COLLAPSE_LINE_THRESHOLD: 20,

  /** Debounce delay for search/filter inputs */
  SEARCH_DEBOUNCE_MS: 300,

  /** Toast notification duration */
  TOAST_DURATION_MS: 3000,

  /** Animation duration for smooth transitions */
  ANIMATION_DURATION_MS: 200,
} as const;

// File Upload Limits
export const FILE_LIMITS = {
  /** Maximum number of attachments per message */
  MAX_ATTACHMENTS: 10,

  /** Maximum image file size (20MB) */
  MAX_IMAGE_SIZE: 20 * 1024 * 1024,

  /** Maximum text file size (1MB) */
  MAX_TEXT_SIZE: 1024 * 1024,

  /** Maximum document file size (5MB) */
  MAX_DOCUMENT_SIZE: 5 * 1024 * 1024,
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network connection failed. Please check your internet connection.',
  AUTH_ERROR: 'Authentication failed. Please sign in again.',
  RATE_LIMIT: 'Rate limit exceeded. Please try again later.',
  PAYMENT_REQUIRED: 'Payment required. Please add credits to your account.',
  MODEL_UNAVAILABLE: 'Selected model is currently unavailable. Please try another model.',
  FILE_TOO_LARGE: 'File is too large. Maximum size is {maxSize}.',
  INVALID_FILE_TYPE: 'Invalid file type. Allowed types: {allowedTypes}.',
  GENERIC_ERROR: 'An error occurred. Please try again.',
} as const;

// Success Messages
export const SUCCESS_MESSAGES = {
  FILE_UPLOADED: 'File uploaded successfully',
  MESSAGE_SENT: 'Message sent',
  SETTINGS_SAVED: 'Settings saved successfully',
  CONVERSATION_DELETED: 'Conversation deleted',
  COPIED_TO_CLIPBOARD: 'Copied to clipboard',
} as const;
