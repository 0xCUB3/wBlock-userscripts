// Tube Cleaner's resume-position restore: proven, and the shipped reducer
// held to the rule. tests/cleaners/run-tests.mjs keeps storage and a real
// SPA transition.
import { resume, stepLaws, naive, OPS } from './resume.rule.mjs';
import { proveAndHold } from './shipped.mjs';

proveAndHold({
  title: 'resume restore', rule: resume, laws: [], stepLaws, naive, slug: 'tube-cleaner', fn: 'resumeRestoreStep',
  init: () => ({ waiting: false, restored: false, cancelled: false, seek: false, target: 0, ended: false, done: false }),
  params: rand => ({ hasSaved: rand(5) > 0, saved: rand(3000), carriedSame: rand(4) === 0 }),
  draw: rand => ({ op: OPS[rand(OPS.length)], waitFor: rand(3) === 0, current: rand(6) > 0, ready: rand(4) > 0,
    duration: 400 + rand(4000), now: rand(3000), fails: rand(8) === 0 }),
  mutate: step => (config, state, event) => step({ ...config, carriedSame: false }, state, event),
});
