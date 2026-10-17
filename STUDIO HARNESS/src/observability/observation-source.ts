import { diagnosticIndexedContent, diagnosticProjectedContent } from "./diagnostic-value.js";
import { RUNTIME_CONTENT_FIELDS } from "./content-fields.js";
import { diagnosticRecorder } from "./recorder.js";
import { invocationFor, observeInvocationAdmission } from "./invocations.js";
import { currentExecutionContext } from "../execution/context.js";

interface SnapshotCapture {
  remaining: number;
  register(value: object, keys: readonly PropertyKey[]): void;
}
export interface ObservationSourceBridge {
  capture(event: object): SnapshotCapture | undefined;
  admission?(agentName: string, instanceId: string, submissionId: string, deduplicated: boolean): void;
}
interface SourceGlobal { __projectStudioObservationSource?: ObservationSourceBridge | undefined }
const sourceGlobal: typeof globalThis & SourceGlobal = globalThis;
const snapshotKeys = new WeakMap<object, readonly PropertyKey[]>();

const bridge: ObservationSourceBridge = {
  admission(agentName, instanceId, submissionId, deduplicated) {
    observeInvocationAdmission(agentName, instanceId, submissionId, deduplicated, currentExecutionContext());
  },
  capture(event) {
    if (!diagnosticRecorder.enabled) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(event, "instanceId");
    const instanceId: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
    const agent = Object.getOwnPropertyDescriptor(event, "agentName");
    const submission = Object.getOwnPropertyDescriptor(event, "submissionId");
    const agentName: unknown = agent && "value" in agent ? agent.value : undefined;
    const submissionId: unknown = submission && "value" in submission ? submission.value : undefined;
    const invocation = invocationFor(typeof agentName === "string" ? agentName : undefined,
      typeof instanceId === "string" ? instanceId : undefined, typeof submissionId === "string" ? submissionId : undefined);
    const conversationId = invocation === undefined ? instanceId : invocation.conversationId;
    if (typeof conversationId !== "string" || !diagnosticRecorder.capturesContent(conversationId)) return undefined;
    return { remaining: 128, register(value, keys) {
      // The framework already has these keys while freezing its detached copy.
      // Retain only a bounded prefix; the 101st key labels width truncation.
      snapshotKeys.set(value, keys.slice(0, 101));
    } };
  },
};

/** Optional patched-runtime seam; no public event fields or semantics change. */
export function installObservationSource(): () => void {
  let previous: ObservationSourceBridge | undefined;
  try {
    previous = sourceGlobal.__projectStudioObservationSource;
    sourceGlobal.__projectStudioObservationSource = bridge;
  } catch { return () => undefined; }
  return () => {
    try {
      if (sourceGlobal.__projectStudioObservationSource === bridge) sourceGlobal.__projectStudioObservationSource = previous;
    } catch { /* Source bridge teardown cannot prevent harness shutdown. */ }
  };
}

export function flueObservationContent(value: object) {
  return snapshotKeys.has(value)
    ? diagnosticIndexedContent(value, (entry) => snapshotKeys.get(entry))
    : diagnosticProjectedContent(value, RUNTIME_CONTENT_FIELDS);
}
