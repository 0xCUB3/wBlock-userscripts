// Tube Cleaner's iPhone quality restore watchdog as a gdp-wired rule.
//
// A saved quality is restored only after the stream makes real progress.
// Once restored, a monitor ticks; if playback stalls long enough while the
// video is playing, visible, not seeking and not in an ad, it falls back to
// Auto once, and it stops watching after enough healthy playback. The
// shipped reducer, qualityWatchStep in packages/tube-cleaner/src/tube-cleaner.user.js,
// is held to this rule. Times are milliseconds: t on the wall clock, pos in
// the media.
import { bool, min, nat, no, oneOf, rule, when, yes } from 'gdp-wired';

// baseline: the position when the watch begins, never a start by itself.
export const OPS = ['baseline', 'sample', 'restored', 'tick', 'cancel'];
export const PHASES = ['waiting', 'restoring', 'monitoring', 'done'];

// Terms shared by the flags, the step and the laws (flags are conditions only).
const elapsedOf = ({ t, prevCheck, maxElapsed }) => min(t.minus(prevCheck), maxElapsed);
const stalledNextOf = env => when(env.pos.eq(env.prevPos), env.stalled.plus(elapsedOf(env)), 0);

export const watch = rule('quality watch')
  .params({ stallLimit: nat, healthyLimit: nat, maxAdvance: nat, maxElapsed: nat })
  // Shipped as 8000, 20000, 3000 and 1000 ms; a zero limit would watch nothing.
  .pre(({ stallLimit, healthyLimit }) => stallLimit.atLeast(1).and(healthyLimit.atLeast(1)))
  .inputs({ op: oneOf(...OPS), t: nat, pos: nat, paused: bool, seeking: bool, ended: bool, ready: bool, ad: bool, hidden: bool })
  .state({
    phase: oneOf(...PHASES).from('waiting'),
    lastPos: 0, prevPos: 0, prevCheck: 0, stalled: 0, observed: 0, fallbacks: 0,
    start: bool.from(false), fallback: bool.from(false),
  })
  .flags(env => {
    const { op, pos, paused, seeking, ended, ready, ad, hidden, phase, lastPos, observed, stallLimit, healthyLimit, maxAdvance } = env;
    const elapsed = elapsedOf(env), stalledNext = stalledNextOf(env);
    const idle = paused.or(seeking, hidden, ad);
    const ticking = op.is('tick').and(phase.is('monitoring'));
    return {
      starts: op.is('sample').and(phase.is('waiting'), paused.not(), seeking.not(), ended.not(), ready, ad.not(),
        lastPos.lt(pos), pos.atMost(lastPos.plus(maxAdvance))),
      monitors: op.is('restored').and(phase.is('restoring')),
      ticking, idle,
      falls: ticking.and(ended.not(), idle.not(), stalledNext.atLeast(stallLimit)),
      healthy: ticking.and(ended.not(), idle.not(), stalledNext.lt(stallLimit), observed.plus(elapsed).atLeast(healthyLimit)),
    };
  })
  .step(env => {
    const { op, t, pos, ended, phase, lastPos, prevPos, prevCheck, stalled, observed, fallbacks,
      starts, monitors, ticking, idle, falls, healthy } = env;
    const elapsed = elapsedOf(env), stalledNext = stalledNextOf(env);
    return {
    phase: when(op.is('cancel').or(ticking.and(ended.or(falls, healthy))), phase.of('done'),
      when(starts, phase.of('restoring'), when(monitors, phase.of('monitoring'), phase))),
    lastPos: when(op.is('sample').or(op.is('baseline')), pos, lastPos),
    prevPos: when(monitors.or(ticking), pos, prevPos),
    prevCheck: when(monitors.or(ticking), t, prevCheck),
    stalled: when(monitors, 0, when(ticking, when(idle, 0, stalledNext), stalled)),
    observed: when(monitors, 0, when(ticking.and(idle.not()), observed.plus(elapsed), observed)),
    fallbacks: when(falls, fallbacks.plus(1), fallbacks),
    start: starts,
    fallback: falls,
  };
  });

export const laws = [
  watch.law('it falls back to Auto at most once', ({ fallbacks }) => fallbacks.atMost(1)),
  watch.law('while monitoring, the stall stays under the limit', ({ phase, stalled, stallLimit }) =>
    phase.is('monitoring').implies(stalled.lt(stallLimit))),
  watch.law('while monitoring, healthy playback stays under the limit', ({ phase, observed, healthyLimit }) =>
    phase.is('monitoring').implies(observed.lt(healthyLimit))),
  watch.law('a fallback only happens on the way out', ({ fallbacks, phase }) => fallbacks.gt(0).implies(phase.is('done'))),
];

export const stepLaws = [
  watch.stepLaw('a finished or cancelled watch never acts again',
    (_, after) => after.phase.is('done').and(after.start.not(), after.fallback.not()), ({ phase }) => phase.is('done')),
  watch.stepLaw('cancelling ends the watch', (_, after) => after.phase.is('done').and(after.fallback.not()),
    ({ op }) => op.is('cancel')),
  watch.stepLaw('a restore starts only after real progress while playing',
    ({ op, pos, lastPos, paused, seeking, ready, ad, maxAdvance }, after) => after.start.implies(
      op.is('sample').and(paused.not(), seeking.not(), ready, ad.not(), lastPos.lt(pos), pos.atMost(lastPos.plus(maxAdvance))))),
  watch.stepLaw('a fallback needs a stall of the full limit while playing and visible',
    (env, after) => after.fallback.implies(env.op.is('tick').and(env.paused.not(), env.seeking.not(), env.hidden.not(),
      env.ad.not(), env.pos.eq(env.prevPos), env.stalled.plus(elapsedOf(env)).atLeast(env.stallLimit)))),
  watch.stepLaw('a pause, seek, ad or hidden page resets the stall',
    (_, after) => after.stalled.eq(0).and(after.fallback.not()), ({ ticking, idle }) => ticking.and(idle)),
];

// The bug these laws rule out: counting paused time as a stall, and falling
// back again on every tick past the limit.
export const naive = watch.step(env => {
  const { op, t, pos, phase, lastPos, prevPos, prevCheck, stalled, observed, fallbacks, starts, monitors, stallLimit } = env;
  const ticking = op.is('tick').and(phase.is('monitoring'));
  const s = stalledNextOf(env);
  return {
    phase: when(op.is('cancel'), 'done', when(starts, phase.of('restoring'), when(monitors, phase.of('monitoring'), phase))),
    lastPos: when(op.is('sample'), pos, lastPos), prevPos: when(ticking.or(monitors), pos, prevPos),
    prevCheck: when(ticking.or(monitors), t, prevCheck), stalled: when(ticking, s, stalled), observed,
    fallbacks: when(ticking.and(s.atLeast(stallLimit)), fallbacks.plus(1), fallbacks),
    start: starts, fallback: ticking.and(s.atLeast(stallLimit)),
  };
});
