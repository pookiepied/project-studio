import type { ComposioAppConfig, Env } from "../../types";
import { normalizeKey, parseJson } from "../../http/request";

const DEFAULT_COMPOSIO_APPS: Omit<ComposioAppConfig, "authConfigId">[] = [
  {
    appKey: "gmail",
    toolkitSlug: "gmail",
    name: "Gmail",
    description: "Read, draft, and send email through the user's connected Gmail account.",
    categories: ["Google", "Email"],
    curatedCategory: "Google Workspace",
  },
  {
    appKey: "googlecalendar",
    toolkitSlug: "googlecalendar",
    name: "Google Calendar",
    description: "Read, create, and manage calendar events.",
    categories: ["Google", "Calendar"],
    curatedCategory: "Google Workspace",
  },
  {
    appKey: "googledrive",
    toolkitSlug: "googledrive",
    name: "Google Drive",
    description: "Search, read, and organize files in Google Drive.",
    categories: ["Google", "Files"],
    curatedCategory: "Google Workspace",
  },
  {
    appKey: "googledocs",
    toolkitSlug: "googledocs",
    name: "Google Docs",
    description: "Read and work with Google Docs documents.",
    categories: ["Google", "Documents"],
    curatedCategory: "Google Workspace",
  },
  {
    appKey: "googlesheets",
    toolkitSlug: "googlesheets",
    name: "Google Sheets",
    description: "Read and update spreadsheets in Google Sheets.",
    categories: ["Google", "Spreadsheets"],
    curatedCategory: "Google Workspace",
  },
  {
    appKey: "github",
    toolkitSlug: "github",
    name: "GitHub",
    description: "Work with repositories, issues, pull requests, and CI signals.",
    categories: ["Developer", "Code"],
    curatedCategory: "Developer",
  },
  {
    appKey: "slack",
    toolkitSlug: "slack",
    name: "Slack",
    description: "Read and manage messages, channels, and workspace activity.",
    categories: ["Communication"],
    curatedCategory: "Communication",
  },
  {
    appKey: "notion",
    toolkitSlug: "notion",
    name: "Notion",
    description: "Search, create, and update pages, notes, and databases.",
    categories: ["Knowledge"],
    curatedCategory: "Knowledge",
  },
  {
    appKey: "linear",
    toolkitSlug: "linear",
    name: "Linear",
    description: "Manage issues, projects, cycles, and product work.",
    categories: ["Developer", "Project Management"],
    curatedCategory: "Developer",
  },
  {
    appKey: "jira",
    toolkitSlug: "jira",
    name: "Jira",
    description: "Search and manage Jira issues, projects, and workflows.",
    categories: ["Project Management"],
    curatedCategory: "Project Management",
  },
  {
    appKey: "trello",
    toolkitSlug: "trello",
    name: "Trello",
    description: "Manage boards, cards, and project workflows.",
    categories: ["Project Management"],
    curatedCategory: "Project Management",
  },
  {
    appKey: "asana",
    toolkitSlug: "asana",
    name: "Asana",
    description: "Manage tasks, projects, and team work.",
    categories: ["Project Management"],
    curatedCategory: "Project Management",
  },
  {
    appKey: "hubspot",
    toolkitSlug: "hubspot",
    name: "HubSpot",
    description: "Work with CRM contacts, companies, deals, and engagement data.",
    categories: ["CRM", "Sales"],
    curatedCategory: "Sales & CRM",
  },
  {
    appKey: "salesforce",
    toolkitSlug: "salesforce",
    name: "Salesforce",
    description: "Work with Salesforce CRM records and workflows.",
    categories: ["CRM", "Sales"],
    curatedCategory: "Sales & CRM",
  },
  {
    appKey: "zendesk",
    toolkitSlug: "zendesk",
    name: "Zendesk",
    description: "Work with support tickets, users, and customer conversations.",
    categories: ["Support"],
    curatedCategory: "Support",
  },
  {
    appKey: "intercom",
    toolkitSlug: "intercom",
    name: "Intercom",
    description: "Work with customer conversations, users, and support workflows.",
    categories: ["Support"],
    curatedCategory: "Support",
  },
  {
    appKey: "figma",
    toolkitSlug: "figma",
    name: "Figma",
    description: "Search and inspect Figma design files and project context.",
    categories: ["Design"],
    curatedCategory: "Design",
  },
  {
    appKey: "airtable",
    toolkitSlug: "airtable",
    name: "Airtable",
    description: "Read and update Airtable bases, tables, and records.",
    categories: ["Database", "Operations"],
    curatedCategory: "Data & Ops",
  },
  {
    appKey: "clickup",
    toolkitSlug: "clickup",
    name: "ClickUp",
    description: "Manage ClickUp tasks, lists, folders, and project work.",
    categories: ["Project Management"],
    curatedCategory: "Project Management",
  },
  {
    appKey: "microsoftteams",
    toolkitSlug: "microsoftteams",
    name: "Microsoft Teams",
    description: "Work with Teams conversations, channels, and collaboration data.",
    categories: ["Communication", "Microsoft"],
    curatedCategory: "Microsoft 365",
  },
  {
    appKey: "outlook",
    toolkitSlug: "outlook",
    name: "Outlook",
    description: "Read, draft, and send email through Outlook.",
    categories: ["Email", "Microsoft"],
    curatedCategory: "Microsoft 365",
  },
  {
    appKey: "onedrive",
    toolkitSlug: "onedrive",
    name: "OneDrive",
    description: "Search, read, and organize files in OneDrive.",
    categories: ["Files", "Microsoft"],
    curatedCategory: "Microsoft 365",
  },
  {
    appKey: "zoom",
    toolkitSlug: "zoom",
    name: "Zoom",
    description: "Work with meetings, recordings, and collaboration context.",
    categories: ["Communication", "Meetings"],
    curatedCategory: "Communication",
  },
  {
    appKey: "canva",
    toolkitSlug: "canva",
    name: "Canva",
    description: "Work with Canva designs and creative assets.",
    categories: ["Design"],
    curatedCategory: "Design",
  },
  {
    appKey: "supabase",
    toolkitSlug: "supabase",
    name: "Supabase",
    description: "Work with Supabase projects and database context.",
    categories: ["Developer", "Database"],
    curatedCategory: "Developer",
  },
  {
    appKey: "googlemaps",
    toolkitSlug: "googlemaps",
    name: "Google Maps",
    description: "Search places, routes, and location data through Google Maps.",
    categories: ["Maps", "Google"],
    curatedCategory: "Location",
  },
  {
    appKey: "firecrawl",
    toolkitSlug: "firecrawl",
    name: "Firecrawl",
    description: "Crawl and extract structured content from websites.",
    categories: ["Web", "Research"],
    curatedCategory: "Research",
  },
  {
    appKey: "dropbox",
    toolkitSlug: "dropbox",
    name: "Dropbox",
    description: "Search, read, and organize files in Dropbox.",
    categories: ["Files"],
    curatedCategory: "Files",
  },
];

type ConfigOverride = Partial<ComposioAppConfig> & {
  auth_config_id?: string;
  authConfigId?: string;
  toolkit_slug?: string;
  toolkitSlug?: string;
};

export function getComposioAppCatalog(env: Env): ComposioAppConfig[] {
  const overrides = parseJson<Record<string, ConfigOverride>>(env.COMPOSIO_AUTH_CONFIGS_JSON, {});

  return DEFAULT_COMPOSIO_APPS.map((app) => {
    const override = overrides[app.appKey] ?? overrides[app.toolkitSlug] ?? {};
    return {
      ...app,
      ...override,
      appKey: normalizeKey(override.appKey ?? app.appKey),
      toolkitSlug: normalizeKey(override.toolkitSlug ?? override.toolkit_slug ?? app.toolkitSlug),
      authConfigId: override.authConfigId ?? override.auth_config_id,
    };
  });
}

export function getComposioAppConfig(env: Env, appKey: string): ComposioAppConfig | null {
  const normalized = normalizeKey(appKey);
  return getComposioAppCatalog(env).find(
    (app) => app.appKey === normalized || app.toolkitSlug === normalized,
  ) ?? null;
}
