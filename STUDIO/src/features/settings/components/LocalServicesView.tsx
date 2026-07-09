import {
  DesktopTowerIcon as DesktopTower,
  CpuIcon as Cpu,
  WaveformIcon as Waveform,
  TerminalIcon as Terminal,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { Icon } from "@/ui/icons";
import { Input } from "@/ui/primitives/Input";
import { Toggle } from "@/ui/primitives/Toggle";
import { useFeatures } from "@/hooks/useFeatures";
import { OllamaStatus } from "@/features/models/components/OllamaStatus";
import { LMStudioStatus } from "@/features/models/components/LMStudioStatus";
import { FasterWhisperStatus } from "@/features/transcription";
import { LocalProviderStatus } from "@/features/models/components/LocalProviderStatus";
import { useSettings } from "@/contexts/SettingsContext";
import type { AppSettings } from "@/types";
import { SectionLabel } from "./SectionLabel";
import { SettingsRow } from "./SettingsRow";

interface McpToggleState {
  enabled:  boolean;
  toggling: boolean;
}

interface Props {
  updateSetting:          <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  isTauri?:               boolean;
  studioHarness?:         McpToggleState;
  computerUse?:           McpToggleState;
  onStudioHarnessToggle?: (enable: boolean) => Promise<void>;
  onComputerUseToggle?:   (enable: boolean) => Promise<void>;
}

export const LocalServicesView = ({
  updateSetting,
  isTauri,
  studioHarness,
  computerUse,
  onStudioHarnessToggle,
  onComputerUseToggle,
}: Props) => {
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();

  return (
    <>
      {/* SYSTEM INTEGRATION */}
      {isTauri && (onStudioHarnessToggle || onComputerUseToggle) && (
        <section className="space-y-4">
          <SectionLabel icon={<Icon icon={Terminal as unknown as PhosphorIcon} size="md" />} title="SYSTEM INTEGRATION" />
          <div>
            {onStudioHarnessToggle && (
              <SettingsRow
                label="Studio Harness"
                description="Files, terminal, git, and project tooling — the core local coding harness the AI uses in Studio mode"
                control={
                  <Toggle
                    checked={studioHarness?.enabled ?? false}
                    onChange={onStudioHarnessToggle}
                    disabled={studioHarness?.toggling}
                  />
                }
              />
            )}
            {onComputerUseToggle && (
              <SettingsRow
                label="Computer Use"
                description="Desktop monitoring, window automation, system settings, network diagnostics, and screen vision"
                control={
                  <Toggle
                    checked={computerUse?.enabled ?? false}
                    onChange={onComputerUseToggle}
                    disabled={computerUse?.toggling}
                  />
                }
              />
            )}
          </div>
        </section>
      )}

      {/* LOCAL SERVER */}
      {isEnabled("localProviderBridge") && (
        <section className="space-y-4">
          <SectionLabel icon={<Icon icon={DesktopTower as unknown as PhosphorIcon} size="md" />} title="LOCAL SERVER" />
          <div>
            <SettingsRow
              label="Enable Local Provider Bridge"
              description="Start background bridge for local LLM providers"
              control={
                <Toggle
                  checked={settings.localProviderEnabled || false}
                  onChange={(v) => updateSetting("localProviderEnabled", v)}
                />
              }
            />
            <SettingsRow
              label="Server Port"
              description="Default network port (11435)"
              control={
                <Input
                  type="number"
                  size="sm"
                  value={settings.localProviderPort || 11435}
                  onChange={(e) => updateSetting("localProviderPort", parseInt(e.target.value, 10))}
                  min={1024}
                  max={65535}
                  className="w-20 tabular-nums"
                />
              }
            />
            {settings.localProviderEnabled && (
              <div className="py-3 border-t border-surface-divider">
                <LocalProviderStatus />
              </div>
            )}
          </div>
        </section>
      )}

      {/* LOCAL MODELS */}
      <section className="space-y-4">
        <SectionLabel icon={<Icon icon={Cpu as unknown as PhosphorIcon} size="md" />} title="LOCAL MODELS" />
        <div>
          {isEnabled("ollamaIntegration") && (
            <OllamaStatus
              enabled={settings.ollamaEnabled || false}
              onToggle={(v) => updateSetting("ollamaEnabled", v)}
            />
          )}
          {isEnabled("localProviderBridge") && (
            <LMStudioStatus
              enabled={settings.lmstudioEnabled || false}
              onToggle={(v) => updateSetting("lmstudioEnabled", v)}
            />
          )}
        </div>
      </section>

      {/* LOCAL TRANSCRIPTION */}
      {isEnabled("fasterWhisper") && (
        <section className="space-y-4">
          <SectionLabel icon={<Icon icon={Waveform as unknown as PhosphorIcon} size="md" />} title="LOCAL TRANSCRIPTION" />
          <div>
            <SettingsRow
              label="Enable Faster Whisper"
              description="Transcribe audio locally using Faster Whisper"
              control={
                <Toggle
                  checked={settings.fasterWhisperEnabled || false}
                  onChange={(v) => updateSetting("fasterWhisperEnabled", v)}
                />
              }
            />
            {settings.fasterWhisperEnabled && (
              <div className="py-3 border-t border-surface-divider">
                <FasterWhisperStatus />
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
};
