import { RecordingState } from "../../types";
import type { PulseCard } from "../../types/pulse";
import { overlayService, type IslandMode, type OverlayPayload } from "./overlayService";

type ActiveActivity = IslandMode;

class PulseCoordinator {
  private activity: ActiveActivity = "global";
  private lastOpacity = 70;

  async init(opacity: number = 70, isDark?: boolean): Promise<void> {
    this.lastOpacity = opacity;
    if (this.activity !== "global") return;
    await overlayService.init(opacity, isDark);
  }

  setEnabled(enabled: boolean): void {
    overlayService.setEnabled(enabled);
    if (!enabled) {
      this.activity = "global";
    }
  }

  async showGlobalIdle(opacity?: number): Promise<void> {
    this.activity = "global";
    await overlayService.returnToIdle(opacity ?? this.lastOpacity, "global");
  }

  async showVoice(payload: Omit<OverlayPayload, "mode">): Promise<void> {
    await this.showAs("voice", payload);
  }

  async endVoice(opacity?: number): Promise<void> {
    if (this.activity !== "voice") return;
    await this.showGlobalIdle(opacity);
  }

  async showTranscription(payload: Omit<OverlayPayload, "mode">): Promise<void> {
    await this.showAs("transcription", payload);
  }

  async endTranscription(opacity?: number): Promise<void> {
    if (this.activity !== "transcription") return;
    await this.showGlobalIdle(opacity);
  }

  async showArtifact(card: PulseCard): Promise<void> {
    if (!this.canPreempt("artifact")) return;
    this.activity = "artifact";
    await overlayService.showCard(card);
  }

  async clearArtifact(opacity?: number): Promise<void> {
    if (this.activity !== "artifact") return;
    await this.showGlobalIdle(opacity);
  }

  getActivity(): ActiveActivity {
    return this.activity;
  }

  private async showAs(activity: ActiveActivity, payload: Omit<OverlayPayload, "mode">): Promise<void> {
    if (!this.canShow(activity)) return;

    this.activity = activity;
    if (payload.opacity !== undefined) {
      this.lastOpacity = payload.opacity;
    }

    if (payload.state === RecordingState.IDLE) {
      await overlayService.returnToIdle(payload.opacity, activity);
      return;
    }

    await overlayService.show({ ...payload, mode: activity });
  }

  private canPreempt(next: ActiveActivity): boolean {
    return this.canShow(next);
  }

  private canShow(next: ActiveActivity): boolean {
    if (next === this.activity) return true;
    if (this.activity === "global") return true;
    if (next === "global") return true;

    // Voice and transcription are mutually exclusive activities. Artifacts
    // should not steal the island while either microphone flow is active.
    if (this.activity === "voice" || this.activity === "transcription") return false;

    // Artifact is a passive result layer. A new voice/transcription activity can
    // replace it, but another artifact can only update the current artifact.
    return this.activity === "artifact" && next !== "artifact";
  }
}

export const pulseCoordinator = new PulseCoordinator();
