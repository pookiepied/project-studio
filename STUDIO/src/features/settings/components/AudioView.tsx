import { useState, useEffect } from "react";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { useSettings } from "@/contexts/SettingsContext";
import { logger } from "@/services/logging/logger";
import { getAvailableTones, type RephraseTone } from "@/utils/prompts";
import type { AppSettings } from "@/types";
import { SettingsRow } from "./SettingsRow";

interface Props {
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export const AudioView = ({ updateSetting }: Props) => {
  const { settings } = useSettings();
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices()
      .then((devices) => setMicrophones(devices.filter((d) => d.kind === "audioinput")))
      .catch((err) => logger.error("AudioView", "Failed to enumerate devices", err));
  }, []);

  const microphoneOptions = [
    { value: "", label: "Default" },
    ...microphones.map((mic) => ({
      value: mic.deviceId,
      label: mic.label || `Microphone ${mic.deviceId.slice(0, 8)}`,
    })),
  ];

  const toneOptions = getAvailableTones().map((tone) => ({
    value: tone.value,
    label: `${tone.label} - ${tone.description}`,
  }));

  return (
    <div>
      <SettingsRow
        label="Microphone"
        description="Select audio input device"
        control={
          <div className="w-full sm:w-64">
            <Select
              value={settings.selectedMicrophone || ""}
              options={microphoneOptions}
              onChange={(v) => updateSetting("selectedMicrophone", v || undefined)}
            />
          </div>
        }
      />
      <SettingsRow
        label="Enable VAD"
        description="Skip silent chunks to save API costs"
        control={<Toggle checked={settings.vadEnabled} onChange={(v) => updateSetting("vadEnabled", v)} />}
      />
      {settings.vadEnabled && (
        <SettingsRow
          label="Silence Threshold"
          description="Lower = more sensitive — scroll or drag to adjust"
          control={
            <div className="w-full sm:w-64 flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="255"
                step="1"
                value={settings.vadSilenceThreshold}
                onChange={(e) => updateSetting("vadSilenceThreshold", parseInt(e.target.value))}
                onWheel={(e) => {
                  e.preventDefault();
                  const delta = e.deltaY < 0 ? 1 : -1;
                  updateSetting("vadSilenceThreshold", Math.max(0, Math.min(255, settings.vadSilenceThreshold + delta)));
                }}
                className="flex-1 h-1.5 bg-surface-raised rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-secondary [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:motion-safe:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
              />
              <span className="text-xs text-muted w-8 text-right tabular-nums">
                {settings.vadSilenceThreshold}
              </span>
            </div>
          }
        />
      )}
      <SettingsRow
        label="Auto-rephrase"
        description="Automatically rephrase transcribed text"
        control={<Toggle checked={settings.autoRephrase} onChange={(v) => updateSetting("autoRephrase", v)} />}
      />
      <SettingsRow
        label="Rephrase Tone"
        description="Style for rephrased text"
        control={
          <div className="w-full sm:w-64">
            <Select
              value={settings.rephraseTone}
              options={toneOptions}
              onChange={(v) => updateSetting("rephraseTone", v as RephraseTone)}
            />
          </div>
        }
      />
    </div>
  );
};
