import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArtifactRenderer } from "@/features/markdown";
import { Select } from "@/ui/primitives/Select";
import { Calendar, Clock, Edit, Email, Icon, ImageSquareIcon, Search, Send, SparkleIcon, Success, Warning } from "@/ui/icons";
import type { Artifact } from "@/types/artifacts";

type CatalogArtifactId =
  | "web-searching"
  | "web-fetching"
  | "web-completed"
  | "image-queued"
  | "image-generating"
  | "image-completed"
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
  | "calendar-search"
  | "calendar-event"
  | "calendar-draft"
  | "calendar-action"
  | "calendar-schedule"
  | "calendar-availability";

type CatalogFamily = "web" | "image" | "gmail" | "calendar";

const ARTIFACT_OPTIONS: Array<{ value: CatalogArtifactId; label: string }> = [
  { value: "web-searching", label: "Web research / searching" },
  { value: "web-fetching", label: "Web research / fetching sources" },
  { value: "web-completed", label: "Web research / completed" },
  { value: "image-queued", label: "Image generation / queued" },
  { value: "image-generating", label: "Image generation / active" },
  { value: "image-completed", label: "Image generation / completed" },
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
  { value: "calendar-search", label: "Calendar / search results" },
  { value: "calendar-event", label: "Calendar / event detail" },
  { value: "calendar-draft", label: "Calendar / event draft" },
  { value: "calendar-action", label: "Calendar / action result" },
  { value: "calendar-schedule", label: "Calendar / schedule view" },
  { value: "calendar-availability", label: "Calendar / availability check" },
];

const FAMILY_OPTIONS: Array<{ value: CatalogFamily; label: string; initial: CatalogArtifactId }> = [
  { value: "web", label: "Web", initial: "web-searching" },
  { value: "image", label: "Image", initial: "image-queued" },
  { value: "gmail", label: "Gmail", initial: "gmail-searching" },
  { value: "calendar", label: "Calendar", initial: "calendar-search" },
];

function artifactFamily(id: CatalogArtifactId): CatalogFamily {
  if (id.startsWith("image-")) return "image";
  if (id.startsWith("gmail-")) return "gmail";
  if (id.startsWith("calendar-")) return "calendar";
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

function buildArtifact(id: CatalogArtifactId): Artifact {
  if (id.startsWith("image-")) return buildImageArtifact(id);
  if (id.startsWith("gmail-")) return buildGmailArtifact(id);
  if (id.startsWith("calendar-")) return buildCalendarArtifact(id);
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
  }
}

function promptCopy(id: CatalogArtifactId) {
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

  return {
    user: "Check the uploaded budget document and image, then research whether Apple stock looks profitable.",
    assistant: "I found the relevant spending context. I'll keep web search and page fetching inside one inline research artifact so the result stays attached to the conversation.",
  };
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
    <div className="flex min-h-full flex-col bg-surface-page text-primary transition-colors duration-300">
      <main className="chat-scroll-container flex-1 overflow-y-auto overflow-x-hidden px-4 pt-8 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col pb-16">
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
            <div className="flex w-full flex-col gap-2 sm:w-[340px]">
              <div className="flex rounded-2xl bg-surface-base/70 p-1 dark:bg-white/[0.045]">
                {FAMILY_OPTIONS.map((family) => {
                  const active = selectedFamily === family.value;
                  return (
                    <button
                      key={family.value}
                      type="button"
                      onClick={() => setSelectedId(family.initial)}
                      className={`h-7 flex-1 rounded-xl text-xs font-medium transition-colors ${
                        active
                          ? "bg-surface-page text-primary shadow-sm dark:bg-white/[0.08] dark:text-primary"
                          : "text-muted hover:text-secondary dark:text-muted dark:hover:text-disabled"
                      }`}
                    >
                      {family.label}
                    </button>
                  );
                })}
              </div>
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
        </div>
      </main>
    </div>
  );
}
