import { context, trace } from "@opentelemetry/api";

import { safeSerializeValue } from "./errors.js";
import { redactSensitiveString } from "./redaction.js";
import { currentExecutionContext } from "../execution/context.js";

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly deploymentEnvironment: string;
  readonly baseFields?: LogFields;
  readonly write?: (line: string) => void;
}

function correlationFields(): LogFields {
  const execution = currentExecutionContext();
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();

  return {
    ...(execution === undefined
      ? {}
      : {
          request_id: execution.requestId,
          request_id_source: execution.requestIdSource,
          operation_id: execution.operationId,
          ...(execution.parentOperationId === undefined
            ? {}
            : { parent_operation_id: execution.parentOperationId }),
          attempt_id: execution.attemptId,
          operation_kind: execution.kind,
          ...(execution.clientId === undefined ? {} : { client_id: execution.clientId }),
          ...(execution.sessionId === undefined ? {} : { session_id: execution.sessionId }),
          ...(execution.flueInstanceId === undefined ? {} : { flue_instance_id: execution.flueInstanceId }),
          ...(execution.flueAgentName === undefined ? {} : { flue_agent_name: execution.flueAgentName }),
          ...(execution.flueSubmissionId === undefined ? {} : { flue_submission_id: execution.flueSubmissionId }),
          ...(execution.flueConversationId === undefined ? {} : { flue_conversation_id: execution.flueConversationId }),
          ...(execution.flueTurnId === undefined ? {} : { flue_turn_id: execution.flueTurnId }),
          ...(execution.flueTaskId === undefined ? {} : { flue_task_id: execution.flueTaskId }),
          ...(execution.flueOperationId === undefined ? {} : { flue_operation_id: execution.flueOperationId }),
          ...(execution.flueToolCallId === undefined ? {} : { flue_tool_call_id: execution.flueToolCallId }),
        }),
    ...(spanContext?.traceId === undefined ? {} : { trace_id: spanContext.traceId }),
    ...(spanContext?.spanId === undefined ? {} : { span_id: spanContext.spanId }),
    ...(spanContext === undefined ? {} : { trace_flags: spanContext.traceFlags }),
  };
}

function emit(
  options: LoggerOptions,
  level: LogLevel,
  message: string,
  fields: LogFields | undefined,
): void {
  const serializedFields = safeSerializeValue({
    ...options.baseFields,
    ...fields,
  }) as LogFields;
  const record = {
    ...serializedFields,
    timestamp: new Date().toISOString(),
    level,
    message: redactSensitiveString(message),
    "service.name": options.serviceName,
    "service.version": options.serviceVersion,
    "deployment.environment": options.deploymentEnvironment,
    ...correlationFields(),
  };

  const line = `${JSON.stringify(record)}\n`;
  if (options.write) {
    options.write(line);
    return;
  }

  if (level === "error") {
    process.stderr.write(line);
    return;
  }

  process.stdout.write(line);
}

export function createLogger(options: LoggerOptions): Logger {
  const log =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      emit(options, level, message, fields);
    };

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child(fields: LogFields): Logger {
      return createLogger({
        ...options,
        baseFields: {
          ...options.baseFields,
          ...fields,
        },
      });
    },
  };
}
