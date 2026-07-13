import { useState } from "react";
import { ImageLightbox } from "@/features/markdown";
import { IconButton } from "@/ui/primitives/IconButton";

interface ScreenshotThumbnailProps {
  url: string;
  idx: number;
}

/** Thumbnail for a screenshot captured by an MCP tool (e.g. screenshot/vision tools).
 *  Shows the image if the data URL is valid; falls back to an "Attachment" chip
 *  if the src fails to load (e.g. a stale reference in an old conversation). */
export const ScreenshotThumbnail = ({ url, idx }: ScreenshotThumbnailProps) => {
  const [failed,   setFailed]   = useState(false);
  const [lightbox, setLightbox] = useState(false);

  if (failed) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-base dark:bg-surface-raised rounded-xl border border-surface-border dark:border-surface-border">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="text-disabled dark:text-secondary flex-shrink-0">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <circle cx="8.5" cy="10.5" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M3 17l5-5 4 4 3-3 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
        <span className="text-xs text-disabled dark:text-secondary">Screenshot {idx + 1}</span>
      </div>
    );
  }

  return (
    <>
      <IconButton
        aria-label="Click to preview"
        title="Click to preview"
        onClick={() => setLightbox(true)}
        className="h-auto w-auto shrink-0 overflow-hidden rounded-xl border border-surface-border dark:border-surface-border hover:border-surface-border dark:hover:border-surface-border hover:bg-transparent transition-colors cursor-zoom-in group relative"
      >
        <img
          src={url}
          alt={`Screenshot ${idx + 1}`}
          className="max-w-[300px] max-h-[200px] object-contain block"
          onError={() => setFailed(true)}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-xl" />
      </IconButton>
      {lightbox && (
        <ImageLightbox
          src={url}
          alt={`Screenshot ${idx + 1}`}
          onClose={() => setLightbox(false)}
        />
      )}
    </>
  );
};
