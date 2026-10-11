import type { RunOutcome } from '@hackwave/contracts';

/**
 * An error that ends a run with a known outcome: unresolvable (refuse to guess), refused (allowlist)
 * or environment (timeouts, crashes, unreachable services). The executor turns it into the run's reason.
 */
export class OutcomeError extends Error {
  constructor(
    readonly runOutcome: RunOutcome,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
