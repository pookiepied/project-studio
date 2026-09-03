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
        headline: 'The harness could not be found.',
        // Deliberately not "reinstall Studio". Studio ships the harness inside
        // itself, so a copy that cannot find it is a copy that is incomplete --
        // but the same message is what a development tree produces before the
        // harness has ever been built, and telling that reader to reinstall is
        // advice they cannot act on and would not need. Naming the condition
        // and pointing at the path is true in both cases; the details say which
        // one this is, because they carry the path that was searched.
        remedy:
          'Studio ships with the harness, so this usually means the installation is ' +
          'incomplete. The details name the path it looked in.',
      }
    case 'node-missing':
      return {
        kind,
        code: 'HARNESS_NODE_MISSING',
        headline: 'Node.js could not be started.',
        remedy:
          'The harness runs on Node.js, and Studio could not launch it. It is either ' +
          'not installed, or not on the PATH this machine searches.',
      }
    case 'crashed':
      return {
        kind,
        code: 'HARNESS_EXITED',
        headline: 'The harness stopped while starting.',
        remedy:
          'It began and then exited before it was ready. Its last output is in the ' +
          'details, and that is the part worth sending on.',
      }
    case 'timed-out':
      return {
        kind,
        code: 'HARNESS_TIMEOUT',
        headline: 'The harness did not finish starting.',
        remedy:
          'It began but never reported itself ready. A slow machine or a firewall ' +
          'holding the local connection can do this, and trying again often clears it.',
      }
    case 'bad-handshake':
      return {
        kind,
        code: 'HARNESS_BAD_HANDSHAKE',
        headline: 'The harness answered unexpectedly.',
        remedy:
          'It started, but what it said on the way up was not something this version ' +
          'of Studio recognises. That usually means the two are different versions.',
      }
    case 'blocked':
      return {
        kind,
        code: 'HARNESS_CONTAINMENT_REFUSED',
        headline: 'The system refused to contain the harness.',
        remedy:
          'Studio confines the harness and the tools it runs so nothing outlives it, ' +
          'and the operating system declined. Restarting the machine usually clears it.',
      }
    case 'busy':
      return {
        kind,
        code: 'HARNESS_BUSY',
        headline: 'The harness is already starting.',
        remedy: 'A start is in flight. Give it a moment before trying again.',
      }
    case 'unknown':
      // No remedy on purpose. There is nothing true to say about a cause
      // nobody identified, and the details carry its own words.
      return {
        kind,
        code: 'HARNESS_UNKNOWN',
        headline: 'The harness is not running.',
        remedy: null,
      }
  }
}
