import { anthropicDriver } from './anthropic';
import { openAiCompatibleDriver } from './openai-compatible';
import type { Driver, FetchLike, ProviderEndpoint } from './types';

export type { Driver, DriverRequest, DriverResult, FetchLike, ProviderEndpoint } from './types';

/** Two thin drivers cover every major API; LLM_PROVIDER (via the registry in engine.config.json) picks one. */
export function createDriver(endpoint: ProviderEndpoint, fetchImpl?: FetchLike): Driver {
  return endpoint.driver === 'anthropic' ? anthropicDriver(endpoint, fetchImpl) : openAiCompatibleDriver(endpoint, fetchImpl);
}
