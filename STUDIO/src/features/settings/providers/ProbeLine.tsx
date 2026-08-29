import type { ProbeState } from './useProviders'

/**
 * What the last probe found, in one line under the connection.
 *
 * ---- Why the wording is careful -------------------------------------------
 *
 * A probe answers three different questions and the contract keeps them apart,
 * so this does too. `ok` is whether the endpoint answered acceptably.
 * `modelCount` is present only when the endpoint could actually enumerate -
 * absent is "we could not tell", which is not zero, and rendering "0 models"
 * for it would be inventing a fact. `status` is absent when the attempt never
 * produced an HTTP response at all (a refused connection, a DNS failure), and
 * `latencyMs` is absent when the request never left the process because there
 * was no address to send it to.
 *
 * So every field is rendered only when it is there, and nothing is defaulted.
 *
 * A transport failure - the harness itself unreachable - is a different thing
 * from a probe that ran and failed, and says so: one is "Studio could not
 * ask", the other is "we asked and the provider said no".
 */
export function ProbeLine({ state }: { state: ProbeState }) {
  if (state.status === 'probing') {
    return <span className="text-caption text-muted-foreground">Checking the endpoint...</span>
  }

  if (state.status === 'failed') {
    return (
      <span className="text-caption text-muted-foreground">
        Could not run the check. {state.error.message}
      </span>
    )
  }

  const { ok, modelCount, failure, status, latencyMs } = state.result

  if (!ok) {
    // `failure` is the harness's own sentence, written for a person reading a
    // settings screen. Anything this component wrote instead would be vaguer.
    const detail = failure ?? 'The endpoint did not answer acceptably.'
    return (
      <span className="text-caption text-danger">
        {detail}
        {status === undefined ? null : ` (HTTP ${status})`}
      </span>
    )
  }

  const parts = [
    latencyMs === undefined ? 'Reachable' : `Reachable in ${Math.round(latencyMs)} ms`,
    modelCount === undefined ? null : `${modelCount} ${modelCount === 1 ? 'model' : 'models'} listed`,
  ].filter((part) => part !== null)

  return <span className="text-caption text-muted-foreground">{parts.join(' - ')}</span>
}
