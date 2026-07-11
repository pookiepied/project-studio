export interface Env {
  ENVIRONMENT: string;
  /** D1 — structured metadata (conversations, messages, records). */
  DATA_DB: D1Database;
  /** R2 — cloud conversation transcripts and exports. */
  CONVERSATIONS: R2Bucket;
  /** R2 — user-provided uploads. */
  UPLOADS: R2Bucket;
  /** R2 — generated media and artifact content. */
  GENERATED: R2Bucket;
}
