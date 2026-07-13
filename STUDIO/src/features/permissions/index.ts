/**
 * Permission UI feature.
 *
 * Houses the user-facing surfaces that frame review-mode approval prompts and
 * OS notifications. The actual enforcement logic lives in `src/permissions`
 * (the engine); this feature only renders its decisions and feeds user input
 * back through `useChat().resolveToolApproval`.
 *
 * Public surface:
 *   - {@link ComposerApprovalCard}   - slide-in card above the composer
 *   - {@link LocalCapabilitiesModal} - one-time local capability gate
 *   - {@link PermissionLayerHost}     - global host for approval surfaces
 *
 * Why a separate feature (rather than permissions/) - the engine module stays
 * free of React + UI deps, importable from anywhere; the feature folder owns
 * the React components / hooks. This gives the app a single NPM-importable
 * entry point for everything permission-UI.
 */

export { ComposerApprovalCard } from "./components/ComposerApprovalCard";
export { LocalCapabilitiesModal } from "./components/LocalCapabilitiesModal";
export { PermissionLayerHost } from "./PermissionLayerHost";
