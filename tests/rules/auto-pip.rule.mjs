// Automatic Picture-in-Picture, shared by Tube Cleaner and Player Cleaner,
// as a gdp-wired rule. Each script ships the same reducer, autoPiPStep: it
// decides on each visibility, focus, scroll or PiP event whether to enter or
// leave PiP, and remembers whether PiP is its own.
import { bool, oneOf, rule, when, yes, no } from 'gdp-wired';

export const OPS = ['hide', 'show', 'focus', 'blur', 'scrollOut', 'scrollIn', 'left'];

export const pip = rule('auto pip')
  // blurEnters: iPhone suspends a video before its hidden event arrives, so
  // there focus loss enters PiP while the playback gesture is still live.
  .params({ blurEnters: bool })
  .inputs({
    op: oneOf(...OPS),
    // autoAllowed: automatic PiP is on; hideAllowed: PiP on hiding is allowed
    // (on iOS it follows Background Playback instead).
    autoAllowed: bool, hideAllowed: bool,
    playing: bool, focused: bool, hidden: bool,
    // inPiP: the video is in PiP right now, whoever put it there.
    inPiP: bool,
  })
  .state({ ours: bool.from(false), enter: bool.from(false), exit: bool.from(false) })
  .flags(({ op, blurEnters, autoAllowed, hideAllowed, playing, focused, hidden, inPiP, ours }) => {
    const wantsIn = op.is('hide').and(hideAllowed).or(op.is('blur').and(blurEnters, hideAllowed), op.is('scrollOut').and(autoAllowed));
    const wantsOut = op.is('show').and(focused).or(op.is('focus').and(hidden.not(), focused), op.is('scrollIn').and(autoAllowed));
    return {
      entering: wantsIn.and(playing, inPiP.not()),
      leaving: wantsOut.and(ours, inPiP),
      // PiP that ended on its own (closed, or a request that was refused)
      // is no longer ours to close.
      forget: op.is('left').or(wantsOut.and(ours, inPiP.not())),
    };
  })
  .step(({ ours, entering, leaving, forget }) => ({
    ours: when(entering, yes, when(leaving.or(forget), no, ours)),
    enter: entering,
    exit: leaving,
  }));

export const laws = [];

export const stepLaws = [
  pip.stepLaw('it only closes PiP it opened itself', ({ ours }, after) => after.exit.implies(ours)),
  pip.stepLaw('it opens PiP only for a playing video not already in PiP',
    ({ playing, inPiP }, after) => after.enter.implies(playing.and(inPiP.not()))),
  pip.stepLaw('focus loss alone never opens PiP outside iPhone', (_, after) => after.enter.not(),
    ({ op, blurEnters }) => op.is('blur').and(blurEnters.not())),
  pip.stepLaw('nothing opens PiP while its switch is off',
    ({ op, autoAllowed, hideAllowed }, after) => after.enter.implies(op.is('scrollOut').and(autoAllowed).or(hideAllowed))),
  pip.stepLaw('hiding the page opens PiP for a playing video when allowed', (_, after) => after.enter.and(after.ours),
    ({ op, hideAllowed, playing, inPiP }) => op.is('hide').and(hideAllowed, playing, inPiP.not())),
  pip.stepLaw('it closes PiP only on coming back into focus or into view',
    ({ op, focused }, after) => after.exit.implies(op.is('scrollIn').or(focused.and(op.is('show').or(op.is('focus')))))),
  pip.stepLaw('PiP that ended on its own is forgotten', (_, after) => after.ours.not(), ({ op }) => op.is('left')),
];

// The bug these laws rule out (Player Cleaner had it): closing PiP on every
// return to the page, including PiP the user opened from Safari's controls.
export const naive = pip.flags(({ op, blurEnters, autoAllowed, hideAllowed, playing, focused, hidden, inPiP }) => {
  const wantsIn = op.is('hide').and(hideAllowed).or(op.is('blur').and(blurEnters, hideAllowed), op.is('scrollOut').and(autoAllowed));
  const wantsOut = op.is('show').and(focused).or(op.is('focus').and(hidden.not(), focused), op.is('scrollIn').and(autoAllowed));
  return { entering: wantsIn.and(playing, inPiP.not()), leaving: wantsOut.and(inPiP), forget: op.is('left') };
});
