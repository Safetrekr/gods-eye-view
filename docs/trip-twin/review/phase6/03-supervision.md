# Phase 6 review: supervision (live vs not-live, honesty)

Reviewer: supervision / autonomous-interface lens. Review only, no code edits.
Read: PHASE-6-PLAN.md, WEATHER-TIMELINE-SOURCES.md, shots 01–11 (1600 + 1280) and 1600-text.json, and the code: `page.js` (weather section, mode chip, incident snap, keyboard), `twinWeatherTime.js`, `twinWeatherFx.js`, `twinWeatherTimeline.js`, `twinWeather.js` (recolour, chip parts, exceptions).
Line numbers are from page.js as of 10:06. The file changed while I was reading, so the function names are the stable reference.

**Verdict.** The away-from-now state is well marked: an amber bar, "— not live", FCST/PAST in the chip and "· VIEWING FORECAST" in the mode chip. The lightning rule correctly keeps using live data. But two P0 bugs mean the 3D and the bar can say the wrong thing:
- **F1.** In widespread rain the particles disappear and the row says there is "none on radar". When a frame is missing, the particles spread over the whole site instead.
- **F2.** US past radar has never loaded, because the JSON field is parsed wrong. The same bug removes the data-kind shading from the US bar.

After those, the main risks are:
- what the snap-back to now does not cover (lightning watch, an incident at another site);
- two clocks that are 11 h apart;
- simulated snow values that leak, unlabelled, into the exception lines.

---

## P0

### F1. Rain placement fails both ways: widespread rain reads as "none on radar", and a missing frame fills the whole site
**Evidence.**
- `recolour()` (twinWeather.js:426) clears the canvas and sets `noData: true` when more than 85 % of the box is lit.
- `radarCover()` (page.js:3111) does not check `noData`. It builds `coverageFromCanvas` from the cleared canvas, so `covered:false`. `drawFx` then draws no particles, and `precipRowText` says "Forecast rain · none on radar over the site now".
- A 20 km box under a stratiform rain shield is often more than 85 % lit. On the DWD ICON-EU map the box is about 3×4 cells of 7 km (sources doc §5), so any rain across the box lights nearly all of it.
- The opposite case: when the timeline frame is `loading` or `missing` (EUMETSAT 502 gaps, DWD XML errors, IEM blank frames), `img` is null and `radarCover()` returns null. `drawFx` then takes the "radar off" branch: particles over the whole site, row "…MET Norway forecast for the site · not a map". The radar-gated view quietly turns into a forecast-filled site exactly when the radar data is absent. It also flickers: whole site while loading, then none or partial once the frame arrives.

**Risk.** The view inverts the truth in the case that matters most, heavy widespread rain, and prints a false sentence that cites radar. The plan's rule "disagreement is said, not drawn" is broken in both directions.

**Spec.**
1. `radarCover()` returns a state, not a boolean:
   - `{state:'covered'|'clear'|'saturated'|'missing'|'loading', fn, label, frameTime}`.
   - `noData` → `saturated`: treat it as covered over the whole site. Row: "Rain over the whole area on {label} {time} · amount: MET Norway".
2. While the precipitation layer is on and the frame is `missing` or `loading`, draw **no** particles. Row: "{label} frame for {hh:mm} missing — rain not drawn" (or "loading"). Never fall back to whole-site without saying so.
3. Unit-test `radarCover` against fixtures: saturated canvas, empty canvas, partial canvas, and a missing frame.

### F2. US observed past is broken, so the bar's data-kind shading disappears
**Evidence.**
- `timeSources('us').observed.parseLatest = (j) => Date.parse(j?.valid)` (twinWeatherTime.js:179).
- A curl of `…/USCOMP/n0q_0.json` today at 15:08 UTC returned `{"meta": {…, "valid": "2026-10-16T15:05:00Z", …}}`. The field is `meta.valid`, so `j.valid` is undefined and the result is `NaN`.
- `until: (now, meta) => meta?.latestRadar ?? now - 10*MIN` lets the NaN through, because `??` only catches null and undefined.
- So `obsUntil` is NaN:
  - `kindAt` returns `'none'` for the whole past two hours;
  - `frameSourceAt` returns no past source;
  - the caption at −1 h says "newest radar frame not in yet" (shot 07, 1600-text.json). That is false: the newest frame was 3 minutes old.
- The track gradient also gets `NaN%` stops. The custom property is then invalid, and the US bar has no shading at all (shots 05, 06, 07 and 1280-06 show a flat dark track). London is shaded (shots 08, 11).

**Risk.**
- The bar's main honesty device (observed / model map / site forecast) is missing for every US site.
- Past radar never shows, and the bar gives a false reason. A blank past radar next to the word "observed" in the legend can read as "it was dry".

**Spec.**
1. `parseLatest: (j) => Date.parse(j?.meta?.valid ?? j?.valid)`.
2. In `until`, use the value only if `Number.isFinite`; otherwise use `now - 10 min`, and say "radar time not confirmed".
3. `render()` in twinWeatherTimeline drops any segment with non-finite ends and never writes NaN into the gradient.
4. Add a unit test with the real JSON shape above, and one for NaN.
5. Even when the shading works, the three kinds are three greys (shot 08). Add a pattern so kind is not shown by lightness alone: solid for observed, diagonal hatch for the model map, dotted for the site forecast. Use the same patterns in the legend.

---

## P1

### F3. The snap back to now covers new incidents here, but not lightning watch, an incident at another site, or an incident already running
**Evidence.** Page.js:750–762 snaps only when `mode.mode === 'incident' && lastModeKey !== 'incident'`. The lightning exception sets mode `'watch'` (twinData deriveMode); an incident at another site sets `'incident_elsewhere'`. Neither snaps.
While the operator is at +6 h:
- a live lightning watch makes the chip read "WATCH · VIEWING FORECAST";
- the lightning layer is hidden because the view is ahead of now (`lightning: wx.layers.lightning && !ahead`, page.js:3192);
- the 3D may show clear forecast skies.

Other gaps:
- The notice is the shared 8 s `role=status` toast, so any other toast can overwrite it.
- The snap path sets `wx.at = null` and calls `renderWeather()`. It skips `renderLayers()` and `twin.refresh()`, which `setWxTime(null)` would call.
- During an incident already running, the operator can scrub away again with no reminder.

**Risk.** Lightning is the weather exception (EX-WX-01). It can fire while the screen shows a calm forecast with the lightning layer hidden, and only a suffix on the chip says otherwise.

**Spec.**
1. Snap on any rise in severity: monitoring → watch, any → incident, any → incident_elsewhere. Also snap on `lightningDown` appearing.
2. Snap with `timeline.stop(); setWxTime(null)`.
3. Announce in a live region with `role=alert`: "Weather back to now: {topLine}". Keep a line in the bar caption until the operator scrubs again: "Returned to now at {hh:mm} because: Lightning 6.2 km SW of rally point".
4. While mode is watch or incident and the view is away from now, put a red second line in the bar: "{chip} is live now — you are viewing {FORECAST|PAST}".
5. Lightning stays drawn (live) while ahead of now whenever a watch is active, labelled "Lightning now (live)".

### F4. Esc does nothing while the slider is focused, and Play leaves the view at +48 h
**Evidence.**
- Esc: the keydown handler returns at `if (e.target.closest?.('input, select, textarea')) return;` (page.js:3847), before the Esc-to-now branch (3849–3857). The slider is `<input type=range>`, and the component has no keydown handler of its own. So Esc fails in the very state where the operator is scrubbing.
- Native Home and End jump to −2 h and +48 h, not to now.
- Play: `setInterval` steps 15 min every 700 ms and calls `stop()` at the end (twinWeatherTimeline.js:77–80). The view stays at the last forecast hour, and nothing brings it back to now when idle.
- `cap` is `role=status` and is rewritten on every step, so a screen reader announces about 190 long captions during one Play.

**Risk.** The operator should not have to be watching for the view to come back to live. An unattended screen can sit for hours on "+48 h forecast". The amber bar shows it, but a glance at the 3D does not.

**Spec.**
1. A keydown on the range input:
   - Esc → back to now (stop Play, `onChange(null)`);
   - `N` → now;
   - Home → now (not −2 h); Shift+Home → start.
2. Play runs once from the thumb to the end, holds 2 s, then returns to now with the notice "Played to +48 h — back to now".
3. Idle return: if the view is away from now and there has been no timeline input for 3 minutes, return to now and post a notice. Show the countdown in the caption ("returns to now in 2:40").
4. During Play, set `aria-live="off"` on the caption and announce only at start, at stop, and at each change of data kind.

### F5. Two clocks 11 h apart: the scenario clock is fictional, the weather is real, and real now is never shown
**Evidence.**
- Shot 06: top bar "21:32 local · sample", directly next to "FCST 68 °F mostly clear forecast 13:00", above a bar that reads "VIEWING FORECAST 13:00 (+3 h)". From the visible clock, +3 h is about 00:30, not 13:00.
- The NOW tick shows no time ("NOW"), so the real current time (about 10:00) appears nowhere.
- Shot 08 (London): sample 21:32 against forecast 22:00 (+6 h).
- The incident panel mixes both clocks. Incident and positions use the sample clock (page.js:1125 "position 'at 21:31' agrees with '21:32 local · sample'"), while the weather line says "forecast for 10:00 · fetched 10:02" (page.js:887).
- The only explanation is a tooltip on the chip ("the sample clock is fictional", page.js:3283).
- At 1280 the chip truncates to "mostly cle… forecast 13:0…" (1280-06), and the NOW label runs into the first tick ("NOW3:00").

**Risk.** The operator can work out when weather arrives wrongly. The worse version: reading "lightning held from 10:04" against a 21:32 clock as about 11 h old.

**Spec.**
1. While any weather layer is on, the NOW tick reads "NOW 10:02" in real local time. Captions say "13:00 local (+3 h)".
2. Restyle the top-bar clock as "SCENARIO 21:32": dashed border, dimmed, with an aria-label "scenario clock, fictional". Where the clock appears in weather or incident lines, give one of the clocks a prefix.
3. In the incident panel, weather lines use relative times only ("forecast for this hour · fetched 3 min ago").
4. At 1280, truncate the condition word before the time; never cut off the forecast time.
5. Hide 6-hourly ticks that fall within 1.5 h of NOW, so the labels do not collide.

### F6. Mixed-time picture: only travelers are named, they are not dimmed, and lightning shows now while the view is in the past
**Evidence.**
- The plan (§B) says "people dimmed with 'positions now'". No code dims people when `wx.at != null`. There is no class, no `setPeopleVisible`, and no style change. Shots 06, 07, 08 and 11 show HL, JO and MR at full strength.
- "Travelers stay at their current positions" sits at the end of a long amber line, which wraps onto a second line at 1600 (shot 06).
- Lightning while past: `drawWeather` draws `wx.images.lightning`, the live frame, whenever the view is not ahead of now. So at −1 h the scene combines a past radar frame with present lightning. The row says "Lightning density … fetched 10:02", and the future-side text claims "shown for now and the past only".
- The NWS alert, fire detections and Needs-attention list stay live and are not mentioned.

**Risk.** A screenshot or glance at −1 h shows lightning beside travelers and implies they were there together.

**Spec.**
1. Put the caption on two lines:
   - Line 1: "WEATHER AT 13:00 local (+3 h) · model forecast, not live".
   - Line 2: "Live now: travelers, lightning watch, alerts, fires, incidents".
2. When away from now, people markers drop to 55 % opacity with a dashed ring. One label goes on the cluster: "positions now".
3. Lightning when past: either load the matching past frame (nowCOAST `ldn_lightning_strike_density`, 15-min steps over the past 6 h, sources doc §3), or hide it with the row "Lightning: now only — hidden while viewing past (watch rule still live)". Never pair a past radar frame with present strikes.

### F7. Observed versus forecast: the forecast can overrule live radar, and PAST is shown with forecast values
**Evidence.**
- (a) At now with the radar on: if MET's hourly symbol is dry, `precipKind` returns null. There are then no particles and the row says "Forecast: no rain or snow · MET Norway", even when the live radar covers the site. The disagreement sentence only exists for "forecast rain, radar none".
- (b) Past: MET's series starts at the current, partly elapsed hour. So:
  - at −1 h in the US, `stepAt` finds a step: chip "PAST 64 °F cloudy forecast 09:00", plus 3D clouds drawn from that forecast (shot 07);
  - at −1 h 30 in London it finds none: "map frames only" (shot 11).
  The same moment gets different rules depending on minute of the hour, and PAST appears on a forecast value.
- (c) EU at now: `radarCover` places particles from `wx.images.precip`, the satellite estimate, which runs about 65 min or more behind (sources §4). The row says "where the satellite estimate shows it" and gives no time.

**Risk.** "Forecast says dry" can override observed rain in the live view, and an old frame is presented as current.

**Spec.**
1. Precedence: observed beats model map, which beats site forecast.
2. At now or in the past, if the radar covers the site and MET is dry: draw light particles of unknown type (flake-streak mix) and say "Radar shows precipitation over the site {hh:mm} · forecast said dry".
3. In the past, show no site-forecast values in the chip or the 3D. If they must stay, label them "forecast issued {hh:mm} for 09:00 — not observed" and draw no clouds.
4. Every frame named in a row carries its valid time and age: "satellite estimate 13:50 (1 h 12 min old)".
5. If the newest observed frame is more than 30 min old, do not use it to place particles at now. Row: "no current rain map — forecast for the site, not a map".

### F8. Simulated snow invents a temperature, credits it to MET Norway, and leaks it unlabelled into the exception lines
**Evidence.**
- `wxSummary()` with simulated snow sets `tempC:-1, apparentC:-4` (page.js:2985–2989).
- The chip source for any simulation is "prototype · temperature MET Norway" (twinWeather.js:170). Shots 01, 03, 04 and 10 show "30 °F SIMULATED snow · prototype · temperature MET Norway", which credits an invented 30 °F to MET.
- `exposureException(wxSummary(), …, {simulated: wx.sim.rain})` and `rainPace(…, {simulated: wx.sim.rain})` (page.js:3522, 3529) do not flag snow. Even with the flag on, the "feels like" part never gets a SIMULATED prefix.
- The Advance brief flag is `wx.sim.rain || wx.sim.lightning` (page.js:2017), so snow is missing there too.
- Result: with snow on and an incident running, the incident panel can say "…feels like 25 °F — information, not advice" with no SIM marker.

**Risk.** A simulated value reaches the exception surface that responders read, with a real source named next to it. This can only be reached from the prototype drawer, and the mode chip does say SIMULATED DATA. Raise this to P0 if the drawer is in any demo given to operators.

**Spec.**
1. One helper, `simActive() = rain || snow || lightning`, used everywhere a `simulated` flag is passed.
2. Any exception clause built from a simulated summary starts with "SIMULATED", including "feels like".
3. The chip source becomes "prototype · values simulated" when snow is on. Keep "temperature MET Norway" only when the temperature really comes from MET.

---

## P2

### F9. The drawing implies more precision than the data has (grid, timing, run time, wording)
**Evidence.**
- Particles are cut per pixel by `coverageFromCanvas`, on a frame upscaled 2× with high-quality smoothing (twinWeather.js:379–386). For model maps the edges are interpolation, not data:
  - DWD ICON-EU is a 7 km grid, so the site sits inside a single cell;
  - HRRR is 3 km simulated reflectivity.
  Particles that cover part of a 1 km site claim detail below the grid.
- HRRR is offered every 15 min from a run that is about 2 h old. Neither the HRRR nor the DWD caption gives the run time ("Forecast radar (model) · NOAA HRRR 13:00"), which breaks plan §C ("forecast says forecast and the run time").
- DWD frames use `ceil` to the hour and are labelled "1 h totals 22:00". The convention that the total ends at T is UNVERIFIED (sources §5), and the label is ambiguous.
- The slider moves in 15-min steps where the map only has hourly frames.
- At forecast times the row says "…none on the forecast map over the site **now**".
- Beyond +64 h, MET steps are 6-hourly with no fog. They are shown with the same confidence as hourly steps.

**Spec.**
1. For model sources, decide per site, not per pixel: if at least 30 % of the site disc is covered, use the whole site; otherwise none. Row: "DWD ICON-EU 7 km grid — the site is inside one cell". Keep pixel shaping only for observed radar, at 1 km or finer.
2. Captions include the run: "HRRR run 13Z · valid 13:15" and "DWD ICON-EU run 06Z · rain in the hour to 22:00".
3. The slider step follows the source at the thumb: 5 or 10 min observed, 15 min HRRR, 60 min DWD and MET hourly, 6 h beyond +64 h.
4. Replace "now" with "at {hh:mm}" whenever the view is away from now.
5. Beyond +64 h: "6-hour forecast step · less certain".

### F10. Advance: an event outside the forecast range shows today's weather in 3D, with no caption
**Evidence.**
- `syncAdvanceWeather` (page.js:2056) sets `wx.at = null` when the event is more than 1 h in the past or beyond MET's last step. The 3D effects then draw **now** on a Day-N plan.
- The timeline is hidden in Advance, so no caption names the time shown in 3D. The chip (shot 09: "FCST 62 °F clear Day 2 19:00") says one thing, and the scene can show another.
- Within range it works and resets on return to Live (`setAppMode` calls `syncAdvanceWeather`). Keep that.

**Spec.**
1. In Advance, 3D weather is either at the event time or off.
2. Out of range: switch the effects off, with the row "No forecast yet for Day 5 19:00 — 3D weather off".
3. Add a small caption in the scene while in Advance: "Weather shown: Day 2 19:00 · MET Norway forecast, updated 08:17 · not live".

---

## Keep
- **Away state.** The amber bar, the amber thumb, and "— not live" in the caption. "· VIEWING FORECAST / PAST" on the mode chip and FCST/PAST on the weather chip. This works well: three separate markers that agree.
- **Lightning rule uses live data.** `weatherLines` → `strikes()` reads `wx.images.lightning`, whatever `wx.at` is. `ensureImage('lightning')` runs at startup and on the timer ("runs whether or not it is drawn", page.js:3949). "Lightning data unavailable — outdoor check not running" is a good exception.
- **No lightning drawn ahead of now**, and the row says why (page.js:3074, 3190–3192).
- **`stepAt` never stretches a forecast past its end.** Missing frames are shown as "frame missing", never interpolated. A failed image (including an XML error body) becomes `missing` rather than a picture.
- **The "forecast rain · none on radar" sentence.** Keep the idea and make it work in both directions (F1, F7).
- **SIMULATED labelling** on the chip, the mode chip ("· SIMULATED DATA"), the drawer flag and the layer rows. Reduce motion draws particles still and the row says so. The cloud clear-column is stated in the row.
- **Snap to now on a new incident at this site** and the notice text. Widen the triggers and make it louder (F3).
- **Advance → Live resets the weather time.** The Advance chip shows the event forecast, not now.
- **Native range input**: user input stops Play, "Back to now" appears only when away, "further out, less certain" beyond 24 h, and the credits update per frame source.
- **Neutral greys for weather**, with blue kept for paths.

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: supervision_review
agents_covered: 0
capabilities_mapped: 0
autonomy_tiers_defined: 0
exceptions_categorized: 3
reversibility_documented: true
multi_surface_covered: false
kill_switch_specified: true
audit_log_surface_designed: false
wcag_level: aa
metrics_leading: 0
metrics_lagging: 0
kill_criteria_defined: 0
confidence: 0.85
source_artifacts: [plans/trip-twin/PHASE-6-PLAN.md, plans/trip-twin/WEATHER-TIMELINE-SOURCES.md, review/phase6/shots/*, review/phase6/shots/1600-text.json, gods-eye-view/src/operations/tripTwin/{page.js,twinWeatherTime.js,twinWeatherFx.js,twinWeatherTimeline.js,twinWeather.js,twinData.js}]
-->
