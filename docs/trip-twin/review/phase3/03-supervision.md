# 03 Supervision review, phase 3: sites, advance mode, routes, operator numbering, compass

Lens: does phase 3 keep the operator calibrated and in control? Four questions:
- Can anyone be hidden by the site on screen?
- Does a planning view ever carry live data, or does live data ever go missing in it?
- Is every route clear about where it starts, where it ends and what it does not know?
- Does an unverified operator entry ever turn into a number someone will read aloud without its label?

Inputs:
- Shots `phase3/shots/1600-01…18`, `1280-01`, `1280-11` and `1600-text.json`.
- Code: `twinSites.js`, `twinAdvance.js`, `twinRoutes.js`, `twinNumbering.js`, `twinData.js` (assessSnapshot, floorPartition, deriveMode), `tripTwin.js` (activePlace, reportedLabel, switchSite, showRoute, viewFromSide), `page.js` (onAssess, switchSite, the route controller, renderAdvance, applyAppMode), `twinHud.js`, `twinCompass.js`, `twinSiteBeacons.js`, `demoTripTwin.js`.

Recorded decisions are not reopened: lightning stays at 10 km, Jesse's cutaway colours, A-2, rebuild on site switch, a session-only checklist, and the compass bottom-right.

## Verdict

Most of phase 3 holds up:
- Needs attention really is trip-wide.
- Per-site counts drop nobody.
- Routes run only when the operator asks, one set at a time, and they say what they do not know.
- Advance mode hides the people layer and the rail.
- The camera never moves without an operator action.

**The model is still "one site is the trip" in three places, and each one can hide people or a hazard:**
1. An incident at another site turns the screen on view into `MONITORING · No incident reported`. Only a chip says otherwise.
2. An operator-entered reported floor, or a dismissal, follows the operator to whichever site they open.
3. The new floor-numbering answer turns London's honest "can't be matched" into a bare **0 may be at or above floor 9** (shot 16). Nothing on the hero, top line or responder copy says it rests on an unverified operator entry. The reported floor is not even inside the building as the operator described it.

Those three are P0. The P1s fall into three groups:
- Venues inherit the hotel's rooming list.
- Site counts treat a 2-hour-old fix as "at the hotel".
- Advance mode drops live WATCH and Needs attention. It leaks the person card. Its copied brief can read like an approval.

---

## Findings

### P0

**1. An incident at another site makes the screen say "No incident reported".**
- Evidence:
  - `tripTwin.js:698–704`: `reportedLabel()` only returns a report whose `place_id` is the active place.
  - `deriveMode` (`twinData.js:876–935`) therefore runs in MONITORING or WATCH. Its top line is literally `No incident reported · …`, and the mode chip reads `MONITORING`.
  - The incident appears only as one chip, `Reported smoke at Fairmont Austin, floor 9 · not verified — show` (`page.js:607–627`).
  - `.find()` keeps only the first incident at another site.
  - The at-or-above people at the incident site are not in Needs attention: that group exists only when the incident is at the site on screen.
  - Found in code; no shot covers it. Demo A plus a site switch reproduces it.
- Risk:
  - During a hotel fire, the operator who opens the venue to check on the 3 people there gets a calm screen.
  - The people most at risk vanish from the rail, which breaks "nobody is hidden because they are at another site".
  - Responder copy taken from this screen starts `No incident reported`.
- Fix (rules):
  - Incident state is trip-wide. Any unresolved report on any trip place (snapshot or operator-entered) sets the chip to `INCIDENT · Fairmont Austin`, whatever the site on screen.
  - Top line when the incident is off screen: `Smoke reported at Fairmont Austin, floor 9 (hotel desk, 4 min ago, not verified) — 3 may be at or above · you are viewing Long Center — show Fairmont Austin`.
  - Compute the incident site's at-or-above group off-screen from the data that needs no footprint:
    - people whose `floor_estimate.place_id` is the incident place;
    - plus people assigned to that place's rooming list and within `AT_SITE_M` of it with no current floor.

    Keep that group at the top of Needs attention, labelled `At or above reported floor 9 · Fairmont Austin`.
  - Show one chip per off-screen incident, never only the first.
  - Lint test: with any report on the trip, `topLine` never matches `/No incident reported/` on any site.

**2. An operator-entered reported floor, or a dismissal, follows the operator across sites.**
- Evidence:
  - `sessionReported`, `sessionKind` and `dismissed` are single variables (`tripTwin.js:175–177`). Neither `switchSite` (`tripTwin.js:944–949`) nor `page.js:781–804` resets them.
  - `reportedLabel()` returns `sessionReported` before it looks at `place_id` (`:699`).
- Risk:
  - The operator enters `smoke, floor 9` at the hotel and switches to the Long Center. The Long Center now shows `INCIDENT · floor 9 · operator entry` against a 2-floor venue, with `0 may be at or above`.
  - Meanwhile the hotel has no chip, because the off-site chip reads only `snapshot.reported_incidents`.
  - The reverse also happens: dismissing the hotel report sets `sessionReported = null`, and that hides a real snapshot report at the venue.
  - The `Add reported floor` button never names the site it applies to.
- Fix:
  - Key reports and dismissals by place: `sessionReports: Map<placeId, {label, kind, at}>` and `dismissed: Map<placeId, {reason, at}>`.
  - The trip's report list = snapshot reports − dismissed + session reports. Finding 1 reads this list.
  - Button: `Add reported floor · Fairmont Austin`.
  - Test: report at the hotel → switch → the venue is not in incident, and the hotel shows the incident in the top line.

**3. The floor-numbering answer creates an unlabelled false zero (shot 16).**
- Evidence:
  - London before the answer (shot 15): `floor estimates can't be matched … 8 may still be inside`. Correct.
  - The operator then picks `Ground floor = 0` and `9` floors above ground. After that:
    - hero `0 may be at or above floor 9`;
    - top line `— no one at or above by phone estimate or room list`.
  - At the same moment, at the hotel:
    - Ivy Stone and Leo Brandt have `Floor unknown`;
    - Sam Diaz has only a `Last est. floor 0 · 22m ago`.
  - The Floors list runs 0–8 (`levels = 9`, ground 0). **Reported floor 9 is above the top floor** the operator described, so it has no bar at all.
  - `operator entry, not verified` appears only in the card note (`twinNumbering.js:60–65`). It is absent from the hero (`twinHud.js:447–456`), the top line (`twinData.js:924–929`), `responderText` (`twinHud.js:624–654`) and the Floors heading.
  - The card line under it reads `? floors · ground floor = 0` (`twinHud.js:896`), which contradicts the entry.
  - `comparable` becomes true on `levels_source === 'operator'` alone (`twinData.js:787–788`).
- Risk:
  - "0" is the number most likely to be read to a fire officer. Here it rests on an unverified answer that can be off by one floor (convention or count). The phase-2 SUP P1-3 rule (no bare 0 while anyone at the site has no current floor) was only built for the unmapped case, so the prompt reopens it.
  - The answer can be given in one click in the middle of an incident.
- Fix (rules):
  - a. Label every surface that shows the count when numbering comes from an operator entry:
    - hero sub-line: `floor numbers from operator entry at 02:16, not verified`;
    - top line: append `(floor numbers: operator entry, not verified)`;
    - responder copy: add a line `Floor numbering: operator entry at 02:16, not verified — the hotel's numbering may differ by one floor`;
    - Floors heading: `Floors (numbering from operator entry)`;
    - floor card kicker: `… · OPERATOR NUMBERING`.
  - b. No numeral 0 while anyone at the site has no current band. Hero: `No current estimate at or above floor 9`. Sub-line: `2 at the hotel have no floor estimate, 1 has only a last estimate (22 min old) — could be on any floor`.
  - c. With operator numbering, compare with one floor of slack (`label_high + 1 ≥ reported`), and state it: `· counted with ±1 floor for unverified numbering`.
  - d. If the reported floor is outside the described building (`> top label` or `< ground`), show no count: `Floor 9 is above the top floor in the numbering answer (8). Check the answer or the report.`
  - e. Ask for something staff can read off the lift: replace `Floors above ground` with `Top floor number (as on the lift buttons)`, and derive levels = top − ground + 1.
  - f. During an INCIDENT, the answer takes two steps:
    - First a preview: `This changes the count for reported floor 9 from "can't be matched" to a count based on your answer.` Then Confirm.
    - Store who and when, and show both on the card: `ground floor = 0 · top floor 9 · entered by J. Tarva 02:16 · not verified`.

### P1

**4. Venues inherit the hotel's rooming list.**
- Evidence:
  - `assessSnapshot` builds `assignedById` from every place's `room_assignments` (`twinData.js:750–754`), with no `placeId` filter.
  - So at the Long Center, floor 1's roster reads `Likely floor 1 (1–2) · assigned floor 11` (shot 18), and the back link says `‹ Hotel` (`twinHud.js:772`).
  - EX-FLR-03 (`twinData.js:790–804`) compares hotel room floors with the venue's reported floor. If a floor is reported at the Long Center, Leo Brandt (no barometer, hotel floor 11) is counted `1 assigned above, floor not detected` and listed as `Assigned floor 11 · floor not detected`.
- Risk:
  - The at-or-above group and the responder copy give a false reason.
  - In a venue whose floor numbers overlap the hotel's (the Kennedy Center has floors 1–4; the Festival Hall 0–5), people would be placed on the venue's floors as "assigned here".
- Fix:
  - Take assignments only from the active place (`placeId`), and from the incident place for finding 1.
  - Where the place has no `room_assignments`:
    - drop the "assigned" notes and the `Assigned here …` sections;
    - do not run EX-FLR-03;
    - make the footer read `No rooming list for this venue`.
  - The back link becomes `‹ {site short}`.

**5. Site counts treat old fixes as presence, and "Away" includes the group's own hotel.**
- Evidence:
  - `siteCounts` (`twinSites.js:298–335`) uses `p.coordinates` with no freshness test. Shot 06 reads `Group: Fairmont Austin 22 · elsewhere 4 · not located 1`, while 4 people are not current, including Rory Owen `Last known · 2h ago`.
  - `between sites` is anyone within 200 m of a *straight* hotel→venue line for *any* venue, including Day 3's on Day 2. The real walk to the Long Center (shot 12, 1.8 km against 1.3 km straight) strays further than 200 m from that line.
  - Three different "here" radii are in use:
    - 150 m for a site;
    - 200 m for the corridor;
    - 600 m for the group centre (`twinRoutes.js:39`);
    - plus the footprint verdict for the roster.
  - At a venue, the roster's `Away 6` (shot 01) lumps together the 3 at the hotel, the 2 walking and the 1 elsewhere. In DC (shot 17), 22 people at the group's own hotel show as `Away 22`.
- Risk: the site line sits directly under the top line and reads as a headcount. "Fairmont Austin 22" says 22 people are there now.
- Fix:
  - Site buckets count current positions only. Line: `Group across 2 sites (current positions): Long Center 20 · Fairmont Austin 3 · on the way 2 · elsewhere 1 · last known only 4 · not located 1 · of 27`.
  - Tooltip or "Why these numbers?": `At a site = within 150 m of it. On the way = within 200 m of the straight line from the hotel to today's venue.`
  - The corridor applies only to sites on the selected day's itinerary.
  - Rename the roster's `Away` to `At other sites or elsewhere`, with the split underneath: `Fairmont Austin 3 · on the way 2 · elsewhere 1`.

**6. Advance mode drops every live signal except an incident at this site.**
- Evidence:
  - `body.tt-advance-mode #tt-rail, #tt-incident {display:none}` (`tripTwin.css:1498–1501`).
  - `applyAppMode` overwrites the chip with `ADVANCE · PLANNING` and the age with `No live positions in this view` (`page.js:1254–1268`).
  - The live banner is built only when `lastCtx.mode.mode === 'incident'` (`page.js:1241–1250`).
  - WATCH (lightning within 10 km of people outdoors), `DATA DELAYED` and the Needs attention count disappear.
  - `Add reported floor` stays active in Advance (shot 12, 1280-11). One click there creates a live trip incident from a planning screen.
  - At 1280 the Advance chip also pushes the site name out of the bar (`1280-11`). The brief shows Long Center while the 3D view shows Fairmont Austin.
- Risk: Demo B is Day 2. An operator planning Day 3 during the concert gets no sign that a student just went unaccompanied, or that lightning is 6 km from the assembly point.
- Fix:
  - Keep a one-line live strip at the top of the Advance panel whenever live data exists:
    - `LIVE · WATCH: lightning 6 km from Long Center assembly point, 3 outdoors · 4 need attention · data 11 s old — switch to Live`;
    - in calm conditions, `LIVE · no incident · 4 need attention`.
  - Chip: `ADVANCE · PLANNING | live: WATCH`.
  - In Advance, hide `Add reported floor`, or relabel it `Live: add reported floor · {site}`.
  - The site name in the bar never truncates before the trip title.

**7. Advance mode leaks live person data.**
- Evidence:
  - If a person was selected before switching modes, every refresh (`tripTwin.js` refresh → `onSelect({kind:'person'})`) re-renders the person card. It shows `Live · 1m ago · ±16 m · Away · 850 m SE of hotel`, `Route from this person`, and the breadcrumb `› Jay Patel`. `page.js:490–515` has no `appMode` guard, and `setPeopleVisible(false)` (`tripTwin.js:1046`) hides the pins only.
  - The site switcher still shows `20 here` (`page.js:761–765`), and the beacons show `· 3 here` (`twinSiteBeacons.js:34`).
- Risk: the screen says `No live positions in this view` while showing one. A planning screenshot shared with a venue carries a student's live position.
- Fix:
  - Entering Advance clears the person selection, any person route and `lastPersonId`.
  - `onSelect` ignores people in Advance.
  - The switcher and beacons show day and time only: `Long Center · Day 2 19:00`.

**8. Routes: the origin is unclear, person origins carry no age, and routes look alike and outlive their card.**
- Evidence:
  - Card titles name only the destination: `Walk to Ascension Dell Seton … · 1.9 km · walk 30–39 min` (shot 07, `twinRoutes.js:138`). The origin lives only in a toggle state.
  - `From selected person` uses `person.coordinates` without a freshness check (`page.js:863–869`), so a route can start from Rory Owen's 2-hour-old fix with no word about it. That person is `lastPersonId`, who may no longer be selected.
  - The group centre is the median of current positions within 600 m. The UI says `From group centre (19)`, and only the tooltip explains it.
  - The on-demand route is drawn in the same blue, solid primary and dashed alternate, as the standing rally-point path (shots 07, 09). In Advance (shots 11, 12, 14), the hotel→rally path looks like the hotel→venue route the brief describes as `route not checked`.
  - `routeFromHotel` (`page.js:1071–1089`) draws a route that survives the switch back to Live: `applyAppMode` never clears it, and no card describes it there.
- Risk: the operator relays the wrong line ("walk this way") or a start point the person left hours ago.
- Fix:
  - Title: `From Fairmont Austin → Ascension Dell Seton (hospital, OSM, not verified) · walk 1.9 km · 30–39 min (group pace)`.
  - Person origin:
    - current: `From Jay Patel's position (fix 1 min ago, ±16 m)`;
    - not current: `From Rory Owen's last known position (2 h ago) — may have moved`;
    - the person origin is disabled when there is no fix.
  - Group centre: `From group centre — median of 19 current positions within 150 m of Fairmont Austin, as of 21:32`. Use the site radius (150 m) here, not 600 m.
  - Draw the on-demand route in a distinct style, with ground labels `Start` and `End · {destination}`. Dim the standing rally path while it is shown.
  - Clear any on-demand route when switching between Live and Advance.
  - Add to routes to hospitals: `For planning. In a medical emergency call 911 (999 in the UK).`

**9. The brief's forecast and alerts do not cover the event, and failures read as "nothing".**
- Evidence:
  - `forecastAt` (`twinAdvance.js:148–171`) takes one step at or before the start time. A 19:00–21:30 concert gets the 19:00 hour only, so thunder at 20:00 is invisible.
  - The line carries no issue or fetch time (`:266`).
  - A failed fetch sets `adv.met[key] = null` (`page.js:1026–1041`), and the brief then says `No forecast for this time yet (MET Norway covers about 9 days)`.
  - Alerts use `wx.warnings`, which are fetched for the site on screen, not the brief's site. That list is `[]` while loading or after a failure, and it is not cleared on a site switch, so the previous site's alerts linger (`page.js:1436–1504`).
  - `siteBrief` then prints `None on file for this time (checked now; …)` (`twinAdvance.js:286–290`).
  - The alert window is start + 3 h, not start to end.
- Fix:
  - Forecast: scan every step overlapping [start, end] and report the range and the worst case: `62–58 °F · dry · no thunder in forecast 19:00–21:30 · MET Norway, fetched 22:18`.
  - On error: `Forecast unavailable (fetch failed 22:18) — retry`.
  - Alerts: when `warningsStatus !== 'live'`, show `Official alerts unavailable — not checked`. Clear `wx.warnings` on a site switch, fetch alerts at the brief site's point, and use the window [start, end].

**10. "Copy advance brief" can be read as an approval.**
- Evidence (`twinAdvance.js:296–320`, `page.js:1179–1186`):
  - Items carry `[checked you · 22:18]`.
  - Unchecked items carry nothing.
  - `as of 22:18` has no date or time zone, for a brief about another day.
  - `approved` (the rally point) sits next to "checked".
  - The header `Advance brief` never says what the document is not.
- Risk: pasted into an email to a school, it reads as "SafeTrekr checked and approved Day 2".
- Fix (template):
  ```
  Advance brief · draft for review · Spring choir tour · Day 2 (Fri 16 Oct)
  Made Thu 15 Oct 22:18 CDT by J. Tarva · information for planning, not an approval of the site, route or plan.
  "Reviewed" means the operator looked at that line; it is not a site visit.
  - From the hotel: 1.8 km walk · 28–36 min (group pace) · suggested route, unverified [reviewed by J. Tarva 22:18]
  - Nearest hospital: … · 2.5 km NE straight line [not reviewed]
  - Rally point: … · approved in SafeTrekr (status active) [not reviewed]
  Reviewed 1 of 9 items.
  ```
  The on-screen checkbox label becomes `Reviewed`. "Nearest …" lines say `straight line`.

### P2

**11. The numbering answer outlives "this trip".** It is stored in `localStorage` keyed by site, not trip (`page.js:185–207`), and has no author. Yet the form says `used only for this trip … nothing is sent anywhere` (`twinNumbering.js:133–134`). Fix: key it by `trip_id:site_key`, record the author, and use the copy `Saved in this browser for this trip`.

**12. The compass N means two opposite things.**
- Button N = `View from north` (stand north, look south). Key `N` and the centre = "north up", which means viewing from the south (`twinCompass.js:15–21, 51–56`; `page.js:1943`). After north-up, the highlighted letter is `S`, with no caption (every shot).
- Risk: "the north side" is relayed wrongly to responders.
- Fix:
  - Add a caption under the dial: `Viewing from south · looking north`.
  - Centre tooltip, and the `?` help: `North up (view from south)`.

**13. A beacon click rebuilds the site with no confirmation.** `page.js:466–470` handles it. During an incident, a stray click at City scale discards floor focus and the route for about 5 s of rebuild. Fix: in INCIDENT, a beacon click opens `Switch to Long Center? The incident at Fairmont Austin stays in the top line.` with `Switch` and `Stay`.

**14. Place cards and services are missing two honesty notes.**
- The hospital place card (shot 06) omits the brief's `emergency department not confirmed`.
- The `Nearest …` distances in the brief and the place cards are straight-line but not labelled as such.
- Fix: carry `emergency department not confirmed` (or `emergency department: yes, per OSM`) onto the card, and append `straight line` to each distance.

---

## What works — keep

- **Needs attention is trip-wide.** `assessSnapshot` builds `needs` over every row, and `deriveMode` never filters by site. Shots 01 and 17 list Jay Patel, Iris Bell and the not-located person from any site.
- **Nobody is dropped from the site line.** Every participant lands in exactly one bucket (site, between, elsewhere, not located), and the line ends `of 27`. Shot 01: 20 + 3 + 2 + 1 + 1 = 27.
- **An off-site incident is at least visible,** as the first chip, live and in Advance, with a one-click `show`. Advance raises a `LIVE INCIDENT … switch to Live` banner for the site on screen (shot 14). Finding 1 builds on both.
- **Advance hides people properly in the scene:**
  - the people layer, rail and incident panel are hidden;
  - people chips (`outside the mapped area`) are filtered out;
  - Floors are removed from the hotel card;
  - the chip and age line say it is a planning view.
- **Routes are on demand and honest about their limits:**
  - `Pick where from, then Walk or Drive. Nothing is routed until you choose.`;
  - one set at a time (`showRoute` replaces), cleared by Esc and by a site switch;
  - driving is a −10 %/+40 % range, `no live traffic` and `no traffic, parking or drop-off checked`;
  - walking says `group pace`, and every card says `Suggested · unverified · not checked for closures, crowds or lighting`;
  - an error gives a labelled straight-line distance;
  - a draft rally point says `(draft)` in the origin.
- **The brief already says what it doesn't know:**
  - `straight line · about 26–34 min (estimate ×1.3 for streets) · route not checked`;
  - `emergency department not confirmed`;
  - `None found within the recorded area — check before the trip`;
  - `draft · not approved`;
  - `alerts are issued close to the time`;
  - OSM places `not verified by SafeTrekr`;
  - SIMULATED in the sources line;
  - `Planning view: no traveler positions`.
- **Numbering is relabel-only.** Mapped places are never overridden, phone estimates are relabelled rather than recomputed, and `Not sure` keeps the honest "can't be matched". London before the answer (shot 15) is right.
- **Camera discipline holds:**
  - the compass, `,` `.` `N`, the switcher, a beacon, a chip and `Go to this site` all move only on an operator action;
  - reduced motion means an instant move;
  - a snapshot refresh never flies;
  - arrival selects the subject without moving the camera;
  - a site switch clears floor focus, the route and the weather images.

<!-- FACTORY_OUTPUT_METADATA
artifact_type: supervision_review
findings: 14 (P0 3, P1 7, P2 4)
kill_switch_specified: n/a (review)
wcag_level: aa
confidence: 0.85
source_artifacts: [00-CONTEXT.md, ROUND-2.md, PHASE-3-PLAN.md, review/phase2/03-supervision.md, review/phase2/00-FIX-LIST.md, twinSites.js, twinAdvance.js, twinRoutes.js, twinNumbering.js, twinData.js, tripTwin.js, page.js, twinHud.js, twinCompass.js, twinSiteBeacons.js, demoTripTwin.js, tripTwin.css, phase3/shots/1600-01..18, 1280-01, 1280-11, 1600-text.json]
-->
