/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";
import type { ConnectionRow } from "./registry";
import { safeJson } from "./registry";
import { handleRemoteExecute } from "./remote";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Native service tool schemas
// These are hardcoded since native services are system-owned (not user-configured).
// Update when adding new tools to the native workers.
// ---------------------------------------------------------------------------

const NATIVE_SERVICES: Array<{
  id:           string;
  display_name: string;
  binding:      keyof Pick<Env, "MEMORY" | "YOUTUBE_TRANSCRIPT" | "TOOLS" | "SKILLS">;
  tools: Array<{ name: string; description: string; parameters: unknown }>;
}> = [
  {
    id:           "memory",
    display_name: "STUDIO Memory",
    binding:      "MEMORY",
    tools: [
      {
        name:        "memory_recall",
        description: "Multi-layer memory retrieval. Returns profile, recent activity, and semantically relevant facts in one call. Primary tool for getting user context before responding.",
        parameters: {
          type: "object",
          properties: {
            user_id: { type: "string" },
            query:   { type: "string", description: "Topic or current message to find relevant memories for." },
            limit:   { type: "number", description: "Max results (1–20)", default: 5 },
          },
          required: ["user_id", "query"],
        },
      },
      {
        name:        "memory_search",
        description: "Semantic vector search across all memory facts. Returns ranked results by relevance.",
        parameters: {
          type: "object",
          properties: {
            user_id:  { type: "string" },
            query:    { type: "string" },
            category: { type: "string", enum: ["preference","fact","skill","context","goal","relationship","event"] },
            limit:    { type: "number", default: 8 },
          },
          required: ["user_id", "query"],
        },
      },
      {
        name:        "memory_note",
        description: "Explicitly save a fact to STUDIO Memory. Use when the user says 'remember this' or something important should be persisted.",
        parameters: {
          type: "object",
          properties: {
            user_id:         { type: "string" },
            content:         { type: "string", description: "The fact as a self-contained sentence." },
            category:        { type: "string", enum: ["preference","fact","skill","context","goal","relationship","event"] },
            importance:      { type: "number", description: "1–10", default: 5 },
            source_type:     { type: "string", enum: ["stated","observed","inferred"], default: "stated" },
            decay_rate:      { type: "string", enum: ["none","slow","medium","fast"], default: "slow" },
            expires_in_days: { type: "number", description: "Auto-delete after N days. Omit for permanent." },
          },
          required: ["user_id", "content", "category"],
        },
      },
      {
        name:        "memory_profile",
        description: "Get or update the user's core profile (identity + preferences). Profile is auto-injected on every conversation.",
        parameters: {
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
        name:        "memory_delete",
        description: "Delete a specific memory fact or conversation record by ID.",
        parameters: {
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
        name:        "memory_stats",
        description: "Returns memory counts by category, total conversations, and entity relations.",
        parameters: {
          type: "object",
          properties: {
            user_id: { type: "string" },
          },
          required: ["user_id"],
        },
      },
    ],
  },
  {
    id:           "youtube-transcript",
    display_name: "YouTube Transcript",
    binding:      "YOUTUBE_TRANSCRIPT",
    tools: [
      {
        name:        "get_transcript",
        description: "Fetch the full transcript of a YouTube video.",
        parameters: {
          type: "object",
          properties: {
            videoId:  { type: "string", description: "YouTube video ID or full URL." },
            language: { type: "string", description: "Preferred language code (e.g. 'en').", default: "en" },
          },
          required: ["videoId"],
        },
      },
      {
        name:        "get_video_info",
        description: "Get metadata for a YouTube video: title, channel, duration, description.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID or full URL." },
          },
          required: ["videoId"],
        },
      },
    ],
  },
  {
    id:           "studio-tools",
    display_name: "STUDIO Tools",
    binding:      "TOOLS",
    tools: [
      {
        name:        "http_request",
        description: "Make an HTTP request to any URL. Supports all methods (GET, POST, PUT, PATCH, DELETE), custom headers, and request bodies. Use this to interact with APIs, send data to webhooks, or call authenticated endpoints. Returns status code and response body.",
        parameters: {
          type: "object",
          properties: {
            method:    { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method." },
            url:       { type: "string", description: "Full URL including protocol (https://...)." },
            headers:   { type: "object", additionalProperties: { type: "string" }, description: 'Request headers as key-value pairs, e.g. {"Authorization": "Bearer token"}.' },
            body:      { type: "string", description: "Request body as a string. Serialize JSON payloads first. Ignored for GET and DELETE." },
            maxLength: { type: "number", description: "Maximum characters to return from the response body. Defaults to 4000.", default: 4000 },
          },
          required: ["method", "url"],
        },
      },
      {
        name:        "web_search",
        description: "Search the web for current information. Returns an AI-synthesized answer plus relevant results with titles, URLs, and content extracts. Use for research and factual lookups. Follow up with web_fetch only when you need the full page.",
        parameters: {
          type: "object",
          properties: {
            query:      { type: "string", description: "The search query." },
            maxResults: { type: "number", description: "Maximum number of results to return. Defaults to 5, maximum 10.", default: 5 },
          },
          required: ["query"],
        },
      },
      {
        name:        "web_fetch",
        description: "Fetch and read the content of a URL as clean Markdown. Handles HTML, JS-rendered pages, and PDFs. Small pages are returned inline. Large pages (>16KB) are automatically indexed into RAG — result includes auto_indexed=true and a session_id to use with rag(action=query). For API calls needing POST, headers, or auth, use http_request.",
        parameters: {
          type: "object",
          properties: {
            url:       { type: "string", description: "The full URL to fetch (must include http:// or https://)." },
            maxLength: { type: "number", description: "Maximum characters to return inline. Defaults to 16000 (the auto-index threshold). Ignored when content is auto-indexed into RAG." },
          },
          required: ["url"],
        },
      },
      {
        name:        "rag",
        description: 'Index large content for semantic retrieval, then query it by meaning. Use "index" when content is too large to reason over directly — fetched pages, documents, research results, GitHub files. Use "query" to retrieve the most relevant sections by semantic similarity. When web_fetch returns auto_indexed=true, always use rag query with the provided session_id to retrieve content. For indexed books or long documents, use chapter= or section= to restrict the search to a specific part. Scope with session_id to keep content isolated per conversation.',
        parameters: {
          type: "object",
          properties: {
            action:     { type: "string", enum: ["index", "query", "toc"], description: '"index" stores content for later retrieval. "query" searches indexed content semantically. "toc" returns the chapter/section table of contents for a previously indexed document.' },
            session_id: { type: "string", description: "Identifier scoping indexed content. Use the session_id returned by web_fetch when auto_indexed=true, or a chat/conversation ID for manually indexed content." },
            content:    { type: "string", description: "Text to index. Required for action=index." },
            source:     { type: "string", description: "Label for where the content came from (URL, filename, descriptor). Returned in query results." },
            query:      { type: "string", description: "Semantic query to run against indexed content. Required for action=query." },
            top_k:      { type: "number", description: "Number of most relevant chunks to return. Defaults to 5.", default: 5 },
            chapter:    { type: "string", description: "Filter results to a specific chapter. Use the normalized chapter ID returned in previous query results. Omit to search across all chapters." },
            section:    { type: "string", description: 'Filter results to a specific section number, e.g. "7.1". Can be combined with chapter=.' },
          },
          required: ["action", "session_id"],
        },
      },
      {
        name:        "image_generate",
        description: "Generate an image from a text description, edit an existing image, compose from multiple references, or render typography. The model must be provided in 'provider:modelId' format — use the model the user selected in Settings. Set source_image for edit/reimagine mode, reference_images[] for multi-reference composition, font_text for typography, or prompt-only for standard text-to-image. After generation, copy the returned markdownSnippet verbatim into your response.",
        parameters: {
          type: "object",
          properties: {
            model:            { type: "string", description: "Image generation model in provider:modelId format, from the user's Settings. Do not guess — use the configured model." },
            prompt:           { type: "string", description: "Detailed image description. Style prefix is auto-injected — do not repeat it." },
            source_image:     { type: "string", description: "URL (https) or data URL of an existing image to edit/reimagine. Presence switches to editing mode." },
            reference_images: { type: "array", items: { type: "string" }, maxItems: 4, description: "Up to 4 reference image URLs for multi-reference composition. Requires openrouter provider." },
            font_text:        { type: "string", description: "Specific text/words to render inside the image. Requires openrouter provider." },
            aspect_ratio:     { type: "string", enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], description: "Output aspect ratio. Default: 1:1." },
            image_size:       { type: "string", enum: ["1K", "2K", "4K"], description: "Output resolution (OpenRouter only). Default: 1K." },
            style:            { type: "string", enum: ["photorealistic", "anime", "cinematic", "oil-painting", "watercolor", "sketch", "digital-art", "none"], description: "Visual style preset injected as prompt prefix. Default: none." },
          },
          required: ["model", "prompt"],
        },
      },
      {
        name:        "video_generate",
        description: "Generate a video from a text description, or animate a still image into video. The model must be provided in 'fal:modelId' format. Generation is asynchronous: returns a jobId immediately — use video_status to check progress and retrieve the video URL once complete. Text-to-video: model + prompt. Image-to-video: add source_image URL.",
        parameters: {
          type: "object",
          properties: {
            model:        { type: "string", description: "Video generation model in 'fal:modelId' format, from the user's Settings. Do not guess — use the configured model." },
            prompt:       { type: "string", description: "Detailed description of the video content, motion, scene, and mood." },
            source_image: { type: "string", description: "URL of a still image to animate (image-to-video mode)." },
            aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1", "4:3"], description: "Video aspect ratio. Default: 16:9." },
            duration:     { type: "number", description: "Video length in seconds. Typical range: 5–10. Default: 5." },
          },
          required: ["model", "prompt"],
        },
      },
      {
        name:        "video_status",
        description: "Check the status of a video generation job previously submitted with video_generate. Returns the video URL when rendering is complete, or a status message if still processing.",
        parameters: {
          type: "object",
          properties: {
            jobId: { type: "string", description: "The job ID returned by video_generate (the 'jobId' field)." },
            model: { type: "string", description: "The fal.ai model ID returned by video_generate (the 'falModel' field)." },
          },
          required: ["jobId", "model"],
        },
      },
    ],
  },
  {
    id:           "studio-skills",
    display_name: "STUDIO Skills",
    binding:      "SKILLS",
    tools: [
      {
        name:        "skill_read",
        description: "Load instructions for a skill by key. Bundled skills return full content. Local-registered skills return metadata and local_path only; when local tools are connected, use Computer Use skill_read_local or Studio Harness read_file to load local_path/SKILL.md.",
        parameters: {
          type: "object",
          properties: {
            skill:    { type: "string", description: "The skill key (e.g. 'product-self-knowledge'). Must match a key from the skills index." },
            user_id:  { type: "string", description: "User id — required to resolve locally-registered skills." },
            runtime:  { type: "string", enum: ["cloud", "local"], description: "cloud = bundled cloud/system skills only; local = include the user's registered local skills. Defaults to cloud." },
            device_id:{ type: "string" },
          },
          required: ["skill"],
        },
      },
      {
        name:        "skill_list",
        description: "List all available skills (bundled system skills + the user's registered local skills). Returns structured metadata per skill, with duplicate keys preserved (shadowedBy flag shows precedence).",
        parameters: {
          type: "object",
          properties: {
            user_id:  { type: "string" },
            runtime:  { type: "string", enum: ["cloud", "local"] },
            device_id:{ type: "string" },
          },
        },
      },
      {
        name:        "skill_search",
        description: "Search skill metadata (key, name, description, category) by token substring. Searches bundled + registered local skills — never indexes local file content.",
        parameters: {
          type: "object",
          properties: {
            query:    { type: "string", description: "Matched against skill key/name/description/category." },
            user_id:  { type: "string" },
            runtime:  { type: "string", enum: ["cloud", "local"] },
            device_id:{ type: "string" },
          },
          required: ["query"],
        },
      },
      {
        name:        "skill_validate",
        description: "Validate a skill.json manifest and/or SKILL.md body. Returns errors (blocking) and warnings. Does not execute anything. Use before registering an imported skill.",
        parameters: {
          type: "object",
          properties: {
            manifest: { description: "Parsed skill.json object (optional)." },
            skill_md: { type: "string", description: "Raw SKILL.md text (optional). When manifest is absent, metadata is parsed from frontmatter." },
          },
        },
      },
      {
        name:        "skill_register_local",
        description: "Register metadata for a local skill that already exists on the user's machine. Does NOT upload skill content — only metadata/manifest. Local content stays under $HOME/.studio/skills.",
        parameters: {
          type: "object",
          properties: {
            user_id:        { type: "string" },
            key:            { type: "string" },
            name:           { type: "string" },
            description:    { type: "string" },
            category:       { type: "string" },
            version:        { type: "string" },
            allowed_runtime:{ type: "string", enum: ["cloud", "local", "both"], description: "Defaults to local." },
            source_type:    { type: "string", enum: ["bundled", "local_path", "github"], description: "Defaults to local_path." },
            source_url:     { type: "string" },
            local_path:     { type: "string" },
            manifest_json:  { type: "string" },
            content_hash:   { type: "string" },
            device_id:      { type: "string" },
          },
          required: ["user_id", "key", "name", "description"],
        },
      },
      {
        name:        "skill_unregister_local",
        description: "Remove a registered local skill manifest by key (metadata only — does not delete files on disk).",
        parameters: {
          type: "object",
          properties: {
            user_id:  { type: "string" },
            key:      { type: "string" },
            device_id:{ type: "string" },
          },
          required: ["user_id", "key"],
        },
      },
      {
        name:        "skill_install_plan",
        description: "Return a safe, reviewable install plan for a GitHub URL or local path descriptor. Never installs directly in the cloud — local content must be installed by a local/desktop runtime. Never runs scripts.",
        parameters: {
          type: "object",
          properties: {
            source: { type: "string", description: "GitHub repo URL or local folder path." },
          },
          required: ["source"],
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// GET /internal/connections?userId=...
// Returns mcp_local and mcp_remote connections for the user plus native services.
// Composio tools are served separately via /internal/tools/composio.
// ---------------------------------------------------------------------------

export async function handleInternalConnections(userId: string, env: Env): Promise<Response> {
  const { results } = await env.MCP_DB
    .prepare(
      "SELECT * FROM external_connections WHERE user_id = ? AND active = 1 AND type IN ('mcp_local','mcp_remote') ORDER BY created_at DESC"
    )
    .bind(userId)
    .all<ConnectionRow>();

  const connections = (results ?? []).map((row) => ({
    id:           row.id,
    type:         row.type,
    name:         row.name,
    display_name: row.display_name,
    config:       safeJson(row.config),
    active:       row.active === 1,
    created_at:   row.created_at,
    updated_at:   row.updated_at,
  }));

  // Include native services that have their binding wired up
  const native = NATIVE_SERVICES
    .filter((svc) => !!env[svc.binding])
    .map((svc) => ({ id: svc.id, display_name: svc.display_name, tools: svc.tools }));

  return json({ connections, native });
}

// ---------------------------------------------------------------------------
// POST /internal/native/execute
// Proxies a tool call to a native system MCP worker via service binding.
// Uses the MCP Streamable HTTP transport (JSON-RPC 2.0).
// ---------------------------------------------------------------------------

export async function handleNativeExecute(env: Env, request: Request): Promise<Response> {
  let body: { serviceId?: string; toolName?: string; toolArgs?: unknown };
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const { serviceId, toolName, toolArgs } = body;
  if (!serviceId || !toolName) {
    return json({ success: false, error: "serviceId and toolName are required" }, 400);
  }

  const svcDef = NATIVE_SERVICES.find((s) => s.id === serviceId);
  if (!svcDef) {
    return json({ success: false, error: `Unknown native service: ${serviceId}` }, 400);
  }

  const fetcher = env[svcDef.binding] as Fetcher | undefined;
  if (!fetcher) {
    return json({ success: false, error: `Native service '${serviceId}' is not bound in this environment` }, 503);
  }

  try {
    // MCP Streamable HTTP transport — initialize session first, then call tool
    const mcpHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };

    // Step 1: Initialize
    const initRes = await fetcher.fetch(`https://${serviceId}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "studio-mcp-hub", version: "1.0.0" },
        },
      }),
    });

    const sessionId = initRes.headers.get("Mcp-Session-Id");
    if (sessionId) mcpHeaders["Mcp-Session-Id"] = sessionId;

    // Step 2: Notify initialized
    await fetcher.fetch(`https://${serviceId}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    // Step 3: Call the tool
    const callRes = await fetcher.fetch(`https://${serviceId}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: toolArgs ?? {} },
      }),
    });

    if (!callRes.ok) {
      return json({ success: false, error: `Native service returned HTTP ${callRes.status}` }, 502);
    }

    const result = await callRes.json() as { result?: { content?: Array<{ type: string; text?: string }> }; error?: { message?: string } };
    if (result.error) {
      return json({ success: false, error: result.error.message ?? JSON.stringify(result.error) });
    }

    // Extract text content from MCP result
    let data: unknown = result.result;
    if (result.result?.content && Array.isArray(result.result.content)) {
      const texts = result.result.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text as string);
      data = texts.length === 1 ? texts[0] : texts.join("\n");
    }

    return json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: msg }, 502);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleInternalRoutes(
  path: string,
  method: string,
  env: Env,
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (path === "/internal/connections" && method === "GET") {
    const userId = url.searchParams.get("userId");
    if (!userId) return json({ error: "userId required" }, 400);
    return handleInternalConnections(userId, env);
  }

  if (path === "/internal/native/execute" && method === "POST") {
    return handleNativeExecute(env, request);
  }

  if (path === "/internal/remote/execute" && method === "POST") {
    return handleRemoteExecute(request);
  }

  return null;
}
