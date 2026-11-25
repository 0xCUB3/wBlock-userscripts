// Spurious Media Session play suppression on macOS as a gdp-wired rule.
//
// When macOS Safari switches tabs while a video is already paused, it can send
// a redundant Media Session pause followed by a spurious play command. While a
// pause arrives on an already-paused video, one follow-up play command while
// still paused (hidden, or within a short grace window after returning) is
// dropped. Real playback, a normal pause of a playing video, leaving the grace
// window, or a second play press always lets playback through.
//
// The shipped reducer, spuriousPlayStep in both Tube Cleaner and Player
// Cleaner, is held to this rule.
import { bool, nat, no, oneOf, rule, when, yes } from 'gdp-wired';

export const OPS = ['pauseCmd', 'playCmd', 'playing', 'show', 'hide'];

export const spuriousPlay = rule('spurious media-session play')
  .params({ grace: nat })
  .inputs({ op: oneOf(...OPS), paused: bool, t: nat })
  .state({ armed: bool.from(false), visible: bool.from(true), visibleAt: 0, drop: bool.from(false) })
  .step(({ op, paused, t, grace, armed, visible, visibleAt }) => {
    const pauseCmd = op.is('pauseCmd');
    const playCmd = op.is('playCmd');
    const playing = op.is('playing');
    const show = op.is('show');
    const hide = op.is('hide');
    const inGrace = visible.not().or(t.atMost(visibleAt.plus(grace)));
    const drop = playCmd.and(armed, paused, inGrace);
    const nextArmed = when(pauseCmd, paused, when(playCmd.or(playing), no, armed));
    return {
      armed: nextArmed,
      visible: when(show, yes, when(hide, no, visible)),
      visibleAt: when(show, t, visibleAt),
      drop,
    };
  });

export const laws = [];

export const stepLaws = [
  spuriousPlay.stepLaw('only a play command can be dropped, and only while previously armed and paused',
    ({ op, paused, armed }, after) => after.drop.implies(op.is('playCmd').and(paused, armed))),
  spuriousPlay.stepLaw('a play command never drops when the video is not paused',
    (_, after) => after.drop.not(), ({ paused }) => paused.not()),
  spuriousPlay.stepLaw('a play command never drops after the visible grace window expires',
    (_, after) => after.drop.not(), ({ visible, t, visibleAt, grace }) => visible.and(t.gt(visibleAt.plus(grace)))),
  spuriousPlay.stepLaw('a play command always disarms so a second press always plays',
    (_, after) => after.armed.not(), ({ op }) => op.is('playCmd')),
  spuriousPlay.stepLaw('real playback or pausing a playing video always disarms',
    (_, after) => after.armed.not(), ({ op, paused }) => op.is('playing').or(op.is('pauseCmd').and(paused.not()))),
  spuriousPlay.stepLaw('a pause command on an already-paused video arms suppression without dropping',
    (_, after) => after.armed.and(after.drop.not()), ({ op, paused }) => op.is('pauseCmd').and(paused)),
];

// The bug these laws rule out: staying armed after dropping a play command,
// which would swallow the user's real Play press too.
export const naive = spuriousPlay.step(({ op, paused, t, grace, armed, visible, visibleAt }) => {
  const inGrace = visible.not().or(t.atMost(visibleAt.plus(grace)));
  return {
    armed: when(op.is('pauseCmd'), paused, when(op.is('playing'), no, armed)),
    visible: when(op.is('show'), yes, when(op.is('hide'), no, visible)),
    visibleAt: when(op.is('show'), t, visibleAt),
    drop: op.is('playCmd').and(armed, paused, inGrace),
  };
});
