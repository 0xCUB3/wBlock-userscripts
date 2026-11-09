// Tube Cleaner's background-playback recovery (#12) as a gdp-wired rule.
//
// When Safari pauses an already-playing video around the page becoming
// really hidden (a tab or Tab Group switch on macOS with PiP off), Tube
// Cleaner resumes it, a bounded number of times, within a short window.
// A pause the user asked for (Now Playing, a media key, an in-page click)
// is never undone. The shipped reducer, backgroundRecoveryStep in
// packages/tube-cleaner/src/tube-cleaner.user.js, is held to this rule.
import { bool, nat, no, oneOf, rule, same, when, yes } from 'gdp-wired';

// pauseCommand is a Media Session Pause (Now Playing, a media key, or Safari
// itself just before hiding); stop is a Media Session Stop.
export const OPS = ['hide', 'show', 'play', 'pause', 'pauseCommand', 'stop', 'tick', 'reset'];

export const recovery = rule('background recovery')
  // enabled: Background Playback is on (and the platform is not iOS);
  // budget: resume attempts per background session; window: how long after
  // hiding a pause still counts as Safari's; lead: how long before hiding.
  .params({ enabled: bool, budget: nat, window: nat, lead: nat })
  .inputs({ op: oneOf(...OPS), t: nat })
  .state({
    hidden: bool.from(false), playing: bool.from(false), armed: bool.from(false),
    pending: bool.from(false), intent: bool.from(false), pauseSeen: bool.from(false),
    retries: 0, hiddenAt: 0, pausedAt: 0, resume: bool.from(false),
  })
  .flags(({ op, t, enabled, budget, window, lead, hidden, playing, pending, intent, pauseSeen, retries, hiddenAt, pausedAt }) => {
    const inWindow = t.atMost(hiddenAt.plus(window));
    // Safari can deliver its pause just before the visibility change.
    const pausedJustBefore = pauseSeen.and(t.atMost(pausedAt.plus(lead)));
    return {
      arming: op.is('hide').and(enabled, playing.or(pausedJustBefore)),
      lostWhileHidden: op.is('pause').and(hidden, intent.not(), inWindow, retries.lt(budget)),
      resumeNow: op.is('tick').and(pending, hidden, retries.lt(budget), inWindow),
    };
  })
  .step(({ op, t, budget, window, hidden, playing, armed, pending, intent, pauseSeen, retries, hiddenAt, pausedAt, arming, lostWhileHidden, resumeNow }) => {
    const hide = op.is('hide'), show = op.is('show'), play = op.is('play'), pause = op.is('pause');
    const tick = op.is('tick'), reset = op.is('reset');
    // A Pause command is the user's only once the page is hidden: Safari can
    // send its own just before hiding. Stop always is.
    const intentOp = op.is('stop').or(op.is('pauseCommand').and(hidden));
    const nextRetries = when(hide, 0, when(resumeNow, retries.plus(1), retries));
    return {
      hidden: when(hide, yes, when(show, no, hidden)),
      playing: when(play, yes, when(pause.or(reset), no, playing)),
      armed: when(hide, arming, when(show.or(intentOp).or(reset), no, armed)),
      pending: when(hide, arming.and(playing.not()),
        when(show.or(play).or(intentOp).or(reset), no,
          when(pause, armed.and(lostWhileHidden),
            when(tick, resumeNow.and(nextRetries.lt(budget)).and(t.atMost(hiddenAt.plus(window))), pending)))),
      intent: when(hide.or(play), no, when(intentOp, yes, intent)),
      // Only a pause the user didn't ask for can be Safari's.
      pauseSeen: when(pause, intent.not(), when(intentOp.or(reset), no, pauseSeen)),
      retries: nextRetries,
      hiddenAt: when(hide, t, hiddenAt),
      pausedAt: when(pause.and(intent.not()), t, pausedAt),
      resume: resumeNow,
    };
  });

export const laws = [
  recovery.law('resume attempts stay within the budget', ({ retries, budget }) => retries.atMost(budget)),
  recovery.law('a pending recovery is armed, hidden, enabled and not asked away',
    ({ pending, armed, hidden, intent, enabled }) => pending.implies(armed.and(hidden, intent.not(), enabled))),
  recovery.law('nothing is armed while Background Playback is off', ({ armed, enabled }) => armed.implies(enabled)),
];

export const stepLaws = [
  recovery.stepLaw('a pause the user asked for cancels recovery',
    (_, after) => after.pending.not().and(after.armed.not(), after.resume.not()),
    ({ op, hidden }) => op.is('stop').or(op.is('pauseCommand').and(hidden))),
  recovery.stepLaw('a Pause command while visible changes nothing',
    (before, after) => same(after.armed, before.armed).and(same(after.pending, before.pending), same(after.intent, before.intent),
      same(after.pauseSeen, before.pauseSeen), after.pausedAt.eq(before.pausedAt), after.resume.not()),
    ({ op, hidden }) => op.is('pauseCommand').and(hidden.not())),
  recovery.stepLaw('a pause within the lead before hiding arms recovery',
    (_, after) => after.armed,
    ({ op, t, enabled, pauseSeen, pausedAt, lead }) => op.is('hide').and(enabled, pauseSeen, t.atMost(pausedAt.plus(lead)))),
  recovery.stepLaw('a new video, an end or teardown cancels recovery',
    (_, after) => after.pending.not().and(after.armed.not(), after.resume.not()), ({ op }) => op.is('reset')),
  recovery.stepLaw('coming back to the page cancels recovery',
    (_, after) => after.pending.not().and(after.armed.not()), ({ op }) => op.is('show')),
  recovery.stepLaw('a resume happens only while hidden, within the window, and on a timer tick',
    ({ op, t, hidden, hiddenAt, window }, after) => after.resume.implies(op.is('tick').and(hidden, t.atMost(hiddenAt.plus(window))))),
  recovery.stepLaw('after a pause the user asked for, nothing resumes until the page hides again',
    ({ intent }, after) => after.resume.not(), ({ intent, op }) => intent.and(op.is('hide').not())),
];

// The bug these laws rule out: resuming on every pause, including the
// user's own, with no budget.
export const naive = recovery.step(({ op, t, hidden, playing, retries, hiddenAt, pausedAt, intent, pauseSeen, armed }) => ({
  hidden: when(op.is('hide'), yes, when(op.is('show'), no, hidden)),
  playing: when(op.is('play'), yes, when(op.is('pause'), no, playing)),
  armed: when(op.is('hide'), yes, armed),
  pending: when(op.is('pause'), hidden, no),
  intent: when(op.is('stop'), yes, intent),
  pauseSeen, retries: when(op.is('tick'), retries.plus(1), retries), hiddenAt: when(op.is('hide'), t, hiddenAt),
  pausedAt, resume: op.is('tick').and(hidden),
}));
