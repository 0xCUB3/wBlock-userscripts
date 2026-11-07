// Tube Cleaner's live-stream decisions as gdp-wired rules: the LIVE pill
// (liveIndicatorStep) and the seek guard (liveSeekCorrection). Times are
// milliseconds.
import { bool, fun, nat, rule, when, yes, no } from 'gdp-wired';

// The LIVE pill is red at the live head and gray behind it. Playback drifts
// past YouTube's live-head cutoff and catches up on its own, so drift has to
// outlast `drift` before the pill turns gray; a seek or pause turns it gray
// at once.
export const indicator = rule('live indicator')
  .params({ drift: nat })
  .pre(({ drift }) => drift.atLeast(1))
  .inputs({ live: bool, atHead: bool, paused: bool, seeked: bool, t: nat })
  .state({ visible: bool.from(false), pressed: bool.from(false), behind: bool.from(false), since: 0 })
  .flags(({ live, atHead, paused, seeked, t, drift, pressed, behind, since }) => {
    const sinceNext = when(live.and(atHead.not(), behind.not()), t, since);
    return {
      holds: live.and(atHead.not(), paused.not(), seeked.not(), pressed, t.lt(sinceNext.plus(drift))),
    };
  })
  .step(({ live, atHead, t, pressed, behind, since, holds }) => ({
    visible: live,
    behind: when(live, atHead.not(), behind),
    since: when(live.and(atHead.not(), behind.not()), t, since),
    pressed: when(live.and(holds.not()), atHead, pressed),
  }));

export const indicatorStepLaws = [
  indicator.stepLaw('the pill is hidden off live streams', (_, after) => after.visible.not(), ({ live }) => live.not()),
  indicator.stepLaw('it turns red at the live head', (_, after) => after.pressed, ({ live, atHead }) => live.and(atHead)),
  indicator.stepLaw('a seek or pause behind the head turns it gray at once', (_, after) => after.pressed.not(),
    ({ live, atHead, paused, seeked }) => live.and(atHead.not(), paused.or(seeked))),
  indicator.stepLaw('drift behind the head is tolerated for a while', (_, after) => after.pressed,
    ({ live, atHead, paused, seeked, pressed, behind, since, t, drift }) =>
      live.and(atHead.not(), paused.not(), seeked.not(), pressed, behind, t.lt(since.plus(drift)))),
  indicator.stepLaw('drift that outlasts the tolerance turns it gray', (_, after) => after.pressed.not(),
    ({ live, atHead, behind, since, t, drift }) => live.and(atHead.not(), behind, since.plus(drift).atMost(t))),
];

// The bug these laws rule out: graying the pill on every brief drift.
export const naiveIndicator = indicator.flags(() => ({ holds: no }));

// On a live stream WebKit's scrubber spans a synthetic duration far past the
// newest media, so a seek can land where nothing has been broadcast (#934).
// A seek more than a second past the buffered edge is pulled back to half a
// second behind it.
export const seekGuard = fun('live seek guard')
  .inputs({ live: bool, hasEdge: bool, edge: nat, pos: nat, correcting: bool })
  .returns(({ live, hasEdge, edge, pos, correcting }) => {
    const correct = correcting.not().and(live, hasEdge, edge.plus(1000).lt(pos));
    return { correct, target: when(correct, edge.minus(500), pos) };
  });

export const seekGuardLaws = [
  seekGuard.law('a correction always moves the seek back', () => [], ({ correct, target }, { pos }) => correct.implies(target.lt(pos))),
  seekGuard.law('a correction lands behind the buffered edge', () => [], ({ correct, target }, { edge }) => correct.implies(target.lt(edge.plus(1)))),
  seekGuard.law('a seek into the buffered past is left alone', () => [], ({ correct }, { edge, pos }) => pos.atMost(edge.plus(1000)).implies(correct.not())),
  seekGuard.law('nothing is corrected off live streams', () => [], ({ correct }, { live }) => live.not().implies(correct.not())),
];
