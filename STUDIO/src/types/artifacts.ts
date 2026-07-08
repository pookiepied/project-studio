export type ArtifactCategory = "general" | "coding";

export type ArtifactSurface = "chat" | "overview" | "panel";

export type ArtifactStatus = "success" | "partial" | "pending" | "error";

export type ArtifactDensity = "line" | "card" | "expanded";

export interface ArtifactPresentation {
  surface?: ArtifactSurface;
  density?: ArtifactDensity;
  defaultCollapsed?: boolean;
  compactLabel?: string;
  priority?: number;
}

export interface ArtifactSource {
  provider?: string;
  server?: string;
  tool?: string;
  app?: string;
  callId?: string;
}

export interface ArtifactAction {
  label: string;
  kind?: "link" | "open" | "retry" | "copy";
  href?: string;
  payload?: Record<string, unknown>;
}

export interface ArtifactStat {
  label: string;
  value: string | number | boolean;
}

export interface ArtifactLink {
  label: string;
  href: string;
  description?: string;
}

export interface ArtifactListItem {
  label?: string;
  value?: string | number | boolean;
  description?: string;
  href?: string;
  status?: ArtifactStatus;
}

export interface ArtifactTable {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
}

export interface ArtifactTimelineItem {
  label: string;
  time?: string;
  description?: string;
  status?: ArtifactStatus;
}

export interface ArtifactFileChange {
  path: string;
  action?: "created" | "updated" | "deleted" | "renamed" | "read";
  additions?: number;
  deletions?: number;
  language?: string;
}

export type ArtifactSection =
  | {
      type: "text";
      title?: string;
      content: string;
    }
  | {
      type: "stats";
      title?: string;
      items: ArtifactStat[];
    }
  | {
      type: "kv";
      title?: string;
      items: ArtifactListItem[];
    }
  | {
      type: "list";
      title?: string;
      items: ArtifactListItem[];
    }
  | {
      type: "links";
      title?: string;
      items: ArtifactLink[];
    }
  | {
      type: "table";
      title?: string;
      table: ArtifactTable;
    }
  | {
      type: "timeline";
      title?: string;
      items: ArtifactTimelineItem[];
    }
  | {
      type: "file_changes";
      title?: string;
      items: ArtifactFileChange[];
    }
  | {
      type: "json";
      title?: string;
      data: unknown;
    };

export interface Artifact {
  type: "artifact";
  version: 1;
  id?: string;
  category?: ArtifactCategory;
  kind: string;
  title: string;
  summary?: string;
  status?: ArtifactStatus;
  source?: ArtifactSource;
  presentation?: ArtifactPresentation;
  stats?: ArtifactStat[];
  primaryAction?: ArtifactAction;
  actions?: ArtifactAction[];
  sections?: ArtifactSection[];
  data?: unknown;
  meta?: Record<string, unknown>;
}
