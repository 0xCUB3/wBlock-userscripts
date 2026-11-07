// Tube Cleaner's SponsorBlock timing as a gdp-wired rule.
//
// sponsorTimeStep runs on every timeupdate with the scan's result
// (sponsor-scan.rule.mjs) and on every Undo. It decides whether to skip,
// where to seek, whether to show the skip button, and which range Undo
// protects. Times are milliseconds.
import { bool, nat, no, oneOf, rule, when, yes } from 'gdp-wired';
import { MARGIN } from './sponsor-scan.rule.mjs';

export const OPS = ['time', 'undo'];

// Seeking a Safari video to its exact duration replays it, so a skip stops
// this far short; Undo lands this far inside the range.
export const END_MARGIN = 1;
export const UNDO_OFFSET = 10;

export const timing = rule('sponsor timing')
  .inputs({
    op: oneOf(...OPS), now: nat, duration: nat, hasDuration: bool, ended: bool, seeking: bool, loop: bool, enabled: bool,
    // The scan's result on a timeupdate, the skipped range on an Undo.
    found: bool, auto: bool, start: nat, end: nat, notified: bool,
  })
  .state({
    undone: bool.from(false), undoneStart: 0, undoneEnd: 0,
    active: bool.from(false), skip: bool.from(false), notify: bool.from(false), rewind: bool.from(false), seek: 0,
  })
  // What the scan's laws guarantee about its result (sponsor-scan.rule.mjs):
  // inside the chosen range, which isn't one an Undo protects while playback
  // is still inside it.
  .assume(({ op, found, start, end, now, undone, undoneStart, undoneEnd }) => op.is('time').and(found).implies(
    start.atMost(now).and(now.plus(MARGIN).lt(end),
      undone.and(undoneStart.atMost(now), now.lt(undoneEnd), undoneStart.atMost(start), start.lt(undoneEnd)).not())))
  .flags(({ op, now, duration, hasDuration, ended, seeking, enabled, found, auto, notified, undoneStart, undoneEnd }) => {
    const live = op.is('time').and(enabled, seeking.not(), ended.not(), hasDuration.not().or(now.plus(MARGIN).lt(duration)));
    return {
      live,
      leaves: live.and(now.lt(undoneStart).or(now.atLeast(undoneEnd))),
      skips: live.and(found, auto),
      notifies: live.and(found, auto.not(), notified.not()),
      undoes: op.is('undo'),
    };
  })
  .step(({ now, duration, hasDuration, loop, start, end, undone, undoneStart, undoneEnd, live, leaves, skips, notifies, undoes }) => {
    const clamped = hasDuration.and(end.plus(END_MARGIN).atLeast(duration));
    return {
      undone: when(undoes, yes, when(leaves, no, undone)),
      undoneStart: when(undoes, start, undoneStart),
      undoneEnd: when(undoes, end, undoneEnd),
      active: live,
      skip: skips,
      notify: notifies,
      rewind: undoes,
      seek: when(undoes, start.plus(UNDO_OFFSET),
        when(skips, when(clamped, when(loop, 0, duration.minus(END_MARGIN)), end), 0)),
    };
  });

export const laws = [];

export const stepLaws = [
  timing.stepLaw('a skip happens only on a live timeupdate: enabled, not seeking, not ended, short of the end',
    ({ op, enabled, seeking, ended, hasDuration, now, duration }, after) => after.skip.implies(
      op.is('time').and(enabled, seeking.not(), ended.not(), hasDuration.not().or(now.plus(MARGIN).lt(duration))))),
  timing.stepLaw('a skip moves forward unless the video loops',
    ({ now, loop }, after) => after.skip.and(loop.not()).implies(now.lt(after.seek))),
  timing.stepLaw('a skip stops short of the duration unless the video loops',
    ({ hasDuration, duration, loop }, after) => after.skip.and(hasDuration, loop.not()).implies(after.seek.plus(END_MARGIN).atMost(duration))),
  timing.stepLaw('a skip button segment never seeks', ({ found, auto }, after) => after.skip.not(), ({ found, auto }) => found.and(auto.not())),
  timing.stepLaw('a skip never lands in a range protected by Undo while playback is inside it',
    ({ start, now, undone, undoneStart, undoneEnd }, after) => after.skip.implies(
      undone.and(undoneStart.atMost(now), now.lt(undoneEnd), undoneStart.atMost(start), start.lt(undoneEnd)).not())),
  timing.stepLaw('Undo protects the skipped range and rewinds just inside it',
    ({ start, end }, after) => after.undone.and(after.undoneStart.eq(start), after.undoneEnd.eq(end), after.rewind,
      after.seek.eq(start.plus(UNDO_OFFSET)), after.skip.not()), ({ op }) => op.is('undo')),
  timing.stepLaw('protection stays while playback is inside the range',
    ({ undoneStart, undoneEnd }, after) => after.undone.and(after.undoneStart.eq(undoneStart), after.undoneEnd.eq(undoneEnd)),
    ({ op, undone, now, undoneStart, undoneEnd }) => op.is('time').and(undone, undoneStart.atMost(now), now.lt(undoneEnd))),
  timing.stepLaw('leaving the range ends its protection',
    (_, after) => after.undone.not(), ({ live, now, undoneStart, undoneEnd }) => live.and(now.lt(undoneStart).or(now.atLeast(undoneEnd)))),
  timing.stepLaw('the skip button is offered once per visit', (_, after) => after.notify.not(), ({ notified }) => notified),
];

// The bug these laws rule out: seeking to the segment's end even when that
// is the video's duration, which makes Safari replay the video.
export const naive = timing.step(({ start, end, undone, undoneStart, undoneEnd, live, leaves, skips, notifies, undoes }) => ({
  undone: when(undoes, yes, when(leaves, no, undone)), undoneStart: when(undoes, start, undoneStart),
  undoneEnd: when(undoes, end, undoneEnd), active: live, skip: skips, notify: notifies, rewind: undoes,
  seek: when(undoes, start.plus(UNDO_OFFSET), when(skips, end, 0)),
}));
