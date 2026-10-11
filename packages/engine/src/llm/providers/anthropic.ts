import { performance } from 'node:perf_hooks';
import { postJson } from './http';
import type { Driver, FetchLike, ProviderEndpoint } from './types';

/** The Messages API protocol version this driver speaks (a wire-format version, not a model id). */
const API_VERSION = '2023-06-01';

interface MessagesResponse {
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string | null;
}

/** Anthropic Messages API. JSON is requested in the prompt; there is no native JSON mode to switch on. */
export function anthropicDriver(endpoint: ProviderEndpoint, fetchImpl: FetchLike = fetch): Driver {
  const url = `${endpoint.baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const headers: Record<string, string> = { 'anthropic-version': API_VERSION };
  if (endpoint.apiKey) headers['x-api-key'] = endpoint.apiKey;
  return {
    async complete(request) {
      const started = performance.now();
      const data = (await postJson(
        fetchImpl,
        url,
        headers,
        {
          model: endpoint.model,
          max_tokens: request.maxTokens,
          temperature: 0,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        },
        request.timeoutMs,
        request.deadline,
      )) as MessagesResponse;
      return {
        text: (data.content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join(''),
        usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
        ms: Math.round(performance.now() - started),
        stopReason: data.stop_reason ?? null,
      };
    },
  };
}
