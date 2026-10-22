import { useEffect } from 'react'

/**
 * Keeps the screen on while `active`.
 *
 * Voice mode is a conversation held at arm's length: on a phone the screen
 * dimming and locking mid-reply ends the call, because a locked page loses
 * its microphone. The Screen Wake Lock API asks for the screen to stay on
 * while the page is visible - Chrome and Edge everywhere, Safari from iOS
 * 16.4 - and needs a secure context, which is also what voice needs.
 *
 * The platform drops the lock whenever the page is hidden (another app, the
 * tab switched), so it is asked for again each time the page is shown. A
 * browser without the API, or one that refuses (battery saver), leaves the
 * screen to its own settings: voice works the same, it just may dim.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let ended = false

    const acquire = () => {
      if (ended || document.visibilityState !== 'visible' || (lock !== null && !lock.released)) return
      navigator.wakeLock.request('screen').then(
        (granted) => {
          if (ended) void granted.release()
          else lock = granted
        },
        () => {},
      )
    }

    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      ended = true
      document.removeEventListener('visibilitychange', acquire)
      if (lock !== null && !lock.released) void lock.release().catch(() => {})
    }
  }, [active])
}
