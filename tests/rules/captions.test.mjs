// Player Cleaner's caption preference: proven, and the shipped functions held
// to their rules. tests/cleaners/run-tests.mjs keeps a real pick from the
// native menu, storage across a refresh, and a user-activated pick.
import * as C from './captions.rule.mjs';
import { proveAndHold, proveAndHoldFun } from './shipped.mjs';

let t = 0;
proveAndHold({
  title: 'caption choice', rule: C.choice, laws: [], stepLaws: C.stepLaws, naive: C.naive,
  slug: 'player-cleaner', fn: 'captionChoiceStep',
  init: () => ({ seenAt: 0, revert: false, save: false, saveOff: false, savedLang: 0 }),
  params: rand => { t = 0; return { settle: rand(8) }; },
  draw: rand => { t += rand(4); return { op: C.OPS[rand(2)], t, showing: C.SHOWING[rand(3)], lang: rand(4), active: rand(2) === 1 }; },
  mutate: step => (config, state, event) => step({ settle: config.settle + 1 }, state, event),
});

proveAndHoldFun({
  title: 'subtitle mode', fn: C.mode, laws: C.modeLaws, slug: 'player-cleaner', name: 'subtitleModeFor',
  draw: rand => ({ known: rand(3) > 0, off: rand(3) === 0, prefLang: rand(3), trackLang: rand(3) }),
  mutate: shipped => values => shipped({ ...values, off: false }),
});
