import { useState, type ReactElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StudioMark } from "../brand";
import type { LocalPermissionGrants } from "../../hooks/useHarnessInit";

interface HarnessPermissionModalProps {
  open: boolean;
  onAllow: (grants: LocalPermissionGrants) => void;
  onDeny: () => void;
}

type CapabilityKey = "studioHarness" | "computerUse";

interface Capability {
  key: CapabilityKey;
  title: string;
  caption: string;
  icon: (props: { className?: string }) => ReactElement;
}

/** Terminal / toolkit glyph — local dev tools, commands, git. */
function HarnessIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 9.5L10 12.5L6.5 15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 15.5H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Monitor / cursor glyph — desktop, screen, pointer control. */
function ComputerUseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2.5" y="4" width="19" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 20.5H15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 17.5V20.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M10.5 8.2L15.8 10.6C16.2 10.78 16.17 11.36 15.75 11.5L13.55 12.2L14.7 14.3C14.86 14.6 14.75 14.97 14.45 15.13L13.7 15.5C13.4 15.66 13.03 15.55 12.87 15.25L11.72 13.15L10.15 14.6C9.83 14.9 9.3 14.68 9.3 14.24V8.7C9.3 8.32 9.68 8.06 10.03 8.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

const CAPABILITIES: Capability[] = [
  {
    key: "studioHarness",
    title: "Studio Harness",
    caption:
      "Your local dev toolkit — Studio reads, edits, and searches your code, runs commands and builds, and keeps git in sync, right where the project lives.",
    icon: HarnessIcon,
  },
  {
    key: "computerUse",
    title: "Computer Use",
    caption:
      "Full desktop control — Studio sees your screen, opens and drives any app, clicks and types, and carries a task across native and web tools alike.",
    icon: ComputerUseIcon,
  },
];

/**
 * Local-capability gate for Studio Harness + Computer Use. Shares the wide,
 * split-panel silhouette of the other consequential gates (GlobalAccessModal,
 * workspace trust): imagery on the left, the decision on the right. Both
 * capabilities are presented at once as icon-led toggle rows, since enabling
 * them is a single, durable choice rather than a per-action prompt.
 */
export function HarnessPermissionModal({ open, onAllow, onDeny }: HarnessPermissionModalProps) {
  const [grants, setGrants] = useState<LocalPermissionGrants>({
    studioHarness: true,
    computerUse: true,
  });

  const anyEnabled = grants.studioHarness || grants.computerUse;
  const toggle = (key: CapabilityKey) =>
    setGrants((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-md z-50"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 14 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="pointer-events-auto flex w-full max-w-[820px] h-[480px] max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-surface-base shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
              {/* Left — imagery */}
              <div className="relative hidden sm:block w-[42%] flex-shrink-0 overflow-hidden">
                <img
                  src="/flower.png"
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover object-[62%_45%]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/10" />

                <div className="relative flex h-full flex-col justify-between p-7">
                  <div className="flex items-center gap-2.5 text-white">
                    <StudioMark size={22} className="text-white" />
                    <span className="text-xs font-medium uppercase tracking-[0.28em] text-white/85">
                      Studio
                    </span>
                  </div>
                  <div>
                    <p className="text-3xl leading-[1.15] font-semibold text-white drop-shadow-sm">
                      Your machine,
                      <br />
                      your studio.
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-white/75 max-w-[220px]">
                      Switch on the local powers that let Studio build and act
                      right beside you.
                    </p>
                  </div>
                </div>
              </div>

              {/* Right — the decision */}
              <div className="flex flex-1 flex-col justify-center p-8 sm:p-10 overflow-y-auto">
                <span className="text-xs font-medium uppercase tracking-[0.22em] text-gray-400 dark:text-gray-500">
                  Local capabilities
                </span>

                <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-gray-50">
                  Bring Studio to your machine
                </h2>

                <p className="mt-3 text-base leading-relaxed text-gray-500 dark:text-gray-400">
                  Choose what Studio can reach locally. You're always in control,
                  and can change either of these anytime in Settings.
                </p>

                <div className="mt-6 space-y-2.5">
                  {CAPABILITIES.map((cap) => (
                    <CapabilityRow
                      key={cap.key}
                      title={cap.title}
                      caption={cap.caption}
                      enabled={grants[cap.key]}
                      Icon={cap.icon}
                      onToggle={() => toggle(cap.key)}
                    />
                  ))}
                </div>

                <div className="mt-8 flex flex-col-reverse sm:flex-row gap-2.5">
                  <button
                    type="button"
                    onClick={onDeny}
                    className="flex-1 py-2.5 text-base font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-surface-border rounded-2xl transition-colors"
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    onClick={() => onAllow(grants)}
                    disabled={!anyEnabled}
                    className="flex-1 py-2.5 text-base font-semibold text-white bg-gray-900 dark:bg-gray-100 dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white rounded-2xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface CapabilityRowProps {
  title: string;
  caption: string;
  enabled: boolean;
  Icon: (props: { className?: string }) => ReactElement;
  onToggle: () => void;
}

function CapabilityRow({ title, caption, enabled, Icon, onToggle }: CapabilityRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors duration-200 ${
        enabled
          ? "border-gray-300/70 dark:border-white/15 bg-gray-50 dark:bg-white/[0.05]"
          : "border-gray-200 dark:border-white/10 hover:bg-gray-50/70 dark:hover:bg-white/[0.03]"
      }`}
    >
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors duration-200 ${
          enabled
            ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
            : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        <p className="mt-0.5 text-sm leading-relaxed text-gray-500 dark:text-gray-500">{caption}</p>
      </div>

      <Toggle on={enabled} />
    </button>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <motion.span
      whileTap={{ scale: 0.94 }}
      aria-hidden="true"
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full px-0.5 transition-colors duration-200 ${
        on ? "bg-gray-900 dark:bg-gray-100" : "bg-gray-200 dark:bg-white/20"
      }`}
    >
      <motion.span
        initial={false}
        animate={{ x: on ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={`h-5 w-5 rounded-full bg-white shadow-sm ${on ? "dark:bg-gray-900" : "dark:bg-gray-200"}`}
      />
    </motion.span>
  );
}
