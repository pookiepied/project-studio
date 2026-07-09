import { motion } from "framer-motion";
import { StudioMark } from "../brand";
import { SPLASH_EXIT_DURATION_SECONDS } from "../../core/config/constants/splashTiming";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_STANDARD = [0.4, 0, 0.2, 1] as const;

function MaterialBackground() {
  return (
    <div className="absolute inset-0 bg-surface-page transition-colors duration-normal" />
  );
}

function BrandReveal() {
  return (
    <motion.div
      className="relative flex h-[148px] w-[148px] items-center justify-center"
      initial={{ opacity: 0, scale: 0.965 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.82, ease: EASE_OUT }}
    >
      <motion.div className="relative flex items-center justify-center text-primary">
        <StudioMark animated size={116} />
      </motion.div>
    </motion.div>
  );
}

export const SplashScreen = () => {
  return (
    <motion.div
      className="fixed inset-0 z-modal flex items-center justify-center overflow-hidden transition-colors duration-normal"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: SPLASH_EXIT_DURATION_SECONDS, ease: EASE_STANDARD }}
    >
      <MaterialBackground />
      <div className="relative flex min-h-[180px] min-w-[260px] items-center justify-center">
        <BrandReveal />
      </div>
    </motion.div>
  );
};
