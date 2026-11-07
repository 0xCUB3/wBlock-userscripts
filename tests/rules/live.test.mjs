// Tube Cleaner's LIVE pill and live seek guard: proven, and the shipped
// functions held to their rules. tests/cleaners/run-tests.mjs keeps the
// pill's rendering and a real seek past the edge.
import * as L from './live.rule.mjs';
import { proveAndHold, proveAndHoldFun } from './shipped.mjs';

let t = 0;
proveAndHold({
  title: 'LIVE pill', rule: L.indicator, laws: [], stepLaws: L.indicatorStepLaws, naive: L.naiveIndicator,
  slug: 'tube-cleaner', fn: 'liveIndicatorStep',
  init: () => ({ visible: false, pressed: false, behind: false, since: 0 }),
  params: rand => { t = 0; return { drift: 1 + rand(10) }; },
  draw: rand => { t += rand(4); return { live: rand(6) > 0, atHead: rand(2) === 1, paused: rand(6) === 0, seeked: rand(6) === 0, t }; },
  mutate: step => (config, state, event) => step({ drift: config.drift + 1 }, state, event),
});

proveAndHoldFun({
  title: 'live seek guard', fn: L.seekGuard, laws: L.seekGuardLaws, slug: 'tube-cleaner', name: 'liveSeekCorrection',
  draw: rand => { const edge = rand(5000); return { live: rand(5) > 0, hasEdge: rand(6) > 0, edge, pos: Math.max(0, edge + rand(3000) - 500), correcting: rand(6) === 0 }; },
  mutate: shipped => values => shipped({ ...values, pos: values.pos + 1 }),
});
