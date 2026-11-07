// Tube Cleaner's SponsorBlock decisions: the segment scan and the timing
// step, each proven and held to its shipped reducer. The desktop scenario in
// tests/cleaners/run-tests.mjs keeps the page wiring (the k-anonymous
// request, notices, Undo and skip buttons, the boundary timer, settings).
import * as scanRule from './sponsor-scan.rule.mjs';
import * as timeRule from './sponsor-time.rule.mjs';
import { proveAndHold } from './shipped.mjs';

const flag = (rand, odds) => rand(odds) === 0;

// Small, overlapping ranges around the playback position, some protected
// by an Undo, so draws hit picks, chains, protection and both margins.
proveAndHold({
  title: 'SponsorBlock scan', rule: scanRule.scan, laws: scanRule.laws, stepLaws: scanRule.stepLaws, naive: scanRule.naive,
  slug: 'tube-cleaner', fn: 'sponsorSegmentScan',
  init: () => ({ found: false, auto: false, start: 0, end: 0, notified: false }),
  params: rand => {
    const undoneStart = rand(200);
    return { now: rand(300), minDuration: rand(40), undone: flag(rand, 3), undoneStart, undoneEnd: undoneStart + rand(150) };
  },
  draw: rand => {
    const segStart = rand(300);
    return { segStart, segEnd: segStart + rand(200), mode: scanRule.MODES[rand(3)], skip: rand(6) > 0, segNotified: flag(rand, 3) };
  },
  mutate: step => (params, state, input) => step({ ...params, undone: false }, state, input),
});

// Timeupdates near segment ends and the video's end, Undo now and then,
// with the scan results its laws allow (compare skips the rest).
proveAndHold({
  title: 'SponsorBlock timing', rule: timeRule.timing, laws: timeRule.laws, stepLaws: timeRule.stepLaws, naive: timeRule.naive,
  slug: 'tube-cleaner', fn: 'sponsorTimeStep', adapt: step => (params, state, input) => step(state, input),
  init: () => ({ undone: false, undoneStart: 0, undoneEnd: 0, active: false, skip: false, notify: false, rewind: false, seek: 0 }),
  params: () => ({}),
  draw: rand => {
    const now = rand(400), start = Math.max(0, now - rand(100));
    return {
      op: flag(rand, 5) ? 'undo' : 'time', now, duration: 300 + rand(200), hasDuration: rand(4) > 0,
      ended: flag(rand, 12), seeking: flag(rand, 8), loop: flag(rand, 6), enabled: rand(8) > 0,
      found: rand(3) > 0, auto: rand(3) > 0, start, end: now + 51 + rand(300), notified: flag(rand, 3),
    };
  },
  mutate: step => (state, input) => step(state, { ...input, hasDuration: false }),
});
