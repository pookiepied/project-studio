/**
 * What the supervisor's start failure means, in the app's own voice.
 *
 * ---- Why this exists -------------------------------------------------------
 *
 * The supervisor's sentences are written for whoever is holding the repository:
 * they name `dist/server.mjs`, they say `pnpm build`, they carry a Windows exit
 * status and a slab of the child's stderr. That is exactly right in a log, and
 * exactly wrong as the first thing a person reads. A build command is not a
 * remedy for someone who installed Studio; it is a sentence that tells them the
 * program is broken in a language that is not theirs.
 *
 * So the raw text stops being the headline and becomes the evidence. This
 * module is the translation between them: it reads the sentence the supervisor
 * kept, decides which of a small number of things actually went wrong, and
 * answers with a headline and a remedy that were written here, deliberately, in
 * advance. The raw sentence is not discarded and never paraphrased -- it sits
 * one disclosure away, verbatim, because "what did it actually say" is the
 * second question everyone asks and the answer has to be the real one.
 *
 * ---- Why not `classifyFailureKind` -----------------------------------------
 *
 * That classifier reads a model provider's settlement -- quota, throttling,
 * billing. Nothing it knows is true of a process that would not start, and
 * teaching it both vocabularies would give one function two unrelated jobs and
 * a set of wordings that could collide. Different domain, different module.
 *
 * ---- The honesty rule ------------------------------------------------------
 *
 * Every kind here is anchored to a string the supervisor actually produces, and
 * the anchors are listed beside each one. `unknown` is a real answer rather than
 * a gap: an unrecognised failure gets the plain heading and no remedy, because
 * inventing advice for a cause nobody identified is worse than admitting the
 * cause is unidentified. When a kind stops matching -- someone rewords a message
 * in `supervisor.rs` -- the failure mode is that a real error falls back to
 * `unknown` and shows its own words. It under-states. It never misleads.
 */

export type HarnessFailureKind =
  | 'not-installed'
  | 'node-missing'
  | 'crashed'
  | 'timed-out'
  | 'bad-handshake'
  | 'blocked'
  | 'busy'
  | 'unknown'

export interface HarnessFailureCopy {
  readonly kind: HarnessFailureKind
  /**
   * A short stable name for this failure.
   *
   * The thing a person can search for, quote in a report, or read out loud --
   * none of which the prose is any good for, because prose is written to be
   * reassuring and a report needs to be exact. It is stable across rewordings
   * of the headline on purpose: the sentence is for reading and the code is
   * for referring to, and those two jobs pull in opposite directions.
   */
  readonly code: string
  /** The heading. Short: it is set in the display serif. */
  readonly headline: string
  /** What to do about it, or null when nothing honest can be said. */
  readonly remedy: string | null
}

/**
 * Anchors, in the order they are tested.
 *
 * Order matters in one place and only one: `not-installed` is checked before
 * `node-missing`, because the spawn failure names a path and the missing-server
 * message names a file, and a machine with neither should be told about the
 * program before it is told about the runtime.
 *
 * Matching is case-insensitive on a substring rather than a regular expression.
 * These are fixed sentences from one file in this repository, not user input,
 * and a substring is the thing that survives someone appending detail to the
 * end of a message -- which is how every one of them is already built.
 */
const ANCHORS: readonly (readonly [HarnessFailureKind, readonly string[]])[] = [
  // supervisor.rs: "Harness server not found. Run `pnpm build` ..."
  ['not-installed', ['harness server not found']],
  // supervisor.rs: "failed to spawn node harness: {e} (path=...)"
  ['node-missing', ['failed to spawn node harness']],
  // supervisor.rs: "Harness exited before readiness (status=...)"
  //                "Harness readiness stream closed without a frame."
  ['crashed', ['exited before readiness', 'readiness stream closed']],
  // supervisor.rs: "Harness did not publish loopback readiness within {}ms."
  ['timed-out', ['did not publish loopback readiness']],
  // supervisor.rs: "Harness readiness malformed: ..." / "invalid readiness frame"
  //                "harness readiness host must be 127.0.0.1, got ..."
  ['bad-handshake', ['readiness malformed', 'invalid readiness frame', 'readiness host must be']],
  // supervisor.rs: "failed to create job object" / "failed to assign harness to job object"
  ['blocked', ['job object']],
  // supervisor.rs: "a harness start is in flight and did not settle"
  ['busy', ['start is in flight']],
]

export function classifyHarnessFailure(reason: string | null): HarnessFailureKind {
  if (reason === null || reason.trim() === '') return 'unknown'
  const lowered = reason.toLowerCase()
  for (const [kind, wordings] of ANCHORS) {
    if (wordings.some((wording) => lowered.includes(wording))) return kind
  }
  return 'unknown'
}

/**
 * The two sentences a person reads.
 *
 * Written for someone who installed Studio and does not know what a harness is,
 * which is why every remedy names an action available to them. Where the honest
 * action is "tell whoever maintains this", the details disclosure below carries
 * what they would need to send, and the remedy points at it rather than
 * pretending there is a switch to flip.
 */
export function describeHarnessFailure(reason: string | null): HarnessFailureCopy {
  const kind = classifyHarnessFailure(reason)
  switch (kind) {
    case 'not-installed':
      return {
        kind,
        code: 'HARNESS_NOT_FOUND',
        headline: 'The harness was not found.',
        // Deliberately not a flat "reinstall Studio". Studio ships the harness
        // inside itself, so an installed copy that cannot find it is
        // incomplete -- but the same message is what a development tree
        // produces before the harness has been built, and that reader cannot
        // act on reinstall advice. Naming the path covers both.
        remedy:
          'Studio could not find the harness at the path it expects. Reinstall Studio to ' +
          'restore it. The details show the path that was searched.',
      }
    case 'node-missing':
      return {
        kind,
        code: 'HARNESS_NODE_MISSING',
        headline: 'Node.js could not be started.',
        remedy:
          'The harness requires Node.js. It is either not installed or not on the system ' +
          'PATH. The details show the command that failed.',
      }
    case 'crashed':
      return {
        kind,
        code: 'HARNESS_EXITED',
        headline: 'The harness exited during startup.',
        remedy:
          'The harness process started and then stopped before it was ready. The details ' +
          'contain its exit status and its output.',
      }
    case 'timed-out':
      return {
        kind,
        code: 'HARNESS_TIMEOUT',
        headline: 'The harness did not become ready.',
        // The timeout is not repeated here. It is a constant in supervisor.rs
        // and the raw text already states the elapsed value, so naming a
        // number in this file is one more place for it to go stale.
        remedy:
          'The harness started but did not report readiness before the startup timeout. ' +
          'Start it again. If this repeats, check whether a firewall is blocking local ' +
          'connections.',
      }
    case 'bad-handshake':
      return {
        kind,
        code: 'HARNESS_BAD_HANDSHAKE',
        headline: 'The harness sent an invalid startup message.',
        remedy:
          'The harness started, but the message it sent on startup could not be read. ' +
          'This usually means Studio and the harness are different versions.',
      }
    case 'blocked':
      return {
        kind,
        code: 'HARNESS_CONTAINMENT_REFUSED',
        headline: 'The harness could not be contained.',
        remedy:
          'The operating system refused to place the harness in a job object, which Studio ' +
          'requires so that tool processes cannot outlive it. Restart the machine and try ' +
          'again.',
      }
    case 'busy':
      return {
        kind,
        code: 'HARNESS_BUSY',
        headline: 'A harness start is already running.',
        remedy: 'Wait for the current start to finish.',
      }
    case 'unknown':
      // No remedy on purpose. There is nothing accurate to say about a cause
      // that was not identified, and the details carry the raw text.
      return {
        kind,
        code: 'HARNESS_UNKNOWN',
        headline: 'The harness is not running.',
        remedy: null,
      }
  }
}
