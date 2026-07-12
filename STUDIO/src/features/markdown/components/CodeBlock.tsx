import { useState } from "react";
import { FONT_MONO } from "@/design/fonts";
import { CopyIcon as Copy, CheckIcon as Check, CaretDownIcon as CaretDown, CaretUpIcon as CaretUp, TextAlignLeftIcon as TextAlignLeft, EyeIcon as Eye } from "@phosphor-icons/react";
import { useBrowserPanel } from "@/app/contexts/BrowserPanelContext";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/ui/primitives/Button";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneLight, atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { errorService } from "@/core/errors/errorService";
import { toast } from "sonner";
import { useSettings } from "@/app/contexts/SettingsContext";
import { isResolvedDark } from "@/lib/theme";
import { MermaidDiagram } from "./MermaidDiagram";
import { LatexRenderer } from "../renderers/LatexRenderer";
import { SvgRenderer } from "../renderers/SvgRenderer";
import { CsvTable } from "../renderers/CsvTable";
import { JsonRenderer } from "../renderers/JsonRenderer";
import { ArtifactRenderer } from "../renderers/ArtifactRenderer";
import { TextBlock } from "../renderers/TextBlock";
import { VideoPlayer } from "@/features/markdown/components/VideoPlayer";

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
  [key: string]: any;
}

// LLM output commonly uses short aliases — map to names react-syntax-highlighter understands
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  jsx: "javascript",
  tsx: "typescript",
  tf: "hcl",
  dockerfile: "dockerfile",
  tex: "latex",
  math: "latex",
};

// Languages handled by dedicated renderers — not passed to SyntaxHighlighter
const RICH_RENDERERS = new Set(["mermaid", "latex", "svg", "csv", "json", "video", "text", "artifact"]);

// Human-readable display names for language labels
const DISPLAY_NAMES: Record<string, string> = {
  javascript: "JavaScript", typescript: "TypeScript", python: "Python",
  ruby: "Ruby", rust: "Rust", go: "Go", java: "Java", kotlin: "Kotlin",
  swift: "Swift", php: "PHP", perl: "Perl", scala: "Scala", r: "R",
  html: "HTML", css: "CSS", scss: "SCSS", sass: "SCSS",
  json: "JSON", yaml: "YAML", xml: "XML", sql: "SQL", csv: "CSV",
  bash: "Bash", powershell: "PowerShell", shell: "Shell",
  markdown: "Markdown", hcl: "HCL", dockerfile: "Dockerfile", latex: "LaTeX",
  c: "C", cpp: "C++", cs: "C#",
  mermaid: "Diagram", svg: "SVG", video: "Video", text: "Text", artifact: "Artifact",
};

function displayName(lang: string): string {
  return DISPLAY_NAMES[lang] ?? (lang.length <= 4 ? lang.toUpperCase() : lang.charAt(0).toUpperCase() + lang.slice(1));
}

const COLLAPSE_LINE_THRESHOLD = 20;

const getTextContent = (node: React.ReactNode): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  if (typeof node === "object" && "props" in node) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    return getTextContent(element.props.children);
  }
  return "";
};

export const CodeBlock = ({ children, className }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const { settings } = useSettings();
  const isDark = isResolvedDark(settings.theme);
  const { openHtml } = useBrowserPanel();
  const [previewOpened, setPreviewOpened] = useState(false);

  const handlePreview = () => {
    openHtml(code);
    setPreviewOpened(true);
    setTimeout(() => setPreviewOpened(false), 1500);
  };

  const rawLanguage = className?.match(/language-(\w+)/)?.[1]?.toLowerCase() || "text";
  const language = LANGUAGE_ALIASES[rawLanguage] ?? rawLanguage;
  const isInline = !className?.includes("language-");

  const code = getTextContent(children).replace(/\n$/, "");
  const lineCount = code.split("\n").length;
  const isLong = lineCount > COLLAPSE_LINE_THRESHOLD;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      const categorizedError = errorService.categorize(error);
      toast.error(categorizedError.userMessage);
    }
  };

  if (RICH_RENDERERS.has(language) && !isInline) {
    const renderBody = () => {
      switch (language) {
        case "mermaid": return <MermaidDiagram code={code} />;
        case "latex":   return <LatexRenderer code={code} />;
        case "svg":     return <SvgRenderer code={code} />;
        case "text":    return <TextBlock code={code} />;
        case "csv":     return <CsvTable code={code} />;
        case "json":    return <JsonRenderer code={code} />;
        case "artifact": return <ArtifactRenderer code={code} />;
        case "video": {
          const pairs: Record<string, string> = {};
          for (const line of code.split("\n")) {
            const eq = line.indexOf("=");
            if (eq > 0) pairs[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
          }
          if (!pairs.url) return null;
          return (
            <VideoPlayer
              videoUrl={pairs.url}
              aspectRatio={pairs.aspectRatio}
              duration={pairs.duration ? Number(pairs.duration) : undefined}
              resolution={pairs.resolution}
              mode={pairs.mode}
            />
          );
        }
        default:        return null;
      }
    };

    return (
      <div className="group relative my-4 rounded-xl overflow-hidden border border-gray-200 dark:border-surface-border transition-colors duration-300 w-full min-w-0">
        <div className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-surface-base border-b border-gray-200 dark:border-surface-border">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-600">{displayName(language)}</span>
          <Button
            variant="ghost"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-raised rounded-lg transition-smooth"
            title="Copy source"
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.div key="check" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ duration: 0.15 }} className="flex items-center gap-1">
                  <Check size={14} weight="bold" className="text-secondary" />
                  <span className="text-secondary">Copied</span>
                </motion.div>
              ) : (
                <motion.div key="copy" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <Copy size={14} weight="regular" />
                </motion.div>
              )}
            </AnimatePresence>
          </Button>
        </div>
        <div className="bg-white dark:bg-surface-base">
          {renderBody()}
        </div>
      </div>
    );
  }

  if (isInline) {
    return (
      <code
        className="px-1.5 py-0.5 bg-gray-100 dark:bg-surface-raised text-gray-900 dark:text-gray-200 rounded text-sm"
        style={{ fontFamily: FONT_MONO }}
      >
        {children}
      </code>
    );
  }

  const highlighterStyle = isDark ? atomOneDark : atomOneLight;

  return (
    <div className="group relative my-4 rounded-xl overflow-hidden border border-gray-200 dark:border-surface-border transition-colors duration-300 w-full min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-surface-base border-b border-gray-200 dark:border-surface-border transition-colors duration-300">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-600 font-sans transition-colors duration-300">
          {displayName(language)}
        </span>

        <div className="flex items-center gap-0.5">
          {/* HTML preview button */}
          {language === "html" && (
            <Button
              variant="ghost"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handlePreview}
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-raised rounded-lg transition-smooth"
              title="Open preview"
            >
              <AnimatePresence mode="wait">
                {previewOpened ? (
                  <motion.div
                    key="opened"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-1"
                  >
                    <Check size={14} weight="bold" className="text-secondary" />
                    <span className="text-secondary">Opened</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="preview"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-1"
                  >
                    <Eye size={14} weight="regular" />
                    <span>Preview</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </Button>
          )}

          {/* Word wrap toggle */}
          <Button
            variant="ghost"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setWordWrap((w) => !w)}
            aria-label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
            title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
            className={`p-1.5 rounded-lg transition-colors ${
              wordWrap
                ? "text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-surface-raised"
                : "text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-raised"
            }`}
          >
            <TextAlignLeft size={14} weight="regular" />
          </Button>

          {/* Expand/collapse for long blocks */}
          {isLong && (
            <Button
              variant="ghost"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsCollapsed((c) => !c)}
              aria-label={isCollapsed ? `Expand ${lineCount} lines` : "Collapse"}
              title={isCollapsed ? `Expand ${lineCount} lines` : "Collapse"}
              className="p-1.5 text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-raised rounded-lg transition-colors"
            >
              {isCollapsed ? <CaretDown size={14} weight="regular" /> : <CaretUp size={14} weight="regular" />}
            </Button>
          )}

          {/* Copy button */}
          <Button
            variant="ghost"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-raised rounded-lg transition-smooth"
            title="Copy code"
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.div
                  key="check"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-1"
                >
                  <Check size={14} weight="bold" className="text-secondary" />
                  <span className="text-secondary">Copied</span>
                </motion.div>
              ) : (
                <motion.div
                  key="copy"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Copy size={14} weight="regular" />
                </motion.div>
              )}
            </AnimatePresence>
          </Button>
        </div>
      </div>

      {/* Code body */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key="code-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="overflow-x-auto max-h-96 scrollbar-auto-hide w-full min-w-0">
              <SyntaxHighlighter
                language={language}
                style={highlighterStyle}
                showLineNumbers
                wrapLongLines={wordWrap}
                customStyle={{
                  margin: 0,
                  padding: "1rem 1.25rem",
                  fontSize: "0.8125rem",
                  lineHeight: "1.6",
                  background: "var(--surface-base)",
                  fontFamily: FONT_MONO,
                }}
                lineNumberStyle={{
                  minWidth: "2.5em",
                  paddingRight: "1em",
                  color: "#bbb",
                  userSelect: "none",
                  fontSize: "0.75rem",
                }}
                codeTagProps={{
                  style: {
                    fontFamily: "inherit",
                    fontWeight: 400,
                  },
                }}
              >
                {code}
              </SyntaxHighlighter>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed state */}
      {isCollapsed && (
        <Button
          variant="ghost"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setIsCollapsed(false)}
          className="w-full py-3 text-xs text-gray-500 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-surface-raised transition-colors flex items-center justify-center gap-2"
        >
          <CaretDown size={14} weight="bold" />
          <span>Show {lineCount} lines</span>
        </Button>
      )}
    </div>
  );
};
