import { useState, useCallback } from "react";
import { Button } from "@/ui/primitives/Button";

interface VideoPlayerProps {
  videoUrl: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  mode?: string;
}

export function VideoPlayer({ videoUrl, aspectRatio, duration, resolution, mode }: VideoPlayerProps) {
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = useCallback(async () => {
    try {
      const res  = await fetch(videoUrl);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `studio_video_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    } catch {
      window.open(videoUrl, "_blank");
    }
  }, [videoUrl]);

  // Convert "16:9" → "16/9" for CSS aspect-ratio property
  const cssAspectRatio = (aspectRatio ?? "16:9").replace(":", "/");

  return (
    <div className="rounded-2xl overflow-hidden bg-black w-full max-w-2xl">
      <video
        src={videoUrl}
        controls
        className="w-full block"
        style={{ aspectRatio: cssAspectRatio, maxHeight: "480px", objectFit: "contain" }}
      />
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900/80">
        <span className="text-xs text-gray-400 tabular-nums">
          {[mode, resolution, duration ? `${duration}s` : null, aspectRatio]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <Button
          variant="ghost"
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:!bg-white/20 !text-white text-xs font-medium transition-colors"
        >
          {downloaded ? (
            <>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Saved
            </>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal inline "still processing" state shown when jobId is returned
// ---------------------------------------------------------------------------

interface VideoProcessingProps {
  jobId: string;
  message?: string;
}

export function VideoProcessing({ jobId, message }: VideoProcessingProps) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-surface-raised max-w-2xl">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        Video rendering…
      </div>
      {message && (
        <p className="text-xs text-gray-400 dark:text-gray-500 leading-snug">{message}</p>
      )}
      <p className="text-2xs text-gray-400 dark:text-gray-600 font-mono">job: {jobId}</p>
    </div>
  );
}
