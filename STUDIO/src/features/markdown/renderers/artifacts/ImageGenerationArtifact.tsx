import { motion } from "framer-motion";
import { Clock, Icon, ImageSquareIcon, SparkleIcon, Success } from "@/ui/icons";
import type { Artifact, ArtifactTimelineItem } from "@/types/artifacts";
import { AnimatedItem, AnimatedList, ArtifactIconBubble, ArtifactShell, isArtifactWorking, ProcessingDots } from "./ArtifactMotion";

interface Props {
  artifact: Artifact;
}

type ImageArtifactData = {
  prompt?: string;
  imageUrl?: string;
  aspectRatio?: string;
  model?: string;
  style?: string;
};

function imageData(artifact: Artifact): ImageArtifactData {
  if (!artifact.data || typeof artifact.data !== "object") return {};
  return artifact.data as ImageArtifactData;
}

function statusCopy(artifact: Artifact) {
  if (artifact.status === "completed" || artifact.status === "success") {
    return { icon: <Success size="sm" className="text-secondary dark:text-disabled" />, label: "Image ready" };
  }
  if (artifact.status === "loading" || artifact.status === "streaming") {
    return { icon: <Icon icon={SparkleIcon} size="sm" className="text-secondary dark:text-disabled" />, label: "Generating" };
  }
  return { icon: <Clock size="sm" className="text-secondary dark:text-disabled" />, label: "Queued" };
}

function progressItems(artifact: Artifact): ArtifactTimelineItem[] {
  const timeline = artifact.sections?.find((section) => section.type === "timeline");
  return timeline?.type === "timeline" ? timeline.items : [];
}

function statusDot(status: ArtifactTimelineItem["status"]) {
  if (status === "completed" || status === "success") return "bg-secondary";
  if (status === "streaming" || status === "loading") return "bg-primary animate-pulse";
  if (status === "failed" || status === "error") return "bg-secondary";
  return "bg-surface-selected dark:bg-surface-border";
}

function ImagePlaceholder({ active }: { active: boolean }) {
  return (
    <div className="relative flex aspect-[4/3] min-h-[220px] items-center justify-center overflow-hidden rounded-[18px] bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.92),transparent_28%),linear-gradient(135deg,rgba(116,152,255,0.42),rgba(255,174,118,0.34)_48%,rgba(95,207,172,0.34))] dark:bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.14),transparent_28%),linear-gradient(135deg,rgba(116,152,255,0.28),rgba(255,174,118,0.18)_48%,rgba(95,207,172,0.2))]">
      <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.28),transparent)] opacity-60" />
      {active && (
        <motion.div
          className="absolute inset-0 bg-white/10 dark:bg-white/[0.035]"
          animate={{ opacity: [0.08, 0.18, 0.08] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/55 shadow-sm backdrop-blur-md dark:bg-white/[0.08]">
        <Icon icon={ImageSquareIcon} size="lg" className="text-secondary dark:text-disabled" />
      </div>
    </div>
  );
}

export function ImageGenerationArtifact({ artifact }: Props) {
  const data = imageData(artifact);
  const status = statusCopy(artifact);
  const progress = progressItems(artifact);
  const isComplete = artifact.status === "completed" || artifact.status === "success";
  const working = isArtifactWorking(artifact.status);

  return (
    <ArtifactShell working={working}>
      <div className="flex items-start gap-3">
        <ArtifactIconBubble working={working}>
          {status.icon}
        </ArtifactIconBubble>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-primary dark:text-primary">
            {artifact.title}
          </div>
          <div className="mt-0.5 text-2xs text-disabled dark:text-muted">
            {status.label}{data.model ? ` / ${data.model}` : ""}{data.aspectRatio ? ` / ${data.aspectRatio}` : ""}
          </div>
          {artifact.summary && (
            <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
              {artifact.summary}
            </p>
          )}
        </div>
      </div>

      <motion.div
        className="mt-3 overflow-hidden rounded-[18px]"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        {isComplete && data.imageUrl ? (
          <img
            src={data.imageUrl}
            alt={artifact.title}
            className="aspect-[4/3] w-full object-cover"
          />
        ) : (
          <ImagePlaceholder active={artifact.status === "loading" || artifact.status === "streaming"} />
        )}
      </motion.div>

      {data.prompt && (
        <p className="mt-3 text-xs leading-relaxed text-muted dark:text-disabled">
          <span className="font-medium text-secondary dark:text-primary">Prompt: </span>
          {data.prompt}
        </p>
      )}

      {progress.length > 0 && (
        <AnimatedList className="mt-3 space-y-1.5">
          {progress.map((item, index) => (
            <AnimatedItem key={`${item.label}-${index}`} className="flex items-start gap-2.5">
              <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${statusDot(item.status)}`} />
              <div className="min-w-0 text-xs text-secondary dark:text-disabled">
                {item.label}
                {(item.status === "loading" || item.status === "streaming") && <span className="ml-1"><ProcessingDots /></span>}
              </div>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}

      <div className="mt-3 text-2xs text-disabled dark:text-muted">
        Image generation / Studio
      </div>
    </ArtifactShell>
  );
}
