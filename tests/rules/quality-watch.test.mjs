// Tube Cleaner's iPhone quality restore watchdog: proven, and the shipped
// reducer held to the rule. tests/cleaners/quality-persistence.test.mjs keeps
// the page wiring (the settings menu, storage, cancellation, video swaps).
import { watch, laws, stepLaws, naive, OPS } from './quality-watch.rule.mjs';
import { proveAndHold } from './shipped.mjs';

// Small limits, clocks that mostly advance by a tick, positions that often
// stand still, so runs reach stalls, healthy stretches and both limits.
let t = 0, pos = 0;
proveAndHold({
  title: 'quality watch', rule: watch, laws, stepLaws, naive,
  slug: 'tube-cleaner', fn: 'qualityWatchStep',
  init: () => ({ phase: 'waiting', lastPos: 0, prevPos: 0, prevCheck: 0, stalled: 0, observed: 0, fallbacks: 0,
    start: false, fallback: false }),
  params: rand => { t = 0; pos = 0; return { stallLimit: 1 + rand(8), healthyLimit: 1 + rand(14), maxAdvance: rand(4), maxElapsed: 1 + rand(3) }; },
  draw: rand => {
    t += rand(4);
    if (rand(3) === 0) pos += rand(4);
    const flag = () => rand(6) === 0;
    // Mostly samples and ticks, the ops a real watch sees most.
    const op = rand(4) === 0 ? OPS[rand(OPS.length)] : rand(2) ? 'tick' : 'sample';
    return { op, t, pos, paused: flag(), seeking: flag(), ended: rand(20) === 0, ready: rand(8) > 0, ad: flag(), hidden: flag() };
  },
  mutate: step => (params, state, input) => step({ ...params, stallLimit: params.stallLimit + 1 }, state, input),
});
