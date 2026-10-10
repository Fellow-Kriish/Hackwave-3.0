import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isShopVersion, type ShopVersion } from '../shared/variants';

/** apps/shop, wherever the process was started from. */
export const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

export function findRepoRoot(from: string = APP_ROOT): string {
  let dir = from;
  while (!existsSync(join(dir, 'engine.config.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`engine.config.json not found above ${from}`);
    dir = parent;
  }
  return dir;
}

/** shop.ports from engine.config.json, the single home of every knob. */
export function readShopPorts(): Partial<Record<ShopVersion, number>> {
  const file = join(findRepoRoot(), 'engine.config.json');
  const config = JSON.parse(readFileSync(file, 'utf8')) as { shop?: { ports?: Record<string, unknown> } };
  const ports: Partial<Record<ShopVersion, number>> = {};
  for (const [version, port] of Object.entries(config.shop?.ports ?? {})) {
    if (!isShopVersion(version)) throw new Error(`${file}: shop.ports has unknown version "${version}"`);
    if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) {
      throw new Error(`${file}: shop.ports.${version} must be a port number`);
    }
    ports[version] = port as number;
  }
  return ports;
}
