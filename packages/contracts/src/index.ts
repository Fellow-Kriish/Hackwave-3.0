import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IntentSchema, type Intent } from './intent';
import { PlanSchema, type Plan } from './plan';

export * from './intent';
export * from './plan';
export * from './project';
export * from './records';
export * from './redact';
export * from './run';
export * from './verdict';

/** Thrown with a readable, field-by-field explanation when a contract file does not validate. */
export class ContractError extends Error {
  override readonly name = 'ContractError';
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ContractError(`${what} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function parseIntent(raw: unknown, what = 'intent'): Intent {
  return parseWith(IntentSchema, raw, what);
}

export function parsePlan(raw: unknown, what = 'plan'): Plan {
  return parseWith(PlanSchema, raw, what);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
