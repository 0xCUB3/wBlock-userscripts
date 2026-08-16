import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}packages/dark-reader/dist/dark-reader.user.js`, 'utf8');
const adapter = source.slice(source.indexOf('/* Dark Reader v4.9.128 is vendored above this adapter. */'));

class StubMutationObserver {
  constructor(callback) { this.callback = callback; StubMutationObserver.instances.push(this); }
  observe() { this.observing = true; }
  disconnect() { this.observing = false; }
}
StubMutationObserver.instances = [];

function makeElement(backgroundColor, inlineBackground = '') {
  return {backgroundColor, style: {backgroundColor: inlineBackground}, classList: {contains: () => false}};
}

function makeDocument({rootBg = 'rgba(0, 0, 0, 0)', bodyBg = 'rgb(255, 255, 255)', hasBody = true, sheets = 1, readyState = 'complete'} = {}) {
  const listeners = {};
  const doc = {
    documentElement: makeElement(rootBg),
    body: hasBody ? makeElement(bodyBg) : null,
    styleSheets: Array.from({length: sheets}, () => ({ownerNode: {classList: {contains: () => false}}})),
    readyState,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
    dispatch(type) { for (const fn of [...(listeners[type] || [])]) fn(); },
    listeners
  };
  return doc;
}

function runAdapter(configuration = '', document = undefined) {
  StubMutationObserver.instances = [];
  let autoCalls = 0, autoDisableCalls = 0, enableCalls = 0, disableCalls = 0, fetchMethod;
  const window = {DarkReader: {
    auto(theme) { if (theme === false) autoDisableCalls++; else autoCalls++; },
    enable() { enableCalls++; },
    disable() { disableCalls++; },
    setFetchMethod(fn) { fetchMethod = fn; }
  }};
  const context = {window, Response, TextEncoder, TextDecoder, console, GM_xmlhttpRequest(options) {
    options.onload({response: new TextEncoder().encode('ok').buffer, status: 201, statusText: 'Created', responseHeaders: 'X-Test: yes\r\n'});
  }};
  if (document) {
    context.document = document;
    context.MutationObserver = StubMutationObserver;
    context.getComputedStyle = element => ({backgroundColor: element.backgroundColor});
  }
  vm.createContext(context); vm.runInContext(configuration + adapter, context);
  return {get autoCalls() { return autoCalls; }, get autoDisableCalls() { return autoDisableCalls; },
          get enableCalls() { return enableCalls; }, get disableCalls() { return disableCalls; },
          fetchMethod, window, document};
}

const forcedFlag = 'const __wblockDarkReaderFollowsSystemAppearance = false;\n';

// 1. No DOM available (defensive): modes still wire up, detection is skipped.
const automatic = runAdapter();
if (automatic.autoCalls !== 1 || automatic.enableCalls !== 0 || typeof automatic.fetchMethod !== 'function' || 'chrome' in automatic.window) {
  throw new Error('system appearance adapter contract failed');
}
const forced = runAdapter(forcedFlag);
if (forced.autoCalls !== 0 || forced.enableCalls !== 1 || typeof forced.fetchMethod !== 'function') {
  throw new Error('forced dark adapter contract failed');
}

// 2. Light page: theme stays applied in both modes.
for (const configuration of ['', forcedFlag]) {
  const light = runAdapter(configuration, makeDocument({bodyBg: 'rgb(255, 255, 255)'}));
  if (light.disableCalls !== 0 || light.autoDisableCalls !== 0) throw new Error('light page was wrongly detected as dark');
}

// 3. Natively dark page (opaque dark root): theme is withdrawn.
const darkRootAuto = runAdapter('', makeDocument({rootBg: 'rgb(17, 17, 17)'}));
if (darkRootAuto.autoCalls !== 1 || darkRootAuto.autoDisableCalls !== 1 || darkRootAuto.disableCalls !== 1) {
  throw new Error('auto mode did not withdraw on dark root');
}
const darkRootForced = runAdapter(forcedFlag, makeDocument({rootBg: 'rgb(17, 17, 17)'}));
if (darkRootForced.enableCalls !== 1 || darkRootForced.disableCalls !== 1 || darkRootForced.autoDisableCalls !== 0) {
  throw new Error('forced mode did not withdraw on dark root');
}

// 4. Transparent root falls through to an opaque dark body.
const darkBody = runAdapter(forcedFlag, makeDocument({rootBg: 'rgba(0, 0, 0, 0)', bodyBg: 'rgb(20, 20, 24)'}));
if (darkBody.disableCalls !== 1) throw new Error('dark body behind transparent root was not detected');

// 5. Dark but translucent backgrounds do not count as a built-in dark theme.
const translucent = runAdapter(forcedFlag, makeDocument({rootBg: 'rgba(0, 0, 0, 0)', bodyBg: 'rgba(10, 10, 10, 0.5)'}));
if (translucent.disableCalls !== 0) throw new Error('translucent dark background wrongly detected');

// 6. document-start reality: no body/styles yet, detection waits for mutations.
const pending = makeDocument({rootBg: 'rgb(17, 17, 17)', hasBody: false, sheets: 0, readyState: 'loading'});
const deferred = runAdapter(forcedFlag, pending);
if (deferred.disableCalls !== 0) throw new Error('detection ran before the page had body and styles');
if (StubMutationObserver.instances.length !== 1 || !StubMutationObserver.instances[0].observing) throw new Error('mutation observer not installed');
if ((pending.listeners.readystatechange || []).length !== 1) throw new Error('readystatechange listener not installed');
pending.body = makeElement('rgb(17, 17, 17)');
pending.styleSheets = [{ownerNode: {classList: {contains: () => false}}}];
StubMutationObserver.instances[0].callback();
if (deferred.disableCalls !== 1) throw new Error('deferred detection did not withdraw the theme');
if (StubMutationObserver.instances[0].observing) throw new Error('mutation observer not disconnected after detection');
if ((pending.listeners.readystatechange || []).length !== 0) throw new Error('readystatechange listener not removed after detection');
StubMutationObserver.instances[0].callback();
if (deferred.disableCalls !== 1) throw new Error('detector ran more than once');

// 7. Styleless page at completion: readystatechange path runs the check once.
const styleless = makeDocument({rootBg: 'rgb(17, 17, 17)', hasBody: false, sheets: 0, readyState: 'loading'});
const lateCheck = runAdapter(forcedFlag, styleless);
styleless.body = makeElement('rgba(0, 0, 0, 0)', 'rgb(17, 17, 17)') && makeElement('rgb(17, 17, 17)');
styleless.readyState = 'complete';
styleless.dispatch('readystatechange');
if (lateCheck.disableCalls !== 1) throw new Error('readystate-complete detection failed');

// 8. Dark Reader's own styles are ignored while measuring.
const ownStyle = {disabled: false, classList: {contains: name => name === 'darkreader'}};
const withOwnStyles = makeDocument({rootBg: 'rgb(255, 255, 255)'});
withOwnStyles.querySelectorAll = selector => selector === 'style.darkreader' ? [ownStyle] : [];
const measured = runAdapter(forcedFlag, withOwnStyles);
if (measured.disableCalls !== 0 || ownStyle.disabled !== false) throw new Error('own-style handling failed');

// 9. GM_xmlhttpRequest bridge still translates responses.
const response = await automatic.fetchMethod('https://example.invalid');
if (await response.text() !== 'ok' || response.status !== 201 || response.headers.get('X-Test') !== 'yes') throw new Error('bridge response mismatch');
console.log('dark-reader: PASS');
