import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowSquareOutIcon as ArrowSquareOut, GlobeIcon as Globe, ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { environmentService } from "@/core/platform/environmentService";

interface ExternalLinkProps {
  href?: string;
  children?: React.ReactNode;
}

async function openExternalUrl(url: string) {
  if (environmentService.isTauri()) {
    try {
      await invoke("plugin:opener|open_url", { url });
      return;
    } catch {
      /* fall back to window.open */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const ExternalLink = ({ href, children }: ExternalLinkProps) => {
  const [showPopover, setShowPopover] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const linkRef = useRef<HTMLAnchorElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (linkRef.current) {
      const rect = linkRef.current.getBoundingClientRect();
      const popoverWidth = 280;
      const viewportWidth = window.innerWidth;
      let left = rect.left;
      if (left + popoverWidth > viewportWidth - 12) {
        left = viewportWidth - popoverWidth - 12;
      }
      if (left < 12) left = 12;
      setPosition({
        top: rect.bottom + 6,
        left,
      });
    }
    setShowPopover(true);
  }, []);

  const handleOpen = useCallback(() => {
    setShowPopover(false);
    if (href) {
      openExternalUrl(href);
    }
  }, [href]);

  useEffect(() => {
    if (!showPopover) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        linkRef.current &&
        !linkRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowPopover(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showPopover]);

  const displayUrl = href
    ? (() => {
        try {
          const u = new URL(href);
          const path = u.pathname.length > 25 ? u.pathname.slice(0, 22) + "..." : u.pathname;
          return u.host + path;
        } catch {
          return href.length > 40 ? href.slice(0, 37) + "..." : href;
        }
      })()
    : "";

  return (
    <>
      <a
        ref={linkRef}
        href={href}
        onClick={handleClick}
        className="inline-flex items-center gap-0.5"
        title={href}
      >
        {children}
        <ArrowSquareOut size={12} className="inline opacity-50 ml-0.5" />
      </a>

      {showPopover && createPortal(
        <AnimatePresence>
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="fixed z-popover flex items-center gap-2 px-3 py-2 bg-surface-base border border-surface-border rounded-lg shadow-lg"
            style={{
              top: position.top,
              left: position.left,
              transformOrigin: "top left",
            }}
          >
            <Globe size={14} className="text-muted flex-shrink-0" />
            <span className="text-xs text-muted font-mono max-w-[180px] truncate">
              {displayUrl}
            </span>
            <button
              onClick={handleOpen}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-primary text-on-emphasis rounded-full hover:bg-secondary transition-colors whitespace-nowrap"
            >
              Open
              <ArrowUpRight size={12} weight="regular" />
            </button>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default ExternalLink;
