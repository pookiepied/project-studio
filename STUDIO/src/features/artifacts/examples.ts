import type { Artifact } from "@/types/artifacts";

export const ARTIFACT_EXAMPLES: Artifact[] = [
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "activity",
    title: "Preparing Conversation Context",
    summary: "The cloud runtime is resolving transcript, memory, files, and available tools.",
    status: "loading",
    presentation: {
      surface: "chat",
      density: "line",
      compactLabel: "Preparing context",
    },
    source: {
      tool: "context.prepare",
    },
    sections: [
      {
        type: "timeline",
        title: "Progress",
        items: [
          { label: "Loaded transcript projection", status: "completed" },
          { label: "Resolving attachments", status: "loading" },
          { label: "Selecting tools", status: "pending" },
        ],
      },
    ],
  },
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "research",
    title: "Web Research: Cloudflare Workers Queues",
    summary: "Found current documentation and two implementation references.",
    status: "completed",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Research completed",
    },
    source: {
      tool: "web_search",
    },
    stats: [
      { label: "Sources", value: 5 },
      { label: "Used", value: 3 },
    ],
    sections: [
      {
        type: "links",
        title: "Sources",
        items: [
          { label: "Cloudflare Queues docs", href: "https://developers.cloudflare.com/queues/" },
          { label: "Workers service bindings", href: "https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/" },
        ],
      },
    ],
  },
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "connector_record",
    title: "Email From Finance",
    summary: "A matching Gmail message was found and summarized.",
    status: "completed",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Email found",
    },
    source: {
      app: "gmail",
      tool: "gmail.search",
    },
    sections: [
      {
        type: "kv",
        title: "Message",
        items: [
          { label: "From", value: "finance@example.com" },
          { label: "Subject", value: "July invoice ready" },
          { label: "Received", value: "2026-07-15 09:24" },
        ],
      },
      {
        type: "text",
        title: "Summary",
        content: "The sender says the July invoice is ready for review and asks for approval by Friday.",
      },
    ],
  },
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "connector_action",
    title: "Calendar Event Draft",
    summary: "A calendar event is ready for user approval before it is created.",
    status: "pending",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Approval required",
    },
    source: {
      app: "google-calendar",
      tool: "calendar.create_event",
    },
    sections: [
      {
        type: "kv",
        title: "Event",
        items: [
          { label: "Title", value: "Architecture review" },
          { label: "When", value: "2026-07-16 15:00" },
          { label: "Guests", value: "2" },
        ],
      },
    ],
    actions: [
      { label: "Approve", kind: "open", payload: { decision: "approve" } },
      { label: "Reject", kind: "open", payload: { decision: "reject" } },
    ],
  },
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "file",
    title: "Uploaded Product Brief",
    summary: "The PDF was uploaded and indexed for context retrieval.",
    status: "completed",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "PDF attached",
    },
    source: {
      tool: "uploads.store",
    },
    stats: [
      { label: "Pages", value: 12 },
      { label: "Size", value: "1.8 MB" },
    ],
    sections: [
      {
        type: "kv",
        title: "File",
        items: [
          { label: "Name", value: "product-brief.pdf" },
          { label: "Type", value: "application/pdf" },
        ],
      },
    ],
  },
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "generated_media",
    title: "Generated Cover Image",
    summary: "The requested image was generated and stored as user-generated content.",
    status: "completed",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Image generated",
    },
    source: {
      tool: "image.generate",
    },
    sections: [
      {
        type: "links",
        title: "Output",
        items: [
          { label: "Open generated image", href: "https://api.example.com/cloud/objects/example" },
        ],
      },
      {
        type: "text",
        title: "Prompt",
        content: "A calm product dashboard hero image with soft natural lighting.",
      },
    ],
  },
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "structured_data",
    title: "Extracted Invoice Fields",
    summary: "Key fields were extracted from an uploaded invoice.",
    status: "partial",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Fields extracted",
    },
    sections: [
      {
        type: "table",
        title: "Fields",
        table: {
          columns: ["Field", "Value", "Confidence"],
          rows: [
            ["Invoice number", "INV-2041", "high"],
            ["Amount", "$1,240.00", "high"],
            ["Due date", null, "missing"],
          ],
        },
      },
    ],
  },
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "permission_request",
    title: "Permission Required",
    summary: "The agent needs approval before sending a connector action.",
    status: "pending",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Permission requested",
    },
    source: {
      tool: "connector.execute",
    },
    sections: [
      {
        type: "text",
        title: "Reason",
        content: "Creating the calendar event will modify the user's calendar and requires explicit confirmation.",
      },
    ],
    actions: [
      { label: "Allow once", kind: "open", payload: { decision: "allow_once" } },
      { label: "Deny", kind: "open", payload: { decision: "deny" } },
    ],
  },
];
