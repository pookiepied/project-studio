import {
  DesktopIcon as Desktop,
  SunIcon as Sun,
  MoonIcon as Moon,
} from "@phosphor-icons/react";
import { SegmentedControl } from "@/ui/primitives/SegmentedControl";
import { Toggle } from "@/ui/primitives/Toggle";
import { ConditionalAutostart, ConditionalSystemTray } from "@/app/globals/ConditionalFeatures";
import { useSettings } from "@/app/contexts/SettingsContext";
import type { AppSettings, ThemePreference } from "@/types";
import { SettingsRow } from "./SettingsRow";

interface Props {
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onThemeChange: (theme: ThemePreference) => Promise<void>;
}

const themeOptions = [
  { value: "system" as const, label: "System", icon: <Desktop size={13} weight="regular" /> },
  { value: "light" as const,  label: "Light",  icon: <Sun size={13} weight="regular" /> },
  { value: "dark" as const,   label: "Dark",   icon: <Moon size={13} weight="regular" /> },
];

export const InterfaceView = ({ updateSetting, onThemeChange }: Props) => {
  const { settings } = useSettings();

  return (
    <div>
      <SettingsRow
        label="Appearance"
        description="Light or dark interface theme"
        control={
          <div className="flex-shrink-0">
            <SegmentedControl
              aria-label="Theme"
              options={themeOptions}
              value={settings.theme}
              onChange={onThemeChange}
            />
          </div>
        }
      />
      <SettingsRow
        label="Show Notifications"
        description="Desktop notifications for completed tasks"
        control={<Toggle checked={settings.showNotifications} onChange={(v) => updateSetting("showNotifications", v)} />}
      />
      {settings.showNotifications && (
        <SettingsRow
          label="Background Chat Alerts"
          description="Notify when a conversation finishes while you're in another chat"
          control={
            <Toggle
              checked={settings.notifyConversationDone}
              onChange={(v) => updateSetting("notifyConversationDone", v)}
            />
          }
        />
      )}
      <ConditionalSystemTray>
        <SettingsRow
          label="Minimize to Tray"
          description="Keep app running in system tray"
          control={<Toggle checked={settings.minimizeToTray} onChange={(v) => updateSetting("minimizeToTray", v)} />}
        />
      </ConditionalSystemTray>
      <ConditionalAutostart>
        <SettingsRow
          label="Start on Boot"
          description="Launch STUDIO when system starts"
          control={<Toggle checked={settings.startOnBoot} onChange={(v) => updateSetting("startOnBoot", v)} />}
        />
      </ConditionalAutostart>
    </div>
  );
};
