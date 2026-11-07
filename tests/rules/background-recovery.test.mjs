// Proves Tube Cleaner's background recovery (#12) and holds the shipped
// reducer to the proven rule. Replaces timing tests in a browser: the laws
// cover every run, and compare checks the code that actually ships.
import assert from 'node:assert/strict';
import { proveSteps } from 'gdp-wired';
import { recovery, laws, stepLaws, naive } from './background-recovery.rule.mjs';
import { shippedFunction } from './shipped.mjs';

const proof = proveSteps(recovery, laws, stepLaws);
assert.deepEqual({ proven: proof.proven, checked: proof.checked }, { proven: true, checked: true }, JSON.stringify(proof));
console.log(`PASS: ${laws.length + stepLaws.length} background-recovery laws proven and kernel-checked`);

const broken = proveSteps(naive, laws, stepLaws, { search: false });
assert.equal(broken.proven, false, 'the naive resume-on-every-pause variant must be refused');
console.log(`PASS: resuming on every pause is refused (${broken.goal})`);

const step = shippedFunction('tube-cleaner', 'backgroundRecoveryStep');
const init = () => ({ hidden: false, playing: false, armed: false, pending: false, intent: false, pauseSeen: false,
  retries: 0, hiddenAt: 0, pausedAt: 0, resume: false });
// Small budgets, windows and leads with timestamps that mostly move forward,
// so runs reach the retry cap and both edges of each window.
const OPS = ['hide', 'show', 'play', 'pause', 'intent', 'tick', 'reset'];
function holdToRule(candidate) {
  let t = 0;
  return recovery.compare({ init, step: candidate }, {
    trials: 3000, depth: 30,
    params: rand => { t = 0; return { enabled: rand(5) > 0, budget: rand(5), window: rand(12), lead: rand(5) }; },
    draw: rand => { t += rand(4); return { op: OPS[rand(OPS.length)], t: rand(10) === 0 ? rand(40) : t }; },
  });
}
const compared = holdToRule(step);
assert.equal(compared.failure, undefined, compared.failure);
console.log(`PASS: the shipped backgroundRecoveryStep matches the proven rule on ${compared.checked} steps`);
const offByOne = holdToRule((params, state, input) => step({ ...params, budget: params.budget + 1 }, state, input));
assert.ok(offByOne.failure, 'compare must catch an off-by-one in the retry budget');
console.log('PASS: compare catches an off-by-one in the shipped retry budget');

const cross = recovery.crossCheck(laws, stepLaws);
assert.equal(cross.failure, undefined, cross.failure);
console.log(`PASS: rule builders cross-checked on ${cross.checked} runs`);
