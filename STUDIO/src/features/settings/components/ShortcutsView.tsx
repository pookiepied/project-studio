import {
  SpeakerHighIcon as SpeakerHigh,
  CircleDashedIcon as CircleDashed,
} from "@phosphor-icons/react";
import { Toggle } from "@/ui/primitives/Toggle";
import { ConditionalGlobalShortcuts } from "@/app/globals/ConditionalFeatures";
import { useSettings } from "@/app/contexts/SettingsContext";
import { FONT_SANS } from "@/design/fonts";
import type { AppSettings } from "@/types";
import { SettingsRow } from "./SettingsRow";
import { ShortcutRecorder } from "./ShortcutRecorder";

interface Props {
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export const ShortcutsView = ({ updateSetting }: Props) => {
  const { settings } = useSettings();

  return (
    <ConditionalGlobalShortcuts>
      <div>
        <SettingsRow
          label="Recording Hotkey"
          description="Global shortcut to start/stop recording and rephrase transcribed speech"
          control={
            <div className="w-full sm:w-64">
              <ShortcutRecorder
                value={settings.recordingShortcut}
                onChange={(keys) => updateSetting("recordingShortcut", keys)}
              />
            </div>
          }
        />
        <SettingsRow
          label="Voice AI Hotkey"
          description="Global shortcut to open the live voice AI chat (leave empty to disable)"
          control={
            <div className="w-full sm:w-64">
              <ShortcutRecorder
                value={settings.voiceShortcut}
                onChange={(keys) => updateSetting("voiceShortcut", keys)}
              />
            </div>
          }
        />
        <SettingsRow
          label="Voice Volume"
          description="TTS playback volume during voice AI sessions — 0 mutes, 100 is full"
          control={
            <RangeControl
              icon={<SpeakerHigh size={13} weight="regular" />}
              value={settings.voiceVolume ?? 80}
              min={0}
              max={100}
              step={5}
              onChange={(v) => updateSetting("voiceVolume", v)}
              suffix="%"
            />
          }
        />
        <SettingsRow
          label="Floating AI Status Overlay"
          description="Always-on Pulse overlay that shows recording, transcription, and voice states at a glance"
          control={
            <Toggle
              checked={settings.showFloatingIsland}
              onChange={(v) => updateSetting("showFloatingIsland", v)}
            />
          }
        />
        {settings.showFloatingIsland && (
          <SettingsRow
            label="Overlay Opacity"
            description="Opacity when idle — 0 hides Pulse until active, 100 keeps it always visible"
            control={
              <RangeControl
                icon={<CircleDashed size={13} weight="regular" />}
                value={settings.overlayOpacity}
                min={0}
                max={100}
                step={5}
                onChange={(v) => updateSetting("overlayOpacity", v)}
                suffix="%"
              />
            }
          />
        )}
      </div>
    </ConditionalGlobalShortcuts>
  );
};

/**
 * Volume/opacity range slider control. No `Slider` primitive exists; kept as a
 * tokenized raw `<input type="range">` (same retained-raw precedent as the
 * activity VAD threshold — evaluate a shared primitive if sliders recur).
 */
interface RangeControlProps {
  icon: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}

const RangeControl = ({
  icon,
  value,
  min,
  max,
  step,
  onChange,
  suffix = "",
}: RangeControlProps) => (
  <div className="flex items-center gap-3 w-full sm:w-56 flex-shrink-0">
    <span className="text-muted flex-shrink-0">{icon}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      className="flex-1 h-[3px] appearance-none rounded-full cursor-pointer bg-surface-raised motion-safe:transition-colors"
    />
    <span
      className="text-xs tabular-nums text-muted w-7 text-right flex-shrink-0"
      style={{ fontFamily: FONT_SANS }}
    >
      {value}{suffix}
    </span>
  </div>
);
