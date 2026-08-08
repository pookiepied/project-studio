/**
 * PulseCardView — island content for Pulse tool-result cards.
 *
 * CardIcon    — maps PulseCardType to a leading phosphor icon.
 * PulseCardContent — full card row: icon + title/text/progress + dismiss button.
 */

import { motion } from "framer-motion";
import {
  Success,
  Close,
  Icon,
  CurrencyCircleDollarIcon,
  Search,
  ImageIcon,
  Brain,
  Terminal,
} from "@/ui/icons";
import type { PulseCard, PulseCardType } from "@/types/pulse";
import type { OverlayActionType } from "@/core/platform/overlayService";
import { ActionBtn } from "./IslandAtoms";

// ─── Card icon ────────────────────────────────────────────────────────────────

/** Leading icon whose shape reflects the type of card being shown. */
function CardIcon({ type }: { type: PulseCardType }) {
  const cls = "text-muted dark:text-disabled flex-shrink-0";
  switch (type) {
    case "price-lookup":
      return <Icon icon={CurrencyCircleDollarIcon} size="sm" className={cls} />;
    case "web-search":
      return <Search size="sm" className={cls} />;
    case "image-generation":
    case "video-generation":
      return <Icon icon={ImageIcon} size="sm" className={cls} />;
    case "memory":
      return <Brain size="sm" className={cls} />;
    case "computer-use":
    case "ocr":
      return <Terminal size="sm" className={cls} />;
    default:
      return <Success size="sm" className={cls} />;
  }
}

// ─── Card content ─────────────────────────────────────────────────────────────

interface PulseCardContentProps {
  card: PulseCard;
  onAction: (action: OverlayActionType) => void;
}

/**
 * Renders a PulseCard inside the island: icon · title · text · progress · dismiss.
 * Shown when state=COMPLETE and a card payload is present.
 */
export function PulseCardContent({ card, onAction }: PulseCardContentProps) {
  const hasProgress = typeof card.progress === "number";

  return (
    <motion.div
      key={`card-${card.type}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="flex items-center gap-2.5 px-3.5 h-[46px] max-w-[420px] no-drag-region"
    >
      <CardIcon type={card.type} />

      <div className="flex flex-col min-w-0 flex-1" style={{ gap: 1 }}>
        {card.title && (
          <span
            className="text-sm font-semibold text-secondary dark:text-disabled truncate leading-tight font-sans"
          >
            {card.title}
          </span>
        )}
        {card.text && (
          <span
            className="text-xs text-muted dark:text-disabled truncate leading-tight font-sans"
          >
            {card.text.length > 55 ? card.text.slice(0, 52) + "…" : card.text}
          </span>
        )}
        {hasProgress && (
          <div className="w-full h-[2px] rounded-full bg-surface-raised dark:bg-secondary mt-0.5 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-secondary dark:bg-surface-selected"
              animate={{ width: `${card.progress}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        )}
      </div>

      {card.subtext && (
        <span
          className="text-xs text-disabled dark:text-muted flex-shrink-0 whitespace-nowrap font-sans"
        >
          {card.subtext}
        </span>
      )}

      <ActionBtn
         icon={<Close size="xs" />}
        label="Dismiss"
        onClick={() => onAction("dismiss")}
      />
    </motion.div>
  );
}
