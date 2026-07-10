import { useState, useEffect, useCallback } from "react";
import {
  BrainIcon as Brain,
  TagIcon as Tag,
  ListIcon as List,
  ShareNetworkIcon as ShareNetwork,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { Edit, Delete, Close, Success, Warning, Search, Icon } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Badge } from "@/ui/primitives/Badge";
import { Textarea } from "@/ui/primitives/Textarea";
import { Spinner } from "@/ui/primitives/Spinner";
import { EmptyState } from "@/ui/primitives/EmptyState";
import { SegmentedControl } from "@/ui/primitives/SegmentedControl";
import { createHeaders } from "@/lib/api";
import { apiManager } from "@/core/network/apiManager";
import { logger } from "@/core/logging/logger";
import { formatLabel } from "@/lib/formatters";
import { MemoriesGraph } from "../components";
import type { Memory } from "../types";

export const MemoriesPage = () => {
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filtered, setFiltered] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoints = await apiManager.getEndpoints();
      if (!endpoints.memories) {
        setError("Memories API not configured.");
        return;
      }
      const headers = await createHeaders();
      const res = await fetch(endpoints.memories, { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as any).error?.message ?? `Request failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setMemories(data.memories ?? []);
    } catch (err: any) {
      logger.error("MemoriesPage", "fetch failed", err);
      setError("Could not load memories. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  // Filter by search term
  useEffect(() => {
    if (!search.trim()) {
      setFiltered(memories);
      return;
    }
    const q = search.toLowerCase();
    setFiltered(
      memories.filter(
        (m) =>
          (m.key || "").toLowerCase().includes(q) ||
          (m.content || "").toLowerCase().includes(q) ||
          (m.tags || []).some((t) => (t || "").toLowerCase().includes(q))
      )
    );
  }, [search, memories]);

  const startEdit = (m: Memory) => {
    setEditingKey(m.key);
    setEditContent(m.content);
    setConfirmDeleteKey(null);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditContent("");
  };

  const saveEdit = async (key: string) => {
    setSavingKey(key);
    try {
      const endpoints = await apiManager.getEndpoints();
      const headers = await createHeaders();
      const encodedKey = encodeURIComponent(key);
      const res = await fetch(`${endpoints.memories}/${encodedKey}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setMemories((prev) =>
        prev.map((m) => (m.key === key ? { ...m, content: editContent } : m))
      );
      setEditingKey(null);
    } catch (err: any) {
      logger.error("MemoriesPage", "save failed", err);
    } finally {
      setSavingKey(null);
    }
  };

  const deleteMemory = async (key: string) => {
    setDeletingKey(key);
    try {
      const endpoints = await apiManager.getEndpoints();
      const headers = await createHeaders();
      const encodedKey = encodeURIComponent(key);
      const res = await fetch(`${endpoints.memories}/${encodedKey}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setMemories((prev) => prev.filter((m) => m.key !== key));
      setConfirmDeleteKey(null);
    } catch (err: any) {
      logger.error("MemoriesPage", "delete failed", err);
    } finally {
      setDeletingKey(null);
    }
  };

  const formatAbsoluteDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface-page overflow-hidden transition-colors duration-normal">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-surface-border">
        <div className="flex items-center gap-3 mb-4">
          <Icon icon={Brain} size="lg" className="text-secondary" />
          <h1 className="text-2xl font-display font-normal text-primary">
            Memories
          </h1>
          {!loading && (
            <div className="ml-auto flex items-center gap-4">
              <span className="text-xs text-muted">
                {memories.length} {memories.length === 1 ? "entry" : "entries"}
              </span>
              <SegmentedControl
                aria-label="View mode"
                size="sm"
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { value: "list",  label: null, icon: <Icon icon={List} size="sm" />,         ariaLabel: "List view" },
                  { value: "graph", label: null, icon: <Icon icon={ShareNetwork} size="sm" />, ariaLabel: "Graph view" },
                ]}
              />
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size="sm"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by key, content, or tag..."
            className="w-full pl-8 pr-9 h-9 text-sm rounded-lg bg-surface-base border border-surface-border text-primary placeholder:text-muted transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted hover:text-primary transition-colors duration-fast"
            >
              <Close size="xs" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-auto-hide px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Spinner size="lg" className="text-muted" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-raised border border-surface-border text-sm text-secondary">
            <Warning size="sm" weight="fill" className="text-primary flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Brain}
            title={search ? "No memories match your search." : "No memories yet"}
            body={search ? undefined : "Start chatting to build your memory."}
            size="md"
          />
        ) : (
          <AnimatePresence mode="wait">
            {viewMode === "graph" ? (
              <motion.div
                key="graph-view"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className="h-full w-full"
              >
                <MemoriesGraph
                  memories={filtered}
                  onNodeClick={(node) => {
                    if (node.group === "memory" && node.originalMemory) {
                      startEdit(node.originalMemory);
                      setViewMode("list");
                    }
                  }}
                />
              </motion.div>
            ) : (
              <motion.div
                key="list-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                <AnimatePresence initial={false}>
                  <div className="space-y-2">
              {filtered.map((memory, index) => (
                <motion.div
                  key={memory.key || `memory-fallback-${index}`}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="rounded-xl border border-surface-border bg-surface-base p-4"
                >
                  {/* Key + date row */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-xs font-medium text-secondary truncate">
                      {formatLabel(memory.key)}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-xs text-muted">
                        {formatAbsoluteDate(memory.updatedAt)}
                      </span>

                      {/* Edit button */}
                      {editingKey !== memory.key && (
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label="Edit memory"
                          title="Edit"
                          onClick={() => startEdit(memory)}
                        >
                          <Edit size="xs" />
                        </IconButton>
                      )}

                      {/* Delete / confirm delete */}
                      {confirmDeleteKey === memory.key ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteMemory(memory.key)}
                            loading={deletingKey === memory.key}
                          >
                            Delete
                          </Button>
                          <IconButton
                            variant="ghost"
                            size="sm"
                            aria-label="Cancel delete"
                            onClick={() => setConfirmDeleteKey(null)}
                          >
                            <Close size="xs" />
                          </IconButton>
                        </div>
                      ) : (
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label="Delete memory"
                          title="Delete"
                          onClick={() => {
                            setConfirmDeleteKey(memory.key);
                            cancelEdit();
                          }}
                        >
                          <Delete size="xs" />
                        </IconButton>
                      )}
                    </div>
                  </div>

                  {/* Content — editable or static */}
                  {editingKey === memory.key ? (
                    <div className="space-y-2">
                      <Textarea
                        size="sm"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={4}
                        className="resize-none"
                        autoFocus
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={cancelEdit}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => saveEdit(memory.key)}
                          disabled={savingKey === memory.key || !editContent.trim()}
                          loading={savingKey === memory.key}
                          leftIcon={<Success size="xs" />}
                        >
                          {savingKey === memory.key ? "Saving…" : "Save"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-secondary whitespace-pre-wrap leading-relaxed">
                      {memory.content}
                    </p>
                  )}

                  {/* Tags */}
                  {memory.tags.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      <Icon icon={Tag} size="xs" className="text-muted" />
                      {memory.tags.map((tag) => (
                        <Badge key={tag} tone="muted" size="sm">
                          {formatLabel(tag)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
                  </div>
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};
