// Tube Cleaner's SponsorBlock segment scan as a gdp-wired rule.
//
// On each timeupdate Tube Cleaner folds the segments, sorted by start,
// through sponsorSegmentScan: it picks the first eligible segment playback
// is inside, then extends an automatic skip over every eligible automatic
// segment chained onto it by overlap (one range is often submitted under
// two categories). Here the steps are the segments and the params are that
// timeupdate's context. Times are milliseconds.
import { bool, nat, oneOf, rule, when } from 'gdp-wired';

export const MODES = ['off', 'auto', 'ask'];

// Inside a segment means at least this far short of its end.
export const MARGIN = 50;

// A segment counts when its category isn't off, it is a skip, it is long
// enough, and it doesn't start inside a range the user undid.
const eligible = ({ minDuration, undone, undoneStart, undoneEnd, segStart, segEnd, mode, skip }) =>
  mode.is('off').not().and(skip, segEnd.atLeast(segStart.plus(minDuration)),
    undone.and(undoneStart.atMost(segStart), segStart.lt(undoneEnd)).not());

export const scan = rule('sponsor segment scan')
  // now: the playback position; undone: an Undo protects [undoneStart,
  // undoneEnd) and playback is still inside it.
  .params({ now: nat, minDuration: nat, undone: bool, undoneStart: nat, undoneEnd: nat })
  .inputs({ segStart: nat, segEnd: nat, mode: oneOf(...MODES), skip: bool, segNotified: bool })
  .state({ found: bool.from(false), auto: bool.from(false), start: 0, end: 0, notified: bool.from(false) })
  .flags(env => {
    const { now, segStart, segEnd, mode, found, auto, start, end } = env;
    const ok = eligible(env);
    return {
      picks: found.not().and(ok, segStart.atMost(now), now.plus(MARGIN).lt(segEnd)),
      chains: found.and(auto, ok, mode.is('auto'), start.atMost(segStart), segStart.lt(end), end.lt(segEnd)),
    };
  })
  .step(({ segStart, segEnd, mode, segNotified, found, auto, start, end, notified, picks, chains }) => ({
    found: found.or(picks),
    auto: when(picks, mode.is('auto'), auto),
    start: when(picks, segStart, start),
    end: when(picks.or(chains), segEnd, end),
    notified: when(picks, segNotified, notified),
  }));

export const laws = [
  scan.law('the chosen segment has started', ({ found, start, now }) => found.implies(start.atMost(now))),
  scan.law('playback is still inside the chosen range', ({ found, end, now }) => found.implies(now.plus(MARGIN).lt(end))),
  scan.law('a range the user undid is never chosen', ({ found, start, undone, undoneStart, undoneEnd }) =>
    found.implies(undone.and(undoneStart.atMost(start), start.lt(undoneEnd)).not())),
  scan.law('the chosen range is long enough', ({ found, start, end, minDuration }) =>
    found.implies(end.atLeast(start.plus(minDuration)))),
];

export const stepLaws = [
  scan.stepLaw('once chosen, the segment and its mode stay',
    ({ start, auto }, after) => after.found.and(after.start.eq(start), after.auto.implies(auto), auto.implies(after.auto)), ({ found }) => found),
  scan.stepLaw('a skip button segment never chains', ({ end }, after) => after.end.eq(end), ({ found, auto }) => found.and(auto.not())),
  scan.stepLaw('a chain only grows by an automatic segment starting inside it',
    (env, after) => after.end.gt(env.end).implies(env.mode.is('auto').and(env.start.atMost(env.segStart), env.segStart.lt(env.end))),
    ({ found }) => found),
];

// The bug these laws rule out: protection from Undo ignored, so an undone
// range is skipped again right away.
export const naive = scan.flags(env => {
  const { now, minDuration, segStart, segEnd, mode, skip, found, auto, start, end } = env;
  const ok = mode.is('off').not().and(skip, segEnd.atLeast(segStart.plus(minDuration)));
  return {
    picks: found.not().and(ok, segStart.atMost(now), now.plus(MARGIN).lt(segEnd)),
    chains: found.and(auto, ok, mode.is('auto'), start.atMost(segStart), segStart.lt(end), end.lt(segEnd)),
  };
});
