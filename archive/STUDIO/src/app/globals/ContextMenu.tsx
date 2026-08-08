import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowBendUpRight,
  CopySimple,
  Icon,
  Message,
  Refresh,
  SelectionAll,
  Waveform,
} from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";

type MenuMode = "default" | "selection";

export function ContextMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [mode, setMode] = useState<MenuMode>("default");
  const [selectedText, setSelectedText] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Allow default context menu in input fields for copy/paste
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      e.preventDefault();

      // Check if there's selected text
      const sel = window.getSelection();
      const selText = sel?.toString().trim() ?? "";

      const menuWidth = 200;
      const menuHeight = selText ? 130 : 120;

      const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
      const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

      setPosition({ x, y });
      setSelectedText(selText);
      setMode(selText.length > 0 ? "selection" : "default");
      setIsOpen(true);
    };

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("mousedown", handleClick);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("mousedown", handleClick);
    };
  }, []);

  // Move keyboard focus to the first item when the menu opens, so it is
  // immediately keyboard-navigable (role=menu pattern).
  useEffect(() => {
    if (!isOpen) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [isOpen, mode]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch {
      document.execCommand("copy");
    }
    setIsOpen(false);
  };

  const handleSelectAll = () => {
    const el = document.activeElement as HTMLElement | null;
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    setIsOpen(false);
  };

  const handleChatAboutThis = () => {
    window.dispatchEvent(new CustomEvent("new-chat-with-text", { detail: { text: selectedText } }));
    setIsOpen(false);
  };

  const handleReloadApp = () => {
    setIsOpen(false);
    window.setTimeout(() => window.location.reload(), 180);
  };

  // Roving-focus keyboard navigation for the menu (Esc / arrows / Home / End).
  // Items are <button>s, so Enter/Space activation is handled natively.
  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const itemClass =
    "h-auto w-full justify-start gap-2.5 px-3 py-2 text-sm text-left focus:bg-surface-hover focus:text-primary";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          style={{ top: position.y, left: position.x }}
          className="fixed z-context w-48 p-1.5 bg-surface-base border border-surface-border rounded-xl shadow-xl flex flex-col overflow-hidden font-sans"
        >
          {mode === "selection" ? (
            <>
              {/* Truncated preview of selected text */}
              <div className="px-3 py-1.5 mb-0.5">
                <p className="text-2xs text-muted truncate max-w-full">
                  "{selectedText.length > 40 ? selectedText.slice(0, 40) + "…" : selectedText}"
                </p>
              </div>

              <Button role="menuitem" tabIndex={-1} onClick={handleCopy} variant="ghost" className={itemClass}>
                <Icon icon={CopySimple} size="sm" className="text-muted" />
                Copy
              </Button>

              <Button role="menuitem" tabIndex={-1} onClick={handleSelectAll} variant="ghost" className={itemClass}>
                <Icon icon={SelectionAll} size="sm" className="text-muted" />
                Select All
              </Button>

              <div className="h-px bg-surface-divider my-1 mx-2" />

              <Button role="menuitem" tabIndex={-1} onClick={handleChatAboutThis} variant="ghost" className={itemClass}>
                <Icon icon={ArrowBendUpRight} size="sm" className="text-muted" />
                Chat about this
              </Button>
            </>
          ) : (
            <>
              <Button
                role="menuitem"
                tabIndex={-1}
                variant="ghost"
                onClick={() => { window.dispatchEvent(new CustomEvent("new-chat")); setIsOpen(false); }}
                className={itemClass}
              >
                <Message size="sm" className="text-muted" />
                New Chat
              </Button>

              <Button
                role="menuitem"
                tabIndex={-1}
                variant="ghost"
                onClick={() => { window.dispatchEvent(new CustomEvent("start-live-session")); setIsOpen(false); }}
                className={itemClass}
              >
                <Waveform size="sm" className="text-muted" />
                Live Agent
              </Button>

              <div className="h-px bg-surface-divider my-1 mx-2" />

              <Button role="menuitem" tabIndex={-1} variant="ghost" onClick={handleReloadApp} className={itemClass}>
                <Refresh size="sm" className="text-muted" />
                Reload App
              </Button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
