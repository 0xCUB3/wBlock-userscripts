import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

export const ADGUARD_EXTRA_URL =
  'https://userscripts.adtidy.org/release/adguard-extra/1.0/adguard-extra.user.js';
export const MANIFEST_SCHEMA_VERSION = 1;

const ENTRY_RE =
  /try\s*\{\s*shouldRunExtra\s*\(\s*allHosts\s*\)\s*;?\s*\}\s*finally\s*\{\s*enableTinyShieldForCurrentPage\s*\(\s*\)\s*;?\s*\}\s*;?\s*$/;
const HOST_RE =
  /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function parseVersion(sourceText) {
  const blockMatch = sourceText.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  if (!blockMatch) {
    throw new Error('Missing UserScript metadata block');
  }
  const versionMatch = blockMatch[0].match(/^\/\/\s*@version\s+(.+)$/m);
  const version = versionMatch?.[1]?.trim();
  if (!version) {
    throw new Error('Missing @version in UserScript metadata');
  }
  return version;
}

function normalizeUniqueSorted(values, label, pattern) {
  const out = new Set();
  for (const raw of values) {
    if (typeof raw !== 'string') {
      throw new Error(`Non-string entry in ${label}`);
    }
    const normalized = raw.trim().toLowerCase().replace(/\.+$/, '');
    if (!pattern.test(normalized)) {
      throw new Error(`Invalid entry in ${label}: ${JSON.stringify(raw)}`);
    }
    out.add(normalized);
  }
  return [...out].sort();
}

export function extractAdGuardExtraManifest(
  sourceText,
  {sourceURL = ADGUARD_EXTRA_URL, minHosts = 50, minTinyShieldDomains = 1000} = {},
) {
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    throw new Error('Empty AdGuard Extra source');
  }

  const version = parseVersion(sourceText);
  const scriptSha256 = createHash('sha256').update(sourceText, 'utf8').digest('hex');

  const entryMatch = sourceText.match(ENTRY_RE);
  if (!entryMatch) {
    throw new Error('AdGuard Extra entry point changed; refusing to emit partial host manifest');
  }

  const prefix = sourceText.slice(0, entryMatch.index);
  const instrumented = `${prefix}
globalThis.__wblockExtracted = (() => {
  const findHostKeys = (container) => {
    if (!container) return null;
    if (typeof container.getHosts === 'function') {
      const map = container.getHosts();
      if (map instanceof Map) return [...map.keys()];
    }
    for (const key of Object.keys(container)) {
      const value = container[key];
      if (value instanceof Map) return [...value.keys()];
    }
    return null;
  };
  const hosts = findHostKeys(typeof allHosts !== 'undefined' ? allHosts : null);
  const tinyShieldDomains =
    typeof getTinyShieldDomains === 'function' ? [...getTinyShieldDomains()] : null;
  return { hosts, tinyShieldDomains };
})();
`;

  const noop = () => {};
  const fakeWindow = {
    location: {
      href: 'https://example.invalid/',
      hostname: 'example.invalid',
      host: 'example.invalid',
      pathname: '/',
      protocol: 'https:',
    },
    navigator: {userAgent: 'Mozilla/5.0'},
    document: {
      createElement: () => ({style: {}, setAttribute: noop, appendChild: noop}),
      documentElement: {appendChild: noop},
      head: {appendChild: noop},
      addEventListener: noop,
      removeEventListener: noop,
    },
    addEventListener: noop,
    removeEventListener: noop,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    console: {log: noop, warn: noop, error: noop, debug: noop, info: noop},
    URL,
    URLSearchParams,
    Map,
    Set,
    WeakMap,
    WeakSet,
    RegExp,
    Object,
    Array,
    Function,
    Error,
    TypeError,
    SyntaxError,
    RangeError,
    Promise,
    Symbol,
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    decodeURIComponent,
    encodeURIComponent,
    atob,
    btoa,
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
  };
  fakeWindow.window = fakeWindow;
  fakeWindow.self = fakeWindow;
  fakeWindow.top = fakeWindow;
  fakeWindow.unsafeWindow = fakeWindow;

  const context = vm.createContext(fakeWindow);
  vm.runInContext(instrumented, context, {
    filename: 'adguard-extra.user.js',
    timeout: 10_000,
  });

  const extracted = context.__wblockExtracted;
  if (!extracted || !Array.isArray(extracted.hosts)) {
    throw new Error('Failed to extract allHosts map from AdGuard Extra');
  }
  if (!Array.isArray(extracted.tinyShieldDomains)) {
    throw new Error('Failed to extract tinyShieldDomains from AdGuard Extra');
  }

  const hosts = normalizeUniqueSorted(extracted.hosts, 'hosts', HOST_RE);
  const tinyShieldDomains = normalizeUniqueSorted(
    extracted.tinyShieldDomains,
    'tinyShieldDomains',
    DOMAIN_RE,
  );

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sourceURL,
    version,
    scriptSha256,
    hosts,
    tinyShieldDomains,
  };

  validateAdGuardExtraManifest(manifest, {minHosts, minTinyShieldDomains});
  return manifest;
}

export function validateAdGuardExtraManifest(
  manifest,
  {minHosts = 50, minTinyShieldDomains = 1000} = {},
) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be a JSON object');
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unexpected schemaVersion: ${manifest.schemaVersion}`);
  }
  if (manifest.sourceURL !== ADGUARD_EXTRA_URL) {
    throw new Error(`Unexpected sourceURL: ${manifest.sourceURL}`);
  }
  if (typeof manifest.version !== 'string' || !/^\d+(?:\.\d+)+$/.test(manifest.version)) {
    throw new Error(`Invalid version: ${manifest.version}`);
  }
  if (typeof manifest.scriptSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.scriptSha256)) {
    throw new Error(`Invalid scriptSha256: ${manifest.scriptSha256}`);
  }
  if (!Array.isArray(manifest.hosts) || manifest.hosts.length < minHosts) {
    throw new Error(`Expected at least ${minHosts} hosts, got ${manifest.hosts?.length ?? 0}`);
  }
  if (
    !Array.isArray(manifest.tinyShieldDomains) ||
    manifest.tinyShieldDomains.length < minTinyShieldDomains
  ) {
    throw new Error(
      `Expected at least ${minTinyShieldDomains} tinyShieldDomains, got ${manifest.tinyShieldDomains?.length ?? 0}`,
    );
  }

  const checkSortedUnique = (list, label, pattern) => {
    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i];
      if (typeof entry !== 'string' || !pattern.test(entry)) {
        throw new Error(`Invalid entry in ${label}: ${JSON.stringify(entry)}`);
      }
      if (i > 0 && list[i - 1] >= entry) {
        throw new Error(`${label} must be strictly sorted and deduplicated near ${entry}`);
      }
    }
  };

  checkSortedUnique(manifest.hosts, 'hosts', HOST_RE);
  checkSortedUnique(manifest.tinyShieldDomains, 'tinyShieldDomains', DOMAIN_RE);
}

export function serializeAdGuardExtraManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function runCLI(argv) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  let inputPath = null;
  let sourceURL = ADGUARD_EXTRA_URL;
  let outputPath = join(root, 'manifests/adguard-extra-hosts.json');
  let checkOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      inputPath = argv[++i];
    } else if (arg === '--url') {
      sourceURL = argv[++i];
    } else if (arg === '--output') {
      outputPath = argv[++i];
    } else if (arg === '--check') {
      checkOnly = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  let sourceText;
  if (inputPath) {
    sourceText = await readFile(inputPath, 'utf8');
  } else {
    const response = await fetch(sourceURL, {
      headers: {'User-Agent': 'wBlock-userscripts-manifest-updater/1.0'},
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${sourceURL}`);
    }
    sourceText = await response.text();
  }

  const manifest = extractAdGuardExtraManifest(sourceText, {sourceURL});
  const serialized = serializeAdGuardExtraManifest(manifest);

  if (checkOnly) {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== serialized) {
      throw new Error(`Manifest drift detected at ${outputPath}`);
    }
    console.log(
      `adguard-extra manifest up to date: v${manifest.version} (${manifest.hosts.length} hosts, ${manifest.tinyShieldDomains.length} tinyShield domains)`,
    );
    return;
  }

  await mkdir(dirname(outputPath), {recursive: true});
  await writeFile(outputPath, serialized, 'utf8');
  console.log(
    `wrote ${outputPath}: v${manifest.version} (${manifest.hosts.length} hosts, ${manifest.tinyShieldDomains.length} tinyShield domains)`,
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await runCLI(process.argv.slice(2));
}
