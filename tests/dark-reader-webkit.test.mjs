// Autonomous WebKit (Safari-engine) test harness for the Dark Reader
// userscript distribution, mirroring the cleaners' Playwright harness.
//
// The built dist is injected at document-start in the page world with the
// same appearance flag prefix wBlock's native side prepends
// (DarkReaderAppearancePreference.configuredExecutableContent).
// Scenarios cover both appearance modes against light pages, natively dark
// pages (root and body variants), and pages that theme themselves while the
// document is still parsing.
//
// Exit code is non-zero if any assertion fails. Usage:
//   node tests/dark-reader-webkit.test.mjs [--filter=substring]

import {webkit} from 'playwright';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = readFileSync(join(__dirname, '..', 'packages', 'dark-reader', 'dist', 'dark-reader.user.js'), 'utf8');
const fixture = name => pathToFileURL(join(__dirname, 'dark-reader', `fixture-${name}.html`)).href;
const flagPrefix = follows => `const __wblockDarkReaderFollowsSystemAppearance = ${follows};\n`;
// Playwright init scripts can run before the document element exists, which
// never happens for real document-start content-script injection in Safari.
// Defer to the moment the document element appears to mirror production.
const atDocumentStart = source => `(() => {
  const run = () => {\n${source}\n};
  if (document.documentElement) { run(); return; }
  const observer = new MutationObserver(() => {
    if (document.documentElement) { observer.disconnect(); run(); }
  });
  observer.observe(document, {childList: true});
})();`;
const filter = (process.argv.find(argument => argument.startsWith('--filter=')) || '').split('=')[1] || '';

const SETTLE_MS = 400;
const scenarios = [
  {
    name: 'forced dark keeps theming a light page',
    follows: false, colorScheme: 'light', page: 'light',
    expectEnabled: true
  },
  {
    name: 'forced dark withdraws on a natively dark root',
    follows: false, colorScheme: 'light', page: 'dark-root',
    expectEnabled: false
  },
  {
    name: 'forced dark withdraws on a dark body behind a transparent root',
    follows: false, colorScheme: 'light', page: 'dark-body',
    expectEnabled: false
  },
  {
    name: 'forced dark withdraws when the page themes itself during parsing',
    follows: false, colorScheme: 'light', page: 'late-dark',
    expectEnabled: false
  },
  {
    name: 'system-appearance mode themes a light page when the system is dark',
    follows: true, colorScheme: 'dark', page: 'light',
    expectEnabled: true
  },
  {
    name: 'system-appearance mode withdraws on a natively dark page',
    follows: true, colorScheme: 'dark', page: 'dark-root',
    expectEnabled: false
  },
  {
    name: 'system-appearance mode stays off on a light system',
    follows: true, colorScheme: 'light', page: 'light',
    expectEnabled: false
  },
  {
    name: 'after native-dark detection a system flip to dark must not re-theme',
    follows: true, colorScheme: 'light', page: 'dark-root',
    expectEnabled: false,
    async after(page) {
      await page.emulateMedia({colorScheme: 'dark'});
      await page.waitForTimeout(SETTLE_MS);
      const enabled = await page.evaluate(() => window.DarkReader.isEnabled());
      if (enabled) throw new Error('appearance listener survived detection; page got double-darkened');
    }
  }
];

const browser = await webkit.launch();
let failures = 0;
for (const scenario of scenarios) {
  if (filter && !scenario.name.includes(filter)) continue;
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.emulateMedia({colorScheme: scenario.colorScheme});
    await context.addInitScript(atDocumentStart(flagPrefix(scenario.follows) + dist));
    await page.goto(fixture(scenario.page), {waitUntil: 'load'});
    await page.waitForFunction(() => window.DarkReader !== undefined);
    if (scenario.expectEnabled) {
      await page.waitForTimeout(SETTLE_MS);
      const state = await page.evaluate(() => ({
        enabled: window.DarkReader.isEnabled(),
        ownStyles: document.querySelectorAll('style.darkreader').length,
        disabledOwnStyles: Array.from(document.querySelectorAll('style.darkreader')).filter(style => style.disabled).length
      }));
      if (!state.enabled) throw new Error('Dark Reader is not enabled');
      if (state.ownStyles === 0) throw new Error('no Dark Reader style elements were injected');
      if (state.disabledOwnStyles !== 0) throw new Error('Dark Reader styles were left disabled after measurement');
    } else {
      await page.waitForFunction(() => window.DarkReader.isEnabled() === false, null, {timeout: 5000});
      await page.waitForTimeout(SETTLE_MS);
      const state = await page.evaluate(() => ({
        enabled: window.DarkReader.isEnabled(),
        themedRoot: document.documentElement.hasAttribute('data-darkreader-scheme')
      }));
      if (state.enabled) throw new Error('Dark Reader re-enabled itself');
      if (state.themedRoot) throw new Error('root element still carries Dark Reader theming');
    }
    if (scenario.after) await scenario.after(page);
    if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join('; ')}`);
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
console.log('dark-reader webkit: PASS');
