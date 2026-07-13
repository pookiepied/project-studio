import {
  Forward,
  Brain,
  Activity,
  Settings,
  User,
} from "@/ui/icons";
import { motion } from "framer-motion";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useNavigation } from "../contexts/NavigationContext";
import type { View } from "@/types/navigation";
import { Button } from "@/ui/primitives/Button";

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
    icon: Activity,
  },
  {
    title: "Settings",
    subtitle: "Account, interface, audio, models, shortcuts, and local services.",
    view: "settings",
    icon: Settings,
  },
];

function ProfileTile({ entry, onOpen }: { entry: ProfileEntry; onOpen: (view: View) => void }) {
  const Icon = entry.icon;

  return (
    <Button
      onClick={() => onOpen(entry.view)}
      variant="ghost"
      className="group w-full gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-page dark:hover:bg-surface-page/[0.03]"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-base text-disabled dark:bg-surface-raised dark:text-secondary">
        <Icon size="sm" weight="regular" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-secondary transition-colors group-hover:text-primary dark:text-disabled dark:group-hover:text-primary">
          {entry.title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-disabled dark:text-secondary">
          {entry.subtitle}
        </span>
      </span>
      <Forward size="sm" className="flex-shrink-0 text-disabled opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 dark:text-secondary" />
    </Button>
  );
}

export function ProfilePage() {
  const { user, isAuthenticated } = useAuth();
  const { navigateTo } = useNavigation();

  return (
    <div className="h-full overflow-hidden bg-surface-page text-primary transition-colors duration-300 dark:bg-surface-page dark:text-primary">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="mb-8"
        >
          <p className="text-2xs font-semibold uppercase tracking-extra-wide text-disabled dark:text-secondary">
            Profile
          </p>
          <h1 className="mt-2 font-display text-xl font-normal text-primary">
            Personal context
          </h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-disabled dark:text-secondary">
            Account identity, memory, and personal activity live here instead of being scattered through the launcher.
          </p>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.04, ease: "easeOut" }}
          className="mb-5 rounded-2xl border border-surface-border bg-surface-page p-4 shadow-sm dark:border-surface-border dark:bg-surface-base"
        >
          <div className="flex items-center gap-3">
            {isAuthenticated && user?.picture ? (
              <img src={user.picture} alt={user.name} className="h-11 w-11 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-base text-disabled dark:bg-surface-raised dark:text-secondary">
                <User size="lg" weight="regular" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-primary dark:text-disabled">
                {isAuthenticated && user ? user.name : "Not signed in"}
              </p>
              <p className="mt-0.5 truncate text-xs text-disabled dark:text-secondary">
                {isAuthenticated && user ? user.email : "Sign in from Settings to sync your profile."}
              </p>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.08, ease: "easeOut" }}
          className="overflow-hidden rounded-2xl border border-surface-border bg-surface-page shadow-sm dark:border-surface-border dark:bg-surface-base"
        >
          {PROFILE_ENTRIES.map((entry) => (
            <ProfileTile key={entry.view} entry={entry} onOpen={navigateTo} />
          ))}
        </motion.section>
      </div>
    </div>
  );
}
