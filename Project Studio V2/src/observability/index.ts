import {
  resolveObservabilityConfig,
  type ObservabilityConfig,
  type ObservabilityConfigInput,
} from "./config.js";
import {
  unregisterFlueInstrumentation,
  registerFlueInstrumentation,
  isFlueInstrumentationRegistered,
} from "./flue.js";
import { createLogger, type Logger } from "./logger.js";
import {
  getObservabilitySdk,
  isObservabilitySdkStarted,
  startObservabilitySdk,
  shutdownObservabilitySdk,
  type ObservabilitySdk,
  type TelemetrySnapshot,
} from "./sdk.js";

export type { ObservabilityConfig, ObservabilityConfigInput, TelemetrySnapshot };
export {
  normalizeError,
  safeSerializeError,
  safeSerializeValue,
} from "./errors.js";
export { createLogger, type Logger, type LogFields, type LogLevel } from "./logger.js";
export { redactGenAiContent } from "./redaction.js";
export { resolveObservabilityConfig } from "./config.js";

export interface ObservabilityHandle {
  readonly config: ObservabilityConfig;
  readonly logger: Logger;
  readonly sdk: ObservabilitySdk;
  forceFlush(): Promise<void>;
  getSnapshot(): TelemetrySnapshot;
  shutdown(): Promise<void>;
}

let handle: ObservabilityHandle | undefined;

export function isObservabilityInitialized(): boolean {
  return handle !== undefined;
}

export function initializeObservability(
  input: ObservabilityConfigInput = {},
): ObservabilityHandle {
  if (handle) {
    throw new Error("Observability has already been initialized.");
  }

  const config = resolveObservabilityConfig(input);

  // SDK must be configured before Flue instrumentation registration.
  const sdk = startObservabilitySdk(config);
  registerFlueInstrumentation(config);

  const logger = createLogger({
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    deploymentEnvironment: config.deploymentEnvironment,
  });

  handle = {
    config,
    logger,
    sdk,
    forceFlush(): Promise<void> {
      return sdk.forceFlush();
    },
    getSnapshot(): TelemetrySnapshot {
      return sdk.getSnapshot();
    },
    shutdown(): Promise<void> {
      return shutdownObservability();
    },
  };

  logger.info("Observability initialized", {
    exporter: config.exporter,
    captureContent: config.captureContent,
  });

  return handle;
}

export function getObservability(): ObservabilityHandle {
  if (!handle) {
    throw new Error("Observability has not been initialized.");
  }
  return handle;
}

export async function shutdownObservability(): Promise<void> {
  if (!handle && !isObservabilitySdkStarted() && !isFlueInstrumentationRegistered()) {
    return;
  }

  try {
    await unregisterFlueInstrumentation();
  } finally {
    await shutdownObservabilitySdk();
    handle = undefined;
  }
}

export function getLogger(): Logger {
  return getObservability().logger;
}
