// Player Cleaner's caption preference as gdp-wired rules.
//
// captionChoiceStep decides what a caption change means. WebKit turns on a
// <track default> by itself, sometimes repeatedly while it loads, and a
// default track switching on right after tracks appear is the page's doing
// too: neither may become the user's saved preference. subtitleModeFor
// decides each track's mode from the saved preference. Languages are
// numbered; times are milliseconds.
import { bool, fun, nat, oneOf, rule, when, no } from 'gdp-wired';

export const OPS = ['tracks', 'change'];
export const SHOWING = ['none', 'default', 'other'];

export const choice = rule('caption choice')
  // settle: how long after tracks appear a default track still counts as automatic.
  .params({ settle: nat })
  .inputs({ op: oneOf(...OPS), t: nat, showing: oneOf(...SHOWING), lang: nat, active: bool })
  .state({ seenAt: 0, revert: bool.from(false), save: bool.from(false), saveOff: bool.from(false), savedLang: 0 })
  .flags(({ op, t, showing, active, settle, seenAt }) => {
    const change = op.is('change');
    const automatic = change.and(showing.is('default'), active.and(seenAt.plus(settle).lt(t)).not());
    return { change, automatic, saves: change.and(automatic.not()) };
  })
  .step(({ op, t, showing, lang, seenAt, automatic, saves }) => ({
    seenAt: when(op.is('tracks'), t, seenAt),
    revert: automatic,
    save: saves,
    saveOff: saves.and(showing.is('none')),
    savedLang: when(saves.and(showing.is('none').not()), lang, 0),
  }));

export const stepLaws = [
  choice.stepLaw('a default track WebKit or the page turned on is never saved, only reverted',
    (_, after) => after.save.not().and(after.revert),
    ({ op, showing, active, t, seenAt, settle }) => op.is('change').and(showing.is('default'), active.and(seenAt.plus(settle).lt(t)).not())),
  choice.stepLaw('turning captions off is saved as off', (_, after) => after.save.and(after.saveOff),
    ({ op, showing }) => op.is('change').and(showing.is('none'))),
  choice.stepLaw('picking a non-default track saves its language', ({ lang }, after) => after.save.and(after.saveOff.not(), after.savedLang.eq(lang)),
    ({ op, showing }) => op.is('change').and(showing.is('other'))),
  choice.stepLaw('a deliberate pick of the default track after tracks settle is saved', ({ lang }, after) => after.save.and(after.savedLang.eq(lang)),
    ({ op, showing, active, t, seenAt, settle }) => op.is('change').and(showing.is('default'), active, seenAt.plus(settle).lt(t))),
  choice.stepLaw('only a caption change saves anything', ({ op }, after) => after.save.or(after.revert).implies(op.is('change'))),
];

// The bug these laws rule out: saving whatever track is showing, so WebKit's
// automatic default track overwrote the user's "off".
export const naive = choice.flags(({ op }) => ({ change: op.is('change'), automatic: no, saves: op.is('change') }));

export const mode = fun('subtitle mode')
  .inputs({ known: bool, off: bool, prefLang: nat, trackLang: nat })
  .returns(({ known, off, prefLang, trackLang }) => ({
    touch: known,
    show: known.and(off.not(), prefLang.eq(trackLang)),
  }));

export const modeLaws = [
  mode.law('without a saved preference the page decides', () => [], ({ touch }, { known }) => known.not().implies(touch.not())),
  mode.law('a saved "off" turns every track off', () => [], ({ touch, show }, { known, off }) => known.and(off).implies(touch.and(show.not()))),
  mode.law('only the saved language is shown', () => [], ({ show }, { prefLang, trackLang }) => show.implies(prefLang.eq(trackLang))),
];
