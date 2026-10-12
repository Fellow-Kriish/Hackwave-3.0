import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from './paths';
import { loadProjects, originMatches, projectFor } from './projects';

describe('projects: a new app is added by adding its file', () => {
  it('loads the demo shop and matches it on any local port, and nothing else', () => {
    const projects = loadProjects(findRepoRoot());
    expect(projectFor(projects, 'http://localhost:5172')?.id).toBe('demo-shop');
    expect(projectFor(projects, 'http://127.0.0.1:61234')?.id).toBe('demo-shop');
    expect(projectFor(projects, 'https://www.amazon.in')).toBeNull();
    expect(projectFor(projects, 'http://localhost.evil.example')).toBeNull();
  });

  it('lets an exact address beat a wildcard: the demo sites keep their own store, the shop keeps the rest', () => {
    const projects = loadProjects(findRepoRoot());
    expect(projectFor(projects, 'http://localhost:5182')?.id).toBe('shopsphere');
    expect(projectFor(projects, 'http://127.0.0.1:5193')?.id).toBe('harbor-pine');
    expect(projectFor(projects, 'http://localhost:5172')?.id).toBe('demo-shop');
    expect(projectFor(projects, 'http://localhost:5182')?.stores.orders).toMatchObject({ kind: 'browser-storage', key: 'shopsphere-data' });
  });

  it('matches wildcard subdomains and ports exactly', () => {
    expect(originMatches('https://*.example.com', 'https://shop.example.com')).toBe(true);
    expect(originMatches('https://*.example.com', 'https://example.com')).toBe(false);
    expect(originMatches('https://*.example.com', 'https://shop.example.com.evil.io')).toBe(false);
    expect(originMatches('http://localhost:*', 'http://localhost:4321')).toBe(true);
  });

  it('picks up a dropped-in project and refuses a broken one loudly', () => {
    const root = mkdtempSync(join(tmpdir(), 'hw-projects-'));
    mkdirSync(join(root, 'projects'));
    writeFileSync(
      join(root, 'projects', 'bookings.json'),
      JSON.stringify({ id: 'bookings', name: 'Bookings app', match: ['https://*.bookings.test'], stores: { bookings: { list: '/api/v2/bookings', get: '/api/v2/bookings/{id}', fields: { id: 'ref' } } } }),
    );
    expect(projectFor(loadProjects(root), 'https://staging.bookings.test')?.stores.bookings?.list).toBe('/api/v2/bookings');
    writeFileSync(join(root, 'projects', 'broken.json'), JSON.stringify({ id: 'Broken', name: 'x', match: [], stores: {} }));
    expect(() => loadProjects(root)).toThrow(/projects\/broken.json is invalid/);
    rmSync(root, { recursive: true, force: true });
  });
});
