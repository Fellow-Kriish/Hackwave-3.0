import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

export interface EngineEvent {
  /** 1-based position in the run. */
  seq: number;
  /** Wall-clock time, ISO 8601. */
  ts: string;
  /** Milliseconds since the log opened, from the monotonic clock. */
  elapsedMs: number;
  type: string;
  [field: string]: unknown;
}

export type EventListener = (event: EngineEvent) => void;

const RESERVED = ['seq', 'ts', 'elapsedMs', 'type'];

/**
 * events.jsonl for one run. Every event is appended to disk synchronously before any listener
 * (the console stream, for one) sees it, so the file stays the record even if the process dies mid-run.
 */
export class EventLog {
  private seq = 0;
  private readonly startedAt = performance.now();
  private readonly listeners: EventListener[] = [];

  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    // 'wx' fails if the file exists: a run never appends to another run's log.
    writeFileSync(file, '', { flag: 'wx' });
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) this.listeners.splice(index, 1);
    };
  }

  emit(type: string, fields: Record<string, unknown> = {}): EngineEvent {
    for (const key of RESERVED) {
      if (key in fields) throw new Error(`Event field "${key}" is reserved`);
    }
    const event: EngineEvent = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - this.startedAt),
      type,
      ...fields,
    };
    appendFileSync(this.file, `${JSON.stringify(event)}\n`);
    for (const listener of this.listeners) listener(event);
    return event;
  }
}

export function readEvents(file: string): EngineEvent[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as EngineEvent);
}
