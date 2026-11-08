// WebKit (Safari-engine) checks for the AMP Redirect userscript. Every
// request is answered from the fixtures below, so no network is used.
import {webkit} from 'playwright';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = readFileSync(join(__dirname, '..', 'packages', 'amp-redirect', 'dist', 'amp-redirect.user.js'), 'utf8');
const atDocumentStart = source => `(() => {
  const run = () => {\n${source}\n};
  if (document.documentElement) { run(); return; }
  const observer = new MutationObserver(() => {
    if (document.documentElement) { observer.disconnect(); run(); }
  });
  observer.observe(document, {childList: true});
})();`;

const page = (canonical, amp) =>
  `<!doctype html><html${amp ? ' amp' : ''}><head>${canonical ? `<link rel="canonical" href="${canonical}">` : ''}</head><body>page</body></html>`;
const pages = {
  'https://example.com/story': page(null, false),
  'https://example.com/story?id=7': page(null, false),
  'https://news.test/story/amp': page('https://news.test/story', true),
  'https://news.test/story': page(null, false),
  'https://news.test/self/amp': page('https://news.test/self/amp', true),
  'https://news.test/plain': page('https://news.test/elsewhere', false),
  'https://loop.test/a': page('https://loop.test/b', true),
  'https://loop.test/b': page('https://loop.test/a', true)
};

const scenarios = [
  {name: "Google's AMP viewer opens the publisher's page", start: 'https://www.google.com/amp/s/example.com/story', end: 'https://example.com/story'},
  {name: 'the AMP cache opens the publisher page without its parameters', start: 'https://example-com.cdn.ampproject.org/c/s/example.com/story?id=7&amp_js_v=0.1&usqp=mq331AQ', end: 'https://example.com/story?id=7'},
  {name: "a publisher's AMP page opens its canonical page", start: 'https://news.test/story/amp', end: 'https://news.test/story'},
  {name: 'an AMP page that names itself as canonical stays put', start: 'https://news.test/self/amp', end: 'https://news.test/self/amp'},
  {name: 'a regular page with a canonical link stays put', start: 'https://news.test/plain', end: 'https://news.test/plain'},
  {name: 'AMP pages whose canonical links point at each other stop bouncing', start: 'https://loop.test/a', end: 'https://loop.test/a', maxNavigations: 3}
];

const browser = await webkit.launch();
let failures = 0;
for (const scenario of scenarios) {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = route.request().url();
    route.fulfill({status: 200, contentType: 'text/html', body: pages[url] ?? page(null, false)});
  });
  await context.addInitScript(atDocumentStart(dist));
  const tab = await context.newPage();
  let navigations = 0;
  tab.on('framenavigated', frame => { if (frame === tab.mainFrame()) navigations++; });
  try {
    await tab.goto(scenario.start, {waitUntil: 'load'});
    await tab.waitForTimeout(600);
    if (tab.url() !== scenario.end) throw new Error(`ended on ${tab.url()}`);
    if (scenario.maxNavigations && navigations > scenario.maxNavigations) throw new Error(`${navigations} navigations`);
    console.log(`PASS ${scenario.name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${scenario.name}: ${error.message}`);
  } finally {
    await context.close();
  }
}
await browser.close();
if (failures > 0) { console.error(`${failures} scenario(s) failed`); process.exit(1); }
console.log('amp-redirect webkit: PASS');
