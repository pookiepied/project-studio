/**
 * String formatting utilities
 */

/**
 * Capitalize first letter of a string
 * @example capitalize("hello") => "Hello"
 */
function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Format price for display
 * @example formatPrice(0) => "Free"
 * @example formatPrice(0.0001) => "$0.0001"
 * @example formatPrice(1.5) => "$1.50"
 */
export function formatPrice(price: number): string {
  if (price === 0) return "Free";
  if (price < 0.001) return `$${price.toFixed(4)}`;
  if (price < 0.01) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(2)}`;
}

/**
 * Format an internal identifier (snake_case or kebab-case) into a human-readable label.
 * @example formatLabel("user_profile") => "User Profile"
 * @example formatLabel("identity") => "Identity"
 * @example formatLabel("tool-output") => "Tool Output"
 */
export function formatLabel(identifier: string): string {
  if (!identifier) return "";
  return identifier
    .replace(/[-_]/g, " ")
    .split(" ")
    .map((word) => capitalize(word))
    .join(" ");
}

/**
 * Format timestamp as relative time
 * @example formatDate(Date.now()) => "Just now"
 * @example formatDate(Date.now() - 3600000) => "1h ago"
 * @example formatDate(Date.now() - 86400000 * 2) => "2d ago"
 * @example formatDate("2024-03-09T15:30:00Z") => "2h ago"
 */
export function formatDate(timestamp: number | string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}
