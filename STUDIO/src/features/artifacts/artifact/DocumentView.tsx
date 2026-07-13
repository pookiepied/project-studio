import { useState } from "react";
import { Copy, Check } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";

interface DocumentViewProps {
  content: string;
}

export function DocumentView({ content }: DocumentViewProps) {
  const [copied, setCopied] = useState(false);

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
        title="Copy content"
        className="absolute top-3 right-3 z-10 flex items-center !gap-1.5 !px-2 !h-6 !rounded !text-2xs font-medium !bg-surface-base/80 dark:!bg-surface-raised/80 border !border-surface-border/60 dark:!border-surface-border/60 !text-muted dark:!text-disabled hover:!text-secondary dark:hover:!text-disabled backdrop-blur-sm transition-colors !duration-100"
      >
        {copied
          ? <><Check size="xs" className="text-secondary" /> Copied</>
          : <><Copy size="xs" /> Copy</>
        }
      </Button>

      {/* Document body — plain prose, pre-wrap for whitespace */}
      <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-auto-hide">
        <pre
          className="text-sm leading-relaxed text-secondary dark:text-disabled whitespace-pre-wrap break-words font-sans"
        >
          {content}
        </pre>
      </div>
    </div>
  );
}
