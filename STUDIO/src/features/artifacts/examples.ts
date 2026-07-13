import type { Artifact } from "@/types/artifacts";

export const ARTIFACT_EXAMPLES: Artifact[] = [
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "weather",
    title: "Weather In Dhaka",
    summary: "Warm and cloudy with a chance of rain later today.",
    status: "success",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Weather checked",
    },
    source: {
      tool: "weather",
    },
    stats: [
      { label: "Temperature", value: "31 C" },
      { label: "Rain", value: "42%" },
      { label: "Wind", value: "12 km/h" },
      { label: "Humidity", value: "78%" },
    ],
    sections: [
      {
        type: "kv",
        title: "Conditions",
        items: [
          { label: "Sky", value: "Cloudy" },
          { label: "Feels Like", value: "36 C" },
        ],
      },
    ],
  },
  {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "task",
    title: "Organize Artifact Architecture",
    summary: "A planning task was created and is ready to track in overview.",
    status: "pending",
    presentation: {
      surface: "overview",
      density: "line",
      compactLabel: "Task created",
      defaultCollapsed: false,
    },
    source: {
      tool: "task_write",
    },
    sections: [
      {
        type: "list",
        title: "Steps",
        items: [
          { label: "Define universal artifact envelope", status: "success" },
          { label: "Map general tool artifacts", status: "pending" },
          { label: "Plan coding artifact layer", status: "pending" },
        ],
      },
    ],
  },
  {
    type: "artifact",
    version: 1,
    category: "coding",
    kind: "work_summary",
    title: "Reviewed Chat Rendering",
    summary: "Explored chat rendering and identified where artifact cards can attach.",
    status: "success",
    presentation: {
      surface: "overview",
      density: "card",
      compactLabel: "Explored codebase",
      defaultCollapsed: true,
    },
    sections: [
      {
        type: "timeline",
        title: "Activity",
        items: [
          { label: "Explored codebase", description: "Checked chat rendering, tool cards, and markdown renderer." },
          { label: "Mapped artifact entry point", description: "Connected artifact blocks through CodeBlock." },
        ],
      },
      {
        type: "file_changes",
        title: "Touched Files",
        items: [
          { path: "STUDIO/src/components/ui/CodeBlock.tsx", action: "updated", additions: 2, deletions: 1 },
          { path: "STUDIO/src/types/artifacts.ts", action: "created", additions: 124, deletions: 0 },
        ],
      },
    ],
  },
];
