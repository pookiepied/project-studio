import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge does not know the custom type roles, so it treats them as
 * conflicting font-size classes and silently deletes them. Teaching it the
 * group is the reason fonts apply at all — this exact bug cost STUDIO three
 * attempts at "the fonts won't work".
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["micro", "caption", "ui", "body", "title", "display", "mono"] },
      ],
    },
  },
});

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
