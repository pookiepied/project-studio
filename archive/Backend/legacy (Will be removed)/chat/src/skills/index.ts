import { PRODUCT_SELF_KNOWLEDGE } from "./platform";
import { CODING_WORKFLOW } from "./coding";
import { DOCUMENT_WORKFLOW } from "./documents";
import { DESKTOP_WORKFLOW } from "./desktop";

interface Skill {
  category: string;
  name: string;
  key: string;
  description: string;
  content: string;
}

const SKILLS: Skill[] = [
  {
    category: "Platform",
    name: "Product Self-Knowledge",
    key: "product-self-knowledge",
    description: "What Studio is, who built it (pookiepied), architecture, and what's live vs in development",
    content: PRODUCT_SELF_KNOWLEDGE,
  },
  {
    category: "Workflows",
    name: "Coding Workflow",
    key: "coding_workflow",
    description: "Load at the start of ANY coding task — reading code, understanding a codebase, editing files, debugging, running tests, or making commits. Covers the efficient read pattern (grep → outline → targeted section), which tool to use for each write/run action, and the full step-by-step workflow for code changes.",
    content: CODING_WORKFLOW,
  },
  {
    category: "Workflows",
    name: "Document Workflow",
    key: "document_workflow",
    description: "Load when a user uploads a file, references an indexed document or book, or asks you to read/search/summarise large text content. Covers how to present document structure (TOC, chapters), how to query with chapter and section filters, how to handle large books, and how to use index_document for local files.",
    content: DOCUMENT_WORKFLOW,
  },
  {
    category: "Workflows",
    name: "Desktop Workflow",
    key: "desktop_workflow",
    description: "Load before any desktop automation, system monitoring, settings configuration, or UI interaction task on a Windows machine. Covers all 110 desktop tools across 8 domains (monitoring, process control, settings, vision/OCR, window automation, input, network, security), with decision trees, cooperation patterns, and known limitations.",
    content: DESKTOP_WORKFLOW,
  },
];

export function getSkillsIndex(): string {
  return SKILLS.map(
    (s) => `- **${s.key}** [${s.category}]: ${s.description}`
  ).join("\n");
}

export function getSkillByKey(key: string): Skill | null {
  return SKILLS.find((s) => s.key === key) ?? null;
}

export function getSkillKeys(): string[] {
  return SKILLS.map((s) => s.key);
}
