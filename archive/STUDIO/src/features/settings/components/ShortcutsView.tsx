import {
  Volume,
  Icon,
  CircleDashedIcon,
} from "@/ui/icons";
import { Slider } from "@/ui/primitives/Slider";
import { Toggle } from "@/ui/primitives/Toggle";
import { ConditionalGlobalShortcuts } from "@/app/globals/ConditionalFeatures";
import { useSettings } from "@/app/contexts/SettingsContext";
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
              icon={<Volume size="sm" />}
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
                icon={<Icon icon={CircleDashedIcon} size="sm" />}
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
    <div className="flex-1 min-w-0">
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
    </div>
    <span className="text-xs tabular-nums text-muted w-7 text-right flex-shrink-0">
      {value}{suffix}
    </span>
  </div>
);
