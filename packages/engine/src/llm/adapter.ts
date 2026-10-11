import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sha256, type LlmCalls, type Tokens } from '@hackwave/contracts';
import type { z } from 'zod';
import type { EngineConfig } from '../config';
import type { EventLog } from '../events';
import type { Timings } from '../timing';
import { cacheKey, LlmCache, type Manifest, type TierPin } from './cache';
import { LlmError, llmInvalidOutput } from './errors';
import { parseReply } from './json';
import type { PromptFile } from './prompts';
import { createDriver, type Driver, type FetchLike, type ProviderEndpoint } from './providers';
import type { LlmSettings, Tier } from './settings';

/** Who asked. Only these callers exist: the planner (plan, expand), rung 3, the re-planner, the RED explainer. */
export type LlmStage = 'planner' | 'expand' | 'resolver' | 'replanner' | 'explain';

export interface LlmAdapterOptions {
  settings: LlmSettings;
  config: EngineConfig;
  /** runs/llm-cache */
  cacheDir: string;
  /** budgets.maxLlmCallsPerRun */
  maxCalls: number;
  /** Epoch ms when the run budget ends; rate-limit waits never cross it. */
  deadline: () => number;
  events?: EventLog;
  timings?: Timings;
  fetchImpl?: FetchLike;
  /** Where rejected replies are written for diagnosis (the run folder's llm-rejected/). */
  rejectDir?: string;
}

/** How much of a rejected reply is shown back to the model on the retry. */
const MAX_ECHOED_REPLY_CHARS = 4000;

export interface LlmRequest<T> {
  stage: LlmStage;
  prompt: PromptFile;
  /** The dynamic part of the call, sent after the static system prompt. */
  input: string;
  schema: z.ZodType<T>;
}

const TIERS: Tier[] = ['strong', 'fast'];

/**
 * The only door to a model. Every call is temperature 0, validated against its schema (one retry with the
 * error appended), budgeted, timed, and recorded or replayed by hash(provider, model, prompt, input).
 */
export class LlmAdapter {
  private calls = 0;
  private cached = 0;
  private readonly byModel = new Map<string, { calls: number; input: number; output: number }>();
  private readonly cache: LlmCache;
  private readonly drivers = new Map<string, Driver>();

  constructor(private readonly options: LlmAdapterOptions) {
    this.cache = new LlmCache(options.cacheDir);
  }

  get mode(): LlmSettings['mode'] {
    return this.options.settings.mode;
  }

  /** Planner, expansion and re-planner reason (strong tier); rung 3 and the explainer classify (fast tier). */
  tierFor(stage: LlmStage): Tier {
    const models = this.options.config.models;
    if (stage === 'resolver') return models.resolver;
    if (stage === 'replanner') return models.replanner;
    if (stage === 'explain') return models.explain;
    return models.planner;
  }

  usage(): { llmCalls: LlmCalls; tokens: Tokens } {
    const callsByModel: Record<string, number> = {};
    const tokensByModel: Record<string, { input: number; output: number }> = {};
    let input = 0;
    let output = 0;
    for (const [model, totals] of this.byModel) {
      callsByModel[model] = totals.calls;
      tokensByModel[model] = { input: totals.input, output: totals.output };
      input += totals.input;
      output += totals.output;
    }
    return { llmCalls: { total: this.calls, cached: this.cached, byModel: callsByModel }, tokens: { input, output, byModel: tokensByModel } };
  }

  async call<T>(request: LlmRequest<T>): Promise<T> {
    const { settings, config, maxCalls } = this.options;
    const { stage, prompt } = request;
    if (this.calls >= maxCalls) {
      throw new LlmError('unresolvable', 'llm_budget_exhausted', `the budget of ${maxCalls} LLM calls per run is spent (${stage} asked for one more)`);
    }
    const estimated = Math.ceil((prompt.text.length + request.input.length) / 4);
    if (estimated > config.llm.maxInputTokens) {
      throw new LlmError(
        'unresolvable',
        'llm_input_too_large',
        `${stage} input is about ${estimated} tokens, over the ${config.llm.maxInputTokens} limit; refusing rather than truncating`,
      );
    }
    const tier = this.tierFor(stage);
    const setting = settings.tiers[tier];
    if (!setting.ok) throw new LlmError('environment', 'llm_not_configured', `the ${tier} model tier is not configured: ${setting.problem}`);

    this.calls++;
    const inputHash = sha256(request.input);
    const key = cacheKey(setting.provider, setting.model, prompt.hash, inputHash);
    const modelKey = `${setting.provider}:${setting.model}`;
    const started = performance.now();
    const report = (fields: { cacheHit: boolean; attempts: number; input: number; output: number; failed?: string; retried?: string }) => {
      const totals = this.byModel.get(modelKey) ?? { calls: 0, input: 0, output: 0 };
      this.byModel.set(modelKey, { calls: totals.calls + 1, input: totals.input + fields.input, output: totals.output + fields.output });
      this.options.events?.emit('llm_call', {
        stage,
        prompt: prompt.name,
        promptVersion: prompt.version,
        provider: setting.provider,
        model: setting.model,
        mode: settings.mode,
        cacheHit: fields.cacheHit,
        attempts: fields.attempts,
        tokensIn: fields.input,
        tokensOut: fields.output,
        ms: Math.round(performance.now() - started),
        key: key.slice(0, 12),
        ...(fields.retried ? { retried: fields.retried } : {}),
        ...(fields.failed ? { failed: fields.failed } : {}),
      });
    };

    if (settings.mode === 'replay') {
      const entry = this.cache.read(key);
      if (!entry) {
        throw new LlmError(
          'environment',
          'replay_cache_miss',
          `replay cache miss for ${prompt.name} (${prompt.version}, prompt ${prompt.hash.slice(0, 12)}, input ${inputHash.slice(0, 12)}); record it with LLM_MODE=record`,
        );
      }
      const reply = parseReply(entry.text, request.schema);
      if (!reply.ok) throw llmInvalidOutput(`the cached ${stage} reply no longer validates: ${reply.error}`);
      this.cached++;
      report({ cacheHit: true, attempts: entry.attempts, input: 0, output: 0 });
      return reply.value;
    }

    if (settings.mode === 'record') {
      this.checkManifest();
      // Recording fills gaps: a call already recorded (same provider, model, prompt and input) whose reply still
      // validates is reused, so re-recording a set of fixtures pays only for what changed. Delete its cache file
      // to record it afresh.
      const entry = this.cache.read(key);
      const reply = entry ? parseReply(entry.text, request.schema) : null;
      if (entry && reply?.ok) {
        this.cached++;
        report({ cacheHit: true, attempts: entry.attempts, input: 0, output: 0 });
        return reply.value;
      }
    }
    const endpoint = setting.endpoint;
    if (!endpoint) throw new LlmError('environment', 'llm_not_configured', `the ${tier} model tier has no endpoint`);
    const driver = this.driverFor(endpoint);
    let user = request.input;
    let input = 0;
    let output = 0;
    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const work = () =>
        driver.complete({
          system: prompt.text,
          user,
          maxTokens: config.llm.maxOutputTokens,
          timeoutMs: config.llm.callTimeoutMs,
          deadline: this.options.deadline(),
        });
      const result = await (this.options.timings ? this.options.timings.measure('llm', `llm:${stage}`, work) : work());
      input += result.usage.input;
      output += result.usage.output;
      const reply = parseReply(result.text, request.schema);
      if (reply.ok) {
        if (settings.mode === 'record') this.record(request, setting, key, inputHash, result.text, { input, output }, attempt);
        report({ cacheHit: false, attempts: attempt, input, output, ...(lastError ? { retried: lastError.replace(/\s+/g, ' ').slice(0, 300) } : {}) });
        return reply.value;
      }
      lastError = result.stopReason === 'length' ? `${reply.error}\n(the reply was cut off at the output token limit)` : reply.error;
      this.keepRejected(stage, attempt, result.text, lastError);
      // The one retry shows the model its own reply and what was wrong with it, so it can correct rather than regenerate.
      user = [
        request.input,
        '',
        'YOUR PREVIOUS REPLY:',
        result.text.slice(0, MAX_ECHOED_REPLY_CHARS) || '(empty)',
        '',
        'IT COULD NOT BE USED BECAUSE:',
        lastError,
        '',
        'Reply again with only the corrected JSON object.',
      ].join('\n');
    }
    report({ cacheHit: false, attempts: 2, input, output, failed: lastError.split('\n')[0] ?? lastError });
    throw llmInvalidOutput(`${stage}: the model's reply was still invalid after one retry: ${lastError.replace(/\s+/g, ' ').slice(0, 300)}`);
  }

  private keepRejected(stage: LlmStage, attempt: number, text: string, error: string): void {
    if (!this.options.rejectDir) return;
    mkdirSync(this.options.rejectDir, { recursive: true });
    writeFileSync(join(this.options.rejectDir, `call${this.calls}-${stage}-attempt${attempt}.txt`), `${error}\n\n--- reply ---\n${text}\n`);
  }

  private driverFor(endpoint: ProviderEndpoint): Driver {
    const id = `${endpoint.provider}|${endpoint.model}|${endpoint.baseUrl}`;
    let driver = this.drivers.get(id);
    if (!driver) {
      driver = createDriver(endpoint, this.options.fetchImpl);
      this.drivers.set(id, driver);
    }
    return driver;
  }

  private pins(): Partial<Record<Tier, TierPin>> {
    const pins: Partial<Record<Tier, TierPin>> = {};
    for (const tier of TIERS) {
      const setting = this.options.settings.tiers[tier];
      if (setting.ok) pins[tier] = { provider: setting.provider, model: setting.model };
    }
    return pins;
  }

  /** Recording with other ids than the cache was recorded with would silently mix two providers in one cache. */
  private checkManifest(): void {
    const manifest = this.cache.readManifest();
    if (!manifest) return;
    for (const [tier, pin] of Object.entries(this.pins()) as [Tier, TierPin][]) {
      const recorded = manifest.tiers[tier];
      if (recorded && (recorded.provider !== pin.provider || recorded.model !== pin.model)) {
        throw new LlmError(
          'environment',
          'llm_cache_conflict',
          `runs/llm-cache was recorded with ${recorded.provider} · ${recorded.model} for the ${tier} tier; recording with ${pin.provider} · ${pin.model} would mix them. Use the same ids, or re-record into an empty runs/llm-cache.`,
        );
      }
    }
  }

  private record<T>(
    request: LlmRequest<T>,
    setting: { provider: string; model: string },
    key: string,
    inputHash: string,
    text: string,
    usage: { input: number; output: number },
    attempts: number,
  ): void {
    this.cache.write({
      version: 1,
      key,
      stage: request.stage,
      prompt: request.prompt.name,
      promptVersion: request.prompt.version,
      promptHash: request.prompt.hash,
      provider: setting.provider,
      model: setting.model,
      inputHash,
      text,
      usage,
      attempts,
      recordedAt: new Date().toISOString(),
    });
    const manifest: Manifest = this.cache.readManifest() ?? { version: 1, tiers: { strong: null, fast: null }, prompts: {}, updatedAt: '' };
    for (const [tier, pin] of Object.entries(this.pins()) as [Tier, TierPin][]) manifest.tiers[tier] = pin;
    manifest.prompts[request.prompt.name] = request.prompt.hash;
    manifest.updatedAt = new Date().toISOString();
    this.cache.writeManifest(manifest);
  }
}
