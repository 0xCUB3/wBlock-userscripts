// Tube Cleaner's background recovery (#12): proven, and the shipped reducer
// held to the rule. The page wiring is tests/cleaners/background-recovery.test.mjs.
import { recovery, laws, stepLaws, naive, OPS } from './background-recovery.rule.mjs';
import { proveAndHold } from './shipped.mjs';

// Small budgets, windows and leads with timestamps that mostly move forward,
// so runs reach the retry cap and both edges of each window.
let t = 0;
proveAndHold({
  title: 'background recovery', rule: recovery, laws, stepLaws, naive,
  slug: 'tube-cleaner', fn: 'backgroundRecoveryStep',
  init: () => ({ hidden: false, playing: false, armed: false, pending: false, intent: false, pauseSeen: false,
    retries: 0, hiddenAt: 0, pausedAt: 0, resume: false }),
  params: rand => { t = 0; return { enabled: rand(5) > 0, budget: rand(5), window: rand(12), lead: rand(5) }; },
  draw: rand => { t += rand(4); return { op: OPS[rand(OPS.length)], t: rand(10) === 0 ? rand(40) : t }; },
  mutate: step => (params, state, input) => step({ ...params, budget: params.budget + 1 }, state, input),
});
