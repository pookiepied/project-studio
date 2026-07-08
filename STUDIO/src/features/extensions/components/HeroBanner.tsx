import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ChatCircleIcon as ChatCircle } from "@phosphor-icons/react";
import { AppLogo } from "@/components/brand";
import type { ComposioApp } from "@/services/ai/composioService";
import { GithubLetterIcon } from "./ExtensionIcons";

// NOTE: The hero gradient + the rotating brand-coloured prompt card are an
// intentional marketing surface (user-confirmed, D-408). They are deliberately
// exempt from the strict-neutral palette — do not neutralise this banner.
/* eslint-disable no-restricted-syntax -- D-408 marketing-surface carve-out: brand icon hues + hero gradient are user-confirmed exempt from strict-neutral */
const HERO_EXAMPLES = [
  { appName: "Gmail",    appId: "gmail",          prompt: "Draft replies for every email I'm behind on",       iconColor: "#EA4335", iconBg: "#fef2f2", iconLetter: "G" },
  { appName: "GitHub",   appId: "github",         prompt: "Triage PRs, issues, CI, and publish flows",         iconColor: "#1a1a1a", iconBg: "#f6f8fa", iconLetter: "" },
  { appName: "Slack",    appId: "slack",          prompt: "Summarize my unread messages from today",           iconColor: "#611F69", iconBg: "#f4f0f8", iconLetter: "S" },
  { appName: "Browser",  appId: "",               prompt: "Open LinkedIn and find my latest job applications",  iconColor: "#2563EB", iconBg: "#eff6ff", iconLetter: "B" },
  { appName: "Calendar", appId: "googlecalendar", prompt: "Schedule a team sync for next Tuesday",             iconColor: "#0F9D58", iconBg: "#f0fdf4", iconLetter: "C" },
];
// Decorative hero gradient — same D-408 marketing carve-out (used in the style prop below).
const HERO_GRADIENT = "linear-gradient(135deg, #ede9fe 0%, #dbeafe 55%, #bae6fd 100%)";
/* eslint-enable no-restricted-syntax */

interface HeroBannerProps {
  onTryInChat:   () => void;
  composioApps:  ComposioApp[];
}

export const HeroBanner = ({ onTryInChat, composioApps }: HeroBannerProps) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setActiveIndex(i => (i + 1) % HERO_EXAMPLES.length);
        setIsAnimating(false);
      }, 250);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const example  = HERO_EXAMPLES[activeIndex];
  const heroLogo = example.appId
    ? composioApps.find(a => a.appId.toLowerCase() === example.appId)?.logo
    : undefined;

  return (
    <div
      className="relative rounded-2xl overflow-hidden select-none"
      style={{ background: HERO_GRADIENT }}
    >
      {/* Noise overlay */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

      <div className="relative px-5 pt-10 pb-8 flex flex-col items-center gap-5">
        {/* Rotating prompt card */}
        <motion.div
          key={activeIndex}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: isAnimating ? 0 : 1, y: isAnimating ? -4 : 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm bg-white/80 backdrop-blur-sm rounded-xl px-4 py-3 shadow-sm flex items-center gap-3"
        >
          <AppLogo
            src={heroLogo}
            label={example.appName}
            size="md"
            className="rounded-lg"
            iconBg={example.iconBg}
            iconColor={example.iconColor}
            fallback={example.appName === "GitHub" ? <GithubLetterIcon size={16} /> : example.iconLetter}
          />
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm" style={{ color: example.iconColor }}>{example.appName}</span>
            <p className="text-sm text-gray-600 leading-snug truncate">{example.prompt}</p>
          </div>
        </motion.div>

        {/* Try in chat */}
        <button
          onClick={onTryInChat}
          className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-surface-hover hover:bg-gray-50 dark:hover:bg-surface-border text-gray-800 dark:text-gray-200 text-sm font-semibold rounded-full shadow-sm transition-all hover:shadow-md active:scale-95 border border-gray-150 dark:border-surface-active"
        >
          <ChatCircle size={14} weight="fill" className="text-gray-600 dark:text-gray-400" />
          Try in chat
        </button>

        {/* Pagination dots */}
        <div className="flex items-center gap-1.5">
          {HERO_EXAMPLES.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={`rounded-full transition-all duration-300 ${
                i === activeIndex
                  ? "w-4 h-1.5 bg-gray-700 dark:bg-gray-300"
                  : "w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
