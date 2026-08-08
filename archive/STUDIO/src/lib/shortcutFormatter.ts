/**
 * Format shortcut keys for display
 */

/**
 * Convert shortcut keys array to display format
 * e.g., ["ctrl", "shift", "r"] -> ["CTRL", "SHIFT", "R"]
 */
export function formatShortcutKeys(keys: string[]): string[] {
  return keys.map((key) => {
    const normalized = key.toLowerCase();
    
    // Map special keys to display names
    if (normalized === "ctrl" || normalized === "control") return "CTRL";
    if (normalized === "shift") return "SHIFT";
    if (normalized === "alt") return "ALT";
    if (normalized === "meta" || normalized === "cmd" || normalized === "super") return "CMD";
    
    // Regular keys - uppercase
    return key.toUpperCase();
  });
}
