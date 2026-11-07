// Tube Cleaner's resume-position restore as a gdp-wired rule.
//
// When a video activates, resumeRestoreStep decides whether to seek to the
// saved position. YouTube reuses one <video> across SPA navigations, so a
// restore for a new video waits until a media event confirms the switch,
// and a restore happens at most once per activation. Times are milliseconds.
import { bool, min, nat, oneOf, rule, when, yes, no } from 'gdp-wired';

export const OPS = ['begin', 'check', 'metadata', 'cancel'];

export const resume = rule('resume restore')
  // saved: the stored position, if any; carriedSame: the same video carried
  // over an element swap, which may already hold a playhead.
  .params({ hasSaved: bool, saved: nat, carriedSame: bool })
  .inputs({
    op: oneOf(...OPS),
    // begin: a new activation; waitFor: the previous video was a different
    // one, so wait for a media event before trusting the element.
    waitFor: bool,
    // current: still the active video and identity; ready: metadata with a
    // usable duration.
    current: bool, ready: bool, duration: nat, now: nat,
    // fails: the browser refused the seek.
    fails: bool,
  })
  .state({ waiting: bool.from(false), restored: bool.from(false), cancelled: bool.from(false),
    seek: bool.from(false), target: 0, ended: bool.from(false), done: bool.from(false) })
  .flags(({ op, waitFor, current, ready, duration, now, fails, hasSaved, saved, carriedSame, waiting, restored, cancelled }) => {
    const begin = op.is('begin');
    const waitingNow = when(begin, waitFor, when(op.is('metadata'), no, waiting));
    const fresh = begin.or(restored.not().and(cancelled.not()));
    const attempts = op.is('check').or(op.is('metadata')).and(fresh, waitingNow.not(), current, ready);
    const farAway = now.minus(saved).plus(saved.minus(now)).gt(750);
    const atEnd = duration.atMost(saved.plus(500));
    const seeks = attempts.and(hasSaved, atEnd.not(), farAway, carriedSame.and(now.gt(250)).not());
    return {
      waitingNow, attempts, seeks,
      finishes: attempts.and(hasSaved, atEnd),
      restores: attempts.and(seeks.and(fails).not()),
    };
  })
  .step(({ op, duration, saved, restored, cancelled, waitingNow, seeks, finishes, restores }) => ({
    waiting: waitingNow,
    restored: when(op.is('begin'), restores, restored.or(restores)),
    cancelled: when(op.is('begin'), no, cancelled.or(op.is('cancel'))),
    seek: seeks,
    target: when(seeks, min(saved, duration.minus(100)), 0),
    // A saved position at the very end means the video was finished: start over.
    ended: finishes,
    done: restores,
  }));

export const stepLaws = [
  resume.stepLaw('it never seeks while waiting for YouTube to confirm the new video',
    (_, after) => after.seek.implies(after.waiting.not())),
  resume.stepLaw('it restores at most once per activation', (_, after) => after.seek.not(),
    ({ op, restored }) => restored.and(op.is('begin').not())),
  resume.stepLaw('a cancelled activation never seeks', (_, after) => after.seek.not(),
    ({ op, cancelled }) => cancelled.and(op.is('begin').not())),
  resume.stepLaw('it never pulls back a playhead the same video already has', (_, after) => after.seek.not(),
    ({ carriedSame, now }) => carriedSame.and(now.gt(250))),
  resume.stepLaw('a restore stops short of the end', ({ duration }, after) => after.seek.implies(after.target.plus(100).atMost(duration))),
  resume.stepLaw('it seeks only for the active video once it has metadata',
    ({ current, ready }, after) => after.seek.implies(current.and(ready))),
];

// The bug these laws rule out: restoring on every metadata event, which
// yanked the playhead back after the user's own later seek.
export const naive = resume.flags(({ op, waitFor, current, ready, duration, now, hasSaved, saved, waiting }) => {
  const waitingNow = when(op.is('begin'), waitFor, when(op.is('metadata'), no, waiting));
  const attempts = op.is('check').or(op.is('metadata')).and(waitingNow.not(), current, ready);
  const seeks = attempts.and(hasSaved, duration.atMost(saved.plus(500)).not(), now.minus(saved).plus(saved.minus(now)).gt(750));
  return { waitingNow, attempts, seeks, finishes: attempts.and(hasSaved, duration.atMost(saved.plus(500))), restores: attempts };
});
