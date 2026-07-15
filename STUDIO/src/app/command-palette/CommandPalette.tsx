import { useState, useEffect, useMemo } from "react";
import { Command } from "cmdk";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Add,
  Message,
  Forward,
} from "@/ui/icons";
import { useCommandPalette } from "@/app/contexts/CommandPaletteContext";
import { useNavigation } from "@/app/contexts/NavigationContext";
import { useChat } from "@/features/chat/context";
import { getAllConversations } from "@/features/chat/conversations/chatHistoryService";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import {
  searchMessages,
  invalidateSearchCache,
  type MessageHit,
} from "@/features/chat/services/searchConversations";
import type { View } from "@/types/navigation";

interface ActionItem {
  id:       string;
  label:    string;
  keywords: string;
  icon:     React.ReactNode;
  run:      () => void;
}

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const { navigateTo } = useNavigation();
  const { createNewConversation, loadConversationById } = useChat();

  const [query, setQuery]                 = useState("");
  const [conversations, setConversations] = useState<ConversationMetadata[]>([]);
  const [hits, setHits]                   = useState<MessageHit[]>([]);

  useEffect(() => {
    if (!open) { setQuery(""); setHits([]); return; }
    invalidateSearchCache();
    getAllConversations().then(setConversations).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => { searchMessages(q).then(setHits).catch(() => {}); }, 180);
    return () => clearTimeout(t);
  }, [query, open]);

  const run = (fn: () => void) => { setOpen(false); fn(); };
  const goConversation = (id: string) =>
    run(async () => { await loadConversationById(id); navigateTo("chat"); });

  const actions: ActionItem[] = useMemo(() => {
    const nav = (label: string, view: View, keywords = "") => ({
      id: `go-${view}`, label, keywords, icon: <Forward size="md" />,
      run: () => navigateTo(view),
    });
    return [
      { id: "new-chat", label: "New chat", keywords: "new conversation create start",
        icon: <Add size="md" weight="regular" />,
        run: () => { createNewConversation(); navigateTo("chat"); } },
      nav("Go to Chat",       "chat",       "conversation"),
      nav("Open Live",        "voice",      "voice realtime talk"),
      nav("Open Profile",     "profile",    "account memory personal context"),
      nav("Open Projects",    "projects",   "project workspace folder"),
      nav("Open Workspace",   "workspace",  "context documents automation"),
      nav("Open Artifacts",   "artifacts",  "artifact catalog inline preview web research"),
      nav("Open Apps",        "extensions", "mcp plugins integrations"),
      nav("Open Transcribe",  "transcribe", "audio speech text"),
      nav("Open Computer Use", "computer",   "desktop browser automation"),
      nav("Open Memories",    "memories",   "memory profile"),
      nav("Open Activity",    "activity",   "history log usage"),
      nav("Open Manage",      "manage",     "admin users router"),
      nav("Open Settings",    "settings",   "preferences config account"),
    ];
  }, [navigateTo, createNewConversation]);

  const ql = query.trim().toLowerCase();
  const filteredActions = useMemo(
    () => actions.filter(a => !ql || a.label.toLowerCase().includes(ql) || a.keywords.includes(ql)),
    [actions, ql]
  );
  const filteredConversations = useMemo(
    () => conversations
      .filter(c => !ql || c.title.toLowerCase().includes(ql))
      .slice(0, ql ? 6 : 8),
    [conversations, ql]
  );

  const itemCls =
    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-secondary " +
    "cursor-pointer select-none data-[selected=true]:bg-surface-selected";
  const headingCls =
    "px-3 pt-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted";

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Lighter-than-modal scrim — intentionally bg-scrim, not full --scrim */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-scrim backdrop-blur-sm z-modal"
          />
          <div className="fixed inset-0 z-modal flex items-start justify-center pt-[16vh] px-4 pointer-events-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="w-[600px] max-w-[92vw] pointer-events-auto"
          >
            <Command
              shouldFilter={false}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
              className="bg-surface-raised border border-surface-border rounded-xl shadow-xl overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 border-b border-surface-border">
                <Search size="md" className="text-muted flex-shrink-0" />
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search or jump to…"
                  className="flex-1 h-12 bg-transparent text-sm text-primary placeholder-muted focus:outline-none"
                />
                <kbd className="text-2xs text-muted border border-surface-border rounded px-1.5 py-0.5">esc</kbd>
              </div>

              <Command.List className="max-h-[400px] overflow-y-auto p-1.5 scrollbar-thin">
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
                  No results found.
                </Command.Empty>

                {filteredActions.length > 0 && (
                  <Command.Group>
                    <div className={headingCls}>Actions</div>
                    {filteredActions.map(a => (
                      <Command.Item key={a.id} value={`action-${a.id}`} onSelect={() => run(a.run)} className={itemCls}>
                        <span className="text-muted flex-shrink-0">{a.icon}</span>
                        <span>{a.label}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {filteredConversations.length > 0 && (
                  <Command.Group>
                    <div className={headingCls}>Conversations</div>
                    {filteredConversations.map(c => (
                      <Command.Item key={c.id} value={`conv-${c.id}`} onSelect={() => goConversation(c.id)} className={itemCls}>
                        <Message size="md" className="text-muted flex-shrink-0" />
                        <span className="truncate">{c.title || "Untitled"}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {hits.length > 0 && (
                  <Command.Group>
                    <div className={headingCls}>Messages</div>
                    {hits.map(h => (
                      <Command.Item
                        key={h.messageId}
                        value={`msg-${h.messageId}`}
                        onSelect={() => goConversation(h.conversationId)}
                        className={itemCls + " items-start"}
                      >
                        <Search size="sm" className="text-muted flex-shrink-0 mt-0.5" />
                        <span className="flex flex-col min-w-0">
                          <span className="truncate text-secondary">{h.snippet}</span>
                          <span className="truncate text-xs text-muted">
                            {h.role === "user" ? "You" : "Assistant"} · {h.conversationTitle || "Untitled"}
                          </span>
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
