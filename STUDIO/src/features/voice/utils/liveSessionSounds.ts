function ctx(): AudioContext | null {
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}

function tone(
  ac: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
  freqEnd?: number
) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + startAt);
  if (freqEnd !== undefined) {
    osc.frequency.linearRampToValueAtTime(freqEnd, ac.currentTime + startAt + duration);
  }
  gain.gain.setValueAtTime(0, ac.currentTime + startAt);
  gain.gain.linearRampToValueAtTime(volume, ac.currentTime + startAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + startAt + duration);
  osc.start(ac.currentTime + startAt);
  osc.stop(ac.currentTime + startAt + duration + 0.01);
}

export const liveSessionSounds = {
  connect() {
    const ac = ctx();
    if (!ac) return;
    // Ascending soft two-note chime — C5 → G5
    tone(ac, 523.25, 0,    0.18, 0.10);
    tone(ac, 783.99, 0.13, 0.22, 0.08);
    setTimeout(() => ac.close().catch(() => {}), 600);
  },

  disconnect() {
    const ac = ctx();
    if (!ac) return;
    // Descending single note — G4 slides to D4
    tone(ac, 392.0, 0, 0.28, 0.09, "sine", 293.66);
    setTimeout(() => ac.close().catch(() => {}), 500);
  },

  micMute() {
    const ac = ctx();
    if (!ac) return;
    // Low soft thud
    tone(ac, 220, 0, 0.07, 0.10, "sine");
    tone(ac, 110, 0, 0.07, 0.06, "sine");
    setTimeout(() => ac.close().catch(() => {}), 300);
  },

  micUnmute() {
    const ac = ctx();
    if (!ac) return;
    // Light bright tick
    tone(ac, 880, 0, 0.05, 0.07, "sine");
    setTimeout(() => ac.close().catch(() => {}), 300);
  },

  speakerMute() {
    const ac = ctx();
    if (!ac) return;
    // Slightly different low thud — tri wave for texture
    tone(ac, 260, 0,    0.06, 0.09, "triangle");
    tone(ac, 130, 0.02, 0.07, 0.05, "sine");
    setTimeout(() => ac.close().catch(() => {}), 300);
  },

  speakerUnmute() {
    const ac = ctx();
    if (!ac) return;
    // Slightly different light tick — higher frequency
    tone(ac, 1046.5, 0, 0.04, 0.06, "sine");
    setTimeout(() => ac.close().catch(() => {}), 300);
  },
};
