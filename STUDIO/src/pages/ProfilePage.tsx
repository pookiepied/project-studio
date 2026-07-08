import {
  ArrowRightIcon as ArrowRight,
  BrainIcon as Brain,
  ChartLineUpIcon as ChartLineUp,
  GearIcon as Gear,
  UserIcon as User,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { useNavigation } from "../contexts/NavigationContext";
import type { View } from "../types/navigation";

type ProfileEntry = {
  title: string;
  subtitle: string;
  view: View;
  icon: React.ElementType;
};

const PROFILE_ENTRIES: ProfileEntry[] = [
  {
    title: "Memories",
    subtitle: "Review and manage the long-term context Studio keeps about you.",
    view: "memories",
    icon: Brain,
  },
  {
    title: "Activity",
    subtitle: "Inspect usage and runtime activity while we split personal and system views.",
    view: "activity",
    icon: ChartLineUp,
  },
  {
    title: "Settings",
    subtitle: "Account, interface, audio, models, shortcuts, and local services.",
    view: "settings",
    icon: Gear,
  },
];

function ProfileTile({ entry, onOpen }: { entry: ProfileEntry; onOpen: (view: View) => void }) {
  const Icon = entry.icon;

  return (
    <button
      type="button"
      onClick={() => onOpen(entry.view)}
      className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400 dark:bg-surface-raised dark:text-gray-600">
        <Icon size={14} weight="regular" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-700 transition-colors group-hover:text-gray-950 dark:text-gray-300 dark:group-hover:text-gray-50">
          {entry.title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-gray-400 dark:text-gray-600">
          {entry.subtitle}
        </span>
      </span>
      <ArrowRight size={13} className="flex-shrink-0 text-gray-300 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 dark:text-gray-700" />
    </button>
  );
}

export function ProfilePage() {
  const { user, isAuthenticated } = useAuth();
  const { navigateTo } = useNavigation();

  return (
    <div className="h-full overflow-hidden bg-white text-gray-900 transition-colors duration-300 dark:bg-surface-page dark:text-gray-100">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="mb-8"
        >
          <p className="text-2xs font-semibold uppercase tracking-extra-wide text-gray-400 dark:text-gray-600">
            Profile
          </p>
          <h1 className="mt-2 font-display text-2xl font-normal tracking-tight text-gray-950 dark:text-gray-50">
            Personal context
          </h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-400 dark:text-gray-600">
            Account identity, memory, and personal activity live here instead of being scattered through the launcher.
          </p>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.04, ease: "easeOut" }}
          className="mb-5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-surface-border dark:bg-surface-base"
        >
          <div className="flex items-center gap-3">
            {isAuthenticated && user?.picture ? (
              <img src={user.picture} alt={user.name} className="h-11 w-11 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-surface-raised dark:text-gray-600">
                <User size={18} weight="regular" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                {isAuthenticated && user ? user.name : "Not signed in"}
              </p>
              <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-600">
                {isAuthenticated && user ? user.email : "Sign in from Settings to sync your profile."}
              </p>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.08, ease: "easeOut" }}
          className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-surface-border dark:bg-surface-base"
        >
          {PROFILE_ENTRIES.map((entry) => (
            <ProfileTile key={entry.view} entry={entry} onOpen={navigateTo} />
          ))}
        </motion.section>
      </div>
    </div>
  );
}
