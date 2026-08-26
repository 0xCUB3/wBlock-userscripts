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

function makeElement(backgroundColor, inlineBackground = '', extras = {}) {
  const children = extras.children || [];
  const classes = extras.classes || [];
  const element = {
    tagName: extras.tagName || 'DIV',
    backgroundColor,
    color: extras.color || 'rgb(0, 0, 0)',
    filter: extras.filter || 'none',
    colorScheme: extras.colorScheme || 'normal',
    style: {backgroundColor: inlineBackground},
    classList: {contains: name => classes.includes(name)},
    dataset: extras.dataset || {},
    children,
    scrollHeight: extras.scrollHeight ?? 800,
    clientHeight: extras.clientHeight ?? 800,
    get childElementCount() { return element.children.length; },
    appendChild(child) { child.parentNode = element; element.children.push(child); },
    removeChild(child) {
      element.children = element.children.filter(other => other !== child);
      child.parentNode = null;
    }
  };
  return element;
}

function heading() {
  return makeElement('rgba(0, 0, 0, 0)', '', {tagName: 'H1', color: 'rgb(32, 32, 32)'});
}

function makeDocument({
  rootBg = 'rgba(0, 0, 0, 0)',
  bodyBg = 'rgb(255, 255, 255)',
  hasBody = true,
  sheets = 1,
  readyState = 'complete',
  meta = null,
  rootClass,
  rootTheme,
  rootColorScheme = 'normal',
  rootFilter = 'none',
  rootColor = 'rgb(0, 0, 0)',
  bodyColor = 'rgb(32, 32, 32)'
} = {}) {
  const listeners = {};
  const doc = {
    documentElement: makeElement(rootBg, '', {
      tagName: 'HTML',
      color: rootColor,
      colorScheme: rootColorScheme,
      filter: rootFilter,
      classes: rootClass ? [rootClass] : [],
      dataset: rootTheme ? {theme: rootTheme} : {}
    }),
    body: hasBody ? makeElement(bodyBg, '', {
      tagName: 'BODY',
      color: bodyColor,
      children: [heading()]
    }) : null,
    styleSheets: Array.from({length: sheets}, () => ({ownerNode: {classList: {contains: () => false}}})),
    readyState,
    querySelector: selector => selector === 'meta[name="color-scheme"]' ? meta : null,
    querySelectorAll: () => [],
    created: [],
    createElement(tag) {
      const element = {
        tagName: tag, id: '', textContent: '', disabled: false, parentNode: null,
        classList: {contains: () => false}
      };
      doc.created.push(element);
      return element;
    },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
    dispatch(type) { for (const fn of [...(listeners[type] || [])]) fn(); },
    listeners
  };
  return doc;
}

function runAdapter(configuration = '', document = undefined, extraContext = {}) {
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
    context.getComputedStyle = element => ({
      backgroundColor: element.backgroundColor,
      color: element.color || 'rgb(0, 0, 0)',
      filter: element.filter || 'none',
      colorScheme: element.colorScheme || 'normal'
    });
  }
  Object.assign(context, extraContext);
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

// 2b. Anti-flash guard: injected only when the theme will be applied, and
// removed as soon as detection settles.
const antiflashForced = runAdapter(forcedFlag, makeDocument());
{
  const created = antiflashForced.document.created;
  if (created.length !== 1 || created[0].id !== 'wblock-antiflash') throw new Error('forced mode did not inject the anti-flash guard');
  if (created[0].parentNode !== null || antiflashForced.document.documentElement.children.length !== 0) throw new Error('anti-flash guard not removed after detection settled');
}
const antiflashAutoDark = runAdapter('', makeDocument(), {matchMedia: () => ({matches: true})});
if (antiflashAutoDark.document.created.length !== 1) throw new Error('auto mode on a dark system did not inject the anti-flash guard');
const antiflashAutoLight = runAdapter('', makeDocument(), {matchMedia: () => ({matches: false})});
if (antiflashAutoLight.document.created.length !== 0) throw new Error('auto mode on a light system injected the anti-flash guard');

// 3. Natively dark page (opaque dark root): theme is withdrawn.
const darkRootAuto = runAdapter('', makeDocument({rootBg: 'rgb(17, 17, 17)', bodyBg: 'rgba(0, 0, 0, 0)'}));
if (darkRootAuto.autoCalls !== 1 || darkRootAuto.autoDisableCalls !== 1 || darkRootAuto.disableCalls !== 1) {
  throw new Error('auto mode did not withdraw on dark root');
}
const darkRootForced = runAdapter(forcedFlag, makeDocument({rootBg: 'rgb(17, 17, 17)', bodyBg: 'rgba(0, 0, 0, 0)'}));
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
const pending = makeDocument({rootBg: 'rgb(17, 17, 17)', bodyBg: 'rgba(0, 0, 0, 0)', hasBody: false, sheets: 0, readyState: 'loading'});
const deferred = runAdapter(forcedFlag, pending);
if (deferred.disableCalls !== 0) throw new Error('detection ran before the page had body and styles');
if (StubMutationObserver.instances.length !== 1 || !StubMutationObserver.instances[0].observing) throw new Error('mutation observer not installed');
if ((pending.listeners.readystatechange || []).length !== 1) throw new Error('readystatechange listener not installed');
if (pending.created.length !== 1 || pending.documentElement.children[0] !== pending.created[0]) throw new Error('anti-flash guard missing while detection is pending');
pending.body = makeElement('rgb(17, 17, 17)', '', {tagName: 'BODY', children: [heading()]});
pending.styleSheets = [{ownerNode: pending.created[0]}];
StubMutationObserver.instances[0].callback();
if (deferred.disableCalls !== 0) throw new Error('anti-flash stylesheet wrongly counted as page style');
pending.styleSheets = [{ownerNode: pending.created[0]}, {ownerNode: {classList: {contains: () => false}}}];
StubMutationObserver.instances[0].callback();
if (deferred.disableCalls !== 1) throw new Error('deferred detection did not withdraw the theme');
if (pending.created[0].parentNode !== null) throw new Error('anti-flash guard not removed by deferred detection');
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
withOwnStyles.styleSheets = [{ownerNode: ownStyle}, ...withOwnStyles.styleSheets];
const measured = runAdapter(forcedFlag, withOwnStyles);
if (measured.disableCalls !== 0 || ownStyle.disabled !== false) throw new Error('own-style handling failed');

// 9. color-scheme meta is the strongest signal, including light dark + system.
const metaDark = runAdapter(forcedFlag, makeDocument({bodyBg: 'rgb(255, 255, 255)', meta: {content: 'dark'}}));
if (metaDark.disableCalls !== 1) throw new Error('color-scheme meta dark was ignored');
const metaLight = runAdapter(forcedFlag, makeDocument({rootBg: 'rgb(17, 17, 17)', meta: {content: 'light'}}));
if (metaLight.disableCalls !== 0) throw new Error('color-scheme meta light was overridden by a dark background');
const metaBothDarkSystem = runAdapter(
  forcedFlag,
  makeDocument({bodyBg: 'rgb(255, 255, 255)', meta: {content: 'light dark'}}),
  {matchMedia: () => ({matches: true})}
);
if (metaBothDarkSystem.disableCalls !== 1) throw new Error('light dark meta on a dark system was ignored');
const metaBothLightSystem = runAdapter(
  forcedFlag,
  makeDocument({bodyBg: 'rgb(255, 255, 255)', meta: {content: 'light dark'}}),
  {matchMedia: () => ({matches: false})}
);
if (metaBothLightSystem.disableCalls !== 0) throw new Error('light dark meta on a light system withdrew the theme');

// 10. Class and data-theme hints match Dark Reader's detector.
const classDark = runAdapter(forcedFlag, makeDocument({bodyBg: 'rgb(255, 255, 255)', rootClass: 'dark'}));
if (classDark.disableCalls !== 1) throw new Error('html.dark hint was ignored');
const themeDark = runAdapter(forcedFlag, makeDocument({bodyBg: 'rgb(255, 255, 255)', rootTheme: 'Dark'}));
if (themeDark.disableCalls !== 1) throw new Error('data-theme=dark hint was ignored');

// 11. CSS color-scheme: dark on the root is enough.
const cssScheme = runAdapter(forcedFlag, makeDocument({bodyBg: 'rgb(255, 255, 255)', rootColorScheme: 'dark'}));
if (cssScheme.disableCalls !== 1) throw new Error('css color-scheme: dark was ignored');

// 12. On-screen samples only decide when root and body are transparent.
const vetoDoc = makeDocument({
  rootBg: 'rgba(0, 0, 0, 0)', bodyBg: 'rgba(0, 0, 0, 0)', rootColor: 'rgb(232, 232, 232)'
});
const lightPatch = makeElement('rgb(255, 255, 255)', '', {tagName: 'DIV'});
vetoDoc.elementFromPoint = () => lightPatch;
const vetoed = runAdapter(forcedFlag, vetoDoc, {innerWidth: 800, innerHeight: 800});
if (vetoed.disableCalls !== 0) throw new Error('light on-screen patch did not veto an ambiguous page');
const sampleDoc = makeDocument({
  rootBg: 'rgba(0, 0, 0, 0)', bodyBg: 'rgba(0, 0, 0, 0)', rootColor: 'rgb(232, 232, 232)'
});
sampleDoc.elementFromPoint = () => sampleDoc.documentElement;
const sampled = runAdapter(forcedFlag, sampleDoc, {innerWidth: 800, innerHeight: 800});
if (sampled.disableCalls !== 1) throw new Error('light text on a transparent page was not treated as dark');

// 13. GM_xmlhttpRequest bridge still translates responses.
const response = await automatic.fetchMethod('https://example.invalid');
if (await response.text() !== 'ok' || response.status !== 201 || response.headers.get('X-Test') !== 'yes') throw new Error('bridge response mismatch');
console.log('dark-reader: PASS');
