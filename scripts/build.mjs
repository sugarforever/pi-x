import { build } from 'esbuild';
import { mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
const production = process.argv.includes('--release');
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const shared = {
  bundle: true,
  target: 'chrome120',
  platform: 'browser',
  sourcemap: !production,
  minify: production,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
};
const outputs = await Promise.all([
  build({
    ...shared,
    entryPoints: ['src/background/index.ts'],
    outfile: 'dist/background.js',
    format: 'esm',
    metafile: true,
  }),
  build({
    ...shared,
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content.js',
    format: 'iife',
  }),
  build({
    ...shared,
    entryPoints: ['src/options/index.ts'],
    outfile: 'dist/options.js',
    format: 'iife',
  }),
]);
await Promise.all([
  copyFile('manifest.json', 'dist/manifest.json'),
  copyFile('src/options/options.html', 'dist/options.html'),
  copyFile('src/options/options.css', 'dist/options.css'),
]);
if (!production) await writeFile('dist/meta.json', JSON.stringify(outputs[0].metafile, null, 2));
console.log('Built Chrome extension in dist/');
