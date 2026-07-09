/**
 * ModelPicker — unified model selector used in both the chat header and settings.
 *
 * Variants:
 *   "compact"  — minimal trigger button (chat header)
 *   "full"     — full-width trigger button (settings page)
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { CaretDownIcon as CaretDown, CheckIcon as Check, EyeIcon as Eye, LeafIcon as Leaf } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Model,
  groupModelsByProvider,
  sortModels,
  sortProvidersByFree,
} from "@/features/models/services/modelService";
import {
  filterModels,
  MODEL_FILTERS,
  type ModelFilter,
} from "@/features/models/services/modelFilter";
import { isVisionModel } from "@/lib/modelUtils";
import { ProviderIcon, getProviderDisplayName } from "./ProviderIcon";
import { AI_MODES } from "@/core/config/autoMode";

export interface ModelPickerProps {
  models: Model[];
  value: string;
  onChange: (modelId: string) => void;
  /**
   * Shorthand preset — maps to a MODEL_FILTERS entry.
   * Use `filter` prop for custom or composed filters.
   * Defaults to "chat" when neither prop is provided.
   */
  type?: "chat" | "audio" | "tts" | "image" | "video";
  /**
   * Custom filter — overrides `type` when provided.
   * Use MODEL_FILTERS presets or compose your own.
   */
  filter?: ModelFilter;
  variant?: "compact" | "full";
  disabled?: boolean;
  className?: string;
  align?: "left" | "right";
  onOpenChange?: (open: boolean) => void;
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/**
 * Map the legacy `type` prop to a ModelFilter preset.
 * This keeps all call sites working without changes while routing
 * through the filter module internally.
 */
function typeToFilter(type: "chat" | "audio" | "tts" | "image" | "video"): ModelFilter {
  switch (type) {
    case "chat":  return MODEL_FILTERS.CHAT;
    case "image": return MODEL_FILTERS.IMAGE;
    case "video": return MODEL_FILTERS.VIDEO;
    case "audio": return MODEL_FILTERS.AUDIO_IN;
    case "tts":   return MODEL_FILTERS.AUDIO_OUT;
  }
}

export function ModelPicker({
  models,
  value,
  onChange,
  type = "chat",
  filter,
  variant = "full",
  disabled = false,
  className = "",
  align = "left",
  onOpenChange,
}: ModelPickerProps) {
  // Image/video pickers never show the Auto option.
  // Determine from the resolved filter rather than the raw `type` prop so
  // custom `filter` props are respected too.
  const resolvedFilter  = filter ?? typeToFilter(type);
  const isGenerationType =
    resolvedFilter.types?.every(t => t === "image" || t === "video") ?? false;
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const open = (val: boolean) => {
    setIsOpen(val);
    onOpenChange?.(val);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedModel = models.find((m) => m.id === value);

  const filteredModels = useMemo(() => {
    // Resolve active filter: explicit `filter` prop wins over `type` shorthand.
    const baseFilter: ModelFilter = filter ?? typeToFilter(type);
    return filterModels(models, { ...baseFilter, search: search.trim() || undefined });
  }, [models, type, filter, search]);

  const sortedProviders = useMemo(() => {
    return sortProvidersByFree(groupModelsByProvider(filteredModels));
  }, [filteredModels]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        open(false);
        setSearch("");
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
    // open is component-local (wraps setIsOpen + onOpenChange prop; only re-bind on isOpen change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [isOpen]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    open(false);
    setSearch("");
  };

  const autoMode = AI_MODES[0];
  const isAutoSelected = value === autoMode.id;
  const triggerText = isAutoSelected ? autoMode.label : (selectedModel?.name || "Select model");
  const showAutoOption = type === "chat" && !isGenerationType && (!search.trim() || autoMode.label.toLowerCase().includes(search.toLowerCase()));
  const isCompact = variant === "compact";

  return (
    <div className={`relative ${className}`} ref={containerRef}>

      {/* ── Trigger ── */}
      {isCompact ? (
        <button
          type="button"
          onClick={() => open(!isOpen)}
          disabled={disabled}
          className="flex items-center gap-1 px-2 h-6 rounded-md hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth disabled:opacity-40"
        >
          {isAutoSelected && <Leaf size={10} weight="regular" className="text-gray-400 dark:text-gray-600 flex-shrink-0" />}
          <span className="text-xs text-gray-500 dark:text-gray-400 max-w-[150px] truncate transition-colors duration-300">
            {triggerText}
          </span>
          <CaretDown
            size={9}
            weight="bold"
            className={`text-gray-400 dark:text-gray-600 flex-shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => open(!isOpen)}
          disabled={disabled}
          className="w-full px-3 py-1.5 text-sm text-left bg-white dark:bg-surface-base border border-gray-200 dark:border-surface-border rounded-md hover:bg-gray-50 dark:hover:bg-surface-raised transition-smooth focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 flex items-center justify-between disabled:opacity-50"
        >
          <span className="flex items-center gap-1.5 text-gray-900 dark:text-gray-200 font-normal truncate transition-colors duration-300">
            {isAutoSelected && <Leaf size={12} weight="regular" className="text-gray-400 dark:text-gray-600 flex-shrink-0" />}
            {triggerText}
          </span>
          <CaretDown
            size={12}
            weight="bold"
            className={`text-gray-400 dark:text-gray-600 flex-shrink-0 ml-2 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
      )}

      {/* ── Dropdown ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className={`bg-white dark:bg-surface-base border border-gray-200 dark:border-surface-border rounded-md shadow-xl overflow-hidden transition-colors duration-300 ${
              isCompact
                ? "absolute z-50 mt-1.5 right-0 w-[280px]"
                : `absolute z-50 mt-1.5 w-full ${align === "right" ? "right-0" : "left-0"}`
            }`}
          >

            {/* Search */}
            <div className="px-3 pt-2.5 pb-2 border-b border-gray-100 dark:border-surface-border">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full text-xs bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder-gray-300 dark:placeholder-gray-600 transition-colors duration-300"
              />
            </div>

            {/* List */}
            <div className={`overflow-y-auto scrollbar-auto-hide ${isCompact ? "max-h-[240px]" : "max-h-64"}`}>
              {/* Auto option — always at top for chat type */}
              {showAutoOption && (
                <div className="border-b border-gray-100 dark:border-surface-border pb-1 mb-0.5">
                  <button
                    type="button"
                    onClick={() => handleSelect(autoMode.id)}
                    title={autoMode.description}
                    className={`w-full flex items-center text-left px-3 py-1.5 transition-colors duration-100 ${
                      isAutoSelected ? "bg-gray-50 dark:bg-surface-raised" : "hover:bg-gray-50 dark:hover:bg-surface-raised"
                    }`}
                  >
                    <Leaf size={11} weight="regular" className="text-gray-400 dark:text-gray-600 flex-shrink-0 mr-2" />
                    <span className={`flex-1 min-w-0 text-sm truncate transition-colors duration-300 ${isAutoSelected ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`}>
                      {autoMode.label}
                    </span>
                    <div className="flex items-center flex-shrink-0 ml-2">
                      {isAutoSelected && (
                        <Check size={10} weight="bold" className="text-gray-500 dark:text-gray-400" />
                      )}
                    </div>
                  </button>
                </div>
              )}

              {sortedProviders.length === 0 && !showAutoOption ? (
                <p className="px-3 py-6 text-xs text-gray-400 dark:text-gray-600 text-center">
                  {search ? "No models match" : "No models available"}
                </p>
              ) : (
                sortedProviders.map(([provider, providerModels]) => (
                  <div key={provider}>

                    {/* Provider separator */}
                    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                      <ProviderIcon provider={provider} size="xs" />
                      <span className="text-3xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                        {getProviderDisplayName(provider)}
                      </span>
                    </div>

                    {/* Model rows — fixed-width icon slots for column alignment */}
                    {sortModels(providerModels).map((model) => {
                      const isFree =
                        model.free ||
                        (model.pricing?.input === 0 && model.pricing?.output === 0);
                      const hasVision = isVisionModel(model);
                      const ctx = model.contextWindow;
                      const isSelected = model.id === value;

                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => handleSelect(model.id)}
                          title={[
                            ctx ? `${formatContextWindow(ctx)} context` : null,
                            hasVision ? "Vision" : null,
                            isFree && model.provider !== "local" ? "Free" : null,
                          ].filter(Boolean).join(" · ") || undefined}
                          className={`w-full flex items-center text-left px-3 py-1.5 transition-colors duration-100 ${
                            isSelected
                              ? "bg-gray-50 dark:bg-surface-raised"
                              : "hover:bg-gray-50 dark:hover:bg-surface-raised"
                          }`}
                        >
                          {/* Name — min-w-0 lets it shrink below content width so icons reach the right edge */}
                          <span className={`flex-1 min-w-0 text-sm truncate transition-colors duration-300 ${
                            isSelected
                              ? "text-gray-900 dark:text-gray-100"
                              : "text-gray-700 dark:text-gray-300"
                          }`}>
                            {model.name}
                          </span>

                          {/* Icons — packed together, always at the right edge */}
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            {hasVision && (
                              <Eye size={10} weight="regular" className="text-gray-300 dark:text-gray-600" />
                            )}
                            {isFree && model.provider !== "local" && (
                              <span className="w-1 h-1 rounded-full bg-surface-raised flex-shrink-0" />
                            )}
                            {model.provider === "local" && (
                              <span className="text-3xs text-gray-300 dark:text-gray-600">L</span>
                            )}
                            {isSelected && (
                              <Check size={10} weight="bold" className="text-gray-500 dark:text-gray-400 transition-colors duration-300" />
                            )}
                          </div>
                        </button>
                      );
                    })}

                    {/* Bottom spacing after last group */}
                    <div className="h-1" />
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
