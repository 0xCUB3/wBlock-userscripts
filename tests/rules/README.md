# Proven rules

The stateful decisions inside the userscripts are written as pure reducers and
proven with [gdp-wired](https://www.npmjs.com/package/gdp-wired). Each rule here
mirrors one reducer shipped in a userscript between `// @gdp-begin <name>` and
`// @gdp-end`.

`npm run test:rules` does four things for each rule:

- proves its laws for every run, with the proof tree checked by gdp-wired's kernel;
- checks that a deliberately broken variant (the bug the laws rule out) is refused;
- runs the shipped reducer from the built userscript beside the rule on aimed
  random runs and compares every field after every step;
- makes sure that comparison catches a mutated copy of the reducer.

| Rule | Shipped reducer | What the laws say |
|---|---|---|
| `background-recovery.rule.mjs` | Tube Cleaner `backgroundRecoveryStep` | A pause Safari makes while switching tabs is resumed a bounded number of times within a window; pauses from Now Playing, media keys or the page are never undone, except a Pause command or in-page pause within the lead before hiding, which Safari itself sends on macOS 27; a new video, the end or teardown cancels it; nothing runs with Background Playback off. |
| `quality-watch.rule.mjs` | Tube Cleaner `qualityWatchStep` | A saved quality is restored only after real progress; it falls back to Auto at most once and only after a full stall while playing, visible, not seeking and not in an ad; pauses, seeks, ads and hidden time reset the stall; a cancelled or finished watch never acts again. |
| `sponsor-scan.rule.mjs` | Tube Cleaner `sponsorSegmentScan` | The chosen segment has started and playback is still inside it; a range the user undid is never chosen; once chosen, the segment and its mode stay; a skip-button segment never chains; a chain only grows by an automatic segment starting inside it. |
| `sponsor-time.rule.mjs` | Tube Cleaner `sponsorTimeStep` | A skip happens only while enabled, not seeking, not ended and short of the end; it moves forward and stops short of the duration unless the video loops; a skip-button segment never seeks; nothing skips into a range Undo protects; Undo protects exactly the skipped range while playback stays inside it, and leaving ends that; the skip button is offered once per visit. |
| `auto-pip.rule.mjs` | `autoPiPStep` in Tube Cleaner and Player Cleaner | It only closes PiP it opened itself; it opens PiP only for a playing video not already in PiP; focus loss alone never opens PiP outside iPhone; nothing opens PiP while its switch is off; hiding the page opens PiP when allowed; it closes PiP only on coming back into focus or into view; PiP that ended on its own is forgotten. |
| `live.rule.mjs` | Tube Cleaner `liveIndicatorStep`, `liveSeekCorrection` | The LIVE pill is hidden off live streams, red at the head, gray at once after a seek or pause behind it, and tolerates brief drift but not drift past the limit; a seek is corrected only when it lands more than a second past the buffered edge of a live stream, always backwards and behind the edge. |
| `resume.rule.mjs` | Tube Cleaner `resumeRestoreStep` | It never seeks while waiting for YouTube to confirm a new video; it restores at most once per activation; a cancelled activation never seeks; it never pulls back a playhead the same video already has; a restore stops short of the end and only happens for the active video once it has metadata. |
| `captions.rule.mjs` | Player Cleaner `captionChoiceStep`, `subtitleModeFor` | A default track WebKit or the page turned on is never saved, only reverted; turning captions off is saved as off; a non-default pick, or a deliberate pick of the default after tracks settle, saves its language; without a saved preference the page decides; a saved "off" turns every track off; only the saved language shows. |

The browser tests in `tests/cleaners` keep what a proof can't reach: what WebKit
paints, layout, native controls, events reaching the reducers, storage and
network requests.

To add a rule: move the decision into a self-contained function between the
markers, write the rule with the same inputs, state and step, state the laws a
reviewer would ask about, keep the broken variant, and add a test that calls
`proveAndHold` from `shipped.mjs`.
