/**
 * ComputerUsePage — "Coming soon" surface.
 *
 * The Computer Use feature (AI-driven desktop automation via a vision→action
 * loop) is under active development. This page is a deliberate, polished
 * placeholder until the feature ships.
 *
 * Design: strict-neutral (00 §2 / D-401), full semantic token system, framer-
 * motion entrance reduced-motion is honoured app-wide by `MotionConfig`).
 */

import { motion } from "framer-motion";
import {
  Monitor,
  CursorClick,
  Eye,
  ListChecks,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { Icon } from "@/ui/icons";

// ── Entrance variants (subtle stagger; reduced-motion → opacity-only via MotionConfig) ──
const HERO_VARIANTS = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0 },
} as const;

const TRANSITION = { duration: 0.35, ease: "easeOut" as const };

const PREVIEW_ITEMS: Array<{ icon: PhosphorIcon; title: string; body: string }> = [
  {
    icon: Eye,
    title: "Vision",
    body: "Reads your screen after every action to plan the next step.",
  },
  {
    icon: CursorClick,
    title: "Control",
    body: "Clicks, types, and navigates the OS to complete the task.",
  },
  {
    icon: ListChecks,
    title: "Transparent",
    body: "Every screenshot and action is logged for step-by-step review.",
  },
];

export const ComputerUsePage = () => {
  return (
    <section
      aria-labelledby="computer-use-title"
      className="flex h-full w-full items-center justify-center bg-surface-page"
    >
      <div className="w-full max-w-md px-6 py-10 text-center">
        {/* Hero mark — a surfaced tile holding the feature glyph, with a control
            cue badge in its corner (computer + use). Asymmetric elevation §11.2. */}
        <motion.div
          variants={HERO_VARIANTS}
          initial="hidden"
          animate="shown"
          transition={TRANSITION}
          className="relative mx-auto mb-7 flex h-16 w-16 items-center justify-center"
        >
          <div className="flex h-full w-full items-center justify-center rounded-2xl border border-surface-border bg-surface-raised shadow-lg">
            <Icon icon={Monitor} size="xl" className="text-primary" />
          </div>
          <span
            aria-hidden="true"
            className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-lg border border-surface-border bg-surface-page shadow-sm"
          >
            <Icon icon={CursorClick} size="sm" className="text-secondary" />
          </span>
        </motion.div>

        {/* Eyebrow + title */}
        <motion.p
          variants={HERO_VARIANTS}
          initial="hidden"
          animate="shown"
          transition={{ ...TRANSITION, delay: 0.06 }}
          className="text-2xs font-medium uppercase tracking-ultra-wide text-muted"
        >
          Coming soon
        </motion.p>
        <motion.h1
          id="computer-use-title"
          variants={HERO_VARIANTS}
          initial="hidden"
          animate="shown"
          transition={{ ...TRANSITION, delay: 0.1 }}
          className="mt-2 text-xl font-semibold tracking-tight text-primary"
        >
          Computer Use
        </motion.h1>

        {/* Description */}
        <motion.p
          variants={HERO_VARIANTS}
          initial="hidden"
          animate="shown"
          transition={{ ...TRANSITION, delay: 0.14 }}
          className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-secondary"
        >
          Autonomous desktop automation. Describe a goal and an AI agent sees
          your screen, plans each step, and clicks, types, and navigates to
          complete it.
        </motion.p>

        {/* "What to expect" — a quiet preview of the upcoming shape */}
        <motion.ul
          variants={HERO_VARIANTS}
          initial="hidden"
          animate="shown"
          transition={{ ...TRANSITION, delay: 0.18 }}
          className="mt-8 space-y-1.5 text-left"
        >
          {PREVIEW_ITEMS.map(({ icon, title, body }) => (
            <li
              key={title}
              className="flex items-start gap-3 rounded-xl border border-surface-border bg-surface-base px-3.5 py-3"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-surface-raised"
              >
                <Icon icon={icon} size="sm" className="text-secondary" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-primary">
                  {title}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                  {body}
                </span>
              </span>
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
};
