import { format } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type Fields = Readonly<Record<string, unknown>>;

const RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export type Log = {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
};

export type LineSink = (line: string) => void;

const stdoutSink: LineSink = (line) => {
  process.stdout.write(`${line}\n`);
};

function errorFields(fields: Fields | undefined): Fields | undefined {
  if (!fields) return fields;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return out;
}

/** One JSON object per line on stdout, so any log collector can read it. */
export function createLog(level: LogLevel, sink: LineSink = stdoutSink): Log {
  const write = (lineLevel: Exclude<LogLevel, 'silent'>, message: string, fields?: Fields) => {
    if (RANK[lineLevel] < RANK[level]) return;
    sink(JSON.stringify({ time: new Date().toISOString(), level: lineLevel, msg: message, ...errorFields(fields) }));
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

type ConsoleMethod = (...args: unknown[]) => void;

function folded(write: (message: string, fields?: Fields) => void): ConsoleMethod {
  return (...args) => {
    const error = args.find((arg) => arg instanceof Error);
    write(format(...args), { source: 'colyseus', ...(error ? { error } : {}) });
  };
}

/** Colyseus logs with console-style arguments; this folds them into our JSON lines. */
export function colyseusLogger(log: Log): Record<'trace' | 'debug' | 'info' | 'warn' | 'error', ConsoleMethod> {
  return {
    trace: folded(log.debug),
    debug: folded(log.debug),
    info: folded(log.info),
    warn: folded(log.warn),
    error: folded(log.error),
  };
}
