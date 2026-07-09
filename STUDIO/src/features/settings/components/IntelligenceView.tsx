import {
  BrainIcon as Brain,
  CpuIcon as Cpu,
  CloudCheckIcon as CloudCheck,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { IconButton } from "@/ui/primitives/IconButton";
import { Spinner } from "@/ui/primitives/Spinner";
import { Icon, Manage, Refresh } from "@/ui/icons";
import { ModelPicker } from "@/features/models/components/ModelPicker";
import { useModelsContext as useModels } from "@/features/models/context";
import { useSettings } from "@/app/contexts/SettingsContext";
import { formatDate } from "@/lib/formatters";
import type { AppSettings } from "@/types";
import { SectionLabel } from "./SectionLabel";
import { SettingsRow } from "./SettingsRow";
import { NavTile } from "./NavTile";

interface Props {
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onNavigateToLocalServices: () => void;
}

export const IntelligenceView = ({ updateSetting, onNavigateToLocalServices }: Props) => {
  const { settings } = useSettings();
  const {
    models, providers,
    loading: modelsLoading, error: modelsError,
    lastUpdated, uniqueModels, refetch,
  } = useModels();

  return (
    <>
      {/* Active Providers */}
      {!modelsLoading && (
        <section className="space-y-3">
          <SectionLabel icon={<Icon icon={CloudCheck as unknown as PhosphorIcon} size="md" />} title="ACTIVE PROVIDERS" />
          {Object.keys(providers).length === 0 ? (
            <p className="text-sm text-muted">No providers configured</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <AnimatePresence mode="popLayout">
                  {Object.entries(providers).map(([name, info], index) => (
                    <motion.div
                      key={name}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.3, delay: index * 0.03 }}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-surface-base border border-surface-border shadow-sm hover:shadow transition-all duration-300"
                    >
                      {/* D-401 strict-neutral status: active = strong (primary) dot; inactive = faint (muted) dot */}
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-0.5 ${
                        info.status === "active"
                          ? "bg-primary"
                          : "bg-muted"
                      }`} />
                      <span className="text-2xs font-medium text-secondary tracking-wide uppercase">{name}</span>
                      <div className="flex items-center justify-center px-1.5 py-0.5 min-w-[18px] rounded-full bg-surface-raised text-3xs font-semibold text-muted">
                        {info.modelCount}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-muted">
                  <span className="text-secondary">{uniqueModels}</span> models
                </span>
                {/* "free" count reads on weight/secondary ink, never green hue (D-401) */}
                <span className="text-muted">
                  <span className="text-secondary">{models.filter((m) => m.free).length}</span> free
                </span>
                {lastUpdated && (
                  <span className="text-xs text-muted">
                    Updated {formatDate(lastUpdated)}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Model pickers */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionLabel icon={<Icon icon={Brain as unknown as PhosphorIcon} size="md" />} title="MODELS" />
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Refresh models"
            onClick={refetch}
            disabled={modelsLoading}
            className={modelsLoading ? "cursor-wait" : ""}
          >
            {modelsLoading ? (
              <Spinner size="sm" decorative />
            ) : (
              <Refresh size="md" weight="regular" />
            )}
          </IconButton>
        </div>

        {modelsLoading ? (
          <p className="text-sm text-muted">Loading models...</p>
        ) : modelsError ? (
          <p className="text-sm text-primary">{modelsError}</p>
        ) : (
          <div>
            <SettingsRow label="Default Chat Model" description="Model for chat conversations" control={
              <div className="w-full sm:w-64"><ModelPicker models={models} value={settings.defaultChatModel} onChange={(v) => updateSetting("defaultChatModel", v)} type="chat" /></div>
            } />
            <SettingsRow label="Rephrase Model" description="Model for text rephrasing" control={
              <div className="w-full sm:w-64"><ModelPicker models={models} value={settings.rephraseModel} onChange={(v) => updateSetting("rephraseModel", v)} type="chat" /></div>
            } />
            <SettingsRow label="Transcription Model" description="Model for audio transcription" control={
              <div className="w-full sm:w-64"><ModelPicker models={models} value={settings.transcriptionModel} onChange={(v) => updateSetting("transcriptionModel", v)} type="audio" /></div>
            } />
            <SettingsRow label="Text-to-Speech Model" description="Model for converting text to speech" control={
              <div className="w-full sm:w-64"><ModelPicker models={models} value={settings.ttsModel} onChange={(v) => updateSetting("ttsModel", v)} type="tts" /></div>
            } />
            <SettingsRow label="Image Generation Model" description="Model used by the AI when generating images" control={
              <div className="w-full sm:w-64"><ModelPicker models={models} value={settings.imageModel} onChange={(v) => updateSetting("imageModel", v)} type="image" /></div>
            } />
            <SettingsRow label="Video Generation Model" description="Model used by the AI when generating videos" control={
              <div className="w-full sm:w-64"><ModelPicker models={models} value={settings.videoModel} onChange={(v) => updateSetting("videoModel", v)} type="video" /></div>
            } />
          </div>
        )}
      </section>

      {/* Local AI link (reuses the shared NavTile — one navigational row, no duplication) */}
      <section className="space-y-4">
        <SectionLabel icon={<Icon icon={Cpu as unknown as PhosphorIcon} size="md" />} title="LOCAL AI" />
        <NavTile
          icon={<Manage size="sm" weight="regular" />}
          title="Local Services"
          subtitle="Configure Ollama, LM Studio, Faster Whisper, and engines"
          onClick={onNavigateToLocalServices}
        />
      </section>
    </>
  );
};
