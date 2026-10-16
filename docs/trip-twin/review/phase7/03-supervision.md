# Phase 7 review: supervision ("Ways out", streets, walkways)

Reviewer: supervision / autonomous-interface lens. Review only, no code edits.
Read: BACKLOG.md (phase 7 entry), shots 01–09 (1600 and 1280) and 1600-text.json. Code read: `page.js` (`toggleWaysOut`, mode chip, Esc ladder and keydown, `switchSite`, `setAppMode`/`applyAppMode`, `renderLayers`/`keys()`, `applyGround`, `setWxTime`), `twinStreets.js`, `tripTwin.js` (`setStreets`, `setHotelStepBack`, `setLayer`, `floorsVisible`), `twinPeople.js` (`update`) and `twinData.js` (Overpass query and parser). I also tallied the OSM tags in all nine `scripts/fixtures/trip-twin/*.overpass.json`.

**Verdict.** The view does what Jesse asked for: one key brings up buildings, streets and walkways, and the wording holds ("Ways out" everywhere, no "safe" or "escape"). It has two kinds of problem.

1. **It hides things it should not.** The worst case is the floor ruler with the reported floor during a reported-floor incident. On the way back out it also breaks the floor layer's "show when a floor is reported" behaviour for the rest of the session (P0).
2. **It draws OSM ways as walkable without saying which ones are not.** Motorways are the brightest lines on screen. Private, indoor, tunnel and bridge ways look like ordinary sidewalks. The "not checked" caveat sits only inside the Layers popover.

Beyond those two, the restore logic overwrites changes the operator made while in the view. The Esc ladder also drops the view before it closes a card.

---

## P0

### F1. Ways out turns off the reported floor during an incident, and on the way out it fixes the floor layer to off for the rest of the session
**Evidence.**
- `toggleWaysOut` on entry: `twin.setLayer('floors', false)`.
- In `twinPeople.update`, `if (floorsOn) ruler(rows, reportedLevel, …)`, so with floors off the ruler is not drawn. The ruler carries the red "Reported floor" band (legend `floors` in `keys()`). People are not drawn on their floors either (`onFloors: floorsOn`).
- Shot 07 shows "INCIDENT · WAYS OUT VIEW" with smoke reported on floor 9. The right-hand panel still says "Reported 9", but the 3D hotel has no floor band. The glass is also dimmed by `setHotelStepBack`.
- **Restore bug.** The floor layer's default is *automatic*: `floorsOn === null` → shown when a floor is reported (`floorsVisible()`, tripTwin.js:843). `toggleWaysOut` saves `l.floors`, which is the *resolved boolean*, and restores it with `setLayer('floors', v.floors)`. Say the operator enters Ways out before any report. The saved value is `false`, and leaving sets `floorsOn = false` for good. A floor reported later never brings the ruler back on its own.

**Risk.** The most important fact on the map in a fire or smoke incident ("which floor") disappears from the scene. It disappears in the view the operator opens *because of* the incident. The silent override also hides the floor in later incidents, after the operator has already left Ways out.

**Spec.**
1. Ways out does not touch `floors`. If the scene needs to be cleaner, keep the ruler and draw it above the dimmed glass (the reported band at full opacity).
2. Add `twin.floorsSetting` (raw `null | true | false`). Any code that saves and restores layer state must save and restore that raw value, never `layers.floors`.
3. Test: enter Ways out with no report → report floor 9 → leave Ways out. Floors must be on, and the band must be visible.

## P1

### F2. Ways out turns off the lightning layer, and it does not make sure heat detections, avoid-areas or saved paths are on
**Evidence.**
- On entry: `for (const k of Object.keys(wx.layers)) wx.layers[k] = false`. This includes `lightning`.
- `fires`, `customVis.saved` and `customVis.avoid` are neither saved nor set. Whatever the operator had before carries through, including "off".
- BACKLOG line 8 says: "The suggested and saved paths stay visible on top." The build turns on suggested paths only.
- Mitigation that already works: `strikes()` reads `wx.images.lightning` whether or not the layer is drawn. The lightning rule (EX-WX-01) and the edge chip keep working.

**Risk.** The view exists to choose a way to *move the group outdoors*. Lightning strikes, heat detections and operator-entered avoid-areas are the inputs that decide which way. Hiding them makes the streets look clear when they are not. An avoid-area is an explicit operator decision ("do not route here"), and the one view meant for routing can drop it.

**Spec.** Ways out hides decoration and never hazards.
1. **Always on in Ways out:** people and incidents (already locked), heat detections, avoid-areas, saved paths, suggested paths, safety places, and official warning areas if drawn.
2. **Lightning:** left as it was. It is turned on if the mode is `watch` or EX-WX-01 is active.
3. **Turned off:** grid, contours, clouds, effects, precipitation/totals.
4. Ways out turns hazard layers on but never off. Record which layers it turned on, so that leaving can put them back (see F7).

### F3. Ways out has no incident behaviour: no offer from the incident panel, and nothing is re-applied when an incident arrives
**Evidence.**
- `toggleWaysOut` does not look at `lastCtx.mode`.
- The incident panel (shot 07) already has "If the group must move: rally point (primary) · 0.4 mi · walk 10–13 min · details below", with no way into the view from it.
- An incident that arrives *while* the view is on changes nothing in the view. The phase-6 weather snap-back runs, but Ways out does not re-check floors or hazards.

**Risk.** In an incident the operator has to remember that W exists. If they are already in Ways out when the incident lands, they get a view that was set up for monitoring (see F1 and F2).

**Spec.**
1. Ways out is never entered automatically. A layer swap mid-incident is disorienting, so the operator chooses.
2. In the incident panel, the "If the group must move" row gets a secondary button: "Ways out (W)".
3. When `mode.mode` becomes `incident` or `watch` while the view is on, re-apply the always-on set from F2. Floors stay on (F1). Notice: "Incident reported — Ways out now shows floors and hazards".
4. In Ways out during an incident, the hotel card shows: "Mapped entrances: N (OpenStreetMap, incomplete) · fire exits not mapped — ask the hotel" (see F6).

### F4. Ways that are not walkable or not public are drawn as ordinary streets and walkways
**Evidence.**
- The parser keeps only `highway`, `name` and `coords` (twinData.js:224–230). `access`, `foot`, `oneway`, `bridge`, `tunnel`, `layer`, `indoor` and `level` are dropped.
- `roadClass` puts `motorway` and `trunk` in **major**, the brightest style (`#dfe6e8`, 4 px). Shots 04 and 05 show "North Interstate 35" as one of the strongest lines in Austin.
- Fixture tally (ways in the drawn classes):

| Site | Private or `no` access | Bridge / tunnel / layer | Indoor / level |
|---|---|---|---|
| austin | 19 (8 footways, 1 steps) | 35 | 0 |
| dc | 33 (12 motorway) | 29 | 21 |
| dc-kennedy-center | 36 (11 footways) | 30 | 0 |
| london-abbey | 91 (10 footways) | 111 | 84 |
| london-festival-hall | 36 | 135 | 85 |

- Every one of these is draped on the ground (`drape(…, 0.5)`) in the same style as a public sidewalk.

**Risk.** A view for walking groups out makes the most visible lines the ones pedestrians cannot use. It also shows private service ways, hotel-internal corridors, tunnels and upper-deck bridges as ground-level ways out. An operator reading "ways out" from the picture can send a group to a fence, a locked gate, an underpass or a motorway.

**Spec.**
1. Keep `access`, `foot`, `oneway`, `bridge`, `tunnel`, `layer`, `indoor` and `level` in the parser and the fixtures.
2. New class **no-walk** (`motorway`, `trunk` without `foot=yes`, or `foot=no`): thin dim double line, legend "No walking (motorway or foot=no)". In Ways out it is drawn *below* minor streets in brightness.
3. **restricted** (`access` or `foot` = `private`, `no`, `customers`, `destination`): dotted, 50 % alpha, legend "Private or restricted (OpenStreetMap)".
4. **Indoor / level** footways: not drawn in Walkways, or drawn faint with the legend "Indoor passage (OSM)".
5. **Tunnels:** not drawn in Ways out. **Bridges / layer ≥ 1:** short side ticks, legend "Bridge or upper level".
6. One-way arrows are not needed for walking. Leave them off, but say so in the caveat (F5).

### F5. The "not checked" caveat is not on screen when Ways out is used, and the edge of the mapped area is not marked
**Evidence.**
- The only caveat is a legend note under Walkways: "OpenStreetMap · not checked for closures or access" (`keys().walkways`). Streets say only "Street names from OpenStreetMap". Both appear only while the Layers popover is open.
- In shots 04–09 the screen says "WAYS OUT VIEW" in the chip, and the footer says "Map data © OpenStreetMap contributors" and "OSM buildings · recorded 2026-10-15". Neither the date nor the caveat is given for the streets.
- Shot 06 (city scale): streets stop at the edge of the ~460 m disc. "Long Center · Day 2 19:00" floats in empty space, and the suggested path runs off the mapped area with no marker.

**Risk.** The operator uses the view in a hurry, which is exactly when they will not open Layers. The picture then reads as "these are the ways", with no reminder that closures, fences, construction, access rules and anything beyond about 0.3 mi are not in the data.

**Spec.**
1. While Ways out is on, show a persistent one-line note (map overlay above the toolbar, `role="note"`, not dismissible): "Streets, walkways & entrances: OpenStreetMap, recorded {osmFetchedAt} · not checked for closures, fences, access, construction or one-ways · confirm on the ground".
2. Add the same note to the Streets legend.
3. Draw a faint ring at the street radius, labelled "Mapped streets end here (~{R})".
4. Where a suggested or saved path crosses the ring: "continues beyond the mapped area — street detail not shown".

### F6. Entrances are incomplete and unlabelled, and an operator will read the dots as "the ways out of the building"
**Evidence.**
- Entrances are queried only within **150 m** of the hotel (`node(around:150)["entrance"]`, twinData.js:135), while streets go out to the site radius.
- Fixtures: Austin has 4 entrances (2 `shop`, 1 `yes`, 1 `secondary`, one of them `access=private`). Kennedy Center has 0. Festival Hall has 1 (`service`, private).
- `twinStreets` draws `main` at 7 px and everything else at 5 px, all the same white. The legend says "Building entrance". In shot 05 (building scale) one or two specks are visible next to a 37-floor hotel.

**Risk.** In a building-scale Ways out, the dots are the only answer on screen to "how do they get out of the hotel". With 4 mapped doors on a 37-floor hotel, two of them shop doors and one private, the picture is misleading. Fire exits are almost never in OSM.

**Spec.**
1. Legend: "Entrances mapped in OpenStreetMap: {n} within 150 m · most doors and fire exits are not mapped".
2. Draw by kind:
   - main: larger;
   - `emergency` / `exit`: outlined ring, labelled "exit (OSM)";
   - private / service / staff: dim, "private (OSM)";
   - other: small.
3. Never use the word "exit" for a node that is not tagged as one.
4. At 0 entrances the hotel card says "No entrances mapped" and the map shows no empty legend.
5. Hotel card line in Ways out, as in F3.4.

### F7. Leaving Ways out overwrites changes the operator made while in it, and the chip can claim the view is still on
**Evidence.**
- On exit `toggleWaysOut` restores every saved key unconditionally: streets, walkways, buildings, floors, safety, paths, grid, contours and all five `wx.layers`.
- Case 1: the operator turns lightning on during Ways out (for example in a lightning watch) and presses W or Esc. Lightning goes off again without a word.
- Case 2: the operator turns floors on to see the reported floor. Leaving turns them off.
- Case 3: the operator turns Streets off in Layers while in the view. The chip still says "WAYS OUT VIEW" and the button stays pressed.

**Risk.** A deliberate safety-relevant choice is reversed by a key the operator thinks of as "back". A hazard layer they asked for disappears, and nothing tells them.

**Spec.**
1. Keep a set `touched` of layer keys changed through Layers, G/E or T while Ways out is on. On exit, restore only keys that are not in `touched`.
2. If the operator turns off streets, walkways or buildings while in the view, end Ways out ("Ways out ended — you changed its layers") and keep the current layers.
3. Exit announces what came back through `role="status"`: "Layers back as before: grid, contours, 2 weather overlays".
4. Never restore a hazard layer to off if it was turned on during the view (F2.4).

### F8. Entering Ways out from a forecast time leaves everyone dimmed, and a running timeline is not stopped
**Evidence.**
- Entry sets `wx.at = null` directly.
- People are dimmed only through `setWxTime(t)` → `twin.setPeopleDim(t != null …)`. This is the only call to `setPeopleDim` (page.js:3615). The Esc path does it correctly with `timeline?.stop(); setWxTime(null)`.
- Pressed while viewing a forecast hour, W clears the time but leaves every person pin dimmed, with no timeline and no amber bar to explain it. A playing timeline is not stopped either.
- The phase-6 incident snap-back (page.js ~757: `timeline?.stop(); wx.at = null`) has the same `setPeopleDim` gap. It existed before this phase, but it is the same fix.

**Risk.** Dimmed pins mean "positions are not for this time". If that dimming stays on at "now", it suggests stale data. During an incident it makes every traveler look uncertain.

**Spec.** Both places call `timeline?.stop(); setWxTime(null)` and nothing else. Test: scrub to +3 h → W → pins at full opacity, and `twin.peopleDim === false`.

### F9. Esc drops Ways out before it closes cards, routes and floor focus, and W gives screen readers no summary
**Evidence.**
- Keydown order: toast question → popover → path editor → weather time → **Ways out** (page.js:4062) → advance path → route → place → person-from-floor → floor focus → selection.
- Ways out is the broadest state of all of these, but it sits above every card-level step. In shot 07 the hotel card and an incident card are open. An Esc meant to close a person card swaps eight or more layers instead.
- The chip `#tt-mode` has `role="status"`, so "· WAYS OUT VIEW" is read out. Nothing says what was hidden or how to return.

**Risk.**
- It breaks the narrowest-first Esc rule set up in review/phase5 (J7). Mid-incident, the operator's normal "close this" key changes the whole map.
- Keyboard and screen-reader users do not learn that weather overlays and the other hidden layers went away.

**Spec.**
1. Move Ways out to the **end** of the Esc ladder, after `twin.select(null)`. Esc exits it only when nothing narrower is open.
2. W stays a direct toggle.
3. While Ways out is the next thing Esc will undo, the chip suffix reads "· WAYS OUT VIEW · Esc returns layers".
4. Make the chip suffix a button that toggles the view, for pointer users.
5. On entry, `role="status"`: "Ways out on. Shown: buildings, streets, walkways, entrances, places, paths, hazards. Hidden: grid, contours, {n} weather overlays. W or Esc returns."
6. Leave W working inside the path editor only if `pathEditor.handleKey` does not claim it. Add a test that the editor's own keys win.

## P2

### F10. Ways out does not survive a reload or carry correctly across a site switch or into Advance
**Evidence.**
- `applyGround()` writes `groundGrid` and `groundElevation` to localStorage (page.js:3818). The Ways out snapshot is kept in memory only. A reload while in the view therefore makes grid off and contours off the new saved defaults. Streets come back off and the view is gone.
- `switchSite` keeps the view on (shots 08 and 09, correct), but it does not re-apply it after `twin.switchSite` resolves. The snapshot is from the first site.
- In Advance, `applyAppMode` overwrites the chip with "PLANNING", so the suffix disappears while the button stays pressed and the layers stay swapped.

**Risk.** It is small but cumulative. After a reload the operator's grid and contour defaults change without them asking. In Advance the swapped layers have no label explaining them.

**Spec.**
1. Do not persist ground settings while Ways out is on (`applyGround({ persist: !waysOut })`). Alternatively, keep the snapshot in sessionStorage and resume the view on load.
2. After `twin.switchSite` resolves, call `applyWaysOut()`, which sets the same forced set on the new site.
3. In Advance the chip reads "PLANNING · WAYS OUT VIEW".

---

## Keep
- **Wording.** "Ways out" on the button, in the chip, the tooltip and the help. No "safe", "escape" or "evacuation" anywhere in the UI strings (grep clean).
- **Colours.** Streets are neutral greys and whites, blue is reserved for paths, green for approved places. Steps get a heavy short dash, not amber.
- **Live hazards keep running.** The lightning rule and edge chip work from live data whether or not the lightning layer is drawn (`strikes()`).
- **Locked layers stay on.** People and incidents stay on in the view. The incident panel, floor list and "Copy for responders" are untouched (shot 07).
- **The chip suffix.** "· WAYS OUT VIEW" sits next to MONITORING/INCIDENT in a live status region and shows on every site.
- **Street labels.** One label per street, on the longest way and limited by distance. They stay legible at neighborhood scale and do not crowd building scale (shots 04, 05).
- **Hotel glass step-back.** Streets behind the hotel become readable without hiding the hotel outline (shot 05). Keep it, as long as the floor band (F1) is drawn above it.
- **Site switch.** Switching site during an incident still asks first, and Ways out carries over.

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: supervision_review
agents_covered: 0
capabilities_mapped: 1
autonomy_tiers_defined: 0
exceptions_categorized: 10
reversibility_documented: true
multi_surface_covered: false
kill_switch_specified: false
audit_log_surface_designed: false
wcag_level: aa
metrics_leading: 0
metrics_lagging: 0
kill_criteria_defined: 0
confidence: 0.85
source_artifacts: [plans/trip-twin/BACKLOG.md, review/phase7/shots/*, gods-eye-view/src/operations/tripTwin/{page.js,twinStreets.js,tripTwin.js,twinPeople.js,twinData.js}, gods-eye-view/twin.html, gods-eye-view/scripts/fixtures/trip-twin/*.overpass.json]
-->
