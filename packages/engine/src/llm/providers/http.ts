import { llmUnavailable } from '../errors';
import type { FetchLike } from './types';

const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 2;
const MAX_WAIT_MS = 20_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(response: Response, attempt: number): number {
  const header = Number(response.headers.get('retry-after'));
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : 1000 * 2 ** attempt;
  return Math.min(ms, MAX_WAIT_MS);
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message || (error.cause as NodeJS.ErrnoException).code || '' : '';
  return cause ? `${error.message} (${cause})` : error.message;
}

/** Our own per-attempt timeout (or an abort): the attempt already spent its whole budget, so it is not retried. */
const isOwnTimeout = (error: unknown) => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

/**
 * POST JSON with a per-attempt timeout. Rate limits, transient server errors and connections that fail before
 * any response (a dropped or timed-out connect) are retried at most twice, honouring retry-after, and never past
 * the deadline. Anything else fails at once.
 */
export async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, deadline: number): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const wait = 1000 * 2 ** attempt;
      if (!isOwnTimeout(error) && attempt < MAX_RETRIES && Date.now() + wait < deadline) {
        await delay(wait);
        continue;
      }
      throw llmUnavailable(`model request to ${new URL(url).host} failed: ${describe(error)}`, error);
    }
    if (response.ok) return response.json();
    const text = (await response.text().catch(() => '')).slice(0, 300);
    const wait = waitFor(response, attempt);
    if (RETRYABLE.has(response.status) && attempt < MAX_RETRIES && Date.now() + wait < deadline) {
      await delay(wait);
      continue;
    }
    throw llmUnavailable(`model request to ${new URL(url).host} returned HTTP ${response.status}: ${text}`);
  }
}
