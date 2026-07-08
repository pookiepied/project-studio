import { useState } from "react";
import { motion } from "framer-motion";

interface ImageWithFallbackProps {
  url: string;
  idx: number;
}

export const ImageWithFallback = ({ url, idx }: ImageWithFallbackProps) => {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-surface-raised rounded-xl">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-500">Image sent</span>
      </div>
    );
  }

  return (
    <motion.img
      src={url}
      alt={`Attached image ${idx + 1}`}
      className="max-w-[220px] max-h-[220px] rounded-2xl object-cover"
      onError={() => setHasError(true)}
    />
  );
};
