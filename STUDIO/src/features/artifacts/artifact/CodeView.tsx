import { useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneLight, atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { CopyIcon as Copy, CheckIcon as Check } from "@phosphor-icons/react";
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
        className="absolute top-3 right-3 z-10 flex items-center !gap-1.5 !px-2 !h-6 !rounded !text-2xs font-medium !bg-gray-100/80 dark:!bg-surface-raised/80 border !border-gray-200/60 dark:!border-surface-border/60 !text-gray-500 dark:!text-gray-400 hover:!text-gray-700 dark:hover:!text-gray-200 backdrop-blur-sm transition-colors !duration-100"
      >
        {copied
          ? <><Check size={12} weight="bold" className="text-secondary" /> Copied</>
          : <><Copy size={12} weight="regular" /> Copy</>
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
          lineNumberStyle={{ color: isDark ? "#555" : "#bbb", minWidth: "2.5em" }}
          wrapLongLines={false}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
