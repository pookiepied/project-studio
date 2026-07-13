import { useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneLight, atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { Copy, Check } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { FONT_MONO } from "@/design/fonts";
import { useSettings } from "@/app/contexts/SettingsContext";
import { isResolvedDark } from "@/lib/theme";

interface CodeViewProps {
  content:  string;
  language: string;
}

export function CodeView({ content, language }: CodeViewProps) {
  const [copied, setCopied] = useState(false);
  const { settings } = useSettings();
  const isDark = isResolvedDark(settings.theme);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Copy button */}
      <Button
        variant="ghost"
        onClick={handleCopy}
        title="Copy code"
        className="absolute top-3 right-3 z-10 flex items-center !gap-1.5 !px-2 !h-6 !rounded !text-2xs font-medium !bg-surface-base/80 dark:!bg-surface-raised/80 border !border-surface-border/60 dark:!border-surface-border/60 !text-muted dark:!text-disabled hover:!text-secondary dark:hover:!text-disabled backdrop-blur-sm transition-colors !duration-100"
      >
        {copied
          ? <><Check size="xs" className="text-secondary" /> Copied</>
          : <><Copy size="xs" /> Copy</>
        }
      </Button>

      {/* Code */}
      <div className="flex-1 overflow-auto text-sm" style={{ fontFamily: FONT_MONO }}>
        <SyntaxHighlighter
          language={language || "text"}
          style={isDark ? atomOneDark : atomOneLight}
          customStyle={{
            margin:     0,
            padding:    "16px",
            background: "transparent",
            fontSize:   "inherit",
            fontFamily: "inherit",
            minHeight:  "100%",
          }}
          showLineNumbers={content.split("\n").length > 10}
          lineNumberStyle={{ color: "var(--text-disabled)", minWidth: "2.5em" }}
          wrapLongLines={false}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
