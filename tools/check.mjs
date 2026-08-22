import {readFile, readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const raw = 'https://raw.githubusercontent.com/0xCUB3/wBlock-userscripts/main';
const specs = [
  ['tube-cleaner', '0.1.1'], ['player-cleaner', '0.1.18'], ['dark-reader', '4.9.128-wblock.6']
];
const fail = message => { throw new Error(message); };
const metadata = text => {
  const m = text.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  if (!m) fail('missing metadata');
  const lines = m[0].split('\n');
  const fields = new Map();
  for (const line of lines) { const x = line.match(/^\/\/ @([^\s]+)\s+(.*)$/); if (x) fields.set(x[1], x[2].trim()); }
  for (const key of ['name','namespace','version','description','match','downloadURL','updateURL']) if (!fields.has(key)) fail(`missing @${key}`);
  if (!/^https?:\/\//.test(fields.get('downloadURL')) || !/^https?:\/\//.test(fields.get('updateURL'))) fail('non-HTTP update URL');
  for (const line of lines.filter(line => /@match\s+/.test(line))) {
    const match = line.match(/@match\s+(\S+)/)?.[1];
    if (!/^https?:\/\//.test(match)) fail(`non-HTTP match: ${match}`);
  }
  return {block:m[0], fields};
};
const all = [];
for (const [slug, version] of specs.slice(0, 2)) {
  const source = await readFile(join(root, `packages/${slug}/src/${slug}.user.js`), 'utf8');
  const dist = await readFile(join(root, `packages/${slug}/dist/${slug}.user.js`), 'utf8');
  const meta = await readFile(join(root, `packages/${slug}/dist/${slug}.meta.js`), 'utf8');
  const a = metadata(source), b = metadata(dist), c = metadata(meta);
  if (a.fields.get('version') !== version || b.fields.get('version') !== version || c.fields.get('version') !== version) fail(`${slug}: version mismatch`);
  const url = `${raw}/packages/${slug}/dist/${slug}`;
  for (const x of [a,b,c]) { if (x.fields.get('downloadURL') !== `${url}.user.js` || x.fields.get('updateURL') !== `${url}.meta.js`) fail(`${slug}: URL mismatch`); }
  if (dist !== source) fail(`${slug}: generated userscript drift`);
  if (meta !== `${b.block}\n`) fail(`${slug}: generated metadata drift`);
  all.push(`${b.fields.get('namespace')}\u0000${b.fields.get('name')}`);
  execFileSync(process.execPath, ['--check', join(root, `packages/${slug}/dist/${slug}.user.js`)]);
}
const vendor = await readFile(join(root, 'packages/dark-reader/vendor/darkreader-api.min.js'), 'utf8');
const adapter = await readFile(join(root, 'packages/dark-reader/src/adapter.user.js'), 'utf8');
const dark = await readFile(join(root, 'packages/dark-reader/dist/dark-reader.user.js'), 'utf8');
const dm = await readFile(join(root, 'packages/dark-reader/dist/dark-reader.meta.js'), 'utf8');
const a = metadata(adapter), b = metadata(dark), c = metadata(dm);
if (a.fields.get('version') !== specs[2][1] || b.fields.get('version') !== specs[2][1] || c.fields.get('version') !== specs[2][1]) fail('dark-reader: version mismatch');
const darkUrl = `${raw}/packages/dark-reader/dist/dark-reader`;
for (const x of [a,b,c]) if (x.fields.get('downloadURL') !== `${darkUrl}.user.js` || x.fields.get('updateURL') !== `${darkUrl}.meta.js`) fail('dark-reader: URL mismatch');
if (dark !== `${vendor.trimEnd()}\n${adapter}`) fail('dark-reader: generated userscript drift');
if (dm !== `${b.block}\n`) fail('dark-reader: generated metadata drift');
execFileSync(process.execPath, ['--check', join(root, 'packages/dark-reader/dist/dark-reader.user.js')]);
all.push(`${b.fields.get('namespace')}\u0000${b.fields.get('name')}`);
if (new Set(all).size !== all.length) fail('duplicate identities');
for (const file of ['packages/tube-cleaner/dist/tube-cleaner.user.js','packages/player-cleaner/dist/player-cleaner.user.js','packages/dark-reader/dist/dark-reader.user.js']) {
  const built = await readFile(join(root, file), 'utf8');
  if (/fetch\(['"]https?:|import\(['"]https?:/.test(built)) fail(`${file}: executable network match`);
}
const allowed = /^(packages|tools|tests|\.github|README\.md|AGENTS\.md|LICENSE|\.gitignore|package\.json|package-lock\.json)(\/|$)/;
for (const f of execFileSync('git', ['ls-files','--others','--exclude-standard'], {cwd:root, encoding:'utf8'}).split('\n').filter(Boolean)) if (/\.(?:js|mjs|cjs|py|sh|swift)$/.test(f) && !allowed.test(f)) fail(`untracked executable source outside expected paths: ${f}`);
console.log('check: PASS');
