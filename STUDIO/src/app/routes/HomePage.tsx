/**
 * HomePage — root page wrapper.
 *
 * Responsibilities:
 *   • Provide RecordingProvider, ChatProvider, NavigationProvider
 *   • Track the active view in local state
 *   • Mount the two always-on headless components:
 *       GlobalShortcutHandler — hotkeys + Pulse overlay lifecycle
 *       GlobalContextEvents   — DOM event → view routing
 *   • Render the active page inside MainLayout with AnimatePresence transitions
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { MainLayout }    from "@/app/shell/MainLayout";
import { TranscribePage } from "@/features/transcription";
import { SettingsPage }   from "@/features/settings";
import { ChatPage }       from "@/features/chat";
import { VoicePage }      from "@/features/voice";
import { MemoriesPage }   from "@/features/memories";
import { ProjectsPage }   from "./ProjectsPage";
import { ProfilePage }    from "./ProfilePage";
import { ExtensionsPage } from "@/features/extensions";
import { ActivityPage }   from "@/features/activity";
import { ManagePage }     from "@/features/manage";
import { WorkspacePage }   from "@/features/workspace";
import { ComputerUsePage } from "@/features/computerUse";

import { NavigationProvider }   from "../contexts/NavigationContext";
import { RecordingProvider }    from "@/features/voice/context/RecordingContext";
import { ChatProvider }         from "@/features/chat/context";
import { LiveSessionProvider }  from "@/features/voice/context/LiveSessionContext";

import { GlobalShortcutHandler } from "@/app/globals/GlobalShortcutHandler";
import { GlobalContextEvents }   from "@/app/globals/GlobalContextEvents";
import { PermissionLayerHost }   from "@/features/permissions";

import type { View } from "@/types/navigation";

// ─── Page transition config ───────────────────────────────────────────────────

const PAGE_VARIANTS = {
  initial:  { opacity: 0, y: 20 },
  animate:  { opacity: 1, y: 0 },
  exit:     { opacity: 0, y: -20 },
} as const;

const PAGE_TRANSITION = { duration: 0.3, ease: "easeInOut" as const };

// ─── Component ────────────────────────────────────────────────────────────────

export const HomePage = () => {
  // Chat is the primary destination on launch.
  const [currentView, setCurrentView] = useState<View>("chat");

  // ── Recording callbacks ───────────────────────────────────────────────────

  const handleRecordingComplete = (_original: string, rephrased?: string) => {
    toast.success(rephrased ? "Text transcribed and rephrased!" : "Text transcribed!");
  };

  const handleRecordingError = (error: string) => {
    toast.error(error);
  };

  // ── View rendering ────────────────────────────────────────────────────────

  const renderView = () => {
    const wrap = (key: string, node: React.ReactNode, extraClass = "h-full") => (
      <motion.div
        key={key}
        variants={PAGE_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={PAGE_TRANSITION}
        className={extraClass}
      >
        {node}
      </motion.div>
    );

    switch (currentView) {
      case "transcribe":  return wrap("transcribe",  <TranscribePage />);
      case "settings":    return wrap("settings",    <SettingsPage />);
      case "chat":        return wrap("chat",         <ChatPage />);
      case "voice":       return wrap("voice",        <VoicePage onNavigateSettings={() => setCurrentView("settings")} />);
      case "profile":     return wrap("profile",      <ProfilePage />);
      case "memories":    return wrap("memories",    <MemoriesPage />);
      case "projects":    return wrap("projects",    <ProjectsPage />);
      case "workspace":   return wrap("workspace",   <WorkspacePage />);
      case "extensions":  return wrap("extensions",  <ExtensionsPage />);
      case "activity":    return wrap("activity",    <ActivityPage />);
      case "manage":      return wrap("manage",      <ManagePage />);
      case "computer":    return wrap("computer",    <ComputerUsePage />);
      case "help":        return wrap(
        "help",
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-base font-semibold text-secondary dark:text-disabled mb-1">Help</p>
            <p className="text-sm text-disabled dark:text-secondary">Documentation coming soon.</p>
          </div>
        </div>,
        "h-full flex items-center justify-center",
      );
      default:            return wrap("default",     <TranscribePage />);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <NavigationProvider currentView={currentView} onNavigate={setCurrentView}>
      <RecordingProvider onComplete={handleRecordingComplete} onError={handleRecordingError}>
        <ChatProvider>
          {/* LiveSessionProvider is above all pages so the voice session survives
              page navigation — pressing Ctrl+Shift+V never forces a page change. */}
          <LiveSessionProvider>

            {/* Always-on headless listeners — survive view changes */}
            <GlobalShortcutHandler onViewChange={setCurrentView} />
            <GlobalContextEvents   currentView={currentView} onViewChange={setCurrentView} />
            {/* Permission notification host (headless). Mounted inside
                ChatProvider so it watches activeToolCalls on every page —
                Settings includes permission toasts for tools still pending
                on the chat, and the in-composer card resolves when the user
                returns to chat view. */}
            <PermissionLayerHost />

            <MainLayout currentView={currentView} onViewChange={setCurrentView}>
              <AnimatePresence mode="wait">
                {renderView()}
              </AnimatePresence>
            </MainLayout>

          </LiveSessionProvider>
        </ChatProvider>
      </RecordingProvider>
    </NavigationProvider>
  );
};
