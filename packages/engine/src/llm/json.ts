import { z } from 'zod';

/** Pulls the JSON object out of a reply, tolerating a ```json fence or a sentence around it. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('the reply was empty');
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('the reply contains no JSON object');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (error) {
    throw new Error(`the reply is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export type ParsedReply<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse and validate against the call's schema, semantic checks included. */
export function parseReply<T>(text: string, schema: z.ZodType<T>): ParsedReply<T> {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: z.prettifyError(parsed.error) };
}
