import {
  BrowsersIcon,
  Brain,
  Clock,
  Code,
  DatabaseIcon,
  Document,
  Edit,
  Email,
  GithubLogoIcon,
  Icon,
  type IconSize,
  FilmStripIcon,
  FolderOpen,
  ImageSquareIcon,
  Lightning,
  Calendar,
  LinkIcon,
  Search,
  Terminal,
  WrenchIcon,
} from "@/ui/icons";
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

export function getToolIcon(name: string, size: IconSize = "xs") {
  const n = name.toLowerCase();
  const c = "text-muted dark:text-disabled flex-shrink-0";

  // MCP registry — returns branded icon when available
  const service = resolveMcpService(name);
  if (service) return service.getIcon(size, c);

  // Core tool icons
  if (n.includes("search") || n.includes("web_search")) return <Search size={size} className={c} />;
  if (n.includes("http") || n.includes("fetch")) return <Icon icon={LinkIcon} size={size} className={c} />;
  if (n.includes("think") || n.includes("thinking")) return <Brain size={size} weight="fill" className={c} />;
  if (n.includes("bash") || n.includes("repl") || n.includes("powershell") || n.includes("cmd") || n.includes("command")) return <Terminal size={size} className={c} />;
  if (n.includes("read_file") || n.includes("cat")) return <Document size={size} className={c} />;
  if (n.includes("write_file") || n.includes("edit_file") || n.includes("modify") || n.includes("write")) return <Edit size={size} className={c} />;
  if (n.includes("ls") || n.includes("glob") || n.includes("list_dir")) return <FolderOpen size={size} weight="fill" className={c} />;
  if (n.includes("memory") || n.includes("store")) return <Icon icon={DatabaseIcon} size={size} className={c} />;
  if (n === "video_generate" || n.includes("video")) return <Icon icon={FilmStripIcon} size={size} className={c} />;
  if (n.includes("image") || n.includes("generate")) return <Icon icon={ImageSquareIcon} size={size} className={c} />;
  if (n.includes("time") || n.includes("sleep")) return <Clock size={size} className={c} />;
  if (n.includes("github") || n.includes("git")) return <Icon icon={GithubLogoIcon} size={size} weight="fill" className={c} />;
  if (n.includes("gmail") || n.includes("email")) return <Email size={size} className={c} />;
  if (n.includes("calendar")) return <Calendar size={size} className={c} />;
  if (n.includes("browser")) return <Icon icon={BrowsersIcon} size={size} className={c} />;
  // Generic MCP / studio-harness tool: infer from action part of the name
  if (n.startsWith("mcp_")) return <Lightning size={size} weight="fill" className={c} />;
  if (n.includes("studio") || n.includes("local") || n.includes("reaper")) return <Code size={size} className={c} />;
  if (n.includes("skill") || n.includes("knowledge")) return <Lightning size={size} weight="fill" className={c} />;

  return <Icon icon={WrenchIcon} size={size} className={c} />;
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
