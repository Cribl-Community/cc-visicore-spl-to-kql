/**
 * Materialize the Cribl pack layout at the repo root for "Import from Git" installs:
 * static/ (from dist/), default/{proxies,policies,schedules,backend}.yml (from config/) and
 * default/backend/*.js (from backend-build/). Run after `npm run build`; release CI commits
 * the output onto the release tag.
 *
 * Usage: node scripts/prepare-git-pack.mjs [--version X.Y.Z]
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
if (!existsSync(dist)) throw new Error('dist folder not found. Run npm run build first.');

const staticDir = join(root, 'static');
const defaultDir = join(root, 'default');
await rm(staticDir, { recursive: true, force: true });
await rm(defaultDir, { recursive: true, force: true });
await mkdir(defaultDir, { recursive: true });
await cp(dist, staticDir, { recursive: true });

for (const name of ['proxies.yml', 'policies.yml', 'schedules.yml']) {
  const src = join(root, 'config', name);
  if (existsSync(src)) await cp(src, join(defaultDir, name));
}

// Backend bundles: copy backend-build/backend/*.js and rewrite the manifest's script paths to .js.
const backendYml = join(root, 'config', 'backend.yml');
const backendBuild = join(root, 'backend-build', 'backend');
if (existsSync(backendYml) && existsSync(backendBuild)) {
  await mkdir(join(defaultDir, 'backend'), { recursive: true });
  for (const f of await readdir(backendBuild)) if (f.endsWith('.js')) await cp(join(backendBuild, f), join(defaultDir, 'backend', f));
  const manifest = (await readFile(backendYml, 'utf8')).replace(/(script:\s*backend\/[^\s]+)\.ts/g, '$1.js');
  await writeFile(join(defaultDir, 'backend.yml'), manifest);
}
console.log('Git pack layout ready: static/, default/');
