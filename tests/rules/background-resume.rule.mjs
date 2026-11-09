// The cleaners' iOS background playback as a gdp-wired rule.
//
// When Safari on iOS goes to the background, WebKit pauses a playing video
// with sound once, 0.4 to 0.9 s before the page reports hidden. Calling
// play() at the hide (or on a pause that lands just after it) resumes it, and
// it keeps playing in the background. A pause the page made, one right after
// the user touched the page, a Media Session pause or stop, the end of the
// video and a pause long after hiding (the lock screen's) are never undone,
// and nothing resumes while the page is visible: WebKit also pauses when
// headphones disconnect. The shipped reducers, backgroundResumeStep in
// Tube Cleaner and Player Cleaner, are held to this rule.
import { bool, nat, no, oneOf, rule, when, yes } from 'gdp-wired';

// pageCall: the page called pause(); input: a tap, click or key in the page;
// command: a Media Session pause or stop.
export const OPS = ['pause', 'hide', 'show', 'play', 'pageCall', 'input', 'command'];

export const resume = rule('background resume')
  // enabled: Background Playback is on and the platform is iOS; callGrace:
  // how long after a pause() call a pause is the page's; inputGrace: how long
  // after input it is the user's; lead: how long before hiding a pause still
  // counts as WebKit's; window: how long after hiding.
  .params({ enabled: bool, callGrace: nat, inputGrace: nat, lead: nat, window: nat })
  .inputs({ op: oneOf(...OPS), t: nat, ended: bool })
  .state({
    hidden: bool.from(false), hiddenAt: 0, pageAt: 0, inputAt: 0, intent: bool.from(false),
    held: bool.from(false), heldAt: 0, resume: bool.from(false),
  })
  .flags(({ op, t, ended, enabled, callGrace, inputGrace, lead, window, hidden, hiddenAt, pageAt, inputAt, intent, held, heldAt }) => {
    const system = op.is('pause').and(enabled, ended.not(), t.lt(pageAt.plus(callGrace)).not(),
      t.lt(inputAt.plus(inputGrace)).not(), intent.not());
    return {
      system,
      resumeNow: system.and(hidden, t.atMost(hiddenAt.plus(window)))
        .or(op.is('hide').and(enabled, held, intent.not(), t.atMost(heldAt.plus(lead)))),
    };
  })
  .step(({ op, t, hidden, hiddenAt, pageAt, inputAt, intent, held, heldAt, system, resumeNow }) => {
    const holding = system.and(hidden.not());
    const clears = op.is('hide').or(op.is('show'), op.is('play'), op.is('command'), op.is('input'), op.is('pageCall'));
    return {
      hidden: when(op.is('hide'), yes, when(op.is('show'), no, hidden)),
      hiddenAt: when(op.is('hide'), t, hiddenAt),
      pageAt: when(op.is('pageCall'), t, pageAt),
      inputAt: when(op.is('input'), t, inputAt),
      intent: when(op.is('command'), yes, when(op.is('play'), no, intent)),
      held: when(op.is('pause'), holding, when(clears, no, held)),
      heldAt: when(holding, t, heldAt),
      resume: resumeNow,
    };
  });

export const laws = [
  resume.law('only a visible pause WebKit made is held for the hide',
    ({ held, hidden, intent, enabled }) => held.implies(hidden.not().and(intent.not(), enabled))),
];

export const stepLaws = [
  resume.stepLaw('a pause the page made never resumes',
    (_, after) => after.resume.not().and(after.held.not()),
    ({ op, t, pageAt, callGrace }) => op.is('pause').and(t.lt(pageAt.plus(callGrace)))),
  resume.stepLaw('a pause right after the user touched the page never resumes',
    (_, after) => after.resume.not().and(after.held.not()),
    ({ op, t, inputAt, inputGrace }) => op.is('pause').and(t.lt(inputAt.plus(inputGrace)))),
  resume.stepLaw('the end of the video never resumes',
    (_, after) => after.resume.not().and(after.held.not()), ({ op, ended }) => op.is('pause').and(ended)),
  resume.stepLaw('after a Media Session pause or stop nothing resumes until playback starts again',
    (_, after) => after.resume.not(), ({ op, intent }) => op.is('command').or(intent.and(op.is('play').not()))),
  resume.stepLaw('a pause long after hiding never resumes',
    (_, after) => after.resume.not(), ({ op, t, hidden, hiddenAt, window }) => op.is('pause').and(hidden, t.gt(hiddenAt.plus(window)))),
  resume.stepLaw('a pause while the page is visible never resumes on the spot',
    (_, after) => after.resume.not(), ({ op, hidden }) => op.is('pause').and(hidden.not())),
  resume.stepLaw('a resume happens only on a pause or on hiding',
    ({ op }, after) => after.resume.implies(op.is('pause').or(op.is('hide')))),
  resume.stepLaw('nothing resumes while Background Playback is off', (_, after) => after.resume.not(), ({ enabled }) => enabled.not()),
  resume.stepLaw('a pause WebKit makes just after hiding resumes',
    (_, after) => after.resume,
    ({ op, t, ended, enabled, hidden, hiddenAt, window, pageAt, callGrace, inputAt, inputGrace, intent }) => op.is('pause').and(enabled, ended.not(),
      hidden, t.atMost(hiddenAt.plus(window)), t.lt(pageAt.plus(callGrace)).not(), t.lt(inputAt.plus(inputGrace)).not(), intent.not())),
  resume.stepLaw('a pause WebKit made just before hiding resumes at the hide',
    (_, after) => after.resume, ({ op, t, held, heldAt, lead }) => op.is('hide').and(held, t.atMost(heldAt.plus(lead)))),
];

// The bug these laws rule out: play() on every pause nobody called pause()
// for, visible or not, long after hiding, or after a Media Session pause.
export const naive = resume.step(({ op, t, hidden, hiddenAt, pageAt, inputAt, intent, held, heldAt, callGrace }) => ({
  hidden: when(op.is('hide'), yes, when(op.is('show'), no, hidden)),
  hiddenAt: when(op.is('hide'), t, hiddenAt),
  pageAt: when(op.is('pageCall'), t, pageAt),
  inputAt, intent, held, heldAt,
  resume: op.is('pause').and(t.lt(pageAt.plus(callGrace)).not()),
}));
