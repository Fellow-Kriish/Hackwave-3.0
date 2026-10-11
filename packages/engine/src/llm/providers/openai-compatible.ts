import { performance } from 'node:perf_hooks';
import { postJson } from './http';
import type { Driver, FetchLike, ProviderEndpoint } from './types';

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** OpenAI Chat Completions and every API that copies it: OpenAI, Gemini, Groq, OpenRouter, Ollama, custom servers. */
export function openAiCompatibleDriver(endpoint: ProviderEndpoint, fetchImpl: FetchLike = fetch): Driver {
  const url = `${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {};
  return {
    async complete(request) {
      const started = performance.now();
      const body: Record<string, unknown> = {
        model: endpoint.model,
        temperature: 0,
        [endpoint.maxTokensField]: request.maxTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      };
      if (endpoint.jsonMode) body.response_format = { type: 'json_object' };
      const data = (await postJson(fetchImpl, url, headers, body, request.timeoutMs, request.deadline)) as ChatResponse;
      const choice = data.choices?.[0];
      return {
        text: choice?.message?.content ?? '',
        usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
        ms: Math.round(performance.now() - started),
        stopReason: choice?.finish_reason ?? null,
      };
    },
  };
}
