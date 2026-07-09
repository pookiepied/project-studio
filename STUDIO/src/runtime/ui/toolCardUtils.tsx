import {
  MagnifyingGlassIcon as MagnifyingGlass,
  LinkIcon as Link,
  BrainIcon as Brain,
  DatabaseIcon as Database,
  PencilSimpleIcon as PencilSimple,
  FolderOpenIcon as FolderOpen,
  ImageSquareIcon as ImageSquare,
  FilmStripIcon as FilmStrip,
  ClockIcon as Clock,
  GithubLogoIcon as GithubLogo,
  EnvelopeSimpleIcon as EnvelopeSimple,
  CalendarBlankIcon as CalendarBlank,
  BrowsersIcon as Browsers,
  CodeIcon as Code,
  LightningIcon as Lightning,
  WrenchIcon as Wrench,
  TerminalIcon as Terminal,
  FileTextIcon as FileText,
} from "@phosphor-icons/react";
import { formatLabel } from "@/lib/formatters";
import { resolveMcpService, getMcpActionLabel } from "./toolCardRegistry";

const TOOL_LABELS: Record<string, string> = {
  claude_code: "Local Agent",
  spawn_agent: "Sub-agent",
  task_write: "Updating tasks",
  ask_user_question: "Asking you a question",
  read_file: "Reading file",
  edit_file: "Editing file",
  write_file: "Writing file",
  bash: "Running shell command",
  powershell: "Running PowerShell",
  glob: "Finding files",
  grep: "Searching files",
  ls: "Listing directory",
  repl: "Running code",
  sleep: "Waiting",
  web_search: "Searching the web",
  web_fetch: "Fetching web page",
  http_request: "Making a request",
  memory_read: "Reading memory",
  memory_write: "Saving to memory",
  memory_update: "Updating memory",
  memory_delete: "Deleting from memory",
  memory_list: "Listing memories",
  image_generate: "Generating image",
  video_generate: "Generating video",
  video_status:   "Checking video status",
  think: "Thinking",
  skill_read: "Loading platform knowledge",
  current_time: "Getting the time",
  rag: "Searching knowledge base",
};

export function toolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];

  // Use the MCP registry for branded display names
  const service = resolveMcpService(name);
  if (service) {
    const action = getMcpActionLabel(name);
    return `${service.displayName}: ${action}`;
  }

  // Generic MCP fallback — at least strip the mcp_<server>__ prefix
  const mcpMatch = name.match(/^mcp_(.+?)__(.+)$/);
  if (mcpMatch) return formatLabel(mcpMatch[2]);

  return formatLabel(name);
}

export function getToolIcon(name: string, iconSize = 16) {
  const n = name.toLowerCase();
  const c = "text-gray-500 dark:text-gray-400 flex-shrink-0";
  const s = iconSize;

  // MCP registry — returns branded icon when available
  const service = resolveMcpService(name);
  if (service) return service.getIcon(s, c);

  // Core tool icons
  if (n.includes("search") || n.includes("web_search")) return <MagnifyingGlass size={s} weight="bold" className={c} />;
  if (n.includes("http") || n.includes("fetch")) return <Link size={s} weight="bold" className={c} />;
  if (n.includes("think") || n.includes("thinking")) return <Brain size={s} weight="fill" className={c} />;
  if (n.includes("bash") || n.includes("repl") || n.includes("powershell") || n.includes("cmd") || n.includes("command")) return <Terminal size={s} weight="bold" className={c} />;
  if (n.includes("read_file") || n.includes("cat")) return <FileText size={s} weight="bold" className={c} />;
  if (n.includes("write_file") || n.includes("edit_file") || n.includes("modify") || n.includes("write")) return <PencilSimple size={s} weight="bold" className={c} />;
  if (n.includes("ls") || n.includes("glob") || n.includes("list_dir")) return <FolderOpen size={s} weight="fill" className={c} />;
  if (n.includes("memory") || n.includes("store")) return <Database size={s} weight="bold" className={c} />;
  if (n === "video_generate" || n.includes("video")) return <FilmStrip size={s} weight="bold" className={c} />;
  if (n.includes("image") || n.includes("generate")) return <ImageSquare size={s} weight="bold" className={c} />;
  if (n.includes("time") || n.includes("sleep")) return <Clock size={s} weight="bold" className={c} />;
  if (n.includes("github") || n.includes("git")) return <GithubLogo size={s} weight="fill" className={c} />;
  if (n.includes("gmail") || n.includes("email")) return <EnvelopeSimple size={s} weight="bold" className={c} />;
  if (n.includes("calendar")) return <CalendarBlank size={s} weight="bold" className={c} />;
  if (n.includes("browser")) return <Browsers size={s} weight="bold" className={c} />;
  // Generic MCP / studio-harness tool: infer from action part of the name
  if (n.startsWith("mcp_")) return <Lightning size={s} weight="fill" className={c} />;
  if (n.includes("studio") || n.includes("local") || n.includes("reaper")) return <Code size={s} weight="bold" className={c} />;
  if (n.includes("skill") || n.includes("knowledge")) return <Lightning size={s} weight="fill" className={c} />;

  return <Wrench size={s} weight="bold" className={c} />;
}

export function argsPreview(args: Record<string, unknown>): string {
  // task_write: show active task or progress count
  if (Array.isArray(args.todos)) {
    const todos = args.todos as Array<{ content?: string; activeForm?: string; status?: string }>;
    const active = todos.find((t) => t.status === "in_progress");
    if (active?.activeForm) return active.activeForm;
    if (active?.content) return active.content;
    const done = todos.filter((t) => t.status === "completed").length;
    return `${done}/${todos.length} tasks`;
  }
  if (args.task && typeof args.task === "string") {
    const t = args.task as string;
    return t.length > 70 ? t.slice(0, 70) + "…" : t;
  }
  if (args.query && typeof args.query === "string") {
    const q = args.query as string;
    return q.length > 70 ? q.slice(0, 70) + "…" : q;
  }
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  for (const [, v] of entries) {
    if (typeof v === "string") return v.length > 70 ? v.slice(0, 70) + "…" : v;
  }
  return "";
}
