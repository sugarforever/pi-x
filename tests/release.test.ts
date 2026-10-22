import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { checkVersions } from '../scripts/check-version.mjs';
import { packageExtension } from '../scripts/package-extension.mjs';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-x-package-'));
  roots.push(root);
  const json = async (name: string, value: unknown) =>
    writeFile(join(root, name), JSON.stringify(value));
  await json('package.json', { name: 'pi-x', version: '1.2.3' });
  await json('package-lock.json', { version: '1.2.3', packages: { '': { version: '1.2.3' } } });
  await json('manifest.json', { version: '1.2.3' });
  await json('.release-please-manifest.json', { '.': '1.2.3' });
  await mkdir(join(root, 'dist'));
  await json('dist/manifest.json', { version: '1.2.3' });
  for (const name of ['background.js', 'content.js', 'options.js', 'options.html', 'options.css'])
    await writeFile(join(root, 'dist', name), '/* production asset */');
  await writeFile(join(root, 'LICENSE'), 'MIT fixture');
  await writeFile(join(root, 'INSTALL.md'), 'Extract and load unpacked.');
  await writeFile(join(root, 'dist', 'background.js.map'), 'private source');
  await writeFile(join(root, 'dist', 'meta.json'), 'local paths');
  await writeFile(join(root, 'dist', '.env'), 'API_KEY=secret');
  return { root, json };
}
it('requires the tag and all versioned files to identify the same release', async () => {
  const { root, json } = await fixture();
  expect(await checkVersions(root, 'v1.2.3')).toBe('1.2.3');
  await expect(checkVersions(root, 'v1.2.4')).rejects.toThrow(/tag/i);
  await json('manifest.json', { version: '1.2.4' });
  await expect(checkVersions(root)).rejects.toThrow(/manifest/i);
});
it('rejects versions Chrome cannot install', async () => {
  const { root, json } = await fixture();
  for (const version of ['1.2.3-beta.1', '01.2.3', '65536.0.1', '0.0.0']) {
    await json('package.json', { version });
    await expect(checkVersions(root)).rejects.toThrow(/version/i);
  }
});
it('fails when the lockfile or release metadata drifts', async () => {
  const { root, json } = await fixture();
  await json('package-lock.json', { version: '1.2.3', packages: { '': { version: '1.1.0' } } });
  await expect(checkVersions(root)).rejects.toThrow(/lock/i);
  await json('package-lock.json', { version: '1.2.3', packages: { '': { version: '1.2.3' } } });
  await json('.release-please-manifest.json', { '.': '1.0.0' });
  await expect(checkVersions(root)).rejects.toThrow(/release/i);
});
it('packages only runtime assets with a root manifest, installation guide, and a valid checksum', async () => {
  const { root } = await fixture();
  const { archive, checksum } = await packageExtension(root, 'v1.2.3');
  const bytes = await readFile(archive);
  const contents = unzipSync(bytes);
  expect(Object.keys(contents).sort()).toEqual([
    'INSTALL.md',
    'LICENSE',
    'background.js',
    'content.js',
    'manifest.json',
    'options.css',
    'options.html',
    'options.js',
  ]);
  expect(JSON.parse(strFromU8(contents['manifest.json'])).version).toBe('1.2.3');
  expect(strFromU8(contents['INSTALL.md'])).toContain('load unpacked');
  expect(await readFile(checksum, 'utf8')).toBe(
    `${createHash('sha256').update(bytes).digest('hex')}  pi-x-v1.2.3.zip\n`,
  );
  const again = await packageExtension(root, 'v1.2.3');
  expect(await readFile(again.archive)).toEqual(bytes);
});
it('refuses a stale build or a missing runtime asset', async () => {
  const { root, json } = await fixture();
  await json('dist/manifest.json', { version: '1.0.0' });
  await expect(packageExtension(root)).rejects.toThrow(/build/i);
  await json('dist/manifest.json', { version: '1.2.3' });
  await rm(join(root, 'dist', 'background.js'));
  await expect(packageExtension(root)).rejects.toThrow();
});
it('produces the same archive in a different timezone', async () => {
  const { root } = await fixture();
  const { archive } = await packageExtension(root);
  const original = await readFile(archive);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  await promisify(execFile)(
    process.execPath,
    [fileURLToPath(new URL('../scripts/package-extension.mjs', import.meta.url))],
    { cwd: root, env: { ...process.env, TZ: 'America/Los_Angeles', RELEASE_TAG: '' } },
  );
  expect(await readFile(archive)).toEqual(original);
});
