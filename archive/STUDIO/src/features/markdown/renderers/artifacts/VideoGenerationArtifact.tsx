import { motion } from "framer-motion";
import { Clock, Icon, Play, SparkleIcon, Success, VideoCameraIcon } from "@/ui/icons";
import type { Artifact, ArtifactTimelineItem } from "@/types/artifacts";
import { AnimatedItem, AnimatedList, ArtifactIconBubble, ArtifactShell, isArtifactWorking, ProcessingDots } from "./ArtifactMotion";

interface Props {
  artifact: Artifact;
}

type VideoOutput = {
  url?: string;
  videoUrl?: string;
  posterUrl?: string;
  label?: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
};

type VideoArtifactData = {
  prompt?: string;
  videoUrl?: string;
  posterUrl?: string;
  referenceImageUrl?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  model?: string;
  mode?: string;
  style?: string;
  outputs?: VideoOutput[];
};

function videoData(artifact: Artifact): VideoArtifactData {
  if (!artifact.data || typeof artifact.data !== "object") return {};
  return artifact.data as VideoArtifactData;
}

function isComplete(artifact: Artifact) {
  return artifact.status === "completed" || artifact.status === "success";
}

function statusCopy(artifact: Artifact) {
  if (isComplete(artifact)) {
    return { icon: <Success size="sm" className="text-secondary dark:text-disabled" />, label: "Video ready" };
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

function videoMeta(data: VideoArtifactData) {
  return [data.model, data.duration ? `${data.duration}s` : null, data.aspectRatio, data.resolution]
    .filter(Boolean)
    .join(" / ");
}

function cssAspectRatio(aspectRatio?: string) {
  return (aspectRatio ?? "16:9").replace(":", "/");
}

function VideoPlaceholder({ active, data }: { active: boolean; data: VideoArtifactData }) {
  return (
    <div
      className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(135deg,rgba(16,24,40,0.92),rgba(62,88,126,0.82)_45%,rgba(135,92,68,0.76))] dark:bg-[linear-gradient(135deg,rgba(9,12,18,0.96),rgba(38,55,83,0.84)_48%,rgba(83,57,45,0.72))]"
      style={{ aspectRatio: cssAspectRatio(data.aspectRatio) }}
    >
      {data.posterUrl && (
        <img
          src={data.posterUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-80"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.07)_1px,transparent_1px)] bg-[size:54px_54px] opacity-45" />
      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/35 to-transparent" />
      {active && (
        <motion.div
          className="absolute inset-0 bg-white/[0.05]"
          animate={{ opacity: [0.05, 0.16, 0.05] }}
          transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/18 shadow-sm ring-1 ring-white/20 backdrop-blur-md">
        <Play size="lg" weight="fill" className="translate-x-[1px] text-white/90" />
      </div>
      <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
          <motion.div
            className="h-full rounded-full bg-white/65"
            animate={active ? { width: ["14%", "62%", "14%"] } : { width: "34%" }}
            transition={{ duration: 2.6, repeat: active ? Infinity : 0, ease: "easeInOut" }}
          />
        </div>
        <span className="text-2xs font-medium text-white/75">
          {data.duration ? `${data.duration}s` : "Video"}
        </span>
      </div>
    </div>
  );
}

function VideoPreview({ artifact, data }: { artifact: Artifact; data: VideoArtifactData }) {
  const output = data.outputs?.find((item) => item.videoUrl || item.url);
  const videoUrl = data.videoUrl ?? output?.videoUrl ?? output?.url;
  const posterUrl = data.posterUrl ?? output?.posterUrl;
  const aspectRatio = data.aspectRatio ?? output?.aspectRatio;
  const complete = isComplete(artifact);

  if (complete && videoUrl) {
    return (
      <video
        src={videoUrl}
        poster={posterUrl}
        controls
        playsInline
        className="w-full rounded-2xl bg-black object-contain"
        style={{ aspectRatio: cssAspectRatio(aspectRatio), maxHeight: "480px" }}
      />
    );
  }

  return (
    <VideoPlaceholder
      active={artifact.status === "loading" || artifact.status === "streaming"}
      data={{ ...data, posterUrl, aspectRatio }}
    />
  );
}

export function VideoGenerationArtifact({ artifact }: Props) {
  const data = videoData(artifact);
  const status = statusCopy(artifact);
  const progress = progressItems(artifact);
  const working = isArtifactWorking(artifact.status);
  const meta = videoMeta(data);

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
            {status.label}{meta ? ` / ${meta}` : ""}
          </div>
          {artifact.summary && (
            <p className="mt-2 text-sm leading-relaxed text-secondary dark:text-disabled">
              {artifact.summary}
            </p>
          )}
        </div>
      </div>

      <motion.div
        className="mt-3 overflow-hidden rounded-2xl"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <VideoPreview artifact={artifact} data={data} />
      </motion.div>

      {data.referenceImageUrl && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-page/70 px-2.5 py-2 dark:bg-white/[0.04]">
          <img
            src={data.referenceImageUrl}
            alt=""
            className="h-10 w-14 flex-shrink-0 rounded-lg object-cover"
          />
          <div className="min-w-0">
            <div className="text-xs font-medium text-secondary dark:text-disabled">Reference frame</div>
            <div className="truncate text-2xs text-muted dark:text-muted">
              {data.mode ?? "Image-to-video"}
            </div>
          </div>
        </div>
      )}

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

      <div className="mt-3 flex items-center gap-1.5 text-2xs text-disabled dark:text-muted">
        <Icon icon={VideoCameraIcon} size="xs" />
        <span>Video generation / Studio</span>
      </div>
    </ArtifactShell>
  );
}
