import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArtifactRenderer } from "@/features/markdown";
import { Select } from "@/ui/primitives/Select";
import { Calendar, Checklist, Clock, Code, Edit, Email, Files, FolderOpen, GithubLogoIcon, Icon, ImageSquareIcon, Search, Send, SparkleIcon, Success, VideoCameraIcon, Warning } from "@/ui/icons";
import type { Artifact } from "@/types/artifacts";

type CatalogArtifactId =
  | "web-searching"
  | "web-fetching"
  | "web-completed"
  | "image-queued"
  | "image-generating"
  | "image-completed"
  | "video-queued"
  | "video-generating"
  | "video-completed"
  | "gmail-searching"
  | "gmail-search"
  | "gmail-empty"
  | "gmail-single-message"
  | "gmail-message"
  | "gmail-sent"
  | "gmail-draft"
  | "gmail-draft-editing"
  | "gmail-forward"
  | "gmail-action"
  | "gmail-organize"
  | "gmail-failed"
  | "outlook-search"
  | "outlook-message"
  | "outlook-draft"
  | "outlook-action"
  | "calendar-search"
  | "calendar-event"
  | "calendar-draft"
  | "calendar-action"
  | "calendar-schedule"
  | "calendar-availability"
  | "drive-search"
  | "drive-file"
  | "drive-action"
  | "github-search"
  | "github-pr"
  | "github-action"
  | "todoist-search"
  | "todoist-draft"
  | "todoist-action";

type CatalogFamily = "web" | "image" | "video" | "gmail" | "outlook" | "calendar" | "files" | "github" | "tasks";

type ActivityStatus = "running" | "completed" | "failed" | "pending";

type ToolActivityCall = {
  id: string;
  title: string;
  subtitle?: string;
  status: ActivityStatus;
  preview?: string;
};

type ToolActivityGroup = {
  id: string;
  title: string;
  subtitle: string;
  status: ActivityStatus;
  icon: React.ReactNode;
  calls: ToolActivityCall[];
};

const ARTIFACT_OPTIONS: Array<{ value: CatalogArtifactId; label: string }> = [
  { value: "web-searching", label: "Web research / searching" },
  { value: "web-fetching", label: "Web research / fetching sources" },
  { value: "web-completed", label: "Web research / completed" },
  { value: "image-queued", label: "Image generation / queued" },
  { value: "image-generating", label: "Image generation / active" },
  { value: "image-completed", label: "Image generation / completed" },
  { value: "video-queued", label: "Video generation / queued" },
  { value: "video-generating", label: "Video generation / active" },
  { value: "video-completed", label: "Video generation / completed" },
  { value: "gmail-searching", label: "Gmail / searching" },
  { value: "gmail-search", label: "Gmail / search results" },
  { value: "gmail-empty", label: "Gmail / empty search" },
  { value: "gmail-single-message", label: "Gmail / single email" },
  { value: "gmail-message", label: "Gmail / email thread" },
  { value: "gmail-sent", label: "Gmail / sent messages" },
  { value: "gmail-draft", label: "Gmail / draft review" },
  { value: "gmail-draft-editing", label: "Gmail / editing draft" },
  { value: "gmail-forward", label: "Gmail / forward draft" },
  { value: "gmail-action", label: "Gmail / action result" },
  { value: "gmail-organize", label: "Gmail / label and archive" },
  { value: "gmail-failed", label: "Gmail / failed action" },
  { value: "outlook-search", label: "Outlook / search results" },
  { value: "outlook-message", label: "Outlook / email thread" },
  { value: "outlook-draft", label: "Outlook / draft review" },
  { value: "outlook-action", label: "Outlook / action result" },
  { value: "calendar-search", label: "Calendar / search results" },
  { value: "calendar-event", label: "Calendar / event detail" },
  { value: "calendar-draft", label: "Calendar / event draft" },
  { value: "calendar-action", label: "Calendar / action result" },
  { value: "calendar-schedule", label: "Calendar / schedule view" },
  { value: "calendar-availability", label: "Calendar / availability check" },
  { value: "drive-search", label: "Drive / file search" },
  { value: "drive-file", label: "Drive / file detail" },
  { value: "drive-action", label: "Drive / file action" },
  { value: "github-search", label: "GitHub / triage list" },
  { value: "github-pr", label: "GitHub / pull request" },
  { value: "github-action", label: "GitHub / action result" },
  { value: "todoist-search", label: "Todoist / task list" },
  { value: "todoist-draft", label: "Todoist / task draft" },
  { value: "todoist-action", label: "Todoist / action result" },
];

const FAMILY_OPTIONS: Array<{ value: CatalogFamily; label: string; initial: CatalogArtifactId }> = [
  { value: "web", label: "Web", initial: "web-searching" },
  { value: "image", label: "Image", initial: "image-queued" },
  { value: "video", label: "Video", initial: "video-queued" },
  { value: "gmail", label: "Gmail", initial: "gmail-searching" },
  { value: "outlook", label: "Outlook", initial: "outlook-search" },
  { value: "calendar", label: "Calendar", initial: "calendar-search" },
  { value: "files", label: "Files", initial: "drive-search" },
  { value: "github", label: "GitHub", initial: "github-search" },
  { value: "tasks", label: "Tasks", initial: "todoist-search" },
];

const FAMILY_SELECT_OPTIONS = FAMILY_OPTIONS.map((family) => ({
  value: family.value,
  label: family.label,
}));

const ACTIVITY_GROUPS: ToolActivityGroup[] = [
  {
    id: "explore",
    title: "Exploring project files",
    subtitle: "Reading the frontend artifact area and locating renderer contracts.",
    status: "running",
    icon: <FolderOpen size="sm" className="text-secondary dark:text-disabled" />,
    calls: [
      { id: "rg", title: "Searching files", subtitle: "rg artifact renderers", status: "completed", preview: "Found markdown artifact renderers and lab fixtures." },
      { id: "read", title: "Reading source", subtitle: "ArtifactRenderer.tsx", status: "completed", preview: "Loaded renderer routing and artifact parser." },
      { id: "inspect", title: "Inspecting catalog", subtitle: "ArtifactLabPanel.tsx", status: "running", preview: "Checking current preview families." },
    ],
  },
  {
    id: "edit",
    title: "Updating the preview UI",
    subtitle: "Applying a scalable selector and adding activity test cards.",
    status: "completed",
    icon: <Code size="sm" className="text-secondary dark:text-disabled" />,
    calls: [
      { id: "patch", title: "Editing file", subtitle: "ArtifactLabPanel.tsx", status: "completed", preview: "Added family selector and activity demo structures." },
      { id: "typecheck", title: "Type checking", subtitle: "npm run typecheck", status: "completed", preview: "TypeScript completed successfully." },
    ],
  },
  {
    id: "single",
    title: "Checking GitHub",
    subtitle: "A single connector call can stay compact without becoming a fake group.",
    status: "pending",
    icon: <Icon icon={GithubLogoIcon} size="sm" weight="fill" className="text-secondary dark:text-disabled" />,
    calls: [
      { id: "github", title: "GitHub: Search pull requests", subtitle: "artifact connector renderer", status: "pending", preview: "Waiting for connector response." },
    ],
  },
];

function artifactFamily(id: CatalogArtifactId): CatalogFamily {
  if (id.startsWith("image-")) return "image";
  if (id.startsWith("video-")) return "video";
  if (id.startsWith("gmail-")) return "gmail";
  if (id.startsWith("outlook-")) return "outlook";
  if (id.startsWith("calendar-")) return "calendar";
  if (id.startsWith("drive-")) return "files";
  if (id.startsWith("github-")) return "github";
  if (id.startsWith("todoist-")) return "tasks";
  return "web";
}

const SOURCE_RESULTS = [
  {
    label: "Apple Investor Relations",
    href: "https://investor.apple.com/",
    description: "Official earnings releases, quarterly results, shareholder materials, and management commentary.",
  },
  {
    label: "Apple SEC Filings",
    href: "https://www.sec.gov/edgar/browse/?CIK=320193",
    description: "Annual and quarterly filings used to compare revenue, net income, margins, risks, and cash flow.",
  },
  {
    label: "Nasdaq AAPL Market Summary",
    href: "https://www.nasdaq.com/market-activity/stocks/aapl",
    description: "Live market summary, price movement, valuation context, and basic stock performance signals.",
  },
  {
    label: "Macrotrends Apple Financials",
    href: "https://www.macrotrends.net/stocks/charts/AAPL/apple/financial-statements",
    description: "Historical financial trend data for revenue, profit, margins, and long-term performance comparison.",
  },
  {
    label: "Morningstar Apple Quote",
    href: "https://www.morningstar.com/stocks/xnas/aapl/quote",
    description: "Independent valuation context, business profile, and analyst-oriented stock research signals.",
  },
];

// SVG fixture colors are literal asset data, not application chrome.
/* eslint-disable no-restricted-syntax */
const GENERATED_IMAGE_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7fbff"/>
      <stop offset="0.45" stop-color="#c7d8ff"/>
      <stop offset="1" stop-color="#f7c49b"/>
    </linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#87dfbd"/>
      <stop offset="1" stop-color="#4da98b"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>
  <rect width="1200" height="900" rx="56" fill="url(#sky)"/>
  <circle cx="210" cy="170" r="92" fill="#fff6ce" opacity=".9"/>
  <path d="M0 665 C190 560 340 610 500 526 C710 416 880 424 1200 270 L1200 900 L0 900 Z" fill="#f3f6ff" opacity=".84"/>
  <path d="M0 710 C210 620 365 660 560 580 C760 498 920 510 1200 390 L1200 900 L0 900 Z" fill="url(#green)" opacity=".88"/>
  <g opacity=".35" filter="url(#soft)">
    <circle cx="920" cy="168" r="120" fill="#ffffff"/>
    <circle cx="1020" cy="620" r="180" fill="#ffd4a8"/>
  </g>
  <g fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" opacity=".82">
    <path d="M190 610 L320 540 L450 570 L610 462 L760 488 L930 350"/>
  </g>
  <g fill="#ffffff" opacity=".95">
    <circle cx="190" cy="610" r="18"/>
    <circle cx="320" cy="540" r="18"/>
    <circle cx="450" cy="570" r="18"/>
    <circle cx="610" cy="462" r="18"/>
    <circle cx="760" cy="488" r="18"/>
    <circle cx="930" cy="350" r="18"/>
  </g>
</svg>
`)}`;

const GENERATED_VIDEO_POSTER_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="midnightblue"/>
      <stop offset="0.46" stop-color="steelblue"/>
      <stop offset="1" stop-color="peru"/>
    </linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="aquamarine"/>
      <stop offset="0.5" stop-color="white"/>
      <stop offset="1" stop-color="moccasin"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="28"/>
    </filter>
  </defs>
  <rect width="1280" height="720" rx="42" fill="url(#bg)"/>
  <g filter="url(#soft)" opacity=".5">
    <circle cx="220" cy="150" r="110" fill="aquamarine"/>
    <circle cx="1050" cy="560" r="190" fill="moccasin"/>
  </g>
  <path d="M120 510 C250 420 360 470 500 360 C665 230 785 315 930 210 C1015 148 1080 130 1160 118" fill="none" stroke="url(#line)" stroke-width="22" stroke-linecap="round" opacity=".9"/>
  <g fill="white" opacity=".94">
    <circle cx="120" cy="510" r="18"/>
    <circle cx="500" cy="360" r="18"/>
    <circle cx="930" cy="210" r="18"/>
  </g>
  <g transform="translate(596 316)">
    <circle cx="44" cy="44" r="44" fill="white" opacity=".2"/>
    <path d="M36 26 L66 44 L36 62 Z" fill="white" opacity=".9"/>
  </g>
  <rect x="76" y="620" width="1128" height="9" rx="4.5" fill="white" opacity=".22"/>
  <rect x="76" y="620" width="420" height="9" rx="4.5" fill="white" opacity=".74"/>
</svg>
`)}`;

const GENERATED_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
/* eslint-enable no-restricted-syntax */

const GMAIL_MESSAGES = [
  {
    id: "msg-001",
    from: { name: "Maya Chen", email: "maya@northstar.finance" },
    to: [{ name: "Pookie", email: "pookie@example.com" }],
    subject: "July spending summary",
    snippet: "John's July card spend is attached. The biggest categories were travel, software, and team meals.",
    bodyPreview: "John's July card spend is attached. The total is $4,820. Travel was $2,100, software was $940, team meals were $680, and the remaining spend was split across office and subscriptions.",
    date: "Jul 15",
    labels: ["Finance", "Receipts"],
    attachmentCount: 1,
    unread: true,
  },
  {
    id: "msg-002",
    from: { name: "John Rivera", email: "john@studio.example" },
    to: [{ name: "Pookie", email: "pookie@example.com" }],
    subject: "Re: July budget check",
    snippet: "I added the missing Apple services receipts and marked the recurring items in the sheet.",
    bodyPreview: "I added the missing Apple services receipts and marked the recurring items in the sheet. Let me know if you want me to separate hardware from services before the Friday review.",
    date: "Jul 14",
    labels: ["Budget"],
    attachmentCount: 0,
  },
  {
    id: "msg-003",
    from: { name: "Finance Team", email: "finance@studio.example" },
    to: [{ name: "Pookie", email: "pookie@example.com" }],
    subject: "Receipt reconciliation complete",
    snippet: "The shared Drive folder now has all July receipts and the final reconciliation note.",
    bodyPreview: "The shared Drive folder now has all July receipts and the final reconciliation note. We found two duplicate meal entries and removed them from the working total.",
    date: "Jul 12",
    labels: ["Finance"],
    attachmentCount: 2,
  },
];

const CALENDAR_EVENTS = [
  {
    id: "cal-001",
    title: "Finance review with Maya",
    date: "Jul 18",
    time: "10:00 AM - 10:45 AM",
    calendar: "Work",
    location: "Google Meet",
    meetLink: "https://meet.google.com/demo-finance",
    organizer: { name: "Maya Chen", email: "maya@northstar.finance" },
    attendees: [
      { name: "Pookie", email: "pookie@example.com", status: "accepted" },
      { name: "John Rivera", email: "john@studio.example", status: "needs_action" },
    ],
    description: "Review July spending totals, category breakdown, and the generated graph before sending the final summary.",
    status: "confirmed",
  },
  {
    id: "cal-002",
    title: "John expense follow-up",
    date: "Jul 18",
    time: "2:30 PM - 3:00 PM",
    calendar: "Work",
    location: "Studio huddle",
    organizer: { name: "Pookie", email: "pookie@example.com" },
    attendees: [{ name: "John Rivera", email: "john@studio.example", status: "tentative" }],
    description: "Confirm whether Apple services receipts should stay in software or move to subscriptions.",
    status: "tentative",
  },
  {
    id: "cal-003",
    title: "Weekly ops sync",
    date: "Jul 19",
    time: "9:00 AM - 9:30 AM",
    calendar: "Work",
    location: "Zoom",
    organizer: { name: "Ops Review", email: "ops-review@studio.example" },
    attendees: [{ name: "Pookie", email: "pookie@example.com", status: "accepted" }],
    description: "Routine weekly operations review.",
    status: "confirmed",
  },
];

const DRIVE_FILES = [
  {
    id: "drive-001",
    name: "July spending summary",
    type: "Google Sheet",
    icon: "sheet",
    owner: "Maya Chen",
    modifiedAt: "Jul 16",
    path: "Finance / July",
    description: "Spreadsheet with category totals, receipt references, and the final reconciliation note.",
    shared: true,
  },
  {
    id: "drive-002",
    name: "Receipt reconciliation note",
    type: "Google Doc",
    icon: "document",
    owner: "Finance Team",
    modifiedAt: "Jul 15",
    path: "Finance / July",
    description: "Narrative summary of duplicate entries, missing receipts, and category decisions.",
    shared: true,
  },
  {
    id: "drive-003",
    name: "July receipts",
    type: "folder",
    icon: "folder",
    owner: "John Rivera",
    modifiedAt: "Jul 14",
    path: "Finance",
    description: "Folder containing uploaded travel, software, meals, and office receipts.",
  },
];

const GITHUB_ITEMS = [
  {
    id: "gh-001",
    number: 248,
    title: "Add artifact renderer registry for connector cards",
    repo: "studio/frontend",
    author: "maya",
    state: "open",
    type: "pull_request",
    branch: "artifact-connectors",
    updatedAt: "12 min ago",
    labels: ["frontend", "artifacts"],
    description: "Introduces connector-specific rendering for file, issue, and task workflows.",
  },
  {
    id: "gh-002",
    number: 241,
    title: "Normalize Composio artifact output kinds",
    repo: "studio/runtime",
    author: "john",
    state: "open",
    type: "issue",
    updatedAt: "1h ago",
    labels: ["runtime", "contract"],
    description: "The model should emit stable artifact kinds for connector results instead of generic JSON blocks.",
  },
  {
    id: "gh-003",
    title: "Artifact preview CI",
    repo: "studio/frontend",
    state: "success",
    type: "workflow",
    updatedAt: "2h ago",
    description: "Typecheck, build, and artifact fixture smoke tests passed on the latest branch.",
  },
];

const TODOIST_TASKS = [
  {
    id: "todo-001",
    title: "Review connector artifact scope",
    project: "Studio",
    section: "Artifacts",
    due: "Today",
    assignee: "Pookie",
    priority: "high",
    status: "open",
    labels: ["frontend", "planning"],
    description: "Decide which connector outputs need custom artifacts and which can use generic file/data cards.",
  },
  {
    id: "todo-002",
    title: "Add GitHub artifact fixture",
    project: "Studio",
    section: "Artifacts",
    due: "Tomorrow",
    priority: "medium",
    status: "in_progress",
    labels: ["github"],
  },
  {
    id: "todo-003",
    title: "Document artifact JSON contract",
    project: "Studio",
    section: "Runtime",
    due: "Friday",
    priority: "low",
    status: "completed",
    labels: ["docs"],
  },
];

function buildWebArtifact(id: CatalogArtifactId): Artifact {
  if (id === "web-searching") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "web_research",
      title: "Researching Apple stock",
      summary: "Searching for current Apple financial and market sources.",
      status: "streaming",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Searching web",
      },
      source: {
        tool: "web_search",
      },
      meta: {
        query: "Apple stock profitability current financial performance AAPL",
        mode: "search",
      },
      sections: [
        {
          type: "links",
          title: "Candidate sources",
          items: SOURCE_RESULTS.slice(0, 3),
        },
        {
          type: "timeline",
          title: "Progress",
          items: [
            { label: "Search query prepared", status: "completed" },
            { label: "Scanning current sources", status: "streaming" },
            { label: "Fetching selected pages", status: "pending" },
          ],
        },
      ],
    };
  }

  if (id === "web-fetching") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "web_research",
      title: "Fetching Apple sources",
      summary: "Opening the strongest sources and extracting usable evidence.",
      status: "loading",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Fetching sources",
      },
      source: {
        tool: "web_fetch",
      },
      meta: {
        query: "Apple stock profitability current financial performance AAPL",
        mode: "fetch",
      },
      sections: [
        {
          type: "links",
          title: "Selected sources",
          items: SOURCE_RESULTS.slice(0, 2),
        },
        {
          type: "timeline",
          title: "Progress",
          items: [
            { label: "Apple newsroom opened", status: "completed" },
            { label: "SEC filing being parsed", status: "streaming" },
            { label: "Market data pending", status: "pending" },
          ],
        },
      ],
    };
  }

  return {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "web_research",
    title: "Apple stock research",
    summary: "Apple appears profitable in the searched sources, but the recommendation depends on valuation and the user's uploaded spending document context.",
    status: "completed",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Research completed",
    },
    source: {
      tool: "web_search + web_fetch",
    },
    meta: {
      query: "Apple stock profitability current financial performance AAPL",
      mode: "complete",
    },
    stats: [
      { label: "Sources checked", value: 3 },
      { label: "Sources used", value: 2 },
      { label: "Profit signal", value: "Positive" },
      { label: "Confidence", value: "Medium" },
    ],
    sections: [
      {
        type: "links",
        title: "Sources",
        items: SOURCE_RESULTS,
      },
      {
        type: "list",
        title: "Takeaways",
        items: [
          { label: "Profitability", description: "Recent financial sources show Apple remains profitable." },
          { label: "Valuation", description: "Profitability alone does not guarantee the stock is attractively priced." },
          { label: "Document tie-in", description: "The final answer should compare market confidence with the user's uploaded budget document." },
        ],
      },
    ],
  };
}

function buildCalendarArtifact(id: CatalogArtifactId): Artifact {
  if (id === "calendar-search") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "calendar_search",
      title: "Calendar search results",
      summary: "Found calendar events related to the finance review and spending follow-up.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "Events found" },
      source: { app: "google-calendar", tool: "calendar.search" },
      data: {
        query: "finance spending John July",
        timezone: "Asia/Dhaka",
        events: CALENDAR_EVENTS.slice(0, 2),
      },
    };
  }

  if (id === "calendar-event") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "calendar_event",
      title: "Finance review event",
      summary: "Opened the selected calendar event and extracted the meeting context.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "Event opened" },
      source: { app: "google-calendar", tool: "calendar.get_event" },
      data: {
        timezone: "Asia/Dhaka",
        event: CALENDAR_EVENTS[0],
      },
    };
  }

  if (id === "calendar-draft") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "calendar_draft",
      title: "Schedule finance review",
      summary: "Prepared a calendar event for review before creating it.",
      status: "pending",
      presentation: { surface: "chat", density: "card", compactLabel: "Event draft" },
      source: { app: "google-calendar", tool: "calendar.create_draft" },
      data: {
        timezone: "Asia/Dhaka",
        draft: {
          title: "Finance review with Maya",
          date: "Jul 18",
          time: "10:00 AM",
          duration: "45 minutes",
          location: "Google Meet",
          attendees: [
            { name: "Maya Chen", email: "maya@northstar.finance", status: "needs_action" },
            { name: "John Rivera", email: "john@studio.example", status: "needs_action" },
          ],
          description: "Review John's July spending total, category breakdown, and graph artifact.",
        },
      },
    };
  }

  if (id === "calendar-action") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "calendar_action",
      title: "Calendar event created",
      summary: "The approved meeting was created and invitations were sent.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "Event created" },
      source: { app: "google-calendar", tool: "calendar.create_event" },
      data: {
        action: {
          action: "create",
          target: "Finance review with Maya",
          result: "Created for Jul 18 at 10:00 AM and invited Maya Chen and John Rivera.",
        },
      },
    };
  }

  if (id === "calendar-schedule") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "calendar_schedule",
      title: "Upcoming finance schedule",
      summary: "A chronological agenda for the next finance-related meetings.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "Agenda" },
      source: { app: "google-calendar", tool: "calendar.list_events" },
      data: {
        timezone: "Asia/Dhaka",
        events: CALENDAR_EVENTS,
      },
    };
  }

  return {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "calendar_availability",
    title: "Availability check",
    summary: "Found a conflict and suggested better meeting times.",
    status: "completed",
    presentation: { surface: "chat", density: "card", compactLabel: "Availability" },
    source: { app: "google-calendar", tool: "calendar.free_busy" },
    data: {
      timezone: "Asia/Dhaka",
      conflicts: [CALENDAR_EVENTS[2]],
      slots: [
        { id: "slot-001", date: "Jul 18", time: "10:00 AM - 10:45 AM", score: "Best" },
        { id: "slot-002", date: "Jul 18", time: "3:30 PM - 4:15 PM", score: "Good", conflict: "Leaves 30 minutes after John expense follow-up." },
        { id: "slot-003", date: "Jul 19", time: "11:00 AM - 11:45 AM", score: "Open" },
      ],
    },
  };
}

function buildGmailArtifact(id: CatalogArtifactId): Artifact {
  if (id === "gmail-searching") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_search",
      title: "Searching Gmail",
      summary: "Looking through Gmail for finance messages related to John's July spending.",
      status: "loading",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Searching Gmail",
      },
      source: {
        app: "gmail",
        tool: "gmail.search",
      },
      data: {
        query: "John July spending receipts budget",
        mailbox: "All mail",
        messages: [],
      },
    };
  }

  if (id === "gmail-search") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_search",
      title: "Gmail search results",
      summary: "Found likely finance emails related to John's July spending.",
      status: "completed",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Emails found",
      },
      source: {
        app: "gmail",
        tool: "gmail.search",
      },
      data: {
        query: "John July spending receipts budget",
        mailbox: "Inbox",
        messages: GMAIL_MESSAGES,
      },
    };
  }

  if (id === "gmail-empty") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_search",
      title: "No Gmail matches",
      summary: "Gmail returned no messages for the current search.",
      status: "empty",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "No emails found",
      },
      source: {
        app: "gmail",
        tool: "gmail.search",
      },
      data: {
        query: "John July hardware refund receipt",
        mailbox: "Inbox",
        messages: [],
      },
    };
  }

  if (id === "gmail-single-message") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_message",
      title: "Finance email",
      summary: "Opened one Gmail message and extracted the relevant spending detail.",
      status: "completed",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Email opened",
      },
      source: {
        app: "gmail",
        tool: "gmail.get_message",
      },
      data: {
        message: GMAIL_MESSAGES[0],
      },
    };
  }

  if (id === "gmail-message") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_thread",
      title: "July spending email thread",
      summary: "Opened the most relevant Gmail thread and extracted the usable context.",
      status: "completed",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Email thread",
      },
      source: {
        app: "gmail",
        tool: "gmail.get_thread",
      },
      data: {
        message: GMAIL_MESSAGES[0],
        thread: GMAIL_MESSAGES.slice(0, 2),
      },
    };
  }

  if (id === "gmail-sent") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_search",
      title: "Sent Gmail messages",
      summary: "Reviewed recently sent messages related to the finance thread.",
      status: "completed",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Sent messages",
      },
      source: {
        app: "gmail",
        tool: "gmail.list_sent",
      },
      data: {
        query: "July spending summary",
        mailbox: "Sent",
        messages: [
          {
            id: "sent-001",
            from: { name: "Pookie", email: "pookie@example.com" },
            to: [{ name: "Maya Chen", email: "maya@northstar.finance" }],
            subject: "Re: July spending summary",
            snippet: "I reviewed the July spending context and the total I found for John is $4,820.",
            bodyPreview: "I reviewed the July spending context and the total I found for John is $4,820. The largest categories were travel, software, and team meals.",
            date: "Jul 16",
            labels: ["Sent", "Finance"],
            attachmentCount: 0,
          },
          {
            id: "sent-002",
            from: { name: "Pookie", email: "pookie@example.com" },
            to: [{ name: "John Rivera", email: "john@studio.example" }],
            subject: "July budget follow-up",
            snippet: "Can you confirm whether the Apple services receipts should stay under software?",
            bodyPreview: "Can you confirm whether the Apple services receipts should stay under software? I am preparing the final finance summary.",
            date: "Jul 15",
            labels: ["Sent"],
            attachmentCount: 0,
          },
        ],
      },
    };
  }

  if (id === "gmail-draft") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_draft",
      title: "Draft reply to Finance",
      summary: "Prepared a reply for review before sending.",
      status: "pending",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Draft ready",
      },
      source: {
        app: "gmail",
        tool: "gmail.create_draft",
      },
      data: {
        draft: {
          id: "draft-001",
          to: [{ name: "Maya Chen", email: "maya@northstar.finance" }],
          cc: [{ name: "John Rivera", email: "john@studio.example" }],
          subject: "Re: July spending summary",
          body: "Hi Maya,\n\nThanks for sending this over. I reviewed the July spending context and the total I found for John is $4,820. The largest categories were travel, software, and team meals.\n\nI will use this summary in the graph and keep the receipt details available if you need a category breakdown.\n\nBest,\nPookie",
        },
      },
    };
  }

  if (id === "gmail-draft-editing") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_draft",
      title: "Editing Gmail draft",
      summary: "Updating the draft with a clearer category breakdown before it is sent.",
      status: "streaming",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Editing draft",
      },
      source: {
        app: "gmail",
        tool: "gmail.update_draft",
      },
      data: {
        draft: {
          id: "draft-001",
          to: [{ name: "Maya Chen", email: "maya@northstar.finance" }],
          cc: [{ name: "John Rivera", email: "john@studio.example" }],
          subject: "Re: July spending summary",
          body: "Hi Maya,\n\nThanks for sending this over. I reviewed the July spending context and found John's total at $4,820.\n\nCurrent category breakdown:\n- Travel: $2,100\n- Software: $940\n- Team meals: $680\n- Office and subscriptions: $1,100\n\nI am polishing the final note before sending.\n\nBest,\nPookie",
        },
      },
    };
  }

  if (id === "gmail-forward") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_draft",
      title: "Forward spending email",
      summary: "Prepared a forwarded email with context for review before sending.",
      status: "pending",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Forward draft",
      },
      source: {
        app: "gmail",
        tool: "gmail.forward",
      },
      data: {
        draft: {
          id: "draft-forward-001",
          to: [{ name: "Ops Review", email: "ops-review@studio.example" }],
          subject: "Fwd: July spending summary",
          body: "Forwarding the finance thread for review.\n\nSummary: John's July spend appears to total $4,820, with travel and software as the largest categories.\n\n---------- Forwarded message ---------\nFrom: Maya Chen <maya@northstar.finance>\nSubject: July spending summary",
        },
      },
    };
  }

  if (id === "gmail-action") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_action",
      title: "Email sent",
      summary: "The approved reply was sent through Gmail.",
      status: "completed",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Sent",
      },
      source: {
        app: "gmail",
        tool: "gmail.send",
      },
      data: {
        action: {
          action: "send",
          target: "Re: July spending summary",
          result: "Sent to Maya Chen with John Rivera copied.",
        },
      },
    };
  }

  if (id === "gmail-failed") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "gmail_action",
      title: "Email send failed",
      summary: "Gmail could not send the approved reply.",
      status: "failed",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Send failed",
      },
      source: {
        app: "gmail",
        tool: "gmail.send",
      },
      data: {
        action: {
          action: "send",
          target: "Re: July spending summary",
          result: "Gmail rejected the request because the connector session needs to be refreshed.",
        },
      },
    };
  }

  return {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "gmail_action",
    title: "Email organized",
    summary: "The finance thread was labeled and archived.",
    status: "completed",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Organized",
    },
    source: {
      app: "gmail",
      tool: "gmail.modify",
    },
    data: {
      action: {
        action: "label",
        target: "July spending email thread",
        result: "Applied the Finance label and archived the thread from the inbox.",
      },
    },
  };
}

function buildOutlookArtifact(id: CatalogArtifactId): Artifact {
  if (id === "outlook-search") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "outlook_search",
      title: "Outlook search results",
      summary: "Found finance email context in the connected Outlook mailbox.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "Outlook emails found" },
      source: { app: "outlook", tool: "outlook.search" },
      data: {
        query: "finance review July receipts",
        mailbox: "Inbox",
        messages: GMAIL_MESSAGES.slice(0, 2).map((message) => ({
          ...message,
          id: `outlook-${message.id}`,
          labels: ["Outlook", ...(message.labels ?? [])],
        })),
      },
    };
  }

  if (id === "outlook-message") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "outlook_thread",
      title: "Outlook finance thread",
      summary: "Opened the relevant Outlook thread and extracted the usable context.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "Outlook thread" },
      source: { app: "outlook", tool: "outlook.get_thread" },
      data: {
        message: { ...GMAIL_MESSAGES[0], id: "outlook-msg-001", labels: ["Outlook", "Finance"] },
        thread: GMAIL_MESSAGES.slice(0, 2).map((message) => ({ ...message, id: `outlook-${message.id}` })),
      },
    };
  }

  if (id === "outlook-draft") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "outlook_draft",
      title: "Draft Outlook reply",
      summary: "Prepared an Outlook reply for review before sending.",
      status: "pending",
      presentation: { surface: "chat", density: "card", compactLabel: "Outlook draft" },
      source: { app: "outlook", tool: "outlook.create_draft" },
      data: {
        draft: {
          id: "outlook-draft-001",
          to: [{ name: "Maya Chen", email: "maya@northstar.finance" }],
          subject: "Re: July spending summary",
          body: "Hi Maya,\n\nI reviewed the July spending context and found John's current total at $4,820. The largest categories are travel, software, and team meals.\n\nBest,\nPookie",
        },
      },
    };
  }

  return {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "outlook_action",
    title: "Outlook email sent",
    summary: "The approved Outlook reply was sent.",
    status: "completed",
    presentation: { surface: "chat", density: "card", compactLabel: "Outlook sent" },
    source: { app: "outlook", tool: "outlook.send" },
    data: {
      action: {
        action: "send",
        target: "Re: July spending summary",
        result: "Sent to Maya Chen through Outlook.",
      },
    },
  };
}

function buildDriveArtifact(id: CatalogArtifactId): Artifact {
  if (id === "drive-file") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "googledrive_file",
      title: "Drive file opened",
      summary: "Opened the selected Drive file and extracted its file context.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "Drive file" },
      source: { app: "googledrive", tool: "googledrive.get_file" },
      data: {
        provider: "googledrive",
        file: DRIVE_FILES[0],
      },
    };
  }

  if (id === "drive-action") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "googledrive_action",
      title: "Drive file shared",
      summary: "The selected finance file was shared with the review group.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "Drive action" },
      source: { app: "googledrive", tool: "googledrive.share" },
      data: {
        provider: "googledrive",
        action: {
          action: "share",
          target: "July spending summary",
          result: "Shared with Maya Chen and John Rivera with comment access.",
        },
      },
    };
  }

  return {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "googledrive_search",
    title: "Drive search results",
    summary: "Found files in Drive that match the finance review context.",
    status: "completed",
    presentation: { surface: "chat", density: "card", compactLabel: "Drive files" },
    source: { app: "googledrive", tool: "googledrive.search" },
    data: {
      provider: "googledrive",
      query: "July spending receipts finance",
      location: "Finance",
      files: DRIVE_FILES,
    },
  };
}

function buildGithubArtifact(id: CatalogArtifactId): Artifact {
  if (id === "github-pr") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "github_pull_request",
      title: "GitHub pull request",
      summary: "Opened the selected pull request and summarized its review state.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "PR opened" },
      source: { app: "github", tool: "github.get_pull_request" },
      data: {
        repo: "studio/frontend",
        item: GITHUB_ITEMS[0],
      },
    };
  }

  if (id === "github-action") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "github_action",
      title: "GitHub comment posted",
      summary: "Posted a review comment on the selected pull request.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "GitHub action" },
      source: { app: "github", tool: "github.create_comment" },
      data: {
        repo: "studio/frontend",
        action: {
          action: "comment",
          target: "#248 Add artifact renderer registry for connector cards",
          result: "Posted a comment asking for the artifact kind aliases to be documented before merge.",
        },
      },
    };
  }

  return {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "github_search",
    title: "GitHub triage",
    summary: "Found active GitHub work related to connector artifact rendering.",
    status: "completed",
    presentation: { surface: "chat", density: "card", compactLabel: "GitHub results" },
    source: { app: "github", tool: "github.search" },
    data: {
      repo: "studio/frontend",
      query: "artifact connector renderer",
      items: GITHUB_ITEMS,
    },
  };
}

function buildTodoistArtifact(id: CatalogArtifactId): Artifact {
  if (id === "todoist-draft") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "todoist_draft",
      title: "Todoist task draft",
      summary: "Prepared a task for review before creating it.",
      status: "pending",
      presentation: { surface: "chat", density: "card", compactLabel: "Task draft" },
      source: { app: "todoist", tool: "todoist.create_task_draft" },
      data: {
        provider: "todoist",
        draft: {
          title: "Review Drive and GitHub artifact contracts",
          project: "Studio",
          due: "Tomorrow",
          labels: ["artifacts", "connectors"],
          description: "Confirm the LLM output shape for file search, GitHub triage, and task actions.",
        },
      },
    };
  }

  if (id === "todoist-action") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "todoist_action",
      title: "Todoist task completed",
      summary: "Marked the connector artifact review task complete.",
      status: "completed",
      presentation: { surface: "chat", density: "card", compactLabel: "Task updated" },
      source: { app: "todoist", tool: "todoist.complete_task" },
      data: {
        provider: "todoist",
        action: {
          action: "complete",
          target: "Document artifact JSON contract",
          result: "Marked complete in the Studio project.",
        },
      },
    };
  }

  return {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "todoist_search",
    title: "Todoist tasks",
    summary: "Found tasks related to the Studio artifact workstream.",
    status: "completed",
    presentation: { surface: "chat", density: "card", compactLabel: "Tasks found" },
    source: { app: "todoist", tool: "todoist.search" },
    data: {
      provider: "todoist",
      query: "Studio artifacts",
      tasks: TODOIST_TASKS,
    },
  };
}

function buildImageArtifact(id: CatalogArtifactId): Artifact {
  const baseData = {
    prompt: "A polished colorful financial graph inspired by the uploaded budget document, soft natural light, clean editorial composition.",
    aspectRatio: "4:3",
    model: "Studio image model",
    style: "Editorial data visualization",
  };

  if (id === "image-queued") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "generated_image",
      title: "Budget graph image",
      summary: "The image request is queued and waiting for generation capacity.",
      status: "pending",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Image queued",
      },
      source: {
        tool: "image.generate",
      },
      data: baseData,
      sections: [
        {
          type: "timeline",
          title: "Progress",
          items: [
            { label: "Prompt prepared", status: "completed" },
            { label: "Generation queued", status: "pending" },
            { label: "Image render pending", status: "pending" },
          ],
        },
      ],
    };
  }

  if (id === "image-generating") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "generated_image",
      title: "Budget graph image",
      summary: "Rendering a graph-style image from the document data and visual direction.",
      status: "loading",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Generating image",
      },
      source: {
        tool: "image.generate",
      },
      data: baseData,
      sections: [
        {
          type: "timeline",
          title: "Progress",
          items: [
            { label: "Prompt prepared", status: "completed" },
            { label: "Reference data interpreted", status: "completed" },
            { label: "Image render in progress", status: "loading" },
          ],
        },
      ],
    };
  }

  return {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "generated_image",
    title: "Budget graph image",
    summary: "Generated a colorful graph-style image using the document data as the visual direction.",
    status: "completed",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Image generated",
    },
    source: {
      tool: "image.generate",
    },
    data: {
      ...baseData,
      imageUrl: GENERATED_IMAGE_URL,
    },
    stats: [
      { label: "Outputs", value: 1 },
      { label: "Aspect ratio", value: "4:3" },
    ],
    sections: [
      {
        type: "timeline",
        title: "Progress",
        items: [
          { label: "Prompt prepared", status: "completed" },
          { label: "Image rendered", status: "completed" },
          { label: "Stored as generated content", status: "completed" },
        ],
      },
    ],
  };
}

function buildVideoArtifact(id: CatalogArtifactId): Artifact {
  const baseData = {
    prompt: "Animate the uploaded budget graph into a polished 8-second finance recap with rising line motion, soft camera drift, and readable category highlights.",
    aspectRatio: "16:9",
    duration: 8,
    resolution: "1280x720",
    model: "Studio video model",
    mode: "text-to-video",
    style: "Editorial motion graphic",
  };

  if (id === "video-queued") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "generated_video",
      title: "Budget recap video",
      summary: "The video request is queued and waiting for generation capacity.",
      status: "pending",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Video queued",
      },
      source: {
        tool: "video.generate",
      },
      data: baseData,
      sections: [
        {
          type: "timeline",
          title: "Progress",
          items: [
            { label: "Prompt prepared", status: "completed" },
            { label: "Shot plan queued", status: "pending" },
            { label: "Video render pending", status: "pending" },
          ],
        },
      ],
    };
  }

  if (id === "video-generating") {
    return {
      type: "artifact",
      version: 1,
      category: "general",
      kind: "generated_video",
      title: "Budget recap video",
      summary: "Rendering the motion sequence and composing the requested video output.",
      status: "loading",
      presentation: {
        surface: "chat",
        density: "card",
        compactLabel: "Generating video",
      },
      source: {
        tool: "video.generate",
      },
      data: {
        ...baseData,
        posterUrl: GENERATED_VIDEO_POSTER_URL,
      },
      sections: [
        {
          type: "timeline",
          title: "Progress",
          items: [
            { label: "Prompt prepared", status: "completed" },
            { label: "Motion plan created", status: "completed" },
            { label: "Video render in progress", status: "loading" },
            { label: "Output storage pending", status: "pending" },
          ],
        },
      ],
    };
  }

  return {
    type: "artifact",
    version: 1,
    category: "general",
    kind: "generated_video",
    title: "Budget recap video",
    summary: "Generated an 8-second finance recap video from the prompt and visual direction.",
    status: "completed",
    presentation: {
      surface: "chat",
      density: "card",
      compactLabel: "Video generated",
    },
    source: {
      tool: "video.generate",
    },
    data: {
      ...baseData,
      videoUrl: GENERATED_VIDEO_URL,
      posterUrl: GENERATED_VIDEO_POSTER_URL,
      outputs: [
        {
          label: "Primary video",
          videoUrl: GENERATED_VIDEO_URL,
          posterUrl: GENERATED_VIDEO_POSTER_URL,
          duration: 8,
          resolution: "1280x720",
          aspectRatio: "16:9",
        },
      ],
    },
    stats: [
      { label: "Outputs", value: 1 },
      { label: "Duration", value: "8s" },
      { label: "Aspect ratio", value: "16:9" },
      { label: "Resolution", value: "1280x720" },
    ],
    sections: [
      {
        type: "timeline",
        title: "Progress",
        items: [
          { label: "Prompt prepared", status: "completed" },
          { label: "Video rendered", status: "completed" },
          { label: "Stored as generated content", status: "completed" },
        ],
      },
    ],
  };
}

function buildArtifact(id: CatalogArtifactId): Artifact {
  if (id.startsWith("image-")) return buildImageArtifact(id);
  if (id.startsWith("video-")) return buildVideoArtifact(id);
  if (id.startsWith("gmail-")) return buildGmailArtifact(id);
  if (id.startsWith("outlook-")) return buildOutlookArtifact(id);
  if (id.startsWith("calendar-")) return buildCalendarArtifact(id);
  if (id.startsWith("drive-")) return buildDriveArtifact(id);
  if (id.startsWith("github-")) return buildGithubArtifact(id);
  if (id.startsWith("todoist-")) return buildTodoistArtifact(id);
  return buildWebArtifact(id);
}

function statusCopy(id: CatalogArtifactId) {
  switch (id) {
    case "web-searching":
      return { icon: <Search size="sm" />, label: "Searching" };
    case "web-fetching":
      return { icon: <Clock size="sm" />, label: "Fetching" };
    case "web-completed":
      return { icon: <Success size="sm" />, label: "Completed" };
    case "image-queued":
      return { icon: <Icon icon={ImageSquareIcon} size="sm" />, label: "Queued" };
    case "image-generating":
      return { icon: <Icon icon={SparkleIcon} size="sm" />, label: "Generating" };
    case "image-completed":
      return { icon: <Success size="sm" />, label: "Image ready" };
    case "video-queued":
      return { icon: <Icon icon={VideoCameraIcon} size="sm" />, label: "Queued" };
    case "video-generating":
      return { icon: <Icon icon={SparkleIcon} size="sm" />, label: "Generating" };
    case "video-completed":
      return { icon: <Success size="sm" />, label: "Video ready" };
    case "gmail-searching":
      return { icon: <Clock size="sm" />, label: "Searching Gmail" };
    case "gmail-search":
      return { icon: <Search size="sm" />, label: "Emails found" };
    case "gmail-empty":
      return { icon: <Search size="sm" />, label: "No matches" };
    case "gmail-single-message":
      return { icon: <Email size="sm" />, label: "Email opened" };
    case "gmail-message":
      return { icon: <Email size="sm" />, label: "Thread opened" };
    case "gmail-sent":
      return { icon: <Send size="sm" />, label: "Sent messages" };
    case "gmail-draft":
      return { icon: <Edit size="sm" />, label: "Draft ready" };
    case "gmail-draft-editing":
      return { icon: <Edit size="sm" />, label: "Editing draft" };
    case "gmail-forward":
      return { icon: <Send size="sm" />, label: "Forward draft" };
    case "gmail-action":
      return { icon: <Send size="sm" />, label: "Sent" };
    case "gmail-organize":
      return { icon: <Success size="sm" />, label: "Organized" };
    case "gmail-failed":
      return { icon: <Clock size="sm" />, label: "Failed" };
    case "outlook-search":
      return { icon: <Search size="sm" />, label: "Outlook emails found" };
    case "outlook-message":
      return { icon: <Email size="sm" />, label: "Outlook thread" };
    case "outlook-draft":
      return { icon: <Edit size="sm" />, label: "Outlook draft" };
    case "outlook-action":
      return { icon: <Send size="sm" />, label: "Outlook sent" };
    case "calendar-search":
      return { icon: <Search size="sm" />, label: "Events found" };
    case "calendar-event":
      return { icon: <Calendar size="sm" />, label: "Event opened" };
    case "calendar-draft":
      return { icon: <Edit size="sm" />, label: "Event draft" };
    case "calendar-action":
      return { icon: <Success size="sm" />, label: "Created" };
    case "calendar-schedule":
      return { icon: <Calendar size="sm" />, label: "Agenda" };
    case "calendar-availability":
      return { icon: <Warning size="sm" />, label: "Availability" };
    case "drive-search":
      return { icon: <Files size="sm" />, label: "Files found" };
    case "drive-file":
      return { icon: <Files size="sm" />, label: "File opened" };
    case "drive-action":
      return { icon: <Success size="sm" />, label: "File shared" };
    case "github-search":
      return { icon: <Icon icon={GithubLogoIcon} size="sm" weight="fill" />, label: "GitHub results" };
    case "github-pr":
      return { icon: <Icon icon={GithubLogoIcon} size="sm" weight="fill" />, label: "Pull request" };
    case "github-action":
      return { icon: <Success size="sm" />, label: "GitHub updated" };
    case "todoist-search":
      return { icon: <Checklist size="sm" />, label: "Tasks found" };
    case "todoist-draft":
      return { icon: <Edit size="sm" />, label: "Task draft" };
    case "todoist-action":
      return { icon: <Success size="sm" />, label: "Task updated" };
  }
}

function promptCopy(id: CatalogArtifactId) {
  if (id.startsWith("github-")) {
    return {
      user: "Check GitHub and triage the artifact-related pull requests.",
      assistant: "I can keep GitHub search, pull request detail, and write actions visible as inline workflow artifacts.",
    };
  }

  if (id.startsWith("drive-")) {
    return {
      user: "Find the Drive files related to John's July spending review.",
      assistant: "I found the relevant file context and will keep Drive search and file actions visible as inline file artifacts.",
    };
  }

  if (id.startsWith("todoist-")) {
    return {
      user: "Show me what tasks are open for the Studio artifact work.",
      assistant: "I can show the task list, prepare new task drafts, and report task actions as inline artifacts.",
    };
  }

  if (id.startsWith("outlook-")) {
    return {
      user: "Find the Outlook email about July spending and draft a reply.",
      assistant: "I found the Outlook context and will keep the email thread, draft, and send result attached to the conversation.",
    };
  }

  if (id.startsWith("calendar-")) {
    return {
      user: "Check my calendar and schedule a finance review with Maya and John.",
      assistant: "I can review calendar availability, prepare the event, and keep the scheduling result visible as an inline artifact.",
    };
  }

  if (id.startsWith("gmail-")) {
    return {
      user: "Find the email about John's July spending and draft a reply to Finance.",
      assistant: "I found the relevant Gmail context and will keep each email step visible as an inline connector artifact.",
    };
  }

  if (id.startsWith("image-")) {
    return {
      user: "Generate a colorful graph-style image from the uploaded budget document.",
      assistant: "I can turn the budget data into an inline generated-image artifact and keep the preview attached to the conversation.",
    };
  }

  if (id.startsWith("video-")) {
    return {
      user: "Generate a short video recap from the uploaded budget graph.",
      assistant: "I can keep the video generation lifecycle in one inline artifact, then attach the finished video output when it is ready.",
    };
  }

  return {
    user: "Check the uploaded budget document and image, then research whether Apple stock looks profitable.",
    assistant: "I found the relevant spending context. I'll keep web search and page fetching inside one inline research artifact so the result stays attached to the conversation.",
  };
}

function activityTone(status: ActivityStatus) {
  if (status === "completed") return { label: "Completed", icon: <Success size="xs" className="text-secondary dark:text-disabled" /> };
  if (status === "failed") return { label: "Failed", icon: <Warning size="xs" className="text-secondary dark:text-disabled" /> };
  if (status === "running") return { label: "Running", icon: <Clock size="xs" className="text-secondary dark:text-disabled" /> };
  return { label: "Pending", icon: <Clock size="xs" className="text-disabled dark:text-muted" /> };
}

function ActivityShimmer() {
  return (
    <motion.span
      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/[0.08]"
      animate={{ x: ["-100%", "100%"] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

function ToolCallRow({ call }: { call: ToolActivityCall }) {
  const tone = activityTone(call.status);
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-page/55 px-3 py-2 dark:bg-white/[0.035]">
      {call.status === "running" && <ActivityShimmer />}
      <div className="relative flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-surface-base dark:bg-white/[0.06]">
          {tone.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate text-xs font-medium text-primary dark:text-primary">{call.title}</div>
            <div className="flex-shrink-0 text-2xs text-disabled dark:text-muted">{tone.label}</div>
          </div>
          {call.subtitle && <div className="mt-0.5 truncate text-2xs text-muted dark:text-muted">{call.subtitle}</div>}
          {call.preview && <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-secondary dark:text-disabled">{call.preview}</div>}
        </div>
      </div>
    </div>
  );
}

function ToolActivityCard({ group }: { group: ToolActivityGroup }) {
  const tone = activityTone(group.status);
  const openByDefault = group.status === "running";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="relative overflow-hidden rounded-2xl bg-surface-base/70 px-4 py-4 shadow-[0_18px_44px_rgba(0,0,0,0.055)] ring-1 ring-black/[0.035] dark:bg-white/[0.055] dark:shadow-none dark:ring-white/[0.06]"
    >
      {group.status === "running" && <ActivityShimmer />}
      <details open={openByDefault} className="relative group/activity">
        <summary className="flex cursor-pointer list-none items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-page/80 dark:bg-white/[0.07]">
            {group.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-primary dark:text-primary">{group.title}</span>
            <span className="mt-0.5 block text-2xs text-disabled dark:text-muted">
              {tone.label} / {group.calls.length} tool call{group.calls.length === 1 ? "" : "s"}
            </span>
            <span className="mt-2 block text-sm leading-relaxed text-secondary dark:text-disabled">{group.subtitle}</span>
          </span>
          <span className="mt-1 flex flex-shrink-0 items-center gap-1 rounded-full bg-surface-page/70 px-2 py-1 text-2xs text-muted dark:bg-white/[0.045] dark:text-muted">
            {tone.icon}
            <span>{tone.label}</span>
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          {group.calls.map((call) => (
            <ToolCallRow key={call.id} call={call} />
          ))}
        </div>
      </details>
    </motion.div>
  );
}

function ActivityPreviewPanel() {
  return (
    <section className="mt-12 border-t border-surface-border/60 pt-8 dark:border-white/[0.06]">
      <div className="mb-5">
        <p className="text-2xs font-medium uppercase tracking-[0.16em] text-disabled dark:text-muted">
          Tool activity catalog
        </p>
        <h2 className="mt-1 font-display text-xl font-normal text-primary">
          Runtime activity preview
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          System-generated activity groups for tool calls that do not need a curated LLM artifact.
        </p>
      </div>
      <div className="grid gap-3">
        {ACTIVITY_GROUPS.map((group) => (
          <ToolActivityCard key={group.id} group={group} />
        ))}
      </div>
      <div className="mt-4 rounded-2xl bg-surface-base/70 px-4 py-3 text-xs leading-relaxed text-muted dark:bg-white/[0.045] dark:text-muted">
        Curated artifacts remain reserved for durable outputs. Tool activity is generated from runtime metadata and can collapse many raw calls into one readable work item.
      </div>
    </section>
  );
}

export function ArtifactLabPanel() {
  const [selectedId, setSelectedId] = useState<CatalogArtifactId>("calendar-search");
  const artifact = useMemo(() => buildArtifact(selectedId), [selectedId]);
  const status = statusCopy(selectedId);
  const copy = promptCopy(selectedId);
  const selectedFamily = artifactFamily(selectedId);
  const visibleOptions = useMemo(
    () => ARTIFACT_OPTIONS.filter((option) => artifactFamily(option.value) === selectedFamily),
    [selectedFamily],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-page text-primary transition-colors duration-300">
      <main className="chat-scroll-container min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-8 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col pb-20">
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-2xs font-medium uppercase tracking-[0.16em] text-disabled dark:text-muted">
                Artifact catalog
              </p>
              <h1 className="mt-1 font-display text-2xl font-normal text-primary">
                Inline artifact preview
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
                A focused chat fixture for shaping artifact states before they move into production conversations.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:w-[380px] sm:grid-cols-[150px_minmax(0,1fr)]">
              <Select
                value={selectedFamily}
                options={FAMILY_SELECT_OPTIONS}
                onChange={(value) => {
                  const nextFamily = FAMILY_OPTIONS.find((family) => family.value === value);
                  if (nextFamily) setSelectedId(nextFamily.initial);
                }}
                aria-label="Artifact family"
                className="!rounded-2xl !bg-surface-base/70 dark:!bg-white/[0.06]"
              />
              <Select
                value={selectedId}
                options={visibleOptions}
                onChange={(value) => setSelectedId(value as CatalogArtifactId)}
                aria-label="Artifact type"
                className="!rounded-2xl !bg-surface-base/70 dark:!bg-white/[0.06]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-8">
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="group relative flex flex-col items-end"
          >
            <div className="flex max-w-[88%] flex-col items-end gap-1.5 sm:max-w-[75%] md:max-w-[70%]">
              <div className="rounded-2xl bg-surface-base px-4 py-3 text-primary transition-colors duration-300 dark:bg-surface-raised dark:text-disabled">
                <p className="text-sm leading-relaxed">
                  {copy.user}
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="group relative flex flex-col items-start"
          >
            <div className="w-full">
              <div className="prose-chat">
                <p>
                  {copy.assistant}
                </p>
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs text-muted dark:text-disabled">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-base/80 dark:bg-white/[0.06]">
                  {status.icon}
                </span>
                <span>{status.label}</span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedId}
                  initial={{ opacity: 0, y: 10, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.99 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-3 max-w-2xl"
                >
                  <ArtifactRenderer code={JSON.stringify(artifact, null, 2)} />
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
          </div>
          <ActivityPreviewPanel />
        </div>
      </main>
    </div>
  );
}
