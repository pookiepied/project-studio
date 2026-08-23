import type { CredentialStatus } from '@/platform/harness'
import { cn } from '@/lib/cn'

/**
 * Whether a connection has a key, as three words and a dot.
 *
 * The harness's `CredentialStatus` is a closed three-value picklist and all
 * three are drawn here, because the one it never returns is the interesting
 * one: there is no "the key is X". A connection record cannot carry a key in
 * either direction, so the most this badge can ever say is that one exists.
 *
 * Deliberately not built as a general Badge primitive. The app has exactly one
 * badge, and a primitive extracted from a single use is a guess about the
 * second one; when a second arrives, this is small enough to lift.
 *
 * ---- Colour ---------------------------------------------------------------
 *
 * None of the three is red. The app's only hue outside the voice tokens is
 * `--danger`, reserved for things that lose data, and a connection without a
 * key is not a failure -- it is a connection to an endpoint that does not want
 * one, or one that reads its key from the environment. Weight carries the
 * distinction instead: a filled dot for a key that exists, a hollow one for
 * none.
 */
const LABEL: Record<CredentialStatus, string> = {
  // The OS credential store holds one, put there by a create or an update.
  set: 'Key stored',
  // The harness process inherited one from its environment. Worth naming
  // separately from `set`: nothing in this app put it there, and nothing in
  // this app can remove it -- deleting the connection will not.
  'from-env': 'Key from environment',
  // Nothing was found. Fine for a local endpoint, fatal for a hosted one, and
  // the probe is what tells the two apart.
  absent: 'No key',
}

export function CredentialBadge({ status }: { status: CredentialStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          status === 'absent'
            ? 'border border-muted-foreground/50 bg-transparent'
            : 'bg-foreground/55',
        )}
      />
      {LABEL[status]}
    </span>
  )
}
