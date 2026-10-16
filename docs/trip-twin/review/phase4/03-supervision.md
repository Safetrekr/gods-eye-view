# 03 Supervision review, phase 4: custom paths

Lens: does phase 4 keep the operator calibrated and in control? Six questions:
- Does the router outcome say what it really did?
- Can a check give false comfort?
- What does "reviewed" mean, and does it go stale?
- Can a path draft be mistaken for live guidance? Does editing block any live signal?
- Does anything get stored that should not be?
- Does the camera only move on an operator action?

Inputs:
- Shots `phase4/shots/1600-01…11` and `1280-05`, plus `1600-text.json`.
- Code: `server/tripTwin/routingProxy.js`, `twinCustomPaths.js`, `twinPathEditor.js`, `twinCustomPathsLayer.js`, `page.js` (custom paths block, route section `onEdit`, Advance "Plan your own path", `briefFor`, keyboard, `setAppMode`), `twinAdvance.js` (`briefText`), `tripTwin.js` (pick handler, `hazardPoints`, `refreshFires`), `tripTwin.css`, `twin.html`, `twinCustomPaths.test.mjs`.
- Plans: `PHASE-4-PLAN.md`, `07-production-delta.md` (phase 4 rows), phase 3 `03-supervision.md` and `00-FIX-LIST.md`.

## Verdict

The core is sound:
- Paths are drawn only on an operator action.
- The OSRM fallback is announced, and avoid-areas are always checked on the client, so a crossing is never hidden on the editor or the card.
- An edit clears the review.
- The saved-path card re-runs every check against today's areas and hazards.
- Delete asks twice.
- The camera never moves by itself.

**Three things break the supervision contract.**
1. **A saved path can store a traveler's position and name.** The fix age is stripped. The record is kept in browser storage with no expiry, follows the operator into Advance, and lands in a copied brief whose header says "no traveler positions". This is P0.
2. **The brief, the artifact that leaves the screen, is less honest than the card:**
   - It drops after-dark and heat flags.
   - It drops the warning once a path is "reviewed".
   - It says "avoids construction" on a path that enters the construction area (shot 07; the unit test locks the line in).
3. **Opening the editor in Live takes over the supervision surface:**
   - Every key is swallowed, including the attention keys.
   - The person card is hidden.
   - Map clicks become waypoints.
   - The editor stacks above the incident panel.
   - Nothing pre-empts it when an incident arrives.

   Enter on a focused "Cancel" button saves the path.

---

## Findings

### P0

**1. A saved path can carry a traveler's live position and name, with its age removed, into storage, Advance and the copied brief.**
- Evidence:
  - The route section's `Draw your own path` appears on the person card (`PATH FROM THIS PERSON`) and on place cards with the `From selected person` origin. See `twinHud.js:996–1033` and `page.js:1030–1040`.
  - `onEdit` strips the freshness: `fromLabel: ep.fromLabel.replace(/ \(position .* old\)$/, '')` (`page.js:1036`). Rory Owen's 2-hour-old fix becomes a start point labelled just "Rory Owen". This reopens phase 3 G11.
  - `savedPathRecord` stores `points[0]` (the person's coordinates), `fromLabel` (the name) and `defaultName` ("Jay Patel → Fairmont Austin · walk") (`twinCustomPaths.js:219–245`).
  - The record is written to `localStorage` `tripTwin.paths.<city>`, with no expiry and no clear-on-exit (`page.js:1586–1588`).
  - Live edits start with `day: null` (`page.js:1039`), so `savedPathLines` lists the path on every day's brief whenever its end is within 300 m of a stop (`twinCustomPaths.js:252`, `page.js:1609–1616`).
  - `briefText` then prints `Planning view: no traveler positions.` above `- Saved path: Jay Patel → Fairmont Austin …` (`twinAdvance.js:367–379`).
  - `setAppMode` does not cancel the editor (`page.js:1559–1580`), so an edit opened from a person keeps its `Start · Jay Patel` marker in Advance. This reopens phase 3 P1-7.
- Risk:
  - A minor's location and name persist in a shared browser indefinitely.
  - They leave the system in a brief that states the opposite.
  - The start point can be hours stale with nothing saying so.
- Fix (rules):
  - A saved path never stores a person. If the origin is a person, the editor converts it at start to an anonymous point labelled `Point (from a traveler's position at 21:32, ±16 m)`. The save dialog says `Saved paths never keep who it started from`. The name lives only in the session draft. Simpler alternative for the prototype: hide `Draw your own path` on person-origin path sections.
  - While a draft has a person origin, its card line reads `From Rory Owen's last known position (2 h ago) — may have moved`. Never strip the age.
  - `setAppMode` and the incident pre-emption (finding 7) call `pathEditor.cancel()` when the draft has a person origin. Otherwise they keep the draft but re-render it in the new mode's rules.
  - Lint test: `briefText` output never contains a participant name from the snapshot.
  - `07`: add the row `saved paths: no participant reference or position stored; retention = trip end + 30 days`.

### P1

**2. The brief drops the checks and the warning once a path is reviewed.**
- Evidence:
  - `savedPathLines` (`twinCustomPaths.js:248–266`) re-checks avoid-area crossings only. Heat, after-dark, "much longer" and "does not reach" never reach the brief, and the engine (Valhalla, or OSRM with avoid-areas not applied) is absent too.
  - `warn = crossed || inside || !reviewedBy`. Shot 11: the card says `Walked after dark at the planned time`, while the brief line reads `… 2.0 km · walk 32–41 min (group pace) · avoids construction · reviewed by you · Fri, 00:01 CDT`, with no flag and no warn style.
  - `PHASE-4-PLAN` D requires the brief to show "flags (crosses avoid-area, within 1 km of a heat detection, after dark), and review status".
- Risk:
  - The copied brief is what goes to a school or a venue.
  - A reviewed path reads clean there while the screen shows a warning.
  - "Reviewed" erases the flag.
- Fix:
  - `savedPathLines(saved, {day, siteKey, areas, hazards, hazardsStatus, isDark})` calls the same `pathChecks` as the card. It prints every flag by name, plus the router line, and never filters by review.
  - `warn = flags.some(f => f.warn) || !reviewedBy`.
  - Template:
    ```
    - Saved path: Fairmont Austin → Long Center · Day 2 · walk · 2.0 km · 32–41 min (group pace)
      Routed Thu 15 Oct 22:18 CDT by Valhalla (suggested, unverified) · avoid-areas sent to the router: none on this route
      Flags: after dark (Day 2 events end 21:30, sunset 18:58)
      Reviewed by J. Tarva Thu 15 Oct 22:21 CDT with 1 flag open · not an approval
    ```

**3. "avoids construction" is printed for paths that enter the area or were never routed around it.**
- Evidence:
  - Shot 07 and its card: `1.9 km · walk 30–39 min · avoids construction · ENTERS 1 avoid-area · draft · not reviewed`, on an OSRM-fallback path.
  - The test fixes the contradiction as expected output (`twinCustomPaths.test.mjs:130–160`).
  - The cause: `areaIds` = every avoid-area on the trip at save time (`twinPathEditor.js:369`, `twinCustomPaths.js:228`), whatever the engine, the endpoint exclusion or the distance.
  - Shot 10 says `avoids construction` for a Day-2 path to the Long Center that runs west, away from a construction disc north of the hotel.
  - The area card's `used by N saved paths` (`page.js:1776`) overcounts the same way.
- Risk: "avoids" sounds like a routing decision someone checked, which is the strongest safety claim on the line.
- Fix:
  - Store `sentAreaIds` (the areas actually sent in `exclude_polygons`) and `engine`.
  - Print `avoid-areas sent to the router: Construction` only when `engine === 'valhalla'` and the area is in `sentAreaIds`.
  - On OSRM, print `avoid-areas not applied (router fallback) — checked: enters Construction`.
  - Never print "avoids".
  - The area card reads `Sent to the router for N saved paths · entered by M`.
  - Update the test.

**4. "Valhalla (FOSSGIS) · avoid-areas applied" overclaims.**
- Evidence:
  - It is printed whenever the engine is Valhalla (`twinPathEditor.js:163–165`):
    - with zero areas on the trip (shots 02, 03: `AVOID-AREAS ON THIS TRIP · 0`);
    - directly above the flag `… that area is not avoided` when an area holds a stop (`twinCustomPaths.js:94–97, 150–155`);
    - when the proxy silently drops areas beyond 20 (`routingProxy.js:45–46`).
  - The polygon sent is a 16-gon inscribed in the circle (`twinCustomPaths.js:105`). Valhalla can legally route through the slivers between the polygon and the disc. The client check then flags `Enters 1 avoid-area` beneath "applied", with no explanation.
- Fix:
  - Copy, by case:
    - `Valhalla · avoid-areas: 2 of 3 sent (1 holds a stop — not avoided)`;
    - `Valhalla · no avoid-areas on this trip`;
    - `… 20 of 23 sent (router limit) — the rest are only checked`.
  - Circumscribe the ring: radius `r / cos(π/n)`.
  - The proxy returns `sentAreas: n` so the client never assumes.

**5. Checks can pass silently, and "No checks raised" does not say what was checked.**
- Evidence:
  - **Heat:**
    - `hazardPoints()` returns FIRMS records from the last 24 h around the current site only (`tripTwin.js:851–856`).
    - If the feed is `unavailable` or `no_key` (`tripTwin.js:899–907`), hazards are `[]`, so there is no flag and the editor prints `No checks raised` (shot 02).
    - In Advance it checks today's detections against a path for another day, with no word about it.
  - **After dark:**
    - `isDark(null)` is false (`page.js:1617–1619`), so "Any day" paths (every Live-drawn path, `page.js:1039`) are never checked.
    - When a day is set, the rule is "any event that day ends after sunset", not when the path is walked.
    - The text claims `Walked after dark at the planned time`, but a path has no planned time.
  - **Reach:** only the end is checked (`twinCustomPaths.js:184–191`). A start or a through-waypoint snapped hundreds of metres to the network passes.
  - The thresholds themselves (1.8×, 150 m, 1 km) are reasonable. The silence is the problem.
- Fix:
  - Replace `No checks raised (not a verification of the path)` with a checklist that always shows:
    ```
    Checked: avoid-areas (1 on trip) · heat detections now (FIRMS, 12 min old, around Fairmont Austin) · length vs straight line · reaches start and end
    Not checked: after dark (no day chosen) · closures · crowds · lighting · traffic · step-free access
    ```
  - Heat when the feed is not live: `Heat detections not checked (feed unavailable)`. When simulated: `(SIMULATED)`.
  - After-dark text: `Day 2 has events ending after sunset (18:58) — a walk then is in the dark`. With no day: `After dark: not checked (no day chosen)`.
  - Add start and waypoint reach: `Waypoint 2 is 230 m from the nearest path`.

**6. "Reviewed" is a one-click self-stamp. It survives new flags and has no date.**
- Evidence:
  - `Mark reviewed` toggles `reviewedBy = stamp()` with no confirm (`page.js:1716–1720`).
  - Shot 11: saved and reviewed by "you" in the same minute, with the after-dark flag open.
  - Adding an avoid-area that the path now enters, or a new heat detection, leaves `SAVED PATH · REVIEWED`.
  - `Mark not reviewed` erases the record.
  - The stamp is `you · Fri, 00:01 CDT`, with no date, on a record that persists for days. It uses the wall clock while the screen shows `21:32 local · sample`.
  - What works: an edit clears the review (`twinPathEditor.js:376–377`).
- Risk: "REVIEWED" in a header reads as cleared or approved.
- Fix:
  - The review stores `{by, at (full date + zone), version (hash of points, profile, day, geometry), flagsAtReview}`.
  - With open flags, the button reads `Mark reviewed with 1 flag open (after dark)`.
  - When the current flags differ from `flagsAtReview`, the card and brief read `REVIEW OUT OF DATE — new since review: enters Construction (avoid-area added Fri 16 Oct 09:10)`, with warn style.
  - The header reads `SAVED PATH · REVIEWED (looked at, not approved)`.
  - Un-review keeps a history line.
  - Stamp: `J. Tarva · Thu 15 Oct 22:21 CDT`. Use "you" only on screen until accounts exist.
  - `07`: the review row gains `flags at review, version, history`.

**7. Opening the editor in Live takes over the supervision surface.**
- Evidence:
  - `handleKey` returns true for every key (`twinPathEditor.js:447`), and `page.js:2464–2467` calls `preventDefault`. While a draft is open, `[` `]` (Needs attention), `V`, `?`, `L` and `/` (find a person) are all dead.
  - `body.tt-editing #tt-card {display:none}` (`tripTwin.css:1796`). A rail click on Jay Patel opens nothing.
  - All canvas clicks go to the editor (`tripTwin.js:486–489`), so clicking a person pin adds a waypoint at that person.
  - `#tt-editor` sits above `#tt-incident` in the right column, with `flex: 1 1 auto` (`twin.html:107–120`, `tripTwin.css:1787–1791`). At 1280×720 the incident panel gets what is left.
  - Nothing closes or collapses the editor when the mode becomes INCIDENT.
  - Not covered by a shot: Demo A plus `Draw your own path` reproduces it.
- Fix (rules):
  - The editor is a planning tool. In Live, `Draw your own path` reads `Plan a path (planning)`.
  - When the mode is or becomes INCIDENT or INCIDENT · OTHER SITE:
    - the draft collapses to a one-line strip `Draft path paused — incident at Fairmont Austin · Resume · Discard`;
    - the keys and clicks are released;
    - the incident panel is first in the column.
  - The editor owns only `A`, `Enter`, `Esc` and `Backspace`, and only when focus is on the map or the editor panel. Every other key passes through.
  - The person card stays available. A pin click while editing selects the person. Waypoints come from clicks on the ground or buildings only.

**8. Keyboard: Enter on any editor button saves the path; Tab and Space are swallowed; Esc in a text field discards the draft.**
- Evidence:
  - `handleKey` checks `Escape` before the input guard, so Esc while typing the name or notes discards everything.
  - On a focused button (not input, select or textarea):
    - `Enter` runs `saveEdit()` and `preventDefault`. On `Cancel (Esc)` this saves. On `Add avoid-area` it saves the path *without* the area.
    - `Tab` and `Space` are prevented, so focus cannot leave the button. This is a keyboard trap that fails WCAG 2.2 SC 2.1.1 and 2.1.2.
  - See `twinPathEditor.js:423–447` and `page.js:2464–2467`.
- Fix:
  - Return false for `Tab`, `Space` and any key whose target is a button or link.
  - Treat `Enter` as save only when the target is the map canvas or `document.body`.
  - `Esc` in a text field blurs the field first. A second Esc cancels.
  - If the draft has waypoints, notes or areas, Esc asks `Discard this draft? Esc again to discard · Enter to keep editing`.
  - Test: tab through every editor control, and Enter on Cancel does not save.

**9. Saved plans draw on the live map for every day, in the suggested-path blue; the line being edited is identical to a suggested path.**
- Evidence:
  - `customVis = {saved: true, avoid: true}` (`page.js:1589`).
  - In Live, `renderCustom` shows all saved paths, of every day (`day = null`, `page.js:1598–1604`), as `#93bafa` long dash, next to the suggested `#3b82f6`.
  - The edit line is `#3b82f6` solid glow (`twinCustomPathsLayer.js:99`), the same as a suggested path (shots 02, 03).
  - It turns amber only for `avoid` and `reach` (`twinPathEditor.js:57`). Near a heat detection it stays blue, while the legend says amber dash means "within 1 km of a heat detection".
  - The plan asked for `Saved paths · Day N` rows in Layers. One row exists (shot 08).
- Risk: during an incident, a Day-3 sightseeing plan or a half-drawn draft reads as the route out.
- Fix:
  - In Live, saved paths are off by default. When on, they show today only, labelled on the ground `PLAN · Day 2 · not live guidance`.
  - In INCIDENT, they are hidden unless the operator turns them on, and the Layers row then reads `Saved plans (not live guidance)`.
  - Edit line: white dashed `#eff7f3` with `DRAFT` on the end labels.
  - The amber warn style covers every warn flag, heat included.
  - Add `Saved paths · Day N` rows as planned.

**10. Trip-wide avoid-area changes reach other saved paths silently.**
- Evidence:
  - The × in the editor's area list removes a trip-wide area with no confirm (`twinPathEditor.js:226–231, 338–344`). The card asks twice (`page.js:1781–1797`).
  - Neither names the saved paths or reviews affected.
  - Adding an area does not mark existing saved paths as "routed before this area". The card and brief show `ENTERS` (good), but the review stays.
  - Areas have no time window. A Day-2 `Crowd / event` area constrains every path on every day for the whole trip.
- Fix:
  - Removing an area, from any place, asks `Remove "Construction · 100 m" for the whole trip? 3 saved paths were routed with it; 1 is reviewed — its review will be marked out of date.`
  - Adding an area marks every saved path it touches `Routed before avoid-area "Crowd / event" was added — edit to re-route`. That feeds finding 6's out-of-date review.
  - Area form: optional `Applies: whole trip | Day 2 only | Day 2 18:00–22:00`. Record it in `07`, which already lists time windows as "later".

### P2

**11. A saved path does not say when it was routed, or that the network may have changed.** Geometry is frozen at save time (`savedPathRecord`). The card re-runs the checks (keep), but there is no routing date and no way to compare with a fresh route. Fix: `Routed Thu 15 Oct 22:18 CDT (Valhalla)`, plus `Re-route to compare` (operator action; shows old vs new length and flags; save only on confirm). When the path is older than 24 h, or a new area or hazard flag has appeared, add `Re-check before use`.

**12. There is no undo, and drafts vanish silently.**
- Delete is two clicks within 4 s (`page.js:1659–1675`) with no undo, and a reviewed path disappears from the brief without a trace.
- A site switch (`page.js:882`), Esc, or exit discards a draft with no prompt.
- A 13th waypoint click is ignored silently (`twinPathEditor.js:356`).
- Fix:
  - After delete: `Deleted "Fairmont Austin → Long Center · Day 2" · Undo` for 10 s.
  - A site switch with a non-empty draft asks `Discard draft path?`.
  - At the waypoint cap: `12 points is the router's limit — remove one to add another`.

**13. Storage scope and copy contradict each other.**
- Paths are keyed by city (`tripTwin.paths.austin`, `page.js:1586`), not by trip, while the copy says `Saved in this browser for this trip`. Key by `trip_id`, as phase 3 fixed for numbering (P2-11).
- The Advance footer says `Reviews and notes are kept for this session only (prototype)` (`page.js:1500`), but path reviews persist. Fix: `Item reviews and notes: this session only. Saved paths, their reviews and avoid-areas: kept in this browser for this trip.`
- Two operators on two browsers do not see each other's avoid-areas. State it on the area card: `Only in this browser (prototype)`.

**14. Paths that do not end at a stop never appear in any brief.** `siteKeysFor` keeps only sites within 300 m of either end (`page.js:1609–1616`). A Day-2 hotel → hospital path is listed nowhere, while the brief says `None saved for this stop yet.` Fix: add a line `Other saved paths on Day 2: 1 (do not end at a stop) — show`, and include them in the copied day brief under `Other paths`.

---

## What works — keep

- **Operator action only.**
  - No path is routed until `Walk`, `Drive` or `Plan your own path` is clicked.
  - Each change re-asks once, debounced 250 ms, with at most one request in flight (`AbortController`).
  - Save is disabled while loading or after an error.
- **The fallback is announced, not hidden.** Shot 05: `OSRM fallback · avoid-areas checked, not applied (Valhalla: no path avoids every area — the areas block all ways through; move or shrink one)`. The crossing is named in amber and the line turns amber. The proxy's `200 ok:false` lets the client explain instead of failing.
- **Crossings are always checked on the client** (densified every 8 m), whatever the engine. Endpoint-in-area is named rather than letting the router refuse.
- **The saved-path card re-runs every check** against today's areas, hazards and day rules (`page.js:1692–1706`), so a stale geometry gets current flags on screen.
- **An edit clears the review** (`twinPathEditor.js:376–377`), and `07` records "versioned (an edit clears the review)".
- **The language stays humble:** `Suggested · unverified`; `Paths stay suggested and unverified until someone reviews them`; `DRAFT · NOT REVIEWED` in the card header and `· draft` on the ground label; `No checks raised (not a verification of the path)`. Keep that last line's parenthesis inside the new checklist.
- **The copied brief is a draft:** its header reads `DRAFT FOR REVIEW … Not an approval … paths are suggested and unverified`.
- **Delete and the card's area removal ask twice,** and the area card states `AVOID-AREA · WHOLE TRIP · applies to every path planned on this trip`.
- **Avoid-areas carry a reason and size** on the ground (`Avoid · Construction`), and amber hatching keeps the hazard colour meaning.
- **The camera never moves by itself.**
  - The editor, save, `selectSaved`, the saved layer and "Plan your own path" never fly or frame.
  - Reroutes redraw in place.
  - Phase 3 discipline holds.
  - Suggestion: give saved paths a `Frame path` button (operator action) like G11, since "Plan your own path" for an off-screen venue leaves the new line out of view.

<!-- FACTORY_OUTPUT_METADATA
artifact_type: supervision_review
findings: 14 (P0 1, P1 9, P2 4)
kill_switch_specified: n/a (review)
wcag_level: aa
confidence: 0.85
source_artifacts: [00-CONTEXT.md, PHASE-4-PLAN.md, review/phase3/03-supervision.md, review/phase3/00-FIX-LIST.md, 07-production-delta.md (phase 4 rows), routingProxy.js, twinCustomPaths.js, twinPathEditor.js, twinCustomPathsLayer.js, page.js, twinAdvance.js, tripTwin.js, tripTwin.css, twin.html, twinHud.js, twinCustomPaths.test.mjs, phase4/shots/1600-02,05,07,10, 1280-05, 1600-text.json]
-->
