import {
  LeafIcon as Leaf,
  LightningIcon as Lightning,
  StarIcon as Star,
  SparkleIcon as Sparkle,
} from "@phosphor-icons/react";
import { Icon, type IconSize } from "@/components/icons";

/**
 * AI-tier glyph (leaf / lightning / star / sparkle). These are feature-specific
 * decorative marks with no shared "concept", so they use the sanctioned
 * `<Icon icon={…}>` escape hatch (§17) rather than barrel concepts.
 */
export function ModeIcon({ icon, size = "xs" }: { icon: string; size?: IconSize }) {
  const cls = "text-muted flex-shrink-0";
  switch (icon) {
    case "leaf":      return <Icon icon={Leaf}      size={size} className={cls} />;
    case "lightning": return <Icon icon={Lightning} size={size} className={cls} />;
    case "star":      return <Icon icon={Star}      size={size} className={cls} />;
    case "sparkle":   return <Icon icon={Sparkle}   size={size} className={cls} />;
    default:          return null;
  }
}
