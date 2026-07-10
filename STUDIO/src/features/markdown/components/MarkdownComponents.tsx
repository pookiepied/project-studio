import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CodeBlock } from "./CodeBlock";
import ExternalLink from "@/features/markdown/components/MarkdownExternalLink";
import { tokenManager } from "@/lib/tokenManager";
import { TAURI_CONFIG } from "@/core/config/tauriConfig";

// ---------------------------------------------------------------------------
// Image lightbox — renders via portal so it overlays everything
// ---------------------------------------------------------------------------

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = useCallback(async () => {
    try {
      const res  = await fetch(src);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `studio_image_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    } catch {
      window.open(src, "_blank");
    }
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-context flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        {/* Toolbar */}
        <div
          className="absolute top-4 right-4 flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors backdrop-blur-sm"
            title="Download image"
          >
            {downloaded ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Saved
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm"
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Image */}
        <motion.img
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1,    opacity: 1 }}
          exit={{    scale: 0.92, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          src={src}
          alt={alt}
          className="max-w-full max-h-[90vh] rounded-2xl object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Inline image with hover toolbar and click-to-lightbox
// ---------------------------------------------------------------------------

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed,   setFailed]   = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [blobUrl,  setBlobUrl]  = useState<string | null>(null);
  const revokeRef = useRef<string | null>(null);

  const displayAlt = alt || "Generated image";
  const isApiImage = !!src?.startsWith(TAURI_CONFIG.API_BASE_URL);

  // Fetch API images with auth so the browser img tag gets the bytes directly
  useEffect(() => {
    if (!src || !isApiImage) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await tokenManager.getAccessToken();
        const resp = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled || !resp.ok) { if (!cancelled) setFailed(true); return; }
        const blob = await resp.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revokeRef.current = url;
        setBlobUrl(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (revokeRef.current) { URL.revokeObjectURL(revokeRef.current); revokeRef.current = null; }
    };
  }, [src, isApiImage]);

  const effectiveSrc = isApiImage ? (blobUrl ?? undefined) : src;

  if (!src) return null;

  if (isApiImage && !blobUrl && !failed) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-gray-100 dark:bg-surface-raised rounded-lg text-xs text-gray-400 dark:text-gray-500">
        <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }} className="text-2xs">▌</motion.span>
        Loading image…
      </span>
    );
  }

  if (failed) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-gray-100 dark:bg-surface-raised rounded-lg text-xs text-gray-500 dark:text-gray-400">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        {displayAlt}
      </span>
    );
  }

  return (
    <>
      <span
        className="relative inline-block cursor-zoom-in"
        onClick={() => setLightbox(true)}
      >
        <img
          src={effectiveSrc}
          alt={displayAlt}
          className="max-w-full rounded-2xl block"
          style={{ maxHeight: "480px", objectFit: "contain" }}
          onError={() => setFailed(true)}
        />
      </span>

      {lightbox && effectiveSrc && (
        <ImageLightbox
          src={effectiveSrc}
          alt={displayAlt}
          onClose={() => setLightbox(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Markdown component map
// ---------------------------------------------------------------------------

const markdownComponents = {
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code: ({ className, children, ...props }: any) => (
    <CodeBlock className={className} {...props}>
      {children}
    </CodeBlock>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <ExternalLink href={href}>{children}</ExternalLink>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) => (
    <MarkdownImage src={src} alt={alt} />
  ),
};

export default markdownComponents;
