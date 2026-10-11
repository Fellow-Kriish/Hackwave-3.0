import { OutcomeError } from '../outcome';

/**
 * Why a model call produced no usable answer. Invalid output and exhausted budgets are unresolvable
 * (the caller escalates or the run refuses to guess); an unreachable or unconfigured model is environment.
 */
export class LlmError extends OutcomeError {
  override readonly name = 'LlmError';
}

export const llmUnavailable = (message: string, cause?: unknown) => new LlmError('environment', 'llm_unavailable', message, { cause });
export const llmInvalidOutput = (message: string) => new LlmError('unresolvable', 'llm_invalid_output', message);
