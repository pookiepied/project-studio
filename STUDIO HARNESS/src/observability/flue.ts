import {
  createOpenTelemetryInstrumentation,
  type OpenTelemetryInstrumentation,
} from "@flue/opentelemetry";
import { instrument } from "@flue/runtime";
import type { FlueExecutionInterceptor } from "@flue/runtime";

import type { ObservabilityConfig } from "./config.js";
import { redactGenAiContent } from "./redaction.js";
import { TelemetryError } from "./telemetry-errors.js";

let disposeInstrumentation: (() => Promise<void>) | undefined;
let disposeTurnBoundary: (() => Promise<void>) | undefined;
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
  const disposeBoundary = disposeTurnBoundary;
  disposeInstrumentation = undefined;
  disposeTurnBoundary = undefined;
  instrumentation = undefined;
  await disposeBoundary?.();
  await dispose?.();
}

export function registerFlueTurnBoundary(
  beforeModel: () => Promise<void>,
): void {
  if (disposeTurnBoundary !== undefined) {
    throw new TelemetryError("already_initialized", {
      message: "The Flue turn boundary has already been registered.",
    });
  }

  const interceptor: FlueExecutionInterceptor = async (operation, _context, next) => {
    if (operation.type === "model") await beforeModel();
    return next();
  };
  disposeTurnBoundary = instrument({
    key: Symbol("project-studio-turn-boundary"),
    observe: () => undefined,
    interceptor,
    dispose: () => undefined,
  });
}
