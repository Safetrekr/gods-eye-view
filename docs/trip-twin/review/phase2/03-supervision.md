# 03 Supervision review, phase 2: cutaway, per-floor roster, EX-FLR-03, weather

Lens: does phase 2 keep the operator calibrated? The questions: are the numbers the operator will say aloud right, does an absent signal ever read as "no one there", is simulated data labelled everywhere, and is every camera move the operator's own.
Inputs: shots `phase2/shots/1600-01…14` and `1280-08`, `1600-text.json`, `twinData.js` (assessSnapshot, floorPartition, deriveMode, floorOccupancy, floorRoster, notDetectedReason), `twinCutaway.js`, `twinHud.js`, `twinWeather.js`, `page.js`, `floorEstimate.js`, the three test files. Recorded decisions are not reopened: Jesse's cutaway colours, the A-2 rule (no calm-mode floor exceptions), the free weather sources, and the hotel auto-selected on arrival.
I also ran a probe that calls `floorPartition`, `deriveMode` and `floorOccupancy` with synthetic rows. It was a scratch script; no repo file was touched. Its output is quoted in finding 1.

## Verdict

Phase 2 holds together on the happy path. In Demo A the top line, hero, rail group, cutaway and responder copy all agree: 2 + 1 = 3 at or above, and 11 people need attention. Nobody is counted twice. The camera only moves when the operator acts. The weather copy never says "all clear".
**But the at-or-above rule only sees phones that are moving and current.** In the real night-time fire alarm, phones are stopped on bedside tables. Those people fall out of the hero, out of the top line and out of EX-FLR-03, and the cutaway paints their floor amber with "no one detected here". That is P0.
The weather layer has a smaller version of the same flaw: the lightning rule claims 10 km but only fetches data for ±6 km, and it stays silent when its feed is down. Live weather and a fictional night clock also share one bar, with no label telling them apart.

---

## Findings

### P0

**1. Stopped phones, ageing phones and phones with no estimate drop out of "at or above".**
- Evidence:
  - `floorDisplay` (`twinData.js:570–571`) makes every Stopped · current (POS-03) and every not-current person `kind:'last'`.
  - `floorPartition` (`:604–607`) counts them in `lastAtOrAbove` but never puts them in `priority`. `lastAtOrAbove` is returned and then never used anywhere.
  - EX-FLR-03 (`:767–776`) admits only `unknown` and `not_shared`, so `last`, and `none` while at the hotel, are excluded.
  - 06 FLR-11 requires "+ {n} with last estimate at or above". It is not rendered.
  - The probe used reported floor 9 and four people: two stopped phones with last estimates 10–12 and 11–13 (assigned to floors 11 and 12), one phone with no `floor_estimate` (assigned to 11), and Maya (band 9–11). Output:
    - top line: `— 1 likely at or above, 3 more may still be inside`. Both sleepers and the old-app phone are under "May still be in the building".
    - cutaway: floor 11 shows `assigned-none-detected` (3 assigned, 2 last estimates there), and floor 12 shows amber.
- Risk: in the 01 S3 night case ("18 inside the hotel, stopped-current"), the hero reads **0** while the floors above the fire are full of sleeping students. The indoor-GPS loss in stairwells pushes people into `last` too. This is the scenario phase 2 exists for.
- Fix (rule). During an incident, someone joins `at_or_above` when they are at the hotel (the `floorDisplay` `atHotel` test) and one of these holds:
  - (a) a current band reaches the reported floor (today's rule);
  - (b) `kind:'last'` and `label_high ≥ reported`. Reason: `Last est. floors 10–12 · 3h ago · phone stopped, may not have moved`;
  - (c) `assigned ≥ reported` and there is no current band (`unknown`, `not_shared`, `last` below the reported floor, or `none`). Reason: `Assigned floor 11 · no current floor — {why}`.

  Then:
  - Render the 06 FLR-11 clause in the top line and hero: `… 2 likely at or above, 3 last estimated at or above (phones stopped), 1 assigned above with no current floor …`.
  - In the cutaway, treat `last` bands like current bands with a hollow fill. The bar text should read `2 last est. here`.
  - Add a Demo A variant with stopped sleepers on 11 and a test asserting the hero is not 0.

### P1

**2. The big number is smaller than the group it heads.**
- Evidence: the hero shows `2` with `+ 1 assigned above…` underneath (`twinHud.js:421–433`), while the rail group says `AT OR ABOVE REPORTED FLOOR 9 · 3` (shot 08).
- Risk: the hero is the number read down the phone to the fire service, so "2" will be said when 3 people may be up there.
- Also, the sub-line always says "assigned above", but `deriveMode` (`twinData.js:890–892`) writes "at or above" when someone is assigned to the reported floor itself.
- Fix:
  - Hero = the whole group: `3 may be at or above floor 9`, with the sub-line `2 by phone estimate · 1 by room list, floor not detected`.
  - Build the sub-line from the same `above / at or above` test as the top line.
  - Add a line to "Why these numbers?": `+1 by room list = assigned at or above floor 9, phone gives no floor (counted in "Floor unknown" above)`.

**3. A bare "0" is shown when the evidence is simply missing (London, shot 14).**
- Evidence:
  - The hero shows `0 likely at or above floor 9`, and the top line says `— 0 likely at or above`, in a building where `Floor count not mapped · floor numbering not verified`.
  - 5 of the 8 people at the hotel have no current floor.
  - The rows say `level 0` while the report says `floor 9`.
- Risk: "0" reads as "no one above the fire". It actually means 0 out of 3 current estimates.
- Fix:
  - Rule: if the at-or-above count is 0 and anyone at the hotel lacks a current band, never draw a numeral. Hero: `No current estimate at or above floor 9`. Sub-line: `5 at the hotel have no current floor — could be on any floor`. The top line changes the same way.
  - When numbering is not verified, compare with one floor of slack (`label_high + 1 ≥ reported`). Append `· floor numbering not verified — floor 9 ≈ {27–33} m above street` so the hotel and the twin compare heights, not labels.

**4. Amber "no one detected here" and "No current estimate puts anyone on this floor" are false when an estimate range reaches the floor.**
- Evidence:
  - Floor 11 in shots 08 and 10 shows `8 assigned · none detected`. Its roster says `LIKELY HERE NOW (±1) · 0 — No current estimate puts anyone on this floor`. Yet Maya Ruiz (band 9–11, assigned 11) appears at the bottom under `ASSIGNED HERE · estimate range includes this floor`.
  - Floor 8 is amber while Aron's 8–10 band reaches it.
  - Cause: `state` and `likely` use only the likeliest floor (`twinData.js:999, 1015–1024`). Only the hover plate reports `touches` (`twinCutaway.js:41–42`).
  - "(±1)" in the title suggests that neighbouring floors are included. They are not.
- Fix:
  - Rule: amber only when `assigned > 0`, `touches = 0` and no at-hotel assignee lacks a current floor.
  - New state "range": white outline, no fill. Bar text: `8 assigned · 1 estimate range reaches here · 1 at hotel, floor unknown`.
  - Amber bar text: `{n} assigned · no phone estimate on this floor` instead of "no one detected".
  - Roster: retitle the first section `Likeliest floor is this one`. Add a second section, `Estimate range reaches this floor`. Change the empty text to `No one's likeliest floor is this one · {k} ranges reach it` (or `· no ranges reach it`). This keeps Jesse's colours and makes them true.

**5. The "Copy for hotel / responders" text can be read as "floor 11 is clear".**
- Evidence (`floorRosterText`, `twinCutaway.js:202–225`; floor-11 text in the test):
  - The first block is `Likely here now (±1) (0): - No current estimate puts anyone on this floor`.
  - Leo Brandt (at the hotel, no floor) shares one unsorted list with 6 people who are `Outside the hotel, nearby`.
  - The footer `Floor unknown 2 · Not shared 0 · Last est. only 1` covers the whole group but sits under one floor's heading.
  - On non-reported floors there is no incident line, and the text uses jargon (`±1`, `Last est.`, `no ground reference`).
- Risk: a desk clerk or fire officer skims the first block, sees 0, and moves on.
- Fix (template; sections in this order, empty ones omitted except the first):
  ```
  Fairmont Austin · Floor 11 · list made 02:14 hotel time · from phone estimates, not verified
  Incident: smoke reported on floor 9 by hotel desk at 02:12 (not verified)
  Phone estimates can be a floor off. Someone not listed under "May be on this floor" can still be on it.

  May be on this floor now (1):
  - Maya Ruiz: phone estimate floors 9–11, most likely 10, 1 min old · room list: floor 11
  On this floor's room list, phone gives no floor (1):
  - Leo Brandt: at the hotel · phone has no pressure sensor
  On this floor's room list, phone places them elsewhere (6):
  - Hana Lee (chaperone): outside the hotel, nearby, 40 s old
  Whole group (27): floor unknown 2 · floor not shared 0 · last estimate only 1
  Source: SafeTrekr Trip Twin, sample data, fictional people. Not a headcount.
  ```

**6. Both copy texts carry relative times and no absolute "as of".**
- Evidence: `responderText` (`twinHud.js:579–606`) starts with the top line (`hotel desk, 2 min ago`), and each row says `51s ago`. `floorRosterText` has no time at all.
- Risk: pasted text ages silently in someone else's inbox, and "2 min ago" is wrong a minute later.
- Fix: the first line of both texts becomes `As of {HH:MM} {city tz} ({sample clock} in demos) · traveler data {age} old`. Rows use `fix at {HH:MM}` rather than `{age} ago`.

**7. The lightning rule cannot see what it claims.**
- Evidence:
  - `WX_BOX_KM = 12` (`twinWeather.js:11`) and the raster is fetched for `boxAround(city.center)` (`page.js:612, 689, 706–711`). That covers ±6 km, but `LIGHTNING_WATCH_KM = 10`, so a cell 6–10 km out is never fetched. The plan said a "~20 km box".
  - Live "strikes" are pixels from an 8 km density raster with no time window or age. The text `Lightning 4.1 km NE of … (8 km grid)` reads as a strike 4.1 km away seen just now; it is really the edge of an 8 km cell somewhere in an unknown window.
  - The Layers row says `Lightning strikes`.
  - The exception disappears on the next refresh. There is no 30-minute hold, and the "in use in the last 30 min" gathering memory from the plan was not built.
  - If the raster fails, `strikes()` returns `[]`. The rule goes silent, and only the closed Layers row says `unavailable`.
- Fix:
  - Fetch the lightning raster for a box of edge ≥ 2 × (watch radius + gathering offset + grid), which is ≥ 40 km. Keep the 12 km box for drawing precipitation.
  - Copy: `Lightning detected in an 8 km grid cell reaching {d} {bearing} of {gathering} · nowCOAST density · fetched {HH:MM}, data time not reported — {n} people outdoors there`. Rename the row `Lightning (density, 8 km grid)` (US) / `(flash area, 2 km)` (EU).
  - Hold EX-WX-01 for 30 min after the last qualifying cell, and hold "gathering in use" for 30 min after the last ≥3 count. On release, show for 30 min: `No lightning in the nowCOAST density within 10 km since {HH:MM}. Delays and gaps are possible; this is not an all-clear`.
  - When a gathering is in use and the raster is unavailable or stale (> 15 min), put `Lightning data unavailable — lightning rule not running` in the official slot and in the copy text.
  - Threshold, for Jesse: NWS guidance is that lightning reaches about 10 miles (16 km) from a storm, so I recommend `LIGHTNING_WATCH_KM = 16`. In an incident, count all current outdoor people near the hotel, not only those within 75 m of a designated point. The street group may be 100 m from the assembly point.

**8. Live weather sits on a fictional night clock with no label.**
- Evidence: in shots 08–12 the top bar reads `02:14 local · sample` next to `82 °F · clear · MET Norway 20:00`. The rail and responder copy carry a real `Wind Advisory (NWS) until Fri 19:00` against a fictional trip.
- Risk: the clock suggests the weather is 6 h old. If exposure ran, it would test a real 82 °F evening against a fictional 2 am evacuation. And the copy mixes real warnings with fictional people without saying so.
- Fix:
  - Chip: `LIVE now · 82 °F · clear · MET Norway forecast {HH:MM}`. Official lines: `Official weather alert (live, real): …`.
  - In sample scenarios, the exposure rule and rain allowance use the live values only when the sample clock is within 1 h of real time. Otherwise show `Weather is live; scenario clock is sample · exposure check off`.
  - Responder copy gains `Weather: live, real · people: sample`.

**9. SIMULATED labels leak.**
- Evidence:
  - With simulated rain, path cards and the responder copy (`twinHud.js:106–109, 594–601`) say `Moderate rain: allow +25% walking time…` with no SIMULATED.
  - The chip `82 °F · SIMULATED moderate rain · MET Norway 20:00` (`twinWeather.js:150–160`) credits the simulated rain to MET Norway.
  - The grey rain raster in 3D (shot 12) has no in-scene label.
- Fix:
  - Pass `simulated` into `rainPace` and pathCards: `SIMULATED moderate rain: allow +25%…`.
  - Chip: `82 °F (MET Norway {HH:MM}) · SIMULATED moderate rain (prototype)`.
  - Add one ground label on the raster edge: `SIMULATED rain (prototype)`.
  - Lint rule: any copy built from `wx.sim.*` data must contain "SIMULATED".

**10. The exposure rule states things it did not measure.**
- Evidence:
  - `outsideMin = incident.ageMin` and `outsideCount = counts['Outside, nearby']` (`page.js:799–805`). That is minutes since the report, not time outside.
  - `apparentC` falls back to air temperature (`twinWeather.js:133`). As far as I know, MET Norway Locationforecast 2.0 `complete` publishes no apparent temperature (check a recorded response), so `feels like` is plain air temperature.
  - The < 5 °C threshold is low for children in sleepwear at night.
- Fix:
  - Duration = now − the earliest `Hotel perimeter` exit event among the people counted. If there is none: `{n} people outside nearby · report was {m} min ago`.
  - Compute apparent temperature (Steadman / BoM AT from temperature, humidity and wind) or write `air 4 °C`.
  - At night: apparent < 10 °C, or wind ≥ 10 m/s, or moderate+ rain. Lower the count to ≥ 3. Keep `— information, not advice`.

### P2

**11. Rasters are not validated.** `recolour` (`twinWeather.js:335–383`) treats every pixel with alpha ≥ 8 as data, so an error image or no-data fill becomes "rain everywhere". For lightning, it would become a 0 m strike. Shot 13 (live, MONITORING, chip "clear") shows a box-wide grey checkerboard; verify which layer drew it. Fix: reject a response that is not `image/png` or that is > 90% uniform cover. Map each source's no-data colours to transparent. On rejection, show `{layer} · could not read the image`.

**12. Hazards are hidden from the one-line summary.**
- In an incident, lightning near 16 outdoor people is in the right panel and the copy, but not in the rail top line (shot 12).
- In calm, `DATA DELAYED` replaces the WATCH line (`twinData.js:899–902`).
- Lightning replaces any heat detection in the WATCH line (`page.js:390–395`).
- The edge chip measures from the hotel (`6.2 km`), while the panel measures from the assembly point (`6.3 km`).
- Fix:
  - Incident sub-line: `… · Lightning {d} from the assembly point, {n} outdoors`.
  - Degraded WATCH: `{hazard} — traveler data delayed {age}, counts as of {t}`.
  - WATCH with two hazards: `{first} · also {second}`.
  - Edge chip: `Lightning 6.2 km SW of hotel`.
  - Path cards to an outdoor point: `Lightning {d} from this destination`.

**13. Official labels over-state.** `warningLine` prints every NWS product as "Official weather warning". A Wind Advisory is not a Warning in NWS terms. Separately, the chip shows a forecast hour as if it were now. Fix: `Official weather alert (NWS): Wind Advisory until …`, with the NWS event name verbatim. Chip: `forecast {HH:MM}`.

**14. The cutaway can lose people, and the docked copy costs the action.**
- Bands are clamped up to `levels` (one level above the top floor, `floorEstimate.js:141–150`), and basements are allowed. But the cutaway draws only levels 0…levels−1 (`twinData.js:983–1001`), so rooftop or basement estimates vanish from it while still counted in the partition.
- At 1280 (shot `1280-08`), 26 empty floors take about 200 px and push `Copy for responders` and the paths below the fold.
- Fix:
  - Add `Roof / above top floor` and `Below lobby` rows whenever any band reaches them.
  - In compact mode, collapse quiet floors above the highest flagged floor into one row: `Floors 12–37 · no estimates`.

**15. The keys and the calm export.**
- With a floor in focus, `[` `]` stop meaning "next person in Needs attention" and fly the camera between floors (`page.js:1026–1034`). That is an operator action, but a surprising one.
- In MONITORING, `Copy for hotel / responders` (shot 02) exports a named list of students "assigned here, not detected here". That is a bed-check sheet leaving SafeTrekr, which conflicts with A-2.
- Fix:
  - Bind floors to `Shift+[` / `Shift+]` (or ↑/↓ only) and keep `[` `]` for people.
  - In MONITORING, label the button `Copy floor list (internal)` and leave out the "not detected" section. Offer `for hotel / responders` only in INCIDENT.

---

## What works — keep

- **No double count in EX-FLR-03.** `priority` (bands only) and `assignedNotDetected` (unknown or not shared) cannot overlap. `groupFor` puts each person in one group, first match wins. In Demo A every surface agrees: top line, hero plus sub-line, rail group 3, responder copy, and 11 needing attention.
- **Reasons, not verdicts.** Every not-detected row says why (`phone has no pressure sensor`, `Outside the hotel, nearby`, `Estimate elsewhere · Rough: floors 5–8`). Tests lint for "missing", "empty" and the banned words.
- **The reported floor keeps its count** (`Reported · not verified · 1 likely`). The hover plate already says `1 more within estimate range`. Finding 4 extends that honesty to the bar.
- **The docked cutaway in INCIDENT** is now the perspective-free floor read (it closes phase-1 T1), and it opens without moving the camera.
- **Camera discipline.** `frameFloor` runs only from a click, Enter or a key. `select()` never frames. Snapshot refreshes re-render the card but never fly.
- **London degrades honestly.** No cutaway without a floor count, with the reason stated. No room list on unverified numbering. The footer counts still show.
- **The lightning rule runs whether or not its layer is drawn.** Strike glyphs are static. Simulated strikes are labelled in the glyph, chip, panel and copy.
- **Official warnings unavailable is said out loud** in the rail.
- **Rain allowance shows its arithmetic** and keeps the dry walk times. Exposure ends with `information, not advice`. No copy says "all clear".
- **A-2 holds.** Floor presence raises no calm-mode exception and nothing goes into the rail.

<!-- FACTORY_OUTPUT_METADATA
artifact_type: supervision_review
findings: 15 (P0 1, P1 9, P2 5)
kill_switch_specified: n/a (review)
wcag_level: aa
confidence: 0.85
source_artifacts: [00-CONTEXT.md, ROUND-2.md, ok-cool-ok-well-jaunty-sundae.md, review/03-supervision-review.md, review/00-FIX-LIST.md, WEATHER-SOURCES.md, twinData.js, twinCutaway.js, twinHud.js, twinWeather.js, page.js, floorEstimate.js, tripTwin.js, twinFloors.test.mjs, twinMode.test.mjs, twinWeather.test.mjs, phase2/shots/*, 1600-text.json]
-->
