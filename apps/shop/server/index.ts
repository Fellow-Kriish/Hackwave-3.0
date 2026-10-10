import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { parseShopVersion } from '../shared/variants';
import { createApp } from './app';
import { APP_ROOT, readShopPorts } from './paths';

const version = parseShopVersion(process.env.SHOP_VERSION);
const port = process.env.PORT ? Number(process.env.PORT) : readShopPorts()[version];
if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`No port for ${version}: set PORT or add shop.ports.${version} to engine.config.json`);
}
const testMode = process.env.SHOP_TEST_MODE === '1';
const distDir = join(APP_ROOT, 'dist');
if (!existsSync(join(distDir, 'index.html'))) {
  throw new Error('Front end not built. Run: pnpm --filter @hackwave/shop build');
}

// SHOP_DATA_DIR lets a private instance (e.g. one an eval kills mid-run) keep its own store file.
const dataDir = process.env.SHOP_DATA_DIR ? resolve(process.env.SHOP_DATA_DIR) : join(APP_ROOT, 'data');

const app = createApp({
  version,
  storeFile: join(dataDir, `orders.${version}.json`),
  testMode,
  distDir,
});

// Loopback only: no firewall prompt, nothing exposed to the network.
const server = createServer(app);
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === 'EADDRINUSE' ? `Port ${port} is already in use; is another shop running?` : error.message,
  );
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`shop ${version} on http://localhost:${port} (test mode ${testMode ? 'on' : 'off'})`);
});
