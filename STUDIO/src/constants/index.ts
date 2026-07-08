/**
 * Constants barrel — the single import surface for ALL app-wide static values.
 *
 * Per the §2 placement rule, app-wide constants live in `src/constants/`.
 * This barrel re-exports every categorized group so consumers can do:
 *
 *   import { TOKEN_LIMITS, ERROR_MESSAGES } from "@/constants";
 *
 * — regardless of which sibling file actually defines them. New app constants
 * go into one of: app.ts / network.ts / ui.ts / models.ts / splashTiming.ts.
 * Feature-only constants stay co-located in their `features/<x>/constants.ts`
 * (§2 rule 4) — do NOT add them here.
 *
 * Split out of the historical `config/constants.ts` monolith during Phase 5 (T5.1).
 */

export {
  TOKEN_LIMITS,
  CACHE_CONFIG,
  MEMORY_CONFIG,
  VALIDATION,
  FEATURES,
} from "./app";

export {
  NETWORK_CONFIG,
  API_PATHS,
  STORAGE_KEYS,
  SECURITY_CONFIG,
} from "./network";

export {
  UI_CONFIG,
  FILE_LIMITS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from "./ui";

export { MODEL_CONFIG } from "./models";

export {
  STARTUP_SPLASH_MIN_MS,
  SPLASH_EXIT_DURATION_SECONDS,
} from "./splashTiming";

// ── Aggregate (back-compat with the historical `CONSTANTS` export) ───────────
// Kept so any consumer importing `CONSTANTS` or the default export keeps working.
import { TOKEN_LIMITS, CACHE_CONFIG, MEMORY_CONFIG, VALIDATION, FEATURES } from "./app";
import { NETWORK_CONFIG, API_PATHS, STORAGE_KEYS, SECURITY_CONFIG } from "./network";
import { UI_CONFIG, FILE_LIMITS, ERROR_MESSAGES, SUCCESS_MESSAGES } from "./ui";
import { MODEL_CONFIG } from "./models";

export const CONSTANTS = {
  TOKEN_LIMITS,
  CACHE_CONFIG,
  FILE_LIMITS,
  UI_CONFIG,
  NETWORK_CONFIG,
  MEMORY_CONFIG,
  SECURITY_CONFIG,
  MODEL_CONFIG,
  STORAGE_KEYS,
  API_PATHS,
  FEATURES,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  VALIDATION,
} as const;

export default CONSTANTS;
