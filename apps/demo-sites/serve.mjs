// Serves the static demo sites, one port per version, on 127.0.0.1 only:
//   ShopSphere   v1 5181 · v2 5182 · v3 5183 (v3: orders confirmed but not saved)
//   Harbor & Pine v1 5191 · v2 5192 · v3 5193 (v3: reservations confirmed but not saved)
// Usage: node apps/demo-sites/serve.mjs [shopsphere|harbor-pine]   (no argument: both)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SITES = {
  shopsphere: { name: 'ShopSphere', ports: { v1: 5181, v2: 5182, v3: 5183 } },
  'harbor-pine': { name: 'Harbor & Pine', ports: { v1: 5191, v2: 5192, v3: 5193 } },
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

/** A file inside the version's folder for a URL path, or null: nothing outside the folder is ever served. */
export function fileFor(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = resolve(root, normalize(`.${decoded.endsWith('/') ? `${decoded}index.html` : decoded}`));
  const inside = relative(root, file);
  if (inside.startsWith('..') || resolve(inside) === inside) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

/** Serves one version of a site on a port (0: any free port); resolves once it listens. */
export function serveSite(site, version, port) {
  const root = join(HERE, site, version);
  const server = createServer((request, response) => {
    const file = request.method === 'GET' || request.method === 'HEAD' ? fileFor(root, request.url ?? '/') : null;
    if (!file) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  });
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wanted = process.argv[2];
  if (wanted && !(wanted in SITES)) {
    console.error(`unknown site "${wanted}"; choose ${Object.keys(SITES).join(' or ')}`);
    process.exit(2);
  }
  const servers = [];
  for (const [site, { name, ports }] of Object.entries(SITES)) {
    if (wanted && site !== wanted) continue;
    for (const [version, port] of Object.entries(ports)) {
      try {
        servers.push(await serveSite(site, version, port));
        console.log(`${name} ${version}: http://localhost:${port}`);
      } catch (error) {
        console.error(`${name} ${version}: port ${port} ${error.code === 'EADDRINUSE' ? 'is already in use' : `failed: ${error.message}`}`);
      }
    }
  }
  console.log('Ctrl+C stops them.');
  process.on('SIGINT', () => {
    for (const server of servers) server.close();
    process.exit(0);
  });
}
