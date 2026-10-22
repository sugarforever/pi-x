import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { checkVersions } from './check-version.mjs';

export async function packageExtension(root = process.cwd(), tag = process.env.RELEASE_TAG) {
  const version = await checkVersions(root, tag);
  const manifest = JSON.parse(await readFile(resolve(root, 'dist/manifest.json'), 'utf8'));
  if (manifest.version !== version)
    throw new Error('Build version is stale. Run npm run build:release.');
  // An allowlist prevents source maps, local paths, dotfiles, or future development artifacts from shipping.
  const files = [
    'manifest.json',
    'background.js',
    'content.js',
    'options.js',
    'options.html',
    'options.css',
  ];
  const entries = {};
  for (const file of files)
    entries[file] = new Uint8Array(await readFile(resolve(root, 'dist', file)));
  for (const file of ['LICENSE', 'INSTALL.md'])
    entries[file] = new Uint8Array(await readFile(resolve(root, file)));
  const bytes = zipSync(entries, { level: 9, mtime: new Date(1980, 0, 1, 0, 0, 0) });
  const directory = resolve(root, 'release');
  await mkdir(directory, { recursive: true });
  const archive = resolve(directory, `pi-x-v${version}.zip`);
  const checksum = resolve(directory, 'SHA256SUMS.txt');
  await writeFile(archive, bytes);
  await writeFile(
    checksum,
    `${createHash('sha256').update(bytes).digest('hex')}  ${basename(archive)}\n`,
  );
  return { archive, checksum };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(await packageExtension());
}
