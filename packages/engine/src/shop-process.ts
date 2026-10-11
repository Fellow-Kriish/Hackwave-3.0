import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A shop started for one eval fixture: its own port, its own store, killable mid-run. */
export interface PrivateShop {
  origin: string;
  /** Kill the server now (the env-down fixture). */
  kill(): Promise<void>;
  /** Kill if still running and remove the private store. */
  stop(): Promise<void>;
}

const START_TIMEOUT_MS = 20_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Clears a shop's store through its test-only endpoint, so the next order is 4821 again. */
export async function resetStore(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/_test/reset`, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch((error: unknown) => {
    throw new Error(`${origin} is not reachable (${error instanceof Error ? error.message : String(error)}); start the shops with pnpm shop`);
  });
  if (!response.ok) throw new Error(`reset on ${origin} returned HTTP ${response.status}; is SHOP_TEST_MODE=1?`);
}

/** Why the shop at origin is not the expected version with its reset endpoint on, or null when it is. */
export async function shopProblem(origin: string, version: string): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/api/_health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return `${origin} answered HTTP ${response.status}`;
    const health = (await response.json()) as { version?: unknown; testMode?: unknown };
    if (health.version !== version) return `${origin} serves ${String(health.version)}, expected ${version}`;
    if (health.testMode !== true) return `${origin} has its reset endpoint off; start it with SHOP_TEST_MODE=1 (pnpm shop does)`;
    return null;
  } catch (error) {
    return `nothing answers on ${origin} (${error instanceof Error ? error.message : String(error)}); start the shops with pnpm shop`;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no free port'))));
    });
  });
}

export async function startPrivateShop(root: string, version: string): Promise<PrivateShop> {
  const shopDir = join(root, 'apps', 'shop');
  if (!existsSync(join(shopDir, 'dist', 'index.html'))) throw new Error('the shop is not built; run pnpm shop (or pnpm --filter @hackwave/shop build) first');
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'hackwave-shop-'));
  const child = spawn(process.execPath, ['--import', 'tsx', join('server', 'index.ts')], {
    cwd: shopDir,
    env: { ...process.env, SHOP_VERSION: version, PORT: String(port), SHOP_TEST_MODE: '1', SHOP_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-2000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const running = () => child.exitCode === null && child.signalCode === null;
  const kill = async () => {
    if (!running()) return;
    child.kill();
    await exited;
  };
  const origin = `http://localhost:${port}`;

  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    if (!running()) throw new Error(`private ${version} shop exited during start: ${output.trim()}`);
    try {
      const response = await fetch(`${origin}/api/_health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await kill();
      throw new Error(`private ${version} shop did not start within ${START_TIMEOUT_MS} ms: ${output.trim()}`);
    }
    await delay(150);
  }

  return {
    origin,
    kill,
    async stop() {
      await kill();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
