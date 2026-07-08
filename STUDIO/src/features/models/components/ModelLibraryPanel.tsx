/**
 * ModelLibraryPanel - floating workspace for browsing chat-capable models.
 *
 * The panel is intentionally wider than a menu: provider rail, model list,
 * and detail card stay visible together so users can compare before selecting.
 * Split (T4.5): rail / list-row / detail / filter live in ./library; this file
 * is the shell + state.
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Refresh, Close, Search } from "@/components/icons";
import { IconButton } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/Spinner";
import { useModelsContext as useModels } from "@/features/models/context";
import { sortModels, sortProvidersByFree, groupModelsByProvider } from "@/services/ai/modelService";
import { AUTO_DISPLAY_MODEL } from "@/config/autoMode";
import {
  CHAT_SELECTABLE_TYPES, LONG_CONTEXT_TOKENS,
  isFreeModel, isVisionModel, hasTools, modelMatchesSearch,
} from "../helpers";
import { FilterButton } from "./library/FilterButton";
import { ProviderRail } from "./library/ProviderRail";
import { ModelListRow } from "./library/ModelListRow";
import { ModelDetail } from "./library/ModelDetail";

type TypeFilter = "all" | "chat" | "multimodal";
type CapabilityFilter = "all" | "free" | "vision" | "tools" | "long";

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "chat", label: "Chat" },
  { id: "multimodal", label: "Vision" },
];

const CAPABILITY_FILTERS: { id: CapabilityFilter; label: string }[] = [
  { id: "all", label: "Any" },
  { id: "free", label: "Free" },
  { id: "vision", label: "Vision" },
  { id: "tools", label: "Tools" },
  { id: "long", label: "Long context" },
];

interface ModelLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectModel?: (modelId: string) => void;
  selectedModel?: string;
}

export function ModelLibraryPanel({
  isOpen,
  onClose,
  onSelectModel,
  selectedModel,
}: ModelLibraryPanelProps) {
  const { models, loading, error, uniqueModels, refetch } = useModels();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [inspectedModelId, setInspectedModelId] = useState<string | null>(selectedModel ?? null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setTypeFilter("all");
      setCapabilityFilter("all");
      setProviderFilter("all");
      setInspectedModelId(selectedModel ?? null);
      setTimeout(() => searchRef.current?.focus(), 80);
    }
  }, [isOpen, selectedModel]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const chatModels = useMemo(
    () => models.filter((m) => CHAT_SELECTABLE_TYPES.has(m.type)),
    [models]
  );

  const providerGroups = useMemo(
    () => sortProvidersByFree(groupModelsByProvider(chatModels)),
    [chatModels]
  );

  const filtered = useMemo(() => {
    let result = chatModels;

    if (providerFilter !== "all") result = result.filter((m) => m.provider === providerFilter);
    if (typeFilter !== "all") result = result.filter((m) => m.type === typeFilter);
    if (capabilityFilter === "free") result = result.filter(isFreeModel);
    if (capabilityFilter === "vision") result = result.filter(isVisionModel);
    if (capabilityFilter === "tools") result = result.filter(hasTools);
    if (capabilityFilter === "long") {
      result = result.filter((m) => (m.contextWindow ?? 0) >= LONG_CONTEXT_TOKENS);
    }
    result = result.filter((m) => modelMatchesSearch(m, search));

    return sortModels(result);
  }, [chatModels, providerFilter, typeFilter, capabilityFilter, search]);

  useEffect(() => {
    if (!isOpen || loading) return;
    if (filtered.length === 0) {
      setInspectedModelId(null);
      return;
    }
    if (!inspectedModelId || !filtered.some((m) => m.id === inspectedModelId)) {
      const selected = selectedModel ? filtered.find((m) => m.id === selectedModel) : undefined;
      setInspectedModelId((selected ?? filtered[0]).id);
    }
  }, [filtered, inspectedModelId, isOpen, loading, selectedModel]);

  const inspectedModel = useMemo(
    () => chatModels.find((m) => m.id === inspectedModelId),
    [chatModels, inspectedModelId]
  );

  const providerCount = providerGroups.length;
  const freeTotal = chatModels.filter(isFreeModel).length;
  const visionTotal = chatModels.filter(isVisionModel).length;
  const toolTotal = chatModels.filter(hasTools).length;

  const handleSelect = () => {
    if (!onSelectModel || !inspectedModel) return;
    onSelectModel(inspectedModel.id);
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-modal flex items-center justify-center p-4"
        >
          {/* Scrim (D-304 carve-out: pure black allowed for modal scrims) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-white/70 dark:bg-black/55"
            style={{ backdropFilter: "blur(10px)" }}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-[calc(100vw-32px)] max-w-[1120px] h-[calc(100vh-32px)] max-h-[760px]
              bg-surface-base border border-surface-border
              rounded-2xl shadow-2xl overflow-hidden grid grid-rows-[auto_1fr]"
          >
            <header className="flex items-center justify-between gap-4 px-5 py-4 border-b border-surface-border">
              <div className="min-w-0">
                <h2 className="text-xl font-display text-primary">Model Library</h2>
                {!loading && !error && (
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span>{uniqueModels || chatModels.length} models</span>
                    <span>{providerCount} providers</span>
                    <span>{visionTotal} vision</span>
                    <span>{toolTotal} tools</span>
                    {freeTotal > 0 && <span className="text-secondary">{freeTotal} free</span>}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <IconButton variant="ghost" size="sm" aria-label="Refresh models" title="Refresh" onClick={refetch} disabled={loading}>
                  <Refresh size="sm" className={loading ? "animate-spin" : ""} />
                </IconButton>
                <IconButton variant="ghost" size="sm" aria-label="Close" title="Close" onClick={onClose}>
                  <Close size="sm" />
                </IconButton>
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_320px] min-h-0">
              <ProviderRail
                providers={providerGroups}
                selectedProvider={providerFilter}
                onSelectProvider={setProviderFilter}
              />

              <main className="min-w-0 min-h-0 grid grid-rows-[auto_1fr] bg-surface-base">
                <div className="border-b border-surface-border p-4">
                  <div className="flex items-center gap-2 rounded-lg border border-surface-border px-3 h-10">
                    <Search size="sm" className="text-muted flex-shrink-0" />
                    <input
                      ref={searchRef}
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search models, providers, capabilities..."
                      className="flex-1 min-w-0 bg-transparent outline-none text-sm text-primary placeholder:text-muted"
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        aria-label="Clear search"
                        className="text-muted hover:text-primary transition-colors"
                      >
                        <Close size="xs" />
                      </button>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {TYPE_FILTERS.map((filter) => (
                      <FilterButton
                        key={filter.id}
                        active={typeFilter === filter.id}
                        onClick={() => setTypeFilter(filter.id)}
                      >
                        {filter.label}
                      </FilterButton>
                    ))}
                    <div className="mx-1 h-5 w-px bg-surface-border" />
                    {CAPABILITY_FILTERS.map((filter) => (
                      <FilterButton
                        key={filter.id}
                        active={capabilityFilter === filter.id}
                        onClick={() => setCapabilityFilter(filter.id)}
                      >
                        {filter.label}
                      </FilterButton>
                    ))}
                  </div>
                </div>

                <div className="min-h-0 overflow-y-auto scrollbar-auto-hide p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_88px_82px_72px] gap-3 px-3 pb-2 text-2xs font-medium uppercase tracking-extra-wide text-muted">
                    <span>Model</span>
                    <span>Signals</span>
                    <span>Context</span>
                    <span>Input</span>
                  </div>

                  {loading ? (
                    <div className="flex items-center justify-center py-20">
                      <Spinner size="lg" className="text-muted" />
                    </div>
                  ) : error ? (
                    <div className="py-16 text-center">
                      <p className="text-sm text-muted">{error}</p>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="py-16 text-center">
                      <p className="text-sm text-muted">
                        {search ? "No models match your search" : "No models available"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filtered.map((model) => (
                        <ModelListRow
                          key={model.id}
                          model={model}
                          active={model.id === inspectedModelId}
                          selected={model.id === selectedModel}
                          autoModelId={AUTO_DISPLAY_MODEL}
                          onPreview={() => setInspectedModelId(model.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </main>

              <ModelDetail
                model={inspectedModel}
                selected={Boolean(inspectedModel && inspectedModel.id === selectedModel)}
                selectable={Boolean(onSelectModel)}
                onSelect={handleSelect}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
