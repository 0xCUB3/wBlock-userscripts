// Tube Cleaner's document observer answers "can this mutation reach a
// player?" from a set of tracked player nodes instead of a subtree query per
// record. This holds the shipped fast path to the shipped subtree query on
// every record of a long random mutation run in WebKit: players and hover
// previews created, moved, renamed, detached and reattached (including class
// and id changes while detached), plus a real active player. It also checks
// that the observer still transforms a player that appears by a class change
// on an existing container.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webkit } from 'playwright';

const fixture = readFileSync(new URL('./fixture.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../packages/tube-cleaner/dist/tube-cleaner.user.js', import.meta.url), 'utf8');
const browser = await webkit.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort());
  await page.addInitScript(`const __wblockTubeCleanerFeatures = { backgroundPlayback: false, sponsorBlock: false,
    pictureInPicture: false, chapters: false, captions: false, resumePosition: false };\n` + script);
  await page.goto('https://fixture.test/watch?v=FIRSTVID001');
  await page.waitForSelector('#movie_player.wblock-tc-native');

  const result = await page.evaluate(async () => {
    const debug = window.__wblockTubeDebug;
    const tracker = debug.createPlayerTracker();
    const stats = { batches: 0, checks: 0, hits: 0, relevant: 0, mismatches: [] };
    const describe = node => node && node.nodeType === 1
      ? `${node.tagName.toLowerCase()}#${node.id}.${node.className}${node.isConnected ? '' : ' (detached)'}` : String(node);
    new MutationObserver(records => {
      stats.batches++;
      tracker.update(records);
      const ancestors = tracker.ancestors();
      const nodes = new Set();
      for (const record of records) {
        nodes.add(record.target);
        record.addedNodes.forEach(node => nodes.add(node));
      }
      for (const node of nodes) {
        const fast = debug.nodeMayContainPlayer(node, ancestors);
        const exact = debug.nodeMayContainPlayer(node);
        stats.checks++;
        if (exact) stats.hits++;
        if (fast !== exact && stats.mismatches.length < 5) stats.mismatches.push(`${describe(node)} fast=${fast} exact=${exact}`);
      }
      const fast = debug.playerMutationsRelevant(records, ancestors);
      if (fast) stats.relevant++;
      if (fast !== debug.playerMutationsRelevant(records) && stats.mismatches.length < 5) stats.mismatches.push('batch relevance differs');
    }).observe(document, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['id', 'class'], attributeOldValue: true });

    let seed = 0x2545f491;
    const rand = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
    const pick = list => list[rand(list.length)];
    const tags = ['div', 'span', 'ytd-player', 'ytd-video-preview', 'ytd-miniplayer', 'ytd-thumbnail', 'video', 'section'];
    const classes = ['', 'html5-video-player', 'video-preview-shim', 'ytp-inline-preview-ui', 'wblock-tc-x',
      'html5-video-player wblock-tc-native', 'playing-mode', 'ytp-small-mode'];
    const ids = ['', 'movie_player', 'player-container', 'preview', 'inline-player', 'container'];
    const root = document.body.appendChild(document.createElement('div'));
    root.id = 'churn';
    const detached = [];
    const all = () => [root, ...root.querySelectorAll('*'), ...detached];
    const make = () => {
      const node = document.createElement(pick(tags));
      if (rand(3) === 0) node.className = pick(classes);
      if (rand(4) === 0) node.id = pick(ids);
      for (let i = rand(3); i > 0; i--) node.appendChild(document.createElement(pick(tags)));
      return node;
    };
    const player = document.getElementById('movie_player');
    const ops = [
      () => pick(all()).appendChild(make()),
      () => { const n = pick(all()); if (n !== root) { n.remove(); detached.push(n); } },
      () => { const n = detached.length && detached.splice(rand(detached.length), 1)[0]; if (n && !n.contains(root)) pick([root, ...root.querySelectorAll('*')]).appendChild(n); },
      () => { const n = pick(all()); n.className = pick(classes); },
      () => { const n = pick(all()); if (n !== root) n.id = pick(ids); },
      () => { const a = pick(all()), b = pick(all()); if (a !== root && !a.contains(b)) b.appendChild(a); },
      // The real player: moved into and out of a preview or miniplayer, and
      // toggled through our own classes.
      () => { const n = pick([root, ...root.querySelectorAll('*')]); if (!player.contains(n)) n.appendChild(player); },
      () => document.getElementById('player-wrap').appendChild(player),
      () => player.classList.toggle('wblock-tc-hover'),
    ];
    for (let step = 0; step < 4000; step++) {
      for (let k = 1 + rand(4); k > 0; k--) {
        // A move into its own subtree is refused by the DOM; skip it.
        try { pick(ops)(); } catch (error) { if (error.name !== 'HierarchyRequestError') throw error; }
      }
      if (rand(4) === 0) await new Promise(resolve => setTimeout(resolve, 0));
      else await Promise.resolve();
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    document.getElementById('player-wrap').appendChild(player);
    root.remove();
    return stats;
  });
  assert.deepEqual(result.mismatches, [], JSON.stringify(result));
  assert.ok(result.batches > 1000 && result.hits > 1000 && result.relevant > 100, JSON.stringify(result));
  console.log(`PASS: tracked player nodes give the subtree query's answer on ${result.checks} nodes in ${result.batches} batches (${result.hits} hits)`);

  // Some YouTube transitions turn an existing container into the player by
  // a class change. The observer must still transform it before paint.
  const promoted = await page.evaluate(async () => {
    document.getElementById('movie_player').remove();
    const shell = document.body.appendChild(document.createElement('div'));
    shell.appendChild(document.createElement('video'));
    await new Promise(resolve => setTimeout(resolve, 0));
    shell.id = 'movie_player';
    shell.className = 'html5-video-player';
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    return shell.classList.contains('wblock-tc-native');
  });
  assert.equal(promoted, true, 'a container promoted to the player by class and id is transformed');
  console.log('PASS: a container promoted to the player by a class change is transformed');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
