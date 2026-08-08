import { motion, AnimatePresence } from "framer-motion";
import { StudioMark } from "@/ui/brand";
import { Button } from "@/ui/primitives/Button";
import { PermissionActionButton, PermissionModalShell } from "./PermissionModalShell";
import type { ManagementKind } from "@/core/permissions";

/** The user's choice on a management-permission gate. */
export type ManagementDecision = "session" | "global" | "deny";

interface ManagementAccessModalProps {
  /** The management category being requested, or `null` when the gate is closed. */
  kind: ManagementKind | null;
  /** Resolve the prompt with a grant lifetime, or `"deny"`. */
  onResolve: (decision: ManagementDecision) => void;
}

/**
 * System-management permission gate — the counterpart to {@link GlobalAccessModal}
 * for the two first-party management categories:
 *   - "mcp"   — installing / configuring MCP servers (mcp-management server)
 *   - "skill" — creating / modifying skills (skill-management server)
 *
 * These are consequential, durable choices (an MCP install grants new executable
 * capability; a skill edit changes what the assistant will do), so they get the
 * same wide split-panel treatment as machine access rather than a per-action
 * composer card. One grant covers every operation of that category — "Allow for
 * this chat" (session) or "Always allow" (persisted). Reachable again anytime via
 * Settings → Permissions.
 */
const COPY: Record<ManagementKind, {
  image: string;
  eyebrow: string;
  side: { title: string; body: string };
  heading: string;
  body: string;
  hint: string;
  grant: string;
}> = {
  mcp: {
    image: "/moon.png",
    eyebrow: "MCP management",
    side: {
      title: "New tools,\nyour call.",
      body: "Installing an MCP server adds new capabilities that run on your machine — so it's always your decision.",
    },
    heading: "Let the assistant manage MCP servers?",
    body: "This lets the assistant install and configure MCP servers on this machine — adding new tools it can then use.",
    hint: "One approval covers MCP install and configuration for the scope you choose. You can revoke it anytime in Settings → Permissions.",
    grant: "Allow MCP management",
  },
  skill: {
    image: "/flower.png",
    eyebrow: "Skill management",
    side: {
      title: "New skills,\nyour call.",
      body: "Creating or editing a skill changes what the assistant will do — so authoring is always your decision.",
    },
    heading: "Let the assistant manage skills?",
    body: "This lets the assistant create and modify skills on this machine — changing the playbooks it follows.",
    hint: "One approval covers skill authoring for the scope you choose. You can revoke it anytime in Settings → Permissions.",
    grant: "Allow skill management",
  },
};

export function ManagementAccessModal({ kind, onResolve }: ManagementAccessModalProps) {
  const copy = kind ? COPY[kind] : null;

  return (
    <AnimatePresence>
      {copy && (
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
                  src={copy.image}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover object-[55%_45%]"
                />
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
                    <p className="text-3xl leading-[1.15] font-semibold text-on-emphasis drop-shadow-sm whitespace-pre-line">
                      {copy.side.title}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-on-emphasis/75 max-w-[220px]">
                      {copy.side.body}
                    </p>
                  </div>
                </div>
              </div>

              {/* Right — the decision */}
              <div className="flex flex-1 flex-col justify-center p-8 sm:p-10 overflow-y-auto">
                <span className="text-xs font-medium uppercase tracking-[0.22em] text-disabled dark:text-muted">
                  {copy.eyebrow}
                </span>

                <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.01em] text-primary dark:text-primary">
                  {copy.heading}
                </h2>

                <p className="mt-3 text-base leading-relaxed text-muted dark:text-disabled">
                  {copy.body}
                </p>

                <p className="mt-4 text-sm leading-relaxed text-disabled dark:text-muted">
                  {copy.hint}
                </p>

                <div className="mt-8 flex flex-col gap-2.5">
                  <div className="flex flex-col-reverse sm:flex-row gap-2.5">
                    <Button
                      variant="outline"
                      onClick={() => onResolve("session")}
                      className="flex-1 py-2.5 text-base font-medium text-secondary dark:text-disabled hover:text-primary dark:hover:text-primary border border-surface-border dark:border-surface-border rounded-2xl transition-colors"
                    >
                      Allow for this chat
                    </Button>
                    <PermissionActionButton
                      onClick={() => onResolve("global")}
                    >
                      {copy.grant}
                    </PermissionActionButton>
                  </div>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => onResolve("deny")}
                    className="mx-auto mt-1 text-sm font-medium text-disabled dark:text-muted hover:text-secondary dark:hover:text-disabled transition-colors"
                  >
                    Not now
                  </Button>
                </div>
              </div>
            </PermissionModalShell>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
