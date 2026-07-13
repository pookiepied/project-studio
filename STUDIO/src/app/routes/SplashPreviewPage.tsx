import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SplashScreen } from "@/ui/feedback/SplashScreen";
import { Button } from "@/ui/primitives/Button";

export function SplashPreviewPage() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("studio-theme", dark ? "dark" : "light"); } catch {
      /* ignore storage failures */
    }
  }, [dark]);

  return (
    <div className="font-sans relative h-screen w-screen overflow-hidden bg-surface-page text-primary dark:bg-surface-page dark:text-primary">
      <SplashScreen key={dark ? "dark" : "light"} />

      <div className="fixed left-1/2 top-5 z-popover -translate-x-1/2">
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-1 rounded-xl border border-primary/[0.08] bg-surface-page/[0.82] p-1 shadow-lg backdrop-blur-2xl dark:border-white/[0.08] dark:bg-surface-page/[0.78]"
        >
          <div className="h-8 rounded-lg bg-primary px-3 text-sm leading-8 text-on-emphasis dark:bg-surface-base dark:text-primary">
            Brand Mark
          </div>
          <Button
            onClick={() => setDark((value) => !value)}
            variant="ghost"
            className="h-8 px-3 text-sm text-muted hover:bg-primary/[0.05] hover:text-primary dark:text-muted dark:hover:bg-surface-page/[0.06] dark:hover:text-disabled"
          >
            {dark ? "Dark" : "Light"}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
