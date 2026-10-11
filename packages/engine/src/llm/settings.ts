import type { EngineConfig } from '../config';
import type { Manifest } from './cache';
import type { ProviderEndpoint } from './providers';

export type LlmMode = 'live' | 'record' | 'replay';
export type Tier = 'strong' | 'fast';

export type TierSetting =
  | { ok: true; provider: string; model: string; /** null in replay mode: nothing is ever sent. */ endpoint: ProviderEndpoint | null }
  | { ok: false; problem: string };

export interface LlmSettings {
  mode: LlmMode;
  tiers: Record<Tier, TierSetting>;
  /** Replay pins provider and model ids to the cache manifest, so it needs no .env at all. */
  pinnedToManifest: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Empty values and the .env.example placeholder count as unset. */
function read(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value !== 'replace-me' ? value : undefined;
}

function endpointFor(
  config: EngineConfig,
  provider: string,
  model: string | undefined,
  apiKey: string | undefined,
  baseUrl: string | null,
  vars: { model: string; key: string },
): TierSetting {
  const entry = config.llm.providers[provider];
  if (!entry) return { ok: false, problem: `unknown provider "${provider}"; choose one of ${Object.keys(config.llm.providers).join(', ')}` };
  if (!model) return { ok: false, problem: `${vars.model} is not set` };
  if (entry.needsKey && !apiKey) return { ok: false, problem: `${vars.key} is not set for ${provider}` };
  if (!baseUrl) return { ok: false, problem: `LLM_BASE_URL is required for ${provider}` };
  return {
    ok: true,
    provider,
    model,
    endpoint: {
      provider,
      model,
      driver: entry.driver,
      baseUrl,
      apiKey: apiKey ?? null,
      jsonMode: entry.jsonMode,
      maxTokensField: entry.maxTokensField ?? 'max_tokens',
    },
  };
}

/**
 * Which provider and model each tier uses. Live and record read env (LLM_PROVIDER, LLM_MODEL_STRONG, ...)
 * over engine.config.json; replay reads runs/llm-cache/manifest.json and needs no key.
 */
export function resolveLlmSettings(config: EngineConfig, env: Env, manifest: Manifest | null): LlmSettings {
  const mode = read(env, 'LLM_MODE') ?? config.llm.mode;
  if (mode !== 'live' && mode !== 'record' && mode !== 'replay') throw new Error(`LLM_MODE must be live, record or replay (got "${mode}")`);

  if (mode === 'replay') {
    const pinned = (tier: Tier): TierSetting => {
      const pin = manifest?.tiers[tier];
      if (pin) return { ok: true, provider: pin.provider, model: pin.model, endpoint: null };
      return {
        ok: false,
        problem: manifest ? `the cache manifest records no ${tier} model` : 'runs/llm-cache/manifest.json does not exist yet; record first with LLM_MODE=record',
      };
    };
    return { mode, tiers: { strong: pinned('strong'), fast: pinned('fast') }, pinnedToManifest: true };
  }

  const strongProvider = read(env, 'LLM_PROVIDER') ?? config.llm.provider;
  const fastProvider = read(env, 'LLM_PROVIDER_FAST') ?? config.llm.providerFast ?? strongProvider;
  const strongBaseUrl = read(env, 'LLM_BASE_URL') ?? config.llm.baseUrl ?? config.llm.providers[strongProvider]?.baseUrl ?? null;
  const sameProvider = fastProvider === strongProvider;
  return {
    mode,
    pinnedToManifest: false,
    tiers: {
      strong: endpointFor(config, strongProvider, read(env, 'LLM_MODEL_STRONG'), read(env, 'LLM_API_KEY'), strongBaseUrl, {
        model: 'LLM_MODEL_STRONG',
        key: 'LLM_API_KEY',
      }),
      fast: endpointFor(
        config,
        fastProvider,
        read(env, 'LLM_MODEL_FAST'),
        read(env, 'LLM_API_KEY_FAST') ?? (sameProvider ? read(env, 'LLM_API_KEY') : undefined),
        sameProvider ? strongBaseUrl : (config.llm.providers[fastProvider]?.baseUrl ?? null),
        { model: 'LLM_MODEL_FAST', key: sameProvider ? 'LLM_API_KEY' : 'LLM_API_KEY_FAST' },
      ),
    },
  };
}

export function describeTier(setting: TierSetting): string {
  return setting.ok ? `${setting.provider} · ${setting.model}` : `not configured (${setting.problem})`;
}
