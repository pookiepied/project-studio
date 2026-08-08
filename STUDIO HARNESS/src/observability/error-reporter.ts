import { SpanStatusCode, context, metrics, trace } from "@opentelemetry/api";

import {
  isStudioError,
  type StudioErrorDomain,
  type StudioErrorReport,
} from "../contracts/errors.js";
import { normalizeError, safeSerializeValue } from "./errors.js";
import type { LogFields, Logger } from "./logger.js";

/**
 * The single path a failure takes out of a subsystem.
 *
 * Without this, "handled" means whatever each call site improvised: some log,
 * some annotate the span, some do neither, and none of it aggregates. Reporting
 * one way means every failure lands in logs, on the active span, and in a
 * counter keyed by the same stable code.
 *
 * Reporting is not throwing. A subsystem reports what it is about to raise or
 * has decided to swallow; control flow stays with the caller.
 */

const METER_NAME = "project-studio.errors";
const COUNTER_NAME = "project_studio.errors";

export interface ErrorReportContext extends LogFields {
  /** What the subsystem was doing, e.g. `providers.connect`. */
  readonly operation?: string;
}

export interface ErrorReporter {
  /**
   * Records a failure and returns its safe projection, which is also what the
   * caller should hand to a user or an API response.
   */
  report(error: unknown, context?: ErrorReportContext): StudioErrorReport;
  /** A reporter that stamps every report with additional fields. */
  child(fields: LogFields): ErrorReporter;
}

/**
 * Projects any thrown value onto the report shape.
 *
 * A value that never passed through `StudioError` lands in the `unclassified`
 * domain with its message sanitized by the existing redaction path. That is a
 * visible gap, and it is meant to be: `unclassified` in a dashboard names the
 * subsystems that have not been onboarded yet.
 */
export function toErrorReport(error: unknown): StudioErrorReport {
  if (isStudioError(error)) {
    return error.toReport();
  }

  const normalized = normalizeError(error);
  const kind = normalized.code ?? normalized.name ?? "error";
  return {
    code: `unclassified.${kind}`,
    domain: "unclassified",
    kind,
    name: normalized.name,
    message: normalized.message,
    retryable: normalized.retryable,
  };
}

function recordOnSpan(report: StudioErrorReport): void {
  const span = trace.getSpan(context.active());
  if (!span) {
    return;
  }

  // The report, not the Error: `recordException` would serialize the stack and
  // the original message, neither of which is guaranteed safe.
  span.addEvent("exception", {
    "exception.type": report.code,
    "exception.message": report.message,
    "error.retryable": report.retryable,
  });
  span.setStatus({ code: SpanStatusCode.ERROR, message: report.code });
}

function recordOnCounter(report: StudioErrorReport, operation?: string): void {
  metrics
    .getMeter(METER_NAME)
    .createCounter(COUNTER_NAME, {
      description: "Failures reported by harness subsystems.",
    })
    .add(1, {
      "error.code": report.code,
      "error.domain": report.domain,
      "error.retryable": report.retryable,
      ...(operation ? { "error.operation": operation } : {}),
    });
}

export interface ErrorReporterOptions {
  /**
   * Omitted on paths that run before observability starts, such as the CLIs.
   * Reporting still records span and counter data; it just has nowhere to log.
   */
  readonly logger?: Logger;
  readonly baseFields?: LogFields;
}

export function createErrorReporter(
  options: ErrorReporterOptions = {},
): ErrorReporter {
  return {
    report(error: unknown, reportContext: ErrorReportContext = {}): StudioErrorReport {
      const report = toErrorReport(error);
      const { operation, ...fields } = reportContext;

      recordOnSpan(report);
      recordOnCounter(report, operation);

      // `safeSerializeValue` runs inside the logger too; caller fields are
      // arbitrary, and a reporter with no logger must not skip redaction by
      // accident on some future sink.
      options.logger?.error(report.message, {
        ...options.baseFields,
        ...(safeSerializeValue(fields) as LogFields),
        ...(operation ? { operation } : {}),
        "error.code": report.code,
        "error.domain": report.domain,
        "error.kind": report.kind,
        "error.name": report.name,
        "error.retryable": report.retryable,
      });

      return report;
    },

    child(fields: LogFields): ErrorReporter {
      return createErrorReporter({
        ...options,
        baseFields: { ...options.baseFields, ...fields },
      });
    },
  };
}

/**
 * A reporter for a named subsystem. This is what subsystems should take: it
 * stamps the domain so a report is attributable even when the thrown value was
 * never classified.
 */
export function createDomainReporter(
  domain: StudioErrorDomain,
  options: ErrorReporterOptions = {},
): ErrorReporter {
  return createErrorReporter(options).child({ "error.source_domain": domain });
}
