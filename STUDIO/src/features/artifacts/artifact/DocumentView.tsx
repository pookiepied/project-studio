import { useState } from "react";
import { CopyIcon as Copy, CheckIcon as Check } from "@phosphor-icons/react";

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
      <button
        onClick={handleCopy}
        title="Copy content"
        className="absolute top-3 right-3 z-10
                   flex items-center gap-1.5 px-2 h-6 rounded
                   text-2xs font-medium
                   bg-gray-100/80 dark:bg-surface-raised/80
                   border border-gray-200/60 dark:border-surface-border/60
                   text-gray-500 dark:text-gray-400
                   hover:text-gray-700 dark:hover:text-gray-200
                   backdrop-blur-sm transition-colors duration-100"
      >
        {copied
          ? <><Check size={10} weight="bold" className="text-secondary" /> Copied</>
          : <><Copy size={10} weight="regular" /> Copy</>
        }
      </button>

      {/* Document body — plain prose, pre-wrap for whitespace */}
      <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-auto-hide">
        <pre
          className="text-sm leading-relaxed text-gray-700 dark:text-gray-300
                     whitespace-pre-wrap break-words font-sans"
        >
          {content}
        </pre>
      </div>
    </div>
  );
}
