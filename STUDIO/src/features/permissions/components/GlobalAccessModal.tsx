import { motion, AnimatePresence } from "framer-motion";
import { StudioMark } from "@/ui/brand";
import { Button } from "@/ui/primitives/Button";
import { PermissionActionButton, PermissionModalShell } from "./PermissionModalShell";

interface GlobalAccessModalProps {
  /** Whether the machine-access request is pending. */
  open: boolean;
  /** The tool that triggered the request, for context (optional). */
  toolName?: string;
  /** Resolve the prompt: `true` grants machine-wide access, `false` declines. */
  onResolve: (granted: boolean) => void;
}

/**
 * Machine-wide file-access gate, shown when a chat that isn't tied to a project
 * asks to touch files anywhere on the machine. This is the global counterpart
 * to the workspace trust/working-style modal in `ProjectContextPicker`: a
 * project scopes access to its root, whereas a global chat has no root, so
 * operating on files requires this explicit, once-per-machine grant.
 *
 * Presented as a wide, split-panel card behind a blurred backdrop - an image
 * on the left, the decision on the right - because it is a consequential,
 * durable choice, not a per-action prompt. Deliberately free of tool-name
 * jargon: it speaks to the decision, not the mechanics.
 */
export function GlobalAccessModal({ open, onResolve }: GlobalAccessModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            className="fixed inset-0 bg-scrim backdrop-blur-md z-50"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 14 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
          >
            <PermissionModalShell>
              {/* Left — imagery */}
              <div className="relative hidden sm:block w-[42%] flex-shrink-0 overflow-hidden">
                <img
                  src="/sky.png"
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover object-[55%_45%]"
                />
                {/* Legibility + depth wash */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/10" />

                <div className="relative flex h-full flex-col justify-between p-7">
                  <div className="flex items-center gap-2.5 text-on-emphasis">
                    <StudioMark size={20} className="text-on-emphasis" />
                    <span className="text-xs font-medium uppercase tracking-[0.28em] text-on-emphasis/85">
                      Studio
                    </span>
                  </div>
                  <div>
                    <p className="text-3xl leading-[1.15] font-semibold text-on-emphasis drop-shadow-sm">
                      Your machine,
                      <br />
                      your permission.
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-on-emphasis/75 max-w-[220px]">
                      A global chat has no project of its own — so reaching your
                      files is always your call.
                    </p>
                  </div>
                </div>
              </div>

              {/* Right — the decision */}
              <div className="flex flex-1 flex-col justify-center p-8 sm:p-10 overflow-y-auto">
                <span className="text-xs font-medium uppercase tracking-[0.22em] text-disabled dark:text-muted">
                  Local access
                </span>

                <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.01em] text-primary dark:text-primary">
                  Grant access to your files?
                </h2>

                <p className="mt-3 text-base leading-relaxed text-muted dark:text-disabled">
                  This chat isn't tied to a project folder. Granting access lets
                  the assistant read and modify files anywhere on this machine
                  during local chats.
                </p>

                <p className="mt-4 text-sm leading-relaxed text-disabled dark:text-muted">
                  Prefer to keep things contained? Open a project folder instead
                  and access stays scoped to it. You can revoke this anytime in
                  Settings → Permissions.
                </p>

                <div className="mt-8 flex flex-col-reverse sm:flex-row gap-2.5">
                  <Button
                    variant="outline"
                    onClick={() => onResolve(false)}
                    className="flex-1 py-2.5 text-base font-medium text-secondary dark:text-disabled hover:text-primary dark:hover:text-primary border border-surface-border dark:border-surface-border rounded-2xl transition-colors"
                  >
                    Not now
                  </Button>
                  <PermissionActionButton
                    onClick={() => onResolve(true)}
                  >
                    Grant access
                  </PermissionActionButton>
                </div>
              </div>
            </PermissionModalShell>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
