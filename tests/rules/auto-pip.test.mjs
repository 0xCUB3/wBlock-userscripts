// Automatic PiP in both cleaners: one proven rule, and each script's shipped
// autoPiPStep held to it. The page wiring stays in the visibility scenarios
// of tests/cleaners/run-tests.mjs and in tests/cleaners/auto-pip.test.mjs.
import assert from 'node:assert/strict';
import { proveSteps } from 'gdp-wired';
import { pip, laws, stepLaws, naive, legacy, OPS } from './auto-pip.rule.mjs';
import { proveAndHold } from './shipped.mjs';

const flag = rand => rand(2) === 1;
// The reducer before the scroll fix must be refused by the scroll law itself.
const beforeFix = proveSteps(legacy, laws, stepLaws, { search: false });
assert.equal(beforeFix.proven, false, 'the pre-fix reducer must be refused');
assert.match(beforeFix.goal, /stays through focus/, JSON.stringify(beforeFix));
console.log(`PASS: auto PiP: the pre-fix reducer is refused by the scroll law (${beforeFix.goal})`);

for (const slug of ['tube-cleaner', 'player-cleaner']) {
  proveAndHold({
    title: `auto PiP (${slug})`, rule: pip, laws, stepLaws, naive, slug, fn: 'autoPiPStep',
    init: () => ({ ours: false, enter: false, exit: false, scrolled: false }),
    params: rand => ({ blurEnters: flag(rand) }),
    draw: rand => ({ op: OPS[rand(OPS.length)], autoAllowed: rand(4) > 0, hideAllowed: rand(4) > 0, playing: rand(4) > 0,
      focused: flag(rand), hidden: flag(rand), inPiP: flag(rand) }),
    mutate: step => (config, state, event) => step(config, { ...state, ours: true }, event),
  });
}
