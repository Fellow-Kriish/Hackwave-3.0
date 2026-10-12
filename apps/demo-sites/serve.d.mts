import type { Server } from 'node:http';

export const SITES: Record<'shopsphere' | 'harbor-pine', { name: string; ports: Record<'v1' | 'v2' | 'v3', number> }>;
export function fileFor(root: string, urlPath: string): string | null;
export function serveSite(site: 'shopsphere' | 'harbor-pine', version: 'v1' | 'v2' | 'v3', port: number): Promise<Server>;
