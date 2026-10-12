import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectSchema, type Project } from '@hackwave/contracts';
import { z } from 'zod';

/**
 * Every projects/<id>.json, validated. A broken file stops the run with a readable error rather than being skipped:
 * a project that silently fails to load would send its runs to the wrong source of truth.
 */
export function loadProjects(root: string): Project[] {
  const dir = join(root, 'projects');
  if (!existsSync(dir)) return [];
  const projects: Project[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      throw new Error(`projects/${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const parsed = ProjectSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`projects/${file} is invalid:\n${z.prettifyError(parsed.error)}`);
    if (projects.some((project) => project.id === parsed.data.id)) throw new Error(`projects/${file}: the id "${parsed.data.id}" is used twice`);
    projects.push(parsed.data);
  }
  return projects;
}

/** "http://localhost:*" matches any port on localhost; "https://*.example.com" any one subdomain label. */
export function originMatches(pattern: string, origin: string): boolean {
  const normalised = (() => {
    try {
      return new URL(pattern.replace(/\*/g, 'wildcard')).origin.replace(/wildcard/g, '*');
    } catch {
      return pattern;
    }
  })();
  const regex = new RegExp(`^${normalised.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[A-Za-z0-9-]+')}$`);
  return regex.test(origin);
}

/**
 * The project whose match covers the origin, or null. The most specific pattern wins (fewest "*"), so
 * "http://localhost:5182" beats the demo shop's "http://localhost:*"; a tie goes to the first file by name.
 */
export function projectFor(projects: readonly Project[], origin: string): Project | null {
  let best: { project: Project; wildcards: number } | null = null;
  for (const project of projects) {
    for (const pattern of project.match) {
      if (!originMatches(pattern, origin)) continue;
      const wildcards = pattern.split('*').length - 1;
      if (!best || wildcards < best.wildcards) best = { project, wildcards };
    }
  }
  return best?.project ?? null;
}
