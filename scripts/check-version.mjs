import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkVersions(root = process.cwd(), tag = process.env.RELEASE_TAG) {
  const read = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const pkg = await read('package.json');
  const version = pkg.version;
  if (
    typeof version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version.split('.').some((n) => Number(n) > 65535) ||
    version === '0.0.0'
  ) {
    throw new Error(
      'Release version must be MAJOR.MINOR.PATCH, with Chrome-compatible integers (0–65535), and cannot be 0.0.0.',
    );
  }
  const manifest = await read('manifest.json');
  const lock = await read('package-lock.json');
  const release = await read('.release-please-manifest.json');
  for (const [name, value] of [
    ['manifest.json', manifest.version],
    ['package-lock.json', lock.version],
    ['package-lock.json root', lock.packages?.['']?.version],
  ]) {
    if (value !== version)
      throw new Error(`${name} version ${value} does not match package.json ${version}.`);
  }
  // Empty metadata is Release Please's documented bootstrap for an unreleased package.
  if (release['.'] !== undefined && release['.'] !== version)
    throw new Error('Release Please metadata does not match package.json.');
  if (tag !== undefined && tag !== '' && tag !== `v${version}`)
    throw new Error(`Release tag must be v${version}; received ${tag}.`);
  return version;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(
    `Version verified: ${await checkVersions(process.cwd(), process.argv[2] || process.env.RELEASE_TAG)}`,
  );
}
