import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}packages/dark-reader/dist/dark-reader.user.js`, 'utf8');
const adapter = source.slice(source.indexOf('/* Dark Reader v4.9.128 is vendored above this adapter. */'));
let autoCalls = 0, fetchMethod;
const window = {DarkReader: {auto() { autoCalls++; }, setFetchMethod(fn) { fetchMethod = fn; }}};
const context = {window, Response, TextEncoder, TextDecoder, console, GM_xmlhttpRequest(options) {
  options.onload({response: new TextEncoder().encode('ok').buffer, status: 201, statusText: 'Created', responseHeaders: 'X-Test: yes\r\n'});
}};
vm.createContext(context); vm.runInContext(adapter, context);
if (autoCalls !== 1 || typeof fetchMethod !== 'function' || 'chrome' in window) throw new Error('adapter initialization contract failed');
const response = await fetchMethod('https://example.invalid');
if (await response.text() !== 'ok' || response.status !== 201 || response.headers.get('X-Test') !== 'yes') throw new Error('bridge response mismatch');
console.log('dark-reader: PASS');
