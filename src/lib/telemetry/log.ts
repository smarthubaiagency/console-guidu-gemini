import { redact } from "@/shared/errors/redact";

/**
 * Structured logs (F3d, docs/operacao/observabilidade.md): one JSON object
 * per line with `ts`, `level`, `source` and `event`, plus correlation ids
 * (`requestId` in the web, `jobId` in the worker). Values pass through the
 * secret redaction of §15 and keys that name secrets are dropped to
 * "[REDACTED]", so a log line never carries a token, password or key.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource = "web" | "worker";

export type LogFields = Readonly<Record<string, unknown>> & {
  readonly requestId?: string;
  readonly jobId?: string;
};

export type Logger = Readonly<{
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Same logger with fields added to every line (e.g. a jobId). */
  child(fields: LogFields): Logger;
}>;

/** Keys whose values never reach a log line. */
export const SECRET_KEY =
  /(secret|token|passw|authorization|cookie|api[-_]?key|credential|private[-_]?key|encrypted|signature|session)/i;

/** `<namespace>.<name>`: lower case, dots, dashes and underscores. */
export const LOG_EVENT = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/;

const MAX_STRING = 2000;
const MAX_DEPTH = 4;
const RESERVED = new Set(["ts", "level", "source", "event"]);

function sanitize(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redact(value).slice(0, MAX_STRING);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: sanitize(value.message, depth + 1) };
  }
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SECRET_KEY.test(key)
        ? "[REDACTED]"
        : sanitize(item, depth + 1);
    }
    return result;
  }
  return String(value);
}

/** The JSON line of one event; exported for tests. */
export function formatLogLine(
  level: LogLevel,
  source: LogSource,
  event: string,
  fields: LogFields = {},
  now: Date = new Date(),
): string {
  const clean = sanitize(fields, 0) as Record<string, unknown>;
  const line: Record<string, unknown> = {
    ts: now.toISOString(),
    level,
    source,
    event: LOG_EVENT.test(event) ? event : "log.invalid_event",
  };
  for (const [key, value] of Object.entries(clean)) {
    if (!RESERVED.has(key) && value !== undefined) line[key] = value;
  }
  return JSON.stringify(line);
}

export type LogSink = (level: LogLevel, line: string) => void;

// The one place logs are written (log-convention.test.ts keeps it so).
const consoleSink: LogSink = (level, line) => {
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
};

export function createLogger(
  source: LogSource | (() => LogSource),
  base: LogFields = {},
  sink: LogSink = consoleSink,
): Logger {
  const sourceOf = typeof source === "function" ? source : () => source;
  const write = (level: LogLevel) => (event: string, fields?: LogFields) =>
    sink(
      level,
      formatLogLine(level, sourceOf(), event, { ...base, ...fields }),
    );
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (fields) => createLogger(source, { ...base, ...fields }, sink),
  };
}

let processSource: LogSource = "web";

/** Called once by the worker entry point; the web keeps "web". */
export function setLogSource(source: LogSource): void {
  processSource = source;
}

/** Logger of shared code: its source is the process that runs it. */
export const appLog: Logger = createLogger(() => processSource);
