/**
 * PulseCardView — island content for Pulse tool-result cards.
 *
 * CardIcon    — maps PulseCardType to a leading phosphor icon.
 * PulseCardContent — full card row: icon + title/text/progress + dismiss button.
 */

import { motion } from "framer-motion";
import {
  CheckCircleIcon as CheckCircle,
  XIcon as X,
  CurrencyCircleDollarIcon as CurrencyDollar,
  MagnifyingGlassIcon as MagnifyingGlass,
  ImageIcon,
  BrainIcon as Brain,
  TerminalIcon as Terminal,
} from "@phosphor-icons/react";
import { FONT_SANS } from "../../styles/fonts";
import type { PulseCard, PulseCardType } from "../../types/pulse";
import type { OverlayActionType } from "../../services/platform/overlayService";
import { ActionBtn } from "./IslandAtoms";

// ─── Card icon ────────────────────────────────────────────────────────────────

/** Leading icon whose shape reflects the type of card being shown. */
export function CardIcon({ type }: { type: PulseCardType }) {
  const cls = "text-gray-500 dark:text-gray-400 flex-shrink-0";
  switch (type) {
    case "price-lookup":
      return <CurrencyDollar size={13} weight="regular" className={cls} />;
    case "web-search":
      return <MagnifyingGlass size={13} weight="regular" className={cls} />;
    case "image-generation":
    case "video-generation":
      return <ImageIcon size={13} weight="regular" className={cls} />;
    case "memory":
      return <Brain size={13} weight="regular" className={cls} />;
    case "computer-use":
    case "ocr":
      return <Terminal size={13} weight="regular" className={cls} />;
    default:
      return <CheckCircle size={13} weight="regular" className={cls} />;
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
      className="flex items-center gap-2.5 px-3.5 h-[46px] max-w-[420px]"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <CardIcon type={card.type} />

      <div className="flex flex-col min-w-0 flex-1" style={{ gap: 1 }}>
        {card.title && (
          <span
            className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate leading-tight"
            style={{ fontFamily: FONT_SANS }}
          >
            {card.title}
          </span>
        )}
        {card.text && (
          <span
            className="text-xs text-gray-500 dark:text-gray-400 truncate leading-tight"
            style={{ fontFamily: FONT_SANS }}
          >
            {card.text.length > 55 ? card.text.slice(0, 52) + "…" : card.text}
          </span>
        )}
        {hasProgress && (
          <div className="w-full h-[2px] rounded-full bg-gray-200 dark:bg-gray-700 mt-0.5 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gray-500 dark:bg-gray-300"
              animate={{ width: `${card.progress}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        )}
      </div>

      {card.subtext && (
        <span
          className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 whitespace-nowrap"
          style={{ fontFamily: FONT_SANS }}
        >
          {card.subtext}
        </span>
      )}

      <ActionBtn
        icon={<X size={10} weight="regular" />}
        label="Dismiss"
        onClick={() => onAction("dismiss")}
      />
    </motion.div>
  );
}
