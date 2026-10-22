/**
 * Studio's voice, played where the browser's echo canceller can hear it.
 *
 * Voice mode asks for echo cancellation, and the canceller works by
 * subtracting from the microphone what it knows is being played. What it
 * knows is call audio: the far end of a WebRTC connection. A reply played
 * straight from an `AudioContext` is not that on most browsers, so on a
 * loudspeaker the canceller had nothing to subtract and Studio heard itself
 * (`echo.ts` has the rest of that story).
 *
 * So the reply is made into call audio, inside the page: the context's
 * output is sent from one `RTCPeerConnection` to a second one on the same
 * page and played from the far end's track. Nothing leaves the device - the
 * two connections only ever offer each other host candidates - and the cost
 * is an Opus encode and decode, a few tens of milliseconds, which voice can
 * spare.
 *
 * Every step can fail (no WebRTC, a policy refusing playback, a connection
 * that never forms), and every failure is `null`: the caller plays the
 * reply directly, as before. Worse echo handling is a degraded feature; a
 * reply that never sounds is a broken one.
 */

export interface EchoReference {
  /** Where the reply goes instead of the context's destination. */
  readonly input: AudioNode
  close(): void
}

/** How long the connection is given to form before the reply plays directly. */
const SETUP_MS = 1_500

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timed out')), ms)
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value) },
      (error: unknown) => { window.clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

function connected(peer: RTCPeerConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (peer.connectionState === 'connected') resolve()
      else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') reject(new Error(peer.connectionState))
    }
    peer.addEventListener('connectionstatechange', check)
    check()
  })
}

export async function openEchoReference(context: AudioContext): Promise<EchoReference | null> {
  if (typeof RTCPeerConnection === 'undefined' || typeof context.createMediaStreamDestination !== 'function') return null
  const destination = context.createMediaStreamDestination()
  const sender = new RTCPeerConnection()
  const receiver = new RTCPeerConnection()
  const element = new Audio()
  const close = () => {
    sender.close()
    receiver.close()
    element.pause()
    element.srcObject = null
  }
  try {
    sender.onicecandidate = (event) => { if (event.candidate) void receiver.addIceCandidate(event.candidate).catch(() => {}) }
    receiver.onicecandidate = (event) => { if (event.candidate) void sender.addIceCandidate(event.candidate).catch(() => {}) }
    const track = new Promise<MediaStreamTrack>((resolve) => {
      receiver.ontrack = (event) => resolve(event.track)
    })
    for (const outgoing of destination.stream.getAudioTracks()) sender.addTrack(outgoing, destination.stream)

    await within((async () => {
      const offer = await sender.createOffer()
      await sender.setLocalDescription(offer)
      await receiver.setRemoteDescription(offer)
      const answer = await receiver.createAnswer()
      await receiver.setLocalDescription(answer)
      await sender.setRemoteDescription(answer)
      element.srcObject = new MediaStream([await track])
      await connected(sender)
      await element.play()
    })(), SETUP_MS)
    return { input: destination, close }
  } catch {
    close()
    return null
  }
}
