import { RecordingState } from "@/types";
import type { IslandMode, OverlayPayload } from "./overlayService";

type IslandViewKind =
  | "hidden"
  | "idle"
  | "idleExpanded"
  | "recording"
  | "processing"
  | "completeCard"
  | "completeTranscription"
  | "completeVoice"
  | "error";

export interface IslandViewState {
  kind: IslandViewKind;
  mode: IslandMode;
  state: RecordingState;
  isIdle: boolean;
  isVoice: boolean;
  isComplete: boolean;
  isExpandedIdle: boolean;
}

export interface IslandWindowSize {
  width: number;
  height: number;
}

export interface IslandVisualSize {
  width: number;
  height: number;
}

const SHADOW_PAD = 16;

export function deriveIslandViewState(
  payload: OverlayPayload,
  idleExpanded = false
): IslandViewState {
  const mode = payload.mode ?? "global";
  const isIdle = payload.state === RecordingState.IDLE;
  const isVoice = mode === "voice";
  const isComplete = payload.state === RecordingState.COMPLETE;
  const hasVoiceResponse = isVoice && !!payload.aiText?.trim();

  let kind: IslandViewKind;

  if (isIdle && payload.opacity === 0) {
    kind = "hidden";
  } else if (isIdle && idleExpanded) {
    kind = "idleExpanded";
  } else if (isIdle) {
    kind = "idle";
  } else if (payload.state === RecordingState.RECORDING) {
    kind = "recording";
  } else if (payload.state === RecordingState.ERROR) {
    kind = "error";
  } else if (isComplete && payload.card) {
    kind = "completeCard";
  } else if (isComplete && isVoice && hasVoiceResponse) {
    kind = "completeVoice";
  } else if (isComplete) {
    kind = isVoice ? "processing" : "completeTranscription";
  } else {
    kind = "processing";
  }

  return {
    kind,
    mode,
    state: payload.state,
    isIdle,
    isVoice,
    isComplete,
    isExpandedIdle: kind === "idleExpanded",
  };
}

export function getIslandWindowSize(view: IslandViewState): IslandWindowSize {
  const visual = getIslandVisualSize(view);

  if (view.kind === "hidden") {
    return { width: 1, height: 1 };
  }

  return {
    width: visual.width,
    height: visual.height + SHADOW_PAD,
  };
}

export function getIslandVisualSize(view: IslandViewState): IslandVisualSize {
  switch (view.kind) {
    case "hidden":
      return { width: 58, height: 28 };
    case "idle":
      return { width: 58, height: 28 };
    case "idleExpanded":
      return { width: 154, height: 38 };
    case "recording":
      return view.isVoice ? { width: 188, height: 46 } : { width: 176, height: 46 };
    case "completeCard":
      return { width: 430, height: 46 };
    case "completeVoice":
      return { width: 360, height: 46 };
    case "completeTranscription":
      return { width: 390, height: 40 };
    case "error":
      return { width: 250, height: 46 };
    case "processing":
    default:
      return view.isVoice ? { width: 154, height: 42 } : { width: 186, height: 46 };
  }
}
