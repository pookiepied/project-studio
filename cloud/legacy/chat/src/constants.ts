/**
 * Application-wide constants.
 *
 * Keep values that appear in multiple files here so there is a single place
 * to update them. Runtime overrides always come from environment variables —
 * these are only the compile-time defaults / fallbacks.
 *
 * ── Rule ────────────────────────────────────────────────────────────────────
 *   env.VAR_NAME ?? CONSTANT   ← correct: env wins, constant is the fallback
 *   CONSTANT                   ← correct: purely static config
 *   "hardcoded string"         ← wrong if the string appears in more than one file
 */

// ─────────────────────────────────────────────────────────────────────────────
// Application identity
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical public URL for this STUDIO instance. Used as HTTP-Referer for OpenRouter. */
export const STUDIO_SITE_URL = "https://studio.pookiepied.dev";

/** Human-readable app name sent to OpenRouter as X-Title. */
export const STUDIO_APP_TITLE = "STUDIO";

// ─────────────────────────────────────────────────────────────────────────────
// Default model IDs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default TTS model used when the request does not specify one.
 * Format: "provider:modelId" — matches the model ID format in MODELS_KV.
 */
export const DEFAULT_TTS_MODEL = "google:gemini-2.5-flash-preview-tts";

/**
 * Default image generation model shown pre-selected in the UI.
 * Format: "provider:modelId" — must match an entry in MODELS_KV (type:"image").
 * The backend tools do NOT fall back to this value — they require the model
 * to be passed explicitly. This constant is a UI hint only.
 */
export const DEFAULT_IMAGE_MODEL = "openrouter:black-forest-labs/flux.2-pro";

/**
 * Default video generation model shown pre-selected in the UI.
 * Same rules as DEFAULT_IMAGE_MODEL — UI hint only, not a backend fallback.
 */
export const DEFAULT_VIDEO_MODEL = "openrouter:google/veo-3.1-fast";

// ─────────────────────────────────────────────────────────────────────────────
// Streaming timeouts
// ─────────────────────────────────────────────────────────────────────────────

/** Stream closes after this many ms with no data emitted (stuck loop guard). */
export const INACTIVITY_TIMEOUT_MS = 60_000;

/** Hard wall-clock cap per request regardless of activity. */
export const ABSOLUTE_TIMEOUT_MS = 480_000;

/**
 * Frequency of SSE keepalive comments while the LLM is thinking.
 * Must be strictly less than INACTIVITY_TIMEOUT_MS so the inactivity timer
 * never fires during legitimate long LLM responses.
 * SSE comments (`: keepalive\n\n`) are discarded by the frontend SSE parser.
 */
export const HEARTBEAT_INTERVAL_MS = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// Durable Object TTLs
// ─────────────────────────────────────────────────────────────────────────────

/** RateTracker DO storage key TTL: 48 hours in seconds. */
export const RATE_TRACKER_TTL_S = 86_400 * 2;

// ─────────────────────────────────────────────────────────────────────────────
// Platform markers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injected by STUDIO desktop into the conversation when local machine access
 * is enabled. Detected in userContext and systemPrompt to activate the
 * terminal/file tools in the system prompt.
 */
export const HARNESS_MARKER = "[studio-harness: local machine access enabled]";

// ─────────────────────────────────────────────────────────────────────────────
// Image limits
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum image payload size accepted by the vision pipeline. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

// ─────────────────────────────────────────────────────────────────────────────
// Workers AI
// ─────────────────────────────────────────────────────────────────────────────

/** Embedding model used for RAG indexing and querying. 768-dim cosine space. */
export const VECTORIZE_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

// ─────────────────────────────────────────────────────────────────────────────
// HTTP identity
// ─────────────────────────────────────────────────────────────────────────────

/** User-Agent header sent on all outbound HTTP requests from cloud tools. */
export const STUDIO_USER_AGENT = "ProjectStudio-Agent/1.0";

// ─────────────────────────────────────────────────────────────────────────────
// Agent defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fallback model for spawn_agent when the user context does not specify one.
 * Chosen for speed + large context window — adequate for most agent tasks.
 */
export const DEFAULT_AGENT_FALLBACK_MODEL = "groq:llama-3.3-70b-versatile";

/**
 * Maximum number of expand_tools calls allowed per user turn.
 * Prevents runaway tool catalog expansion consuming context.
 */
export const EXPAND_TOOLS_MAX_PER_TURN = 2;
