export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

/** Wraps raw PCM data in a RIFF/WAV container for browser playback. */
export function pcmToWav(
  pcm: Uint8Array,
  sampleRate: number,
  channels: number,
  bitDepth: number
): ArrayBuffer {
  const byteRate   = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const dataSize   = pcm.byteLength;
  const buffer     = new ArrayBuffer(44 + dataSize);
  const view       = new DataView(buffer);

  writeStr(view, 0,  "RIFF");
  view.setUint32(4,  36 + dataSize, true);
  writeStr(view, 8,  "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16,         true);
  view.setUint16(20, 1,          true); // PCM format
  view.setUint16(22, channels,   true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate,   true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth,   true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize,   true);
  new Uint8Array(buffer, 44).set(pcm);

  return buffer;
}

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
