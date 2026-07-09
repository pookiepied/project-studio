export function sampleAudioLevels(analyser: AnalyserNode, barCount = 5): number[] {
  const binCount = analyser.frequencyBinCount;
  const data = new Uint8Array(binCount);
  analyser.getByteFrequencyData(data);

  const usefulBins = Math.min(Math.floor(binCount / 2), 256);
  const bandSize = Math.max(1, Math.floor(usefulBins / barCount));

  return Array.from({ length: barCount }, (_, i) => {
    const start = i * bandSize;
    let sum = 0;
    for (let j = start; j < start + bandSize && j < data.length; j++) {
      sum += data[j];
    }

    const avg = sum / bandSize;
    return Math.min(1, Math.max(0.08, (avg - 4) / 72));
  });
}
