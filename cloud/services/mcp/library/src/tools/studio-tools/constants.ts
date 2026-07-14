// Shared constants for studio-mcp-tools.
// Kept in sync with the chat worker's constants for ported tools.

export const STUDIO_USER_AGENT = "ProjectStudio-Agent/1.0";

// Workers AI embedding model — must match the studio-rag Vectorize index (768-dim).
export const VECTORIZE_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
