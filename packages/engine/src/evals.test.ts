import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { switchProfiles } from './evals';

const config = loadConfig();
const main = { LLM_PROVIDER: 'groq', LLM_API_KEY: 'groq-key', LLM_MODEL_STRONG: 'openai/gpt-oss-120b' };
const byProvider = (env: Record<string, string>) => Object.fromEntries(switchProfiles(config, env).map((profile) => [profile.provider, profile]));

describe('provider-switch profiles', () => {
  it('runs the main provider and skips providers without a model or key', () => {
    const profiles = byProvider({ ...main, LLM_SWITCH_OPENAI_MODEL: 'gpt-x' });
    expect(profiles.groq).toMatchObject({ model: 'openai/gpt-oss-120b', apiKey: 'groq-key', skip: null });
    expect(profiles.openai).toMatchObject({ skip: 'no LLM_SWITCH_OPENAI_API_KEY' });
    expect(profiles.anthropic).toMatchObject({ skip: 'no LLM_SWITCH_ANTHROPIC_MODEL' });
    expect(profiles.custom).toMatchObject({ skip: 'no LLM_SWITCH_CUSTOM_MODEL' });
  });

  it('lets custom reuse the main key only for the host that key already goes to', () => {
    const sameHost = byProvider({ ...main, LLM_SWITCH_CUSTOM_MODEL: 'openai/gpt-oss-120b', LLM_SWITCH_CUSTOM_BASE_URL: 'https://api.groq.com/openai/v1' });
    expect(sameHost.custom).toMatchObject({ apiKey: 'groq-key', baseUrl: 'https://api.groq.com/openai/v1', skip: null });

    const otherHost = byProvider({ ...main, LLM_SWITCH_CUSTOM_MODEL: 'local', LLM_SWITCH_CUSTOM_BASE_URL: 'http://localhost:1234/v1' });
    expect(otherHost.custom).toMatchObject({ apiKey: undefined, skip: null });

    const noUrl = byProvider({ ...main, LLM_SWITCH_CUSTOM_MODEL: 'local' });
    expect(noUrl.custom).toMatchObject({ skip: 'no LLM_SWITCH_CUSTOM_BASE_URL' });
  });

  it('never hands the main key to another vendor, even with a model set', () => {
    const profiles = byProvider({ ...main, LLM_SWITCH_OPENROUTER_MODEL: 'some/model' });
    expect(profiles.openrouter).toMatchObject({ apiKey: undefined, skip: 'no LLM_SWITCH_OPENROUTER_API_KEY' });
  });
});
