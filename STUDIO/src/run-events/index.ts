/**
 * Run-event display: the shared presentation layer for agent run events.
 *
 * This subsystem is deliberately authority-neutral. It renders tool calls,
 * steps, and approval requests for both cloud runs and Studio CLI sessions, and
 * it must not import transport, execution, or protocol code from either side.
 * Callers normalize their own events into these display shapes.
 *
 * Extracted from the legacy `src/runtime/ui` in R3. See
 * `documentation/version 2 rehabilitation/06-studio-cli-contract.md`.
 */

export { toolLabel, getToolIcon } from "./components/toolCardUtils";
export { classifyToolDisplay } from "./classify/classifyToolDisplay";
export { ToolPermissionCard } from "./components/ToolPermissionCard";
export { RuntimeStepCard } from "./components/RuntimeStepCard";
export { InlineToolSteps } from "./components/InlineToolSteps";
