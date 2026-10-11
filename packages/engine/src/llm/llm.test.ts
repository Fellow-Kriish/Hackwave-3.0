import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../config';
import { findRepoRoot } from '../paths';
import { LlmAdapter } from './adapter';
import { readManifest } from './cache';
import { LlmError } from './errors';
import { extractJson, parseReply } from './json';
import { loadPrompt, type PromptFile } from './prompts';
import { createDriver, type FetchLike } from './providers';
import { resolveLlmSettings } from './settings';

const config = loadConfig();
const env = { LLM_PROVIDER: 'groq', LLM_API_KEY: 'test-key', LLM_MODEL_STRONG: 'strong-model', LLM_MODEL_FAST: 'fast-model' };
const prompt: PromptFile = { name: 'planner', version: 'planner/1', text: 'Reply with JSON only.', hash: 'p'.repeat(64) };
const schema = z.strictObject({ answer: z.number().int() });

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A provider that answers from a script, one reply per request, and records what it was sent. */
function scripted(replies: { status?: number; content?: string; headers?: Record<string, string>; raw?: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)] ?? {};
    const body = reply.raw ?? { choices: [{ message: { content: reply.content ?? '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
    return new Response(JSON.stringify(body), { status: reply.status ?? 200, headers: reply.headers });
  };
  return { calls, fetchImpl };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llm-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function adapter(mode: 'live' | 'record' | 'replay', fetchImpl: FetchLike, maxCalls = 8, extraEnv: Record<string, string> = {}) {
  const settings = resolveLlmSettings(config, { ...env, ...extraEnv, LLM_MODE: mode }, readManifest(dir));
  return new LlmAdapter({ settings, config, cacheDir: dir, maxCalls, deadline: () => Date.now() + 60_000, fetchImpl });
}

describe('reply parsing', () => {
  it('accepts bare, fenced and prose-wrapped JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":1} hope it helps')).toEqual({ a: 1 });
  });

  it('explains what is wrong', () => {
    expect(parseReply('', schema)).toEqual({ ok: false, error: 'the reply was empty' });
    expect(parseReply('no braces here', schema)).toEqual({ ok: false, error: 'the reply contains no JSON object' });
    const wrong = parseReply('{"answer":"forty-two"}', schema);
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.error).toMatch(/answer/);
  });
});

describe('settings', () => {
  it('reads provider and models from env over engine.config.json, and shares the key with the fast tier', () => {
    const settings = resolveLlmSettings(config, { ...env, LLM_MODE: 'live' }, null);
    expect(settings.tiers.strong).toMatchObject({ ok: true, provider: 'groq', model: 'strong-model' });
    expect(settings.tiers.fast).toMatchObject({ ok: true, provider: 'groq', model: 'fast-model' });
    const strong = settings.tiers.strong;
    expect(strong.ok && strong.endpoint).toMatchObject({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'test-key', maxTokensField: 'max_completion_tokens' });
  });

  it('treats empty values and the placeholder as unset', () => {
    const settings = resolveLlmSettings(config, { LLM_MODE: 'live', LLM_PROVIDER: 'groq', LLM_API_KEY: 'replace-me', LLM_MODEL_STRONG: '' }, null);
    expect(settings.tiers.strong).toEqual({ ok: false, problem: 'LLM_MODEL_STRONG is not set' });
    const keyless = resolveLlmSettings(config, { LLM_MODE: 'live', LLM_PROVIDER: 'groq', LLM_API_KEY: 'replace-me', LLM_MODEL_STRONG: 'm' }, null);
    expect(keyless.tiers.strong).toEqual({ ok: false, problem: 'LLM_API_KEY is not set for groq' });
  });

  it('runs the fast tier on another provider with its own key', () => {
    const settings = resolveLlmSettings(config, { ...env, LLM_MODE: 'live', LLM_PROVIDER_FAST: 'ollama' }, null);
    const fast = settings.tiers.fast;
    expect(fast.ok && fast.endpoint).toMatchObject({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: null });
  });

  it('needs a base URL for custom, and rejects unknown providers and modes', () => {
    expect(resolveLlmSettings(config, { LLM_MODE: 'live', LLM_PROVIDER: 'custom', LLM_MODEL_STRONG: 'm' }, null).tiers.strong).toEqual({
      ok: false,
      problem: 'LLM_BASE_URL is required for custom',
    });
    expect(resolveLlmSettings(config, { LLM_MODE: 'live', LLM_PROVIDER: 'nope' }, null).tiers.strong).toMatchObject({ ok: false });
    expect(() => resolveLlmSettings(config, { LLM_MODE: 'sometimes' }, null)).toThrow(/LLM_MODE/);
  });

  it('pins replay to the cache manifest and needs no key', () => {
    const settings = resolveLlmSettings(
      config,
      { LLM_MODE: 'replay' },
      { version: 1, tiers: { strong: { provider: 'groq', model: 'strong-model' }, fast: null }, prompts: {}, updatedAt: '' },
    );
    expect(settings.pinnedToManifest).toBe(true);
    expect(settings.tiers.strong).toEqual({ ok: true, provider: 'groq', model: 'strong-model', endpoint: null });
    expect(resolveLlmSettings(config, { LLM_MODE: 'replay' }, null).tiers.strong).toMatchObject({ ok: false });
  });
});

describe('drivers', () => {
  it('speaks OpenAI chat completions at temperature 0, with native JSON mode where the provider has it', async () => {
    const { calls, fetchImpl } = scripted([{ content: '{"answer":42}' }]);
    const settings = resolveLlmSettings(config, { ...env, LLM_MODE: 'live' }, null);
    const strong = settings.tiers.strong;
    if (!strong.ok || !strong.endpoint) throw new Error('unreachable');
    const result = await createDriver(strong.endpoint, fetchImpl).complete({ system: 'S', user: 'U', maxTokens: 512, timeoutMs: 5000, deadline: Date.now() + 5000 });
    expect(result).toMatchObject({ text: '{"answer":42}', usage: { input: 100, output: 20 }, stopReason: 'stop' });
    expect(calls[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(calls[0]?.headers.authorization).toBe('Bearer test-key');
    expect(calls[0]?.body).toMatchObject({
      model: 'strong-model',
      temperature: 0,
      max_completion_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'U' },
      ],
    });
  });

  it('speaks the Anthropic Messages API', async () => {
    const { calls, fetchImpl } = scripted([
      { raw: { content: [{ type: 'text', text: '{"answer":7}' }], usage: { input_tokens: 9, output_tokens: 3 }, stop_reason: 'end_turn' } },
    ]);
    const settings = resolveLlmSettings(config, { LLM_MODE: 'live', LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_MODEL_STRONG: 'm', LLM_MODEL_FAST: 'm' }, null);
    const strong = settings.tiers.strong;
    if (!strong.ok || !strong.endpoint) throw new Error('unreachable');
    const result = await createDriver(strong.endpoint, fetchImpl).complete({ system: 'S', user: 'U', maxTokens: 256, timeoutMs: 5000, deadline: Date.now() + 5000 });
    expect(result).toMatchObject({ text: '{"answer":7}', usage: { input: 9, output: 3 } });
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
    expect(calls[0]?.body).toMatchObject({ model: 'm', max_tokens: 256, temperature: 0, system: 'S', messages: [{ role: 'user', content: 'U' }] });
  });

  it('waits out a rate limit, then fails fast on a hard error', async () => {
    const limited = scripted([{ status: 429, headers: { 'retry-after': '0.05' } }, { content: '{"answer":1}' }]);
    expect(await adapter('live', limited.fetchImpl).call({ stage: 'planner', prompt, input: 'x', schema })).toEqual({ answer: 1 });
    expect(limited.calls).toHaveLength(2);

    const denied = scripted([{ status: 401, raw: { error: 'bad key' } }]);
    await expect(adapter('live', denied.fetchImpl).call({ stage: 'planner', prompt, input: 'x', schema })).rejects.toMatchObject({
      code: 'llm_unavailable',
      runOutcome: 'environment',
    });
    expect(denied.calls).toHaveLength(1);
  });
});

describe('adapter', () => {
  it('validates the reply against the call schema', async () => {
    const { fetchImpl } = scripted([{ content: '{"answer":42}' }]);
    const llm = adapter('live', fetchImpl);
    expect(await llm.call({ stage: 'planner', prompt, input: 'what is it?', schema })).toEqual({ answer: 42 });
    expect(llm.usage()).toEqual({
      llmCalls: { total: 1, cached: 0, byModel: { 'groq:strong-model': 1 } },
      tokens: { input: 100, output: 20, byModel: { 'groq:strong-model': { input: 100, output: 20 } } },
    });
  });

  it('retries invalid JSON once with the error appended, then fails cleanly', async () => {
    const { calls, fetchImpl } = scripted([{ content: 'not json at all' }, { content: '{"answer":"still wrong"}' }]);
    const call = adapter('live', fetchImpl).call({ stage: 'planner', prompt, input: 'question', schema });
    await expect(call).rejects.toBeInstanceOf(LlmError);
    await expect(call).rejects.toMatchObject({ code: 'llm_invalid_output', runOutcome: 'unresolvable' });
    expect(calls).toHaveLength(2);
    const retry = (calls[1]?.body.messages as { content: string }[])[1]?.content ?? '';
    expect(retry).toContain('question');
    expect(retry).toContain('YOUR PREVIOUS REPLY COULD NOT BE USED');
    expect(retry).toContain('the reply contains no JSON object');
  });

  it('accepts a corrected reply on the retry', async () => {
    const { calls, fetchImpl } = scripted([{ content: '{"answer":1.5}' }, { content: '{"answer":2}' }]);
    expect(await adapter('live', fetchImpl).call({ stage: 'planner', prompt, input: 'q', schema })).toEqual({ answer: 2 });
    expect(calls).toHaveLength(2);
  });

  it('records, then replays with no API key and no network; a miss names the prompt', async () => {
    const recorded = scripted([{ content: '{"answer":42}' }]);
    await adapter('record', recorded.fetchImpl).call({ stage: 'planner', prompt, input: 'q', schema });
    expect(readdirSync(dir).sort()).toEqual([expect.stringMatching(/^[0-9a-f]{64}\.json$/), 'manifest.json'].sort());
    expect(readManifest(dir)?.tiers).toEqual({ strong: { provider: 'groq', model: 'strong-model' }, fast: { provider: 'groq', model: 'fast-model' } });

    const offline: FetchLike = async () => {
      throw new Error('replay must not touch the network');
    };
    const replay = new LlmAdapter({
      settings: resolveLlmSettings(config, { LLM_MODE: 'replay' }, readManifest(dir)),
      config,
      cacheDir: dir,
      maxCalls: 8,
      deadline: () => Date.now() + 1000,
      fetchImpl: offline,
    });
    expect(await replay.call({ stage: 'planner', prompt, input: 'q', schema })).toEqual({ answer: 42 });
    expect(replay.usage().llmCalls).toMatchObject({ total: 1, cached: 1 });
    await expect(replay.call({ stage: 'planner', prompt, input: 'another question', schema })).rejects.toMatchObject({
      code: 'replay_cache_miss',
      message: expect.stringContaining('planner (planner/1, prompt pppppppppppp'),
    });
  });

  it('refuses to record with other ids than the cache was recorded with', async () => {
    await adapter('record', scripted([{ content: '{"answer":1}' }]).fetchImpl).call({ stage: 'planner', prompt, input: 'q', schema });
    const other = scripted([{ content: '{"answer":1}' }]);
    await expect(adapter('record', other.fetchImpl, 8, { LLM_MODEL_STRONG: 'another-model' }).call({ stage: 'planner', prompt, input: 'q2', schema })).rejects.toMatchObject({
      code: 'llm_cache_conflict',
    });
    expect(other.calls).toHaveLength(0);
  });

  it('enforces the call budget and refuses oversize input without sending it', async () => {
    const { calls, fetchImpl } = scripted([{ content: '{"answer":1}' }]);
    const llm = adapter('live', fetchImpl, 1);
    await llm.call({ stage: 'planner', prompt, input: 'q', schema });
    await expect(llm.call({ stage: 'planner', prompt, input: 'q', schema })).rejects.toMatchObject({ code: 'llm_budget_exhausted', runOutcome: 'unresolvable' });

    const big = adapter('live', fetchImpl);
    await expect(big.call({ stage: 'planner', prompt, input: 'x'.repeat(config.llm.maxInputTokens * 4 + 4), schema })).rejects.toMatchObject({
      code: 'llm_input_too_large',
    });
    expect(calls).toHaveLength(1);
  });

  it('sends planner and expansion to the strong tier, rung 3 and the explainer to the fast tier', () => {
    const llm = adapter('live', scripted([]).fetchImpl);
    expect([llm.tierFor('planner'), llm.tierFor('expand'), llm.tierFor('replanner')]).toEqual(['strong', 'strong', 'strong']);
    expect([llm.tierFor('resolver'), llm.tierFor('explain')]).toEqual(['fast', 'fast']);
  });
});

describe('prompt files', () => {
  it('reads the version line and hashes Windows and Unix line endings alike', () => {
    const root = join(dir, 'repo');
    mkdirSync(join(root, 'prompts'), { recursive: true });
    writeFileSync(join(root, 'prompts', 'a.md'), 'version: a/1\n\nHello\nworld\n');
    writeFileSync(join(root, 'prompts', 'b.md'), 'version: a/1\r\n\r\nHello\r\nworld\r\n');
    const unix = loadPrompt(root, 'a');
    const windows = loadPrompt(root, 'b');
    expect(unix).toMatchObject({ version: 'a/1', text: 'Hello\nworld' });
    expect(windows.hash).toBe(unix.hash);
    writeFileSync(join(root, 'prompts', 'c.md'), 'no version line\n');
    expect(() => loadPrompt(root, 'c')).toThrow(/version/);
  });

  it('ships planner and expand prompts with version lines', () => {
    const root = findRepoRoot();
    expect(existsSync(join(root, 'prompts', 'planner.md'))).toBe(true);
    expect(loadPrompt(root, 'planner').version).toMatch(/^planner\/\d+$/);
    expect(loadPrompt(root, 'expand').version).toMatch(/^expand\/\d+$/);
  });
});
