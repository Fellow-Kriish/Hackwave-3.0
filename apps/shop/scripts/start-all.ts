import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { APP_ROOT, readShopPorts } from '../server/paths';

/** Starts one shop process per entry in shop.ports, side by side, with the test-only reset endpoint on. */
const shops = Object.entries(readShopPorts()) as [string, number][];
if (shops.length === 0) throw new Error('engine.config.json has no shop.ports');

const children = new Set<ChildProcess>();
let ready = 0;
let stopping = false;

function stopAll(exitCode: number): void {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) child.kill();
}

for (const [version, port] of shops) {
  const tag = `[${version}]`.padEnd(12);
  const child = spawn(process.execPath, ['--import', 'tsx', join('server', 'index.ts')], {
    cwd: APP_ROOT,
    env: { ...process.env, SHOP_VERSION: version, PORT: String(port), SHOP_TEST_MODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);

  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      console.log(`${tag} ${line}`);
      if (line.startsWith(`shop ${version} on `) && ++ready === shops.length) {
        console.log(`\nAll ${shops.length} shops are up. Press Ctrl+C to stop.`);
      }
    });
  }

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${tag} exited (${signal ?? `code ${code}`}); stopping the other shops.`);
      stopAll(code || 1);
    }
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
