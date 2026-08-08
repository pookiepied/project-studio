import {
  createOpenTelemetryInstrumentation,
  type OpenTelemetryInstrumentation,
} from "@flue/opentelemetry";
import { instrument } from "@flue/runtime";

import type { ObservabilityConfig } from "./config.js";
import { redactGenAiContent } from "./redaction.js";
import { TelemetryError } from "./telemetry-errors.js";

let disposeInstrumentation: (() => Promise<void>) | undefined;
let instrumentation: OpenTelemetryInstrumentation | undefined;

export function isFlueInstrumentationRegistered(): boolean {
  return disposeInstrumentation !== undefined;
}

export function registerFlueInstrumentation(config: ObservabilityConfig): void {
  if (disposeInstrumentation) {
    throw new TelemetryError("already_initialized", {
      message:
        "Flue OpenTelemetry instrumentation has already been registered.",
    });
  }

  instrumentation = createOpenTelemetryInstrumentation({
    content: config.captureContent
      ? {
          enabled: true,
          transform(content) {
            return redactGenAiContent(content);
          },
        }
      : {
          enabled: false,
        },
  });

  disposeInstrumentation = instrument(instrumentation);
}

export async function unregisterFlueInstrumentation(): Promise<void> {
  const dispose = disposeInstrumentation;
  disposeInstrumentation = undefined;
  instrumentation = undefined;
  if (dispose) {
    await dispose();
  }
}
