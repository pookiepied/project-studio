import { Moon, Sun } from "@/ui/icons";
import { IconButton } from "@/ui/primitives/IconButton";
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
    <IconButton
      onClick={(e) => {
        e.stopPropagation();
        updateSettings({ theme: next });
      }}
      aria-label={`Switch to ${next} mode`}
      className="group rounded-full"
    >
      <Icon
        size="sm"
        weight="regular"
        className="text-muted transition-colors group-hover:text-primary"
      />
    </IconButton>
  );
}
