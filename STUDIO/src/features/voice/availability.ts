/**
 * Whether voice input can work where this page runs.
 *
 * Microphone access is a secure-context capability, and there is no way
 * around it over plain HTTP (plan §3.7): the browser refuses `getUserMedia`
 * before a permission is ever asked. The desktop webview and `localhost` are
 * secure contexts, so voice is always available there; a phone reading Studio
 * over the LAN is on plain `http://`, and there the controls hide themselves
 * with a line saying why, instead of buttons that refuse the moment they are
 * pressed.
 *
 * Read per call rather than once at import, like every other
 * browser-capability read in this app: what is true at module load is not
 * guaranteed to be what is true when the composer renders.
 */
export function voiceInputAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true
}

/** The line that stands where the hidden controls would be. */
export const VOICE_UNAVAILABLE_REASON = 'Voice input needs a secure connection to Studio.'
