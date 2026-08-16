/**
 * Structured logs (CLAUDE.md §11).
 *
 * JSON lines, one object per event, so a user can send a log file to whoever is
 * helping and that person can grep it. Free-text logging would be easier to
 * write and useless to read across a 40-page crawl.
 *
 * Two rules shape the design more than the format does:
 *
 * - **A log must never be a leak.** Logs get pasted into bug reports. So an API
 *   key is never written, and page HTML is never written — the closest this
 *   gets is a length. `redact` is applied to every record, not left to each
 *   call site to remember.
 * - **A log must never be the reason a scan fails.** A sink that throws — a
 *   full disk, a revoked permission — is swallowed. Losing telemetry is a much
 *   smaller problem than losing the scan it was describing.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** One line of the log. `event` is a stable dotted name, safe to grep. */
export interface LogRecord {
  at: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
  /** Records below this are dropped. Defaults to `info`. */
  level?: LogLevel;
  now?: () => string;
  /** Where records go. Defaults to collecting them in memory. */
  sink?: LogSink;
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** A child that stamps every record with the same fields — a crawl id, say. */
  child(fields: Record<string, unknown>): Logger;
  /** Everything logged so far, when using the default in-memory sink. */
  records(): readonly LogRecord[];
}

/**
 * Field names whose values are never written, whatever they contain.
 *
 * Matched on the name rather than the value: a key-shaped string is not
 * reliably recognisable, and by the time you are guessing you have already lost.
 */
const SECRET_NAMES = /(?:^|[._-])(?:api)?key$|token|secret|password|authorization|cookie/i;

/** Values long enough to be page content rather than a description. */
const MAX_VALUE = 500;

function redactValue(name: string, value: unknown): unknown {
  if (SECRET_NAMES.test(name)) return '[redacted]';
  if (typeof value === 'string' && value.length > MAX_VALUE) {
    // Page HTML and model answers are the two things that get this long. The
    // length is the part worth keeping — it is what tells you a fragment was
    // 900 bytes when it should have been 20,000.
    return `[${String(value.length)} chars]`;
  }
  if (Array.isArray(value))
    return value.slice(0, 20).map((entry, index) => redactValue(String(index), entry));
  if (typeof value === 'object' && value !== null) return redact(value as Record<string, unknown>);
  return value;
}

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) out[name] = redactValue(name, value);
  return out;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = ORDER[options.level ?? 'info'];
  const now = options.now ?? ((): string => new Date().toISOString());
  const collected: LogRecord[] = [];
  const sink = options.sink ?? ((record): void => void collected.push(record));

  const make = (bound: Record<string, unknown>): Logger => {
    const write = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
      if (ORDER[level] < threshold) return;
      const record: LogRecord = {
        at: now(),
        level,
        event,
        ...redact({ ...bound, ...fields }),
      };
      try {
        sink(record);
      } catch {
        // Deliberately swallowed — see the module comment.
      }
    };

    return {
      debug: (event, fields) => {
        write('debug', event, fields);
      },
      info: (event, fields) => {
        write('info', event, fields);
      },
      warn: (event, fields) => {
        write('warn', event, fields);
      },
      error: (event, fields) => {
        write('error', event, fields);
      },
      child: (fields) => make({ ...bound, ...redact(fields) }),
      records: () => collected,
    };
  };

  return make({});
}

/** A logger that discards everything, for callers that do not want logs. */
export function silentLogger(): Logger {
  return createLogger({ level: 'error', sink: () => undefined });
}

/** Render records as JSON lines, which is the format meant to be shared. */
export function formatLog(records: readonly LogRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n');
}
