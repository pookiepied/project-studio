import { motion } from "framer-motion";
import type { Artifact } from "@/types/artifacts";

export function isArtifactWorking(status: Artifact["status"]) {
  return status === "loading" || status === "streaming" || status === "pending";
}

export function ArtifactShell({
  children,
  working = false,
}: {
  children: React.ReactNode;
  working?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.26,
        ease: [0.16, 1, 0.3, 1],
      }}
      data-working={working ? "true" : undefined}
      className="relative max-w-2xl overflow-hidden rounded-[22px] bg-surface-base/70 px-4 py-4 shadow-[0_18px_44px_rgba(0,0,0,0.055)] ring-1 ring-black/[0.035] dark:bg-white/[0.055] dark:shadow-none dark:ring-white/[0.06]"
    >
      {children}
    </motion.div>
  );
}

export function ArtifactIconBubble({
  children,
  working = false,
}: {
  children: React.ReactNode;
  working?: boolean;
}) {
  return (
    <motion.div
      className="relative mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-page/80 dark:bg-white/[0.07]"
      initial={{ scale: 0.94, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      data-working={working ? "true" : undefined}
    >
      <span className="relative">{children}</span>
    </motion.div>
  );
}

export function AnimatedList({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.045 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedItem({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 7 },
        show: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function ProcessingDots() {
  return (
    <span className="inline-flex translate-y-[-1px] items-center gap-0.5">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="h-0.5 w-0.5 rounded-full bg-current"
          animate={{ opacity: [0.28, 0.7, 0.28] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.16, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}
