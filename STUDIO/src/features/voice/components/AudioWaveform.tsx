/**
 * AudioWaveform — real-time frequency bar visualization for microphone input.
 * Reads directly from a Web Audio AnalyserNode via RAF for zero-state-update
 * performance. Bars collapse to minimum height when not recording.
 */

import { useEffect, useRef, type RefObject } from "react";

interface AudioWaveformProps {
  analyserRef: RefObject<AnalyserNode | null>;
  isRecording: boolean;
  barCount?: number;
  barWidthPx?: number;
  gapPx?: number;
  maxHeightPx?: number;
  minHeightPx?: number;
  /** Tailwind color class, e.g. "bg-gray-400" */
  colorClass?: string;
  className?: string;
}

export function AudioWaveform({
  analyserRef,
  isRecording,
  barCount = 5,
  barWidthPx = 3,
  gapPx = 3,
  maxHeightPx = 18,
  minHeightPx = 2,
  colorClass = "bg-gray-400",
  className = "",
}: AudioWaveformProps) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!isRecording) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Collapse bars to idle state
      barsRef.current.forEach((bar) => {
        if (bar) bar.style.height = `${minHeightPx}px`;
      });
      return;
    }

    function tick() {
      const analyser = analyserRef.current;

      if (!analyser) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const binCount = analyser.frequencyBinCount;
      if (!dataRef.current || dataRef.current.length !== binCount) {
        dataRef.current = new Uint8Array(binCount);
      }

      analyser.getByteFrequencyData(dataRef.current);
      const data = dataRef.current;

      // Focus on the lower half of bins — covers speech frequencies best
      const usefulBins = Math.min(Math.floor(binCount / 2), 256);
      const bandSize = Math.max(1, Math.floor(usefulBins / barCount));
      const range = maxHeightPx - minHeightPx;

      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const start = i * bandSize;
        let sum = 0;
        for (let j = start; j < start + bandSize; j++) {
          sum += data[j];
        }
        const avg = sum / bandSize; // 0–255
        const height = minHeightPx + (avg / 255) * range;
        bar.style.height = `${Math.round(height)}px`;
      });

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isRecording, analyserRef, barCount, maxHeightPx, minHeightPx]);

  const totalWidth = barCount * barWidthPx + (barCount - 1) * gapPx;

  return (
    <div
      className={`flex items-center ${className}`}
      style={{ width: totalWidth, gap: gapPx }}
    >
      {Array.from({ length: barCount }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className={`rounded-full ${colorClass}`}
          style={{
            width: barWidthPx,
            height: minHeightPx,
            transition: "height 60ms ease-out",
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}
