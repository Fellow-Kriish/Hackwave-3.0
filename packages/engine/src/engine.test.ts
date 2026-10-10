import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineConfigSchema, loadConfig } from './config';
import { EventLog, readEvents } from './events';
import { createRunDir, runFolderName } from './run-dir';
import { Timings } from './timing';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('engine.config.json', () => {
  it('loads and matches the build doc defaults', () => {
    const config = loadConfig();
    expect(config.budgets).toEqual({
      stepMs: 10000,
      runMs: 90000,
      maxActions: 25,
      maxReplansPerMilestone: 2,
      maxLlmCallsPerRun: 8,
      maxRung3AttemptsPerStepPerScreen: 1,
    });
    expect(config.ladder).toEqual({
      similarityAccept: 0.85,
      similarityMargin: 0.15,
      candidatesPerStep: 8,
      fullTreeBelowScore: 0.5,
      visionEnabled: false,
    });
    expect(config.tree).toEqual({ maxNodes: 400, maxTextChars: 80 });
    expect(config.settle).toEqual({ sampleGapMs: 150, maxWaitMs: 3000 });
    expect(config.verifier).toEqual({ pollMs: 5000 });
    expect(config.llm.mode).toBe('replay');
    expect(config.shop.ports).toEqual({ v1: 5171, v2: 5172, 'v2-broken': 5173 });
  });

  it('rejects unknown keys and out-of-range values', () => {
    const config = loadConfig();
    expect(EngineConfigSchema.safeParse({ ...config, budgts: {} }).success).toBe(false);
    expect(EngineConfigSchema.safeParse({ ...config, ladder: { ...config.ladder, similarityAccept: 1.5 } }).success).toBe(false);
    expect(EngineConfigSchema.safeParse({ ...config, llm: { ...config.llm, apiKey: 'sk-nope' } }).success).toBe(false);
  });
});

describe('EventLog', () => {
  it('writes each event as a JSON line before any listener sees it', () => {
    const file = join(dir, 'events.jsonl');
    const log = new EventLog(file);
    const linesSeenByListener: number[] = [];
    log.onEvent(() => linesSeenByListener.push(readEvents(file).length));

    log.emit('resolved', { stepKey: 'cart.open', rung: 1 });
    log.emit('healed', { stepKey: 'checkout.start', rung: 3 });

    expect(linesSeenByListener).toEqual([1, 2]);
    const events = readEvents(file);
    expect(events.map((event) => [event.seq, event.type, event.stepKey])).toEqual([
      [1, 'resolved', 'cart.open'],
      [2, 'healed', 'checkout.start'],
    ]);
    expect(events[1]?.elapsedMs).toBeGreaterThanOrEqual(events[0]?.elapsedMs ?? 0);
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true);
  });

  it('rejects reserved field names', () => {
    const log = new EventLog(join(dir, 'events.jsonl'));
    expect(() => log.emit('action', { type: 'click' })).toThrow(/reserved/);
  });

  it('never appends to an existing log', () => {
    const file = join(dir, 'events.jsonl');
    new EventLog(file).emit('first');
    expect(() => new EventLog(file)).toThrow();
    expect(readEvents(file)).toHaveLength(1);
  });
});

describe('Timings', () => {
  it('splits browser time from model time and keeps the per-step list', async () => {
    const timings = new Timings();
    await timings.measure('browser', 'cart.open', async () => new Promise((done) => setTimeout(done, 20)));
    await timings.measure('llm', 'resolve:checkout', async () => new Promise((done) => setTimeout(done, 20)));
    await expect(
      timings.measure('browser', 'pay', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const summary = timings.summary();
    expect(summary.steps.map((step) => [step.key, step.kind])).toEqual([
      ['cart.open', 'browser'],
      ['resolve:checkout', 'llm'],
      ['pay', 'browser'],
    ]);
    expect(summary.browserMs).toBeGreaterThanOrEqual(15);
    expect(summary.llmMs).toBeGreaterThanOrEqual(15);
    expect(summary.totalMs).toBeGreaterThanOrEqual(summary.browserMs + summary.llmMs - 2);
  });
});

describe('run folders', () => {
  it('names folders <timestamp>-<intentId>-<target>', () => {
    const name = runFolderName(new Date('2026-10-11T15:30:12.345Z'), 'checkout-valid-card', 'http://localhost:5171');
    expect(name).toBe('20261011T153012Z-checkout-valid-card-localhost-5171');
  });

  it('never reuses a folder and creates evidence/', () => {
    const startedAt = new Date('2026-10-11T15:30:12Z');
    const first = createRunDir(dir, 'checkout-valid-card', 'http://localhost:5171', startedAt);
    const second = createRunDir(dir, 'checkout-valid-card', 'http://localhost:5171', startedAt);
    expect(second).toBe(`${first}-2`);
    expect(existsSync(join(first, 'evidence'))).toBe(true);
    expect(existsSync(join(second, 'evidence'))).toBe(true);
  });
});
