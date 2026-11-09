// iOS background resume in both cleaners: proven, and each script's shipped
// backgroundResumeStep held to the rule. The page wiring is
// tests/cleaners/background-resume.test.mjs.
import { resume, laws, stepLaws, naive, OPS } from './background-resume.rule.mjs';
import { proveAndHold } from './shipped.mjs';

// Small graces, leads and windows with timestamps that mostly move forward,
// so runs reach both edges of each.
let t = 0;
for (const slug of ['tube-cleaner', 'player-cleaner']) {
  proveAndHold({
    title: `background resume (${slug})`, rule: resume, laws, stepLaws, naive, slug, fn: 'backgroundResumeStep',
    init: () => ({ hidden: false, hiddenAt: 0, pageAt: 0, inputAt: 0, intent: false, held: false, heldAt: 0, resume: false }),
    params: rand => { t = 0; return { enabled: rand(5) > 0, callGrace: rand(4), inputGrace: rand(6), lead: rand(6), window: rand(6) }; },
    draw: rand => { t += rand(3); return { op: OPS[rand(OPS.length)], t: rand(10) === 0 ? rand(40) : t, ended: rand(6) === 0 }; },
    mutate: step => (params, state, input) => step({ ...params, window: params.window + 1 }, state, input),
  });
}
