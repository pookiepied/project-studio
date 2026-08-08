import { useState, useEffect } from "react";
import { Select } from "@/ui/primitives/Select";
import { Slider } from "@/ui/primitives/Slider";
import { Toggle } from "@/ui/primitives/Toggle";
import { useSettings } from "@/app/contexts/SettingsContext";
import { logger } from "@/core/logging/logger";
import { getAvailableTones, type RephraseTone } from "@/lib/prompts";
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

  // Radix Select reserves the empty string for "no selection" — it throws if
  // an item uses value="". Use a sentinel for "system default" instead and
  // map it back to undefined when persisting the setting.
  const DEFAULT_MIC_VALUE = "__default__";
  const microphoneOptions = [
    { value: DEFAULT_MIC_VALUE, label: "Default" },
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
              value={settings.selectedMicrophone || DEFAULT_MIC_VALUE}
              options={microphoneOptions}
              onChange={(v) => updateSetting("selectedMicrophone", v === DEFAULT_MIC_VALUE ? undefined : v)}
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
              <div className="flex-1 min-w-0">
                <Slider
                  min={0}
                  max={255}
                  step={1}
                  value={settings.vadSilenceThreshold}
                  onChange={(e) => updateSetting("vadSilenceThreshold", parseInt(e.target.value))}
                  onWheel={(e) => {
                    e.preventDefault();
                    const delta = e.deltaY < 0 ? 1 : -1;
                    updateSetting("vadSilenceThreshold", Math.max(0, Math.min(255, settings.vadSilenceThreshold + delta)));
                  }}
                />
              </div>
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
