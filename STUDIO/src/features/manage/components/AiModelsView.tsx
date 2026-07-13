import type { Dispatch, SetStateAction } from "react";
import { ArrowCounterClockwiseIcon as ArrowCounterClockwise } from "@/ui/icons";
import { motion, AnimatePresence } from "framer-motion";
import { Back, Refresh, Success, Warning, Icon } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Badge } from "@/ui/primitives/Badge";
import { Spinner } from "@/ui/primitives/Spinner";
import { SegmentedControl } from "@/ui/primitives/SegmentedControl";
import { ModelPicker } from "@/features/models/components/ModelPicker";
import { MODEL_FILTERS } from "@/features/models/services/modelFilter";
import type { Model } from "@/core/models";
import type { AdminMode, FetchState, ActionState } from "../types";
import { ModeIcon } from "./ModeIcon";

interface Props {
  amState: FetchState;
  adminModes: AdminMode[];
  isAmRefreshing: boolean;
  editValues: Record<string, string>;
  setEditValues: Dispatch<SetStateAction<Record<string, string>>>;
  autoRouterMode: "static" | "dynamic";
  setAutoRouterMode: (v: "static" | "dynamic") => void;
  autoStaticModel: string;
  setAutoStaticModel: (v: string) => void;
  availableModels: Model[];
  amSaveState: ActionState;
  amSaveError: string | null;
  isDirty: boolean;
  isAutoDirty: boolean;
  loadedAuto: AdminMode | undefined;
  onBack: () => void;
  onRefresh: () => void;
  onSave: () => void;
  onReset: (modeId: string) => void;
  onRetry: () => void;
}

export const AiModelsView = ({
  amState, adminModes, isAmRefreshing,
  editValues, setEditValues,
  autoRouterMode, setAutoRouterMode,
  autoStaticModel, setAutoStaticModel,
  availableModels,
  amSaveState, amSaveError,
  isDirty, isAutoDirty, loadedAuto,
  onBack, onRefresh, onSave, onReset, onRetry,
}: Props) => (
  <motion.div
    key="aimodels"
    className="h-full flex flex-col"
    initial={{ opacity: 0, x: 12 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: 12 }}
    transition={{ duration: 0.15, ease: "easeOut" }}
  >
    <div className="flex-shrink-0 px-4 py-3 border-b border-surface-border flex items-center gap-2">
      <IconButton variant="ghost" size="sm" aria-label="Back to Manage" onClick={onBack}>
        <Back size="sm" />
      </IconButton>
      <span className="text-sm font-semibold text-primary font-sans">AI Modes</span>

      <div className="ml-auto flex items-center gap-1.5">
        <AnimatePresence>
          {isDirty && amSaveState !== "success" && (
            <Button
              key="save"
              variant="primary"
              size="sm"
              onClick={onSave}
              loading={amSaveState === "loading"}
              leftIcon={<Success size="xs" />}
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.88 }}
              transition={{ duration: 0.12 }}
            >
              {amSaveState === "loading" ? "Saving…" : "Save"}
            </Button>
          )}
          {amSaveState === "success" && !isDirty && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1 text-2xs text-muted"
            >
              <Success size="xs" />
              Saved
            </motion.span>
          )}
        </AnimatePresence>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label="Refresh AI modes"
          onClick={onRefresh}
          disabled={isAmRefreshing || amState === "loading"}
        >
          <Refresh size="xs" className={isAmRefreshing ? "animate-spin" : ""} />
        </IconButton>
      </div>
    </div>

    {amState === "loading" && (
      <div className="flex-1 flex items-center justify-center">
        <Spinner size="lg" className="text-muted" />
      </div>
    )}

    {amState === "error" && (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Warning size="md" weight="fill" className="mx-auto text-primary" />
          <p className="text-xs text-secondary">Failed to load.</p>
          <Button
            variant="ghost"
            onClick={onRetry}
            className="text-xs text-muted underline h-auto px-0 py-0 hover:bg-transparent hover:text-primary"
          >
            Try again
          </Button>
        </div>
      </div>
    )}

    {amState === "ready" && (
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-surface-divider">

          {adminModes.filter(m => m.id !== "auto").map(mode => {
            const currentVal = editValues[mode.id] ?? mode.modelId;
            const isDirtyRow = currentVal !== mode.modelId;

            return (
              <div key={mode.id} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <ModeIcon icon={mode.icon} />
                    <span className="text-sm font-medium text-secondary">{mode.label}</span>
                    {mode.isCustomized && !isDirtyRow && (
                      <Badge tone="default" size="sm">Custom</Badge>
                    )}
                    {isDirtyRow && (
                      <Badge tone="strong" size="sm">Unsaved</Badge>
                    )}
                  </div>
                  {mode.isCustomized && (
                    <Button
                      variant="ghost"
                      onClick={() => onReset(mode.id)}
                      disabled={amSaveState === "loading"}
                      className="flex items-center gap-1 text-2xs text-muted hover:text-primary h-auto px-0 py-0 hover:bg-transparent disabled:opacity-40"
                    >
                      <Icon icon={ArrowCounterClockwise} size="xs" />
                      <span>Reset</span>
                    </Button>
                  )}
                </div>

                <ModelPicker
                  models={availableModels}
                  value={currentVal}
                  onChange={modelId => setEditValues(prev => ({ ...prev, [mode.id]: modelId }))}
                  filter={MODEL_FILTERS.CHAT}
                  variant="full"
                  align="left"
                  disabled={amSaveState === "loading"}
                />

                {mode.isCustomized && (
                  <p className="text-2xs text-muted mt-1.5 font-mono truncate">
                    default: {mode.defaultModelId}
                  </p>
                )}
              </div>
            );
          })}

          {loadedAuto && (
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ModeIcon icon="leaf" />
                  <span className="text-sm font-medium text-secondary">Auto</span>
                  {loadedAuto.isCustomized && !isAutoDirty && (
                    <Badge tone="default" size="sm">Custom</Badge>
                  )}
                  {isAutoDirty && (
                    <Badge tone="strong" size="sm">Unsaved</Badge>
                  )}
                </div>
                {loadedAuto.isCustomized && (
                    <Button
                      variant="ghost"
                      onClick={() => onReset("auto")}
                      disabled={amSaveState === "loading"}
                      className="flex items-center gap-1 text-2xs text-muted hover:text-primary h-auto px-0 py-0 hover:bg-transparent disabled:opacity-40"
                    >
                      <Icon icon={ArrowCounterClockwise} size="xs" />
                      <span>Reset</span>
                    </Button>
                )}
              </div>

              <SegmentedControl
                aria-label="Auto router mode"
                size="sm"
                value={autoRouterMode}
                onChange={setAutoRouterMode}
                disabled={amSaveState === "loading"}
                options={[
                  { value: "static", label: "Static" },
                  { value: "dynamic", label: "Dynamic" },
                ]}
                className="mb-3"
              />

              {autoRouterMode === "static" ? (
                <>
                  <ModelPicker
                    models={availableModels}
                    value={autoStaticModel}
                    onChange={setAutoStaticModel}
                    filter={MODEL_FILTERS.CHAT}
                    variant="full"
                    align="left"
                    disabled={amSaveState === "loading"}
                  />
                  {loadedAuto.isCustomized && loadedAuto.autoDefaultStaticModel && (
                    <p className="text-2xs text-muted mt-1.5 font-mono truncate">
                      default: {loadedAuto.autoDefaultStaticModel}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted leading-relaxed">
                  Classifier picks the best tier automatically based on message complexity.
                </p>
              )}
            </div>
          )}

        </div>
      </div>
    )}

    <AnimatePresence>
      {amSaveError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface-raised border border-surface-border text-primary text-xs px-3 py-2 rounded-lg shadow-lg z-toast"
        >
          <Warning size="xs" weight="fill" className="text-primary flex-shrink-0" />
          {amSaveError}
        </motion.div>
      )}
    </AnimatePresence>
  </motion.div>
);
