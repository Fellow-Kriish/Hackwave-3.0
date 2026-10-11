/** Everything a driver needs to reach one provider. Provider ids, base URLs and model ids come from config and env. */
export interface ProviderEndpoint {
  provider: string;
  model: string;
  driver: 'anthropic' | 'openai-compatible';
  baseUrl: string;
  apiKey: string | null;
  jsonMode: boolean;
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
}

export interface DriverRequest {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
  /** Epoch ms after which no rate-limit wait may start (the run budget). */
  deadline: number;
}

export interface DriverResult {
  text: string;
  usage: { input: number; output: number };
  ms: number;
  /** Why generation stopped, as the provider reports it (e.g. "length" when the token cap was hit). */
  stopReason: string | null;
}

/** complete(system, user) at temperature 0, returning text, token usage and milliseconds. */
export interface Driver {
  complete(request: DriverRequest): Promise<DriverResult>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
