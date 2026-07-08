export const MEMORY_CATEGORIES = ["identity", "preference", "project", "event", "knowledge"] as const;

export type MemoryToolDef = { name: string; description: string; schema: any; tier?: 1 | 2 };

export const STUDIO_MEMORY_TOOLS: MemoryToolDef[] = [
  {
    name:        "memory_recall",
    description: "Multi-layer memory retrieval. Returns profile, recent activity, and semantically relevant facts in one call. Primary tool for getting user context before responding.",
    schema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        query:   { type: "string", description: "Topic or current message to find relevant memories for." },
        limit:   { type: "number", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["user_id", "query"],
    },
  },
  {
    name:        "memory_search",
    description: "Semantic vector search across all memory facts. Returns ranked results by relevance.",
    schema: {
      type: "object",
      properties: {
        user_id:  { type: "string" },
        query:    { type: "string" },
        category: { type: "string", enum: MEMORY_CATEGORIES },
        limit:    { type: "number", minimum: 1, maximum: 20, default: 8 },
      },
      required: ["user_id", "query"],
    },
  },
  {
    name:        "memory_recent",
    description: "Get the most recent conversation summaries, newest first.",
    schema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        limit:   { type: "number", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["user_id"],
    },
  },
  {
    name:        "memory_profile",
    description: "Get or update the user's core profile (identity + preferences). Profile is auto-injected on every conversation.",
    schema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        updates: {
          type: "object",
          properties: {
            identity:   { type: "array", items: { type: "string" } },
            preference: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["user_id"],
    },
  },
  {
    name:        "memory_note",
    description: "Explicitly save a fact to STUDIO Memory. Use when the user says 'remember this' or something important should be persisted immediately.",
    schema: {
      type: "object",
      properties: {
        user_id:         { type: "string" },
        content:         { type: "string", description: "The fact as a self-contained sentence." },
        category:        { type: "string", enum: MEMORY_CATEGORIES },
        importance:      { type: "number", minimum: 1, maximum: 10, default: 5 },
        expires_in_days: { type: "number", minimum: 1, description: "Auto-delete after N days. Omit for permanent." },
      },
      required: ["user_id", "content", "category"],
    },
  },
  {
    name:        "memory_relate",
    description: "Query the entity relationship graph. Returns all known relationships for a named entity (person, project, tool, concept).",
    schema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        entity:  { type: "string", description: "Entity name to look up (e.g. 'Studio', 'Cloudflare', 'TypeScript')." },
      },
      required: ["user_id", "entity"],
    },
  },
  {
    name:        "memory_timeline",
    description: "Get conversation summaries in time order. Use for 'what happened last week?' or 'what did I work on in May?'",
    schema: {
      type: "object",
      properties: {
        user_id:   { type: "string" },
        limit:     { type: "number", minimum: 1, maximum: 50, default: 10 },
        from_date: { type: "string", description: "Start date YYYY-MM-DD (inclusive)." },
        to_date:   { type: "string", description: "End date YYYY-MM-DD (inclusive)." },
      },
      required: ["user_id"],
    },
  },
  {
    name:        "memory_list",
    description: "Browse memory facts filtered by category and/or tag.",
    schema: {
      type: "object",
      properties: {
        user_id:  { type: "string" },
        category: { type: "string", enum: MEMORY_CATEGORIES },
        tag:      { type: "string" },
        limit:    { type: "number", minimum: 1, maximum: 50, default: 20 },
        offset:   { type: "number", minimum: 0, default: 0 },
      },
      required: ["user_id"],
    },
  },
  {
    name:        "memory_delete",
    description: "Delete a specific memory fact or conversation record by ID.",
    schema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        id:      { type: "string" },
        type:    { type: "string", enum: ["fact", "conversation"] },
      },
      required: ["user_id", "id", "type"],
    },
  },
  {
    name:        "memory_forget",
    description: "Bulk delete memory facts matching a tag, category, or date range.",
    schema: {
      type: "object",
      properties: {
        user_id:     { type: "string" },
        tag:         { type: "string" },
        category:    { type: "string", enum: MEMORY_CATEGORIES },
        before_date: { type: "string", description: "YYYY-MM-DD — delete facts created before this date." },
      },
      required: ["user_id"],
    },
  },
  {
    name:        "memory_stats",
    description: "Returns memory counts by category, total conversations, and relations. Useful for diagnostics.",
    schema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
      },
      required: ["user_id"],
    },
  },
];
