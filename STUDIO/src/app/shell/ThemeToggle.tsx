import { MoonIcon as Moon, SunIcon as Sun } from "@phosphor-icons/react";
import { useSettings } from "@/app/contexts/SettingsContext";
import { resolveTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { settings, updateSettings } = useSettings();
  // Quick toggle is light ↔ dark only — "system" lives in full Settings, not here.
  // The icon reflects the current appearance; clicking flips to the opposite mode.
  const isDark = resolveTheme(settings.theme) === "dark";
  const next = isDark ? "light" : "dark";
  const Icon = isDark ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        updateSettings({ theme: next });
      }}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="group flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-surface-hover"
    >
      <Icon
        size={14}
        weight="regular"
        className="text-muted transition-colors group-hover:text-primary"
      />
    </button>
  );
}
