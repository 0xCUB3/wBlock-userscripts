import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packages = ['tube-cleaner', 'player-cleaner', 'no-autoplay'];
const metadata = source => {
  const match = source.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  if (!match) throw new Error('missing userscript metadata');
  return `${match[0]}\n`;
};
await mkdir(join(root, 'packages/dark-reader/dist'), {recursive: true});
for (const slug of packages) {
  const source = await readFile(join(root, `packages/${slug}/src/${slug}.user.js`), 'utf8');
  await mkdir(join(root, `packages/${slug}/dist`), {recursive: true});
  await writeFile(join(root, `packages/${slug}/dist/${slug}.user.js`), source);
  await writeFile(join(root, `packages/${slug}/dist/${slug}.meta.js`), metadata(source));
}
const vendor = await readFile(join(root, 'packages/dark-reader/vendor/darkreader-api.min.js'), 'utf8');
const adapter = await readFile(join(root, 'packages/dark-reader/src/adapter.user.js'), 'utf8');
const bundled = `${vendor.trimEnd()}\n${adapter}`;
await writeFile(join(root, 'packages/dark-reader/dist/dark-reader.user.js'), bundled);
await writeFile(join(root, 'packages/dark-reader/dist/dark-reader.meta.js'), metadata(adapter));
console.log('Built cleaner and Dark Reader distributions.');
