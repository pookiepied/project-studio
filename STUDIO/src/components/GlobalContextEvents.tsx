/**
 * GlobalContextEvents
 *
 * Listens for DOM-level custom events dispatched from anywhere in the app
 * and routes them to the correct view/action:
 *
 *   "new-chat"            → create new conversation, navigate to chat
 *   "new-chat-with-text"  → same + inject text once chat mounts
 *   "start-live-session"  → navigate to voice page (UI only — session is
 *                           managed by LiveSessionContext / GlobalShortcutHandler)
 *
 * Also renders the brief white flash used when a new chat is opened
 * while the user is already on the chat page.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useChat } from "@/features/chat/context";
import type { View } from "../types/navigation";

// ─── Props ────────────────────────────────────────────────────────────────────

interface GlobalContextEventsProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GlobalContextEvents({ currentView, onViewChange }: GlobalContextEventsProps) {
  const { createNewConversation } = useChat();
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    const handleNewChat = () => {
      createNewConversation();
      if (currentView === "chat") {
        // Already on chat — flash to signal a fresh start instead of re-navigating
        setFlashing(true);
        setTimeout(() => setFlashing(false), 350);
      } else {
        onViewChange("chat");
      }
    };

    const handleNewChatWithText = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      createNewConversation();
      onViewChange("chat");
      // Small delay lets the new conversation mount before injecting the text
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("inject-chat-text", { detail: { text } }));
      }, 80);
    };

    const handleLiveSession = () => {
      // Navigate to VoicePage so the user can see the session UI.
      // Session start/stop is handled by GlobalShortcutHandler via LiveSessionContext
      // — no auto-start dispatch needed here.
      onViewChange("voice");
    };

    window.addEventListener("new-chat", handleNewChat);
    window.addEventListener("new-chat-with-text", handleNewChatWithText);
    window.addEventListener("start-live-session", handleLiveSession);

    return () => {
      window.removeEventListener("new-chat", handleNewChat);
      window.removeEventListener("new-chat-with-text", handleNewChatWithText);
      window.removeEventListener("start-live-session", handleLiveSession);
    };
  }, [createNewConversation, onViewChange, currentView]);

  return (
    <AnimatePresence>
      {flashing && (
        <motion.div
          key="flash"
          className="fixed inset-0 z-toast pointer-events-none bg-surface-page"
          initial={{ opacity: 0.6 }}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        />
      )}
    </AnimatePresence>
  );
}
