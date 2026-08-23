/**
 * The Connections feature.
 *
 * It lives beside `panes/` rather than inside it because `panes/` is a layout
 * concern -- the frame every settings section is drawn in -- and this is a
 * feature with data loading, two dialogs and a wire vocabulary of its own.
 * `ProvidersPane` stays in `panes/` where the registry expects to find it, and
 * composes what is exported here.
 */

export { AddConnectionDialog } from './AddConnectionDialog'
export { CredentialBadge } from './CredentialBadge'
export { ProbeLine } from './ProbeLine'
export { RemoveConnectionDialog } from './RemoveConnectionDialog'
export { LANGUAGE_PROTOCOL_CHOICES, connectionIdFrom } from './draft'
export {
  connectToHarness,
  useConnections,
  type Connections,
  type ConnectionsView,
  type HarnessConnect,
  type ProbeState,
} from './useConnections'
