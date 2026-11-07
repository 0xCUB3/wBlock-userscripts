# Proven rules

The stateful decisions inside the userscripts are written as pure reducers and
proven with [gdp-wired](https://www.npmjs.com/package/gdp-wired). Each rule here
mirrors one reducer shipped in a userscript between `// @gdp-begin <name>` and
`// @gdp-end`.

`npm run test:rules` does four things for each rule:

- proves its laws for every run, with the proof tree checked by gdp-wired's kernel;
- checks that a deliberately broken variant (the bug the laws rule out) is refused;
- runs the shipped reducer from the built userscript beside the rule on aimed
  random runs and compares every field after every step;
- makes sure that comparison catches a mutated copy of the reducer.

| Rule | Shipped reducer | What the laws say |
|---|---|---|
| `background-recovery.rule.mjs` | Tube Cleaner `backgroundRecoveryStep` | A pause Safari makes while switching tabs is resumed a bounded number of times within a window; pauses from Now Playing, media keys or the page are never undone; a new video, the end or teardown cancels it; nothing runs with Background Playback off. |
| `quality-watch.rule.mjs` | Tube Cleaner `qualityWatchStep` | A saved quality is restored only after real progress; it falls back to Auto at most once and only after a full stall while playing, visible, not seeking and not in an ad; pauses, seeks, ads and hidden time reset the stall; a cancelled or finished watch never acts again. |

The browser tests in `tests/cleaners` keep what a proof can't reach: what WebKit
paints, layout, native controls, events reaching the reducers, storage and
network requests.

To add a rule: move the decision into a self-contained function between the
markers, write the rule with the same inputs, state and step, state the laws a
reviewer would ask about, keep the broken variant, and add a test that calls
`proveAndHold` from `shipped.mjs`.
