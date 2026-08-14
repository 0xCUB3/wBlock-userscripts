import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}packages/dark-reader/dist/dark-reader.user.js`, 'utf8');
const adapter = source.slice(source.indexOf('/* Dark Reader v4.9.128 is vendored above this adapter. */'));
function runAdapter(configuration = '') {
  let autoCalls = 0, enableCalls = 0, fetchMethod;
  const window = {DarkReader: {
    auto() { autoCalls++; },
    enable() { enableCalls++; },
    setFetchMethod(fn) { fetchMethod = fn; }
  }};
  const context = {window, Response, TextEncoder, TextDecoder, console, GM_xmlhttpRequest(options) {
    options.onload({response: new TextEncoder().encode('ok').buffer, status: 201, statusText: 'Created', responseHeaders: 'X-Test: yes\r\n'});
  }};
  vm.createContext(context); vm.runInContext(configuration + adapter, context);
  return {autoCalls, enableCalls, fetchMethod, window};
}
const automatic = runAdapter();
if (automatic.autoCalls !== 1 || automatic.enableCalls !== 0 || typeof automatic.fetchMethod !== 'function' || 'chrome' in automatic.window) {
  throw new Error('system appearance adapter contract failed');
}
const forced = runAdapter('const __wblockDarkReaderFollowsSystemAppearance = false;\n');
if (forced.autoCalls !== 0 || forced.enableCalls !== 1 || typeof forced.fetchMethod !== 'function') {
  throw new Error('forced dark adapter contract failed');
}
const response = await automatic.fetchMethod('https://example.invalid');
if (await response.text() !== 'ok' || response.status !== 201 || response.headers.get('X-Test') !== 'yes') throw new Error('bridge response mismatch');
console.log('dark-reader: PASS');
