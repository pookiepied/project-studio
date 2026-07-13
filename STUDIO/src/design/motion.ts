import { type Variants, type Transition } from "framer-motion";

export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const fadeTransition: Transition = {
  duration: 0.15,
};

export const scaleFadeVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: -10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: -10 },
};

export const scaleFadeTransition: Transition = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
};

export const slideUpVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
};

export const slideUpTransition: Transition = {
  duration: 0.2,
  ease: [0.4, 0.0, 0.2, 1],
};

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const pageTransition: Transition = {
  duration: 0.2,
  ease: [0.4, 0.0, 0.2, 1],
};

export const chevronRotateTransition: Transition = {
  duration: 0.18,
};
