import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  ADGUARD_EXTRA_URL,
  extractAdGuardExtraManifest,
  validateAdGuardExtraManifest,
} from '../tools/extract_adguard_extra_hosts.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function syntheticScript({
  version = '1.2.3',
  hosts = ['Twitch.tv', 'facebook.com', '*.Kinopoisk.ru', 'twitch.tv'],
  tinyShieldDomains = ['Example.org', 'sub.test.net', 'example.org'],
  entry = 'try{shouldRunExtra(allHosts);}finally{enableTinyShieldForCurrentPage();}',
} = {}) {
  return `// ==UserScript==
// @name AdGuard Extra
// @version ${version}
// @match *://*/*
// ==/UserScript==
class HostsMap {
  constructor(entries) {
    this.hosts = new Map(entries);
    this.getHosts = () => new Map([...this.hosts]);
  }
}
const allHosts = new HostsMap(${JSON.stringify(hosts.map(h => [h, 1]))});
function shouldRunExtra() { throw new Error('must not execute shouldRunExtra'); }
function getTinyShieldDomains() { return new Set(${JSON.stringify(tinyShieldDomains)}); }
function enableTinyShieldForCurrentPage() { throw new Error('must not execute tinyShield'); }
${entry}
`;
}

// 1. Extraction deduplicates, lowercases, sorts, and never invokes runtime entry points.
{
  const manifest = extractAdGuardExtraManifest(syntheticScript(), {
    minHosts: 1,
    minTinyShieldDomains: 1,
  });
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceURL, ADGUARD_EXTRA_URL);
  assert.equal(manifest.version, '1.2.3');
  assert.match(manifest.scriptSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.hosts, ['*.kinopoisk.ru', 'facebook.com', 'twitch.tv']);
  assert.deepEqual(manifest.tinyShieldDomains, ['example.org', 'sub.test.net']);
}

// 2. Rejects unexpected entry point instead of producing a silent partial manifest.
{
  assert.throws(
    () =>
      extractAdGuardExtraManifest(
        syntheticScript({entry: 'shouldRunExtra(allHosts);'}),
        {minHosts: 1, minTinyShieldDomains: 1},
      ),
    /entry point changed/i,
  );
}

// 3. Rejects missing @version.
{
  const noVersion = syntheticScript().replace(/^\/\/ @version .*\n/m, '');
  assert.throws(
    () => extractAdGuardExtraManifest(noVersion, {minHosts: 1, minTinyShieldDomains: 1}),
    /Missing @version/i,
  );
}

// 4. Rejects invalid host entries.
{
  assert.throws(
    () =>
      extractAdGuardExtraManifest(
        syntheticScript({hosts: ['twitch.tv', 'https://bad/path']}),
        {minHosts: 1, minTinyShieldDomains: 1},
      ),
    /Invalid entry in hosts/i,
  );
}

// 5. Tracked manifest on disk passes full schema and sanity validation offline.
{
  const raw = await readFile(join(root, 'manifests/adguard-extra-hosts.json'), 'utf8');
  const manifest = JSON.parse(raw);
  validateAdGuardExtraManifest(manifest);
  assert.ok(manifest.hosts.includes('twitch.tv'), 'expected twitch.tv in tracked manifest');
  assert.ok(manifest.hosts.includes('facebook.com'), 'expected facebook.com in tracked manifest');
}

console.log('adguard-extra-hosts.test: PASS');
