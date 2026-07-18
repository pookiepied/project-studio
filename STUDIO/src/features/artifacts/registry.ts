import type { Artifact, ArtifactStatus } from "@/types/artifacts";

export type ArtifactFamily =
  | "activity"
  | "research"
  | "generated_media"
  | "connector_record"
  | "connector_action"
  | "file"
  | "structured_data"
  | "permission"
  | "coding"
  | "generic";

const KIND_TO_FAMILY: Record<string, ArtifactFamily> = {
  activity: "activity",
  task: "activity",
  work_summary: "activity",
  research: "research",
  web_search: "research",
  web_fetch: "research",
  web_research: "research",
  generated_media: "generated_media",
  generated_image: "generated_media",
  image_generation: "generated_media",
  generated_video: "generated_media",
  video_generation: "generated_media",
  gmail_search: "connector_record",
  gmail_message: "connector_record",
  gmail_thread: "connector_record",
  gmail_draft: "connector_action",
  gmail_action: "connector_action",
  outlook_search: "connector_record",
  outlook_message: "connector_record",
  outlook_thread: "connector_record",
  outlook_draft: "connector_action",
  outlook_action: "connector_action",
  calendar_search: "connector_record",
  calendar_list: "connector_record",
  calendar_schedule: "connector_record",
  calendar_event: "connector_record",
  calendar_draft: "connector_action",
  calendar_action: "connector_action",
  calendar_availability: "connector_action",
  googledrive_search: "connector_record",
  googledrive_list: "connector_record",
  googledrive_file: "file",
  googledrive_action: "connector_action",
  googledocs_file: "file",
  googledocs_action: "connector_action",
  googlesheets_file: "structured_data",
  googlesheets_action: "connector_action",
  onedrive_search: "connector_record",
  onedrive_file: "file",
  onedrive_action: "connector_action",
  dropbox_search: "connector_record",
  dropbox_file: "file",
  dropbox_action: "connector_action",
  github_search: "connector_record",
  github_issue: "connector_record",
  github_pull_request: "connector_record",
  github_repository: "connector_record",
  github_workflow: "connector_record",
  github_action: "connector_action",
  todoist_search: "connector_record",
  todoist_task: "connector_record",
  todoist_draft: "connector_action",
  todoist_action: "connector_action",
  task_list: "connector_record",
  task_draft: "connector_action",
  task_action: "connector_action",
  linear_issue: "connector_record",
  linear_action: "connector_action",
  jira_issue: "connector_record",
  jira_action: "connector_action",
  trello_card: "connector_record",
  trello_action: "connector_action",
  asana_task: "connector_record",
  asana_action: "connector_action",
  clickup_task: "connector_record",
  clickup_action: "connector_action",
  connector_record: "connector_record",
  connector_action: "connector_action",
  file: "file",
  upload: "file",
  document: "file",
  structured_data: "structured_data",
  table: "structured_data",
  permission_request: "permission",
};

export interface ArtifactRendererDescriptor {
  family: ArtifactFamily;
  label: string;
  inline: "full" | "compact";
  expandable: boolean;
  statuses: ArtifactStatus[];
}

export const ARTIFACT_RENDERERS: Record<ArtifactFamily, ArtifactRendererDescriptor> = {
  activity: {
    family: "activity",
    label: "Activity",
    inline: "compact",
    expandable: false,
    statuses: ["loading", "streaming", "completed", "failed", "cancelled", "pending", "success", "error"],
  },
  research: {
    family: "research",
    label: "Research",
    inline: "full",
    expandable: true,
    statuses: ["loading", "streaming", "completed", "partial", "failed", "empty", "pending", "success", "error"],
  },
  generated_media: {
    family: "generated_media",
    label: "Generated media",
    inline: "full",
    expandable: true,
    statuses: ["loading", "completed", "failed", "cancelled", "pending", "success", "error"],
  },
  connector_record: {
    family: "connector_record",
    label: "Connector record",
    inline: "full",
    expandable: true,
    statuses: ["completed", "partial", "empty", "failed", "success", "error"],
  },
  connector_action: {
    family: "connector_action",
    label: "Connector action",
    inline: "full",
    expandable: true,
    statuses: ["pending", "completed", "failed", "rejected", "cancelled", "success", "error"],
  },
  file: {
    family: "file",
    label: "File",
    inline: "full",
    expandable: true,
    statuses: ["loading", "completed", "partial", "failed", "pending", "success", "error"],
  },
  structured_data: {
    family: "structured_data",
    label: "Structured data",
    inline: "full",
    expandable: true,
    statuses: ["completed", "partial", "empty", "failed", "success", "error"],
  },
  permission: {
    family: "permission",
    label: "Permission",
    inline: "full",
    expandable: false,
    statuses: ["pending", "completed", "rejected", "cancelled"],
  },
  coding: {
    family: "coding",
    label: "Coding",
    inline: "compact",
    expandable: true,
    statuses: ["loading", "streaming", "completed", "partial", "failed", "cancelled", "pending", "success", "error"],
  },
  generic: {
    family: "generic",
    label: "Artifact",
    inline: "full",
    expandable: true,
    statuses: ["loading", "streaming", "completed", "partial", "failed", "cancelled", "rejected", "empty", "pending", "success", "error"],
  },
};

export function artifactFamily(artifact: Artifact): ArtifactFamily {
  if (artifact.category === "coding") return "coding";
  return KIND_TO_FAMILY[artifact.kind] ?? "generic";
}

export function artifactRendererDescriptor(artifact: Artifact): ArtifactRendererDescriptor {
  return ARTIFACT_RENDERERS[artifactFamily(artifact)];
}
