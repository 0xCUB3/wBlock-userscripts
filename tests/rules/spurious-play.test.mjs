// Spurious Media Session play suppression: proven, and both shipped reducers
// (Tube Cleaner and Player Cleaner) held to the rule.
import { spuriousPlay, laws, stepLaws, naive, OPS } from './spurious-play.rule.mjs';
import { proveAndHold } from './shipped.mjs';

let t = 0;
for (const slug of ['tube-cleaner', 'player-cleaner']) {
  proveAndHold({
    title: `spurious media-session play (${slug})`, rule: spuriousPlay, laws, stepLaws, naive,
    slug, fn: 'spuriousPlayStep',
    init: () => ({ armed: false, visible: true, visibleAt: 0, drop: false }),
    params: rand => { t = 0; return { grace: rand(12) }; },
    draw: rand => { t += rand(5); return { op: OPS[rand(OPS.length)], paused: rand(2) === 1, t: rand(10) === 0 ? rand(40) : t }; },
    mutate: step => (params, state, input) => {
      const next = step(params, state, input);
      return input.op === 'playCmd' && next.drop ? { ...next, armed: true } : next;
    },
  });
}
