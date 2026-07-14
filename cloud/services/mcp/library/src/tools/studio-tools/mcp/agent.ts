import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { runHttpRequest } from "../tools/httpRequest";
import { runWebSearch } from "../tools/webSearch";
import { runWebFetch } from "../tools/webFetch";
import { runRag } from "../tools/rag";
import { AUTO_INDEX_THRESHOLD } from "../tools/indexing";
import { runImageGenerate } from "../tools/imageGenerate";
import { runVideoGenerate } from "../tools/videoGenerate";
import { runVideoStatus } from "../tools/videoStatus";

/**
 * StudioToolsAgent — the MCP server for STUDIO's first-party native work tools.
 *
 * Tools registered here are surfaced to the main agent (chat) and sub-agents
 * (agents worker) through the studio-mcp hub's NATIVE_SERVICES catalog. Each
 * tool's `name`, `description`, and parameter schema MUST stay in sync with the
 * hub's hardcoded schema for this service (mcp/src/routes/internal.ts), since
 * the hub advertises those schemas to callers without querying this worker.
 *
 * Tools are migrated in group by group (see STUDIO_AGENT_TOOL_PLAN.md):
 *   network   → http_request                              [this step]
 *   retrieval → web_search, web_fetch, rag                [next]
 *   generation→ image_generate, video_generate, video_status
 *   ux        → task_write, skill_read, expand_tools
 */
export class StudioToolsAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "studio-tools",
    version: "1.0.0",
  });

  async init(): Promise<void> {
    // ── http_request ─────────────────────────────────────────────────────
    this.server.tool(
      "http_request",
      "Make an HTTP request to any URL. Supports all methods (GET, POST, PUT, PATCH, DELETE), custom headers, and request bodies. Use this to interact with APIs, send data to webhooks, or call authenticated endpoints. Returns status code and response body.",
      {
        method:    z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().default("GET"),
        url:       z.string().describe("Full URL including protocol (https://...)."),
        headers:   z.record(z.string()).optional().describe('Request headers as key-value pairs, e.g. {"Authorization": "Bearer token"}.'),
        body:      z.string().optional().describe("Request body as a string. Serialize JSON payloads first. Ignored for GET and DELETE."),
        maxLength: z.number().int().min(1).optional().default(4000).describe("Maximum characters to return from the response body."),
      },
      async ({ method, url, headers, body, maxLength }) => {
        const result = await runHttpRequest({ method, url, headers, body, maxLength });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    );

    // ── web_search ───────────────────────────────────────────────────────
    this.server.tool(
      "web_search",
      "Search the web for current information. Returns an AI-synthesized answer plus relevant results with titles, URLs, and content extracts. Use for research and factual lookups. Follow up with web_fetch only when you need the full page.",
      {
        query:      z.string().describe("The search query."),
        maxResults: z.number().int().min(1).max(10).optional().default(5).describe("Maximum number of results to return. Defaults to 5, maximum 10."),
      },
      async ({ query, maxResults }) => {
        const result = await runWebSearch(this.env, { query, maxResults });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    );

    // ── web_fetch ────────────────────────────────────────────────────────
    this.server.tool(
      "web_fetch",
      "Fetch and read the content of a URL as clean Markdown. Handles HTML, JS-rendered pages, and PDFs. Small pages are returned inline. Large pages (>16KB) are automatically indexed into RAG — result includes auto_indexed=true and a session_id to use with rag(action=query). For API calls needing POST, headers, or auth, use http_request.",
      {
        url:       z.string().describe("The full URL to fetch (must include http:// or https://)."),
        maxLength: z.number().int().min(1).optional().default(AUTO_INDEX_THRESHOLD).describe(`Maximum characters to return inline. Defaults to ${AUTO_INDEX_THRESHOLD} (the auto-index threshold). Ignored when content is auto-indexed into RAG.`),
      },
      async ({ url, maxLength }) => {
        const result = await runWebFetch(this.env, { url, maxLength });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    );

    // ── rag ──────────────────────────────────────────────────────────────
    this.server.tool(
      "rag",
      'Index large content for semantic retrieval, then query it by meaning. Use "index" when content is too large to reason over directly — fetched pages, documents, research results, GitHub files. Use "query" to retrieve the most relevant sections by semantic similarity. When web_fetch returns auto_indexed=true, always use rag query with the provided session_id to retrieve content. For indexed books or long documents, use chapter= or section= to restrict the search to a specific part. Scope with session_id to keep content isolated per conversation.',
      {
        action:     z.enum(["index", "query", "toc"]).describe('"index" stores content for later retrieval. "query" searches indexed content semantically. "toc" returns the chapter/section table of contents for a previously indexed document.'),
        session_id: z.string().describe("Identifier scoping indexed content. Use the session_id returned by web_fetch when auto_indexed=true, or a chat/conversation ID for manually indexed content."),
        content:    z.string().optional().describe("Text to index. Required for action=index."),
        source:     z.string().optional().describe("Label for where the content came from (URL, filename, descriptor). Returned in query results."),
        query:      z.string().optional().describe("Semantic query to run against indexed content. Required for action=query."),
        top_k:      z.number().int().min(1).max(20).optional().default(5).describe("Number of most relevant chunks to return. Defaults to 5."),
        chapter:    z.string().optional().describe('Filter results to a specific chapter. Use the normalized chapter ID returned in previous query results. Omit to search across all chapters.'),
        section:    z.string().optional().describe('Filter results to a specific section number, e.g. "7.1". Can be combined with chapter=.'),
      },
      async ({ action, session_id, content, source, query, top_k, chapter, section }) => {
        const result = await runRag(this.env, { action, session_id, content, source, query, top_k, chapter, section });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    );

    // ── image_generate ───────────────────────────────────────────────────
    this.server.tool(
      "image_generate",
      "Generate an image from a text description, edit an existing image, compose from multiple references, or render typography. The model must be provided in 'provider:modelId' format — use the model the user selected in Settings. Set source_image for edit/reimagine mode, reference_images[] for multi-reference composition, font_text for typography, or prompt-only for standard text-to-image. After generation, copy the returned markdownSnippet verbatim into your response.",
      {
        model:            z.string().describe("Image generation model in provider:modelId format, from the user's Settings (e.g. 'fal:fal-ai/flux-pro/v1.1'). Do not guess — use the configured model."),
        prompt:           z.string().describe("Detailed image description. Be specific about subject, lighting, composition, and mood. Style prefix is auto-injected — do not repeat it."),
        source_image:     z.string().optional().describe("URL (https) or data URL of an existing image to edit/reimagine. Presence switches to editing mode."),
        reference_images: z.array(z.string()).max(4).optional().describe("Up to 4 reference image URLs for multi-reference composition. Requires openrouter provider."),
        font_text:        z.string().optional().describe("Specific text/words to render inside the image (logo, title card, sign). Requires openrouter provider."),
        aspect_ratio:     z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]).optional().describe("Output aspect ratio. Default: 1:1."),
        image_size:       z.enum(["1K", "2K", "4K"]).optional().describe("Output resolution (OpenRouter only). Default: 1K."),
        style:            z.enum(["photorealistic", "anime", "cinematic", "oil-painting", "watercolor", "sketch", "digital-art", "none"]).optional().describe("Visual style preset injected as prompt prefix. Default: none."),
      },
      async (args) => {
        const result = await runImageGenerate(this.env, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    );

    // ── video_generate ───────────────────────────────────────────────────
    this.server.tool(
      "video_generate",
      "Generate a video from a text description, or animate a still image into video. The model must be provided in 'fal:modelId' format — use the model the user selected in Settings. Generation is asynchronous: the tool returns a jobId immediately — use video_status to check progress and retrieve the video URL once rendering is complete. Text-to-video: provide model + prompt. Image-to-video: add source_image URL.",
      {
        model:        z.string().describe("Video generation model in 'fal:modelId' format, from the user's Settings. Do not guess — use the configured model."),
        prompt:       z.string().describe("Detailed description of the video content, motion, scene, and mood."),
        source_image: z.string().optional().describe("URL of a still image to animate (image-to-video mode). Switches to the image-to-video variant of the selected model."),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3"]).optional().describe("Video aspect ratio. Default: 16:9."),
        duration:     z.number().optional().describe("Video length in seconds. Typical range: 5–10. Default: 5."),
      },
      async ({ model, prompt, source_image, aspect_ratio, duration }) => {
        const result = await runVideoGenerate(this.env, { model, prompt, source_image, aspect_ratio, duration });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    );

    // ── video_status ─────────────────────────────────────────────────────
    this.server.tool(
      "video_status",
      "Check the status of a video generation job previously submitted with video_generate. Returns the video URL when rendering is complete, or a status message if still processing. Call this when the user asks to check their video progress.",
      {
        jobId: z.string().describe("The job ID returned by video_generate (the 'jobId' field)."),
        model: z.string().describe("The fal.ai model ID returned by video_generate (the 'falModel' field)."),
      },
      async ({ jobId, model }) => {
        const result = await runVideoStatus(this.env, { jobId, model });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    );
  }
}
