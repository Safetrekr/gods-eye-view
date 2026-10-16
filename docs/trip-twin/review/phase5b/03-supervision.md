# Phase 5b review: supervision surface

Scope: Display › Units everywhere, framing in the panel-free area, screen-space label declutter, hotel card "Go to floor", and the site-switch question during an incident.
Evidence: shots in `shots/` (1600-NN, 1280-NN, 1600-text.json) and code in `gods-eye-view/src/operations/tripTwin/`. Line numbers are approximate because the file was changing during the review.

Verdict: the question bar is the right amount of friction for switching sites. It has the right default, and it covers beacons, the S key, edge chips and the API. Two operator paths skip it (Advance, Exit), and Esc does not answer it. The units change is not finished. At least four surfaces keep their old units, and the imperial rounding hides real differences between distances in the 300 m to 1.6 km band. That band holds the rally points and the nearest police and fire. Declutter moves labels but treats pins as invisible, so in shot 08 a fire-station label now appears to point at a rally-point pin.

---

## Findings

### F1 · P1 · Old units stay on screen and in copied text after the unit switch

**Evidence**
- Shot 1600-01 / 1280-01 (feet mode): the path card says "Showing the drive: **1.7 km** in a straight line" just above "**1.2 mi** · 3–5 min".
  - Cause: `runRoute()` stores `auto.reason` from `defaultMode()` in `routeModel.reason`. `rebuildRouteText()` / `refreshRouteUnits()` rebuild the cards but never `reason` (page.js ~1376, ~1459–1485).
- Shot 1600-03 (feet mode): Layers › Paths still says "Within **1 km** of a heat detection".
  - Cause: `KEY` is a `const` evaluated once at init (page.js ~2594–2602). `formatRadius(1000)` is frozen in meters, and `renderLayers()` re-reads the stale string.
- `tripTwin.js:877`: the heat-detection edge chip is hard-coded as `` `${(d/1000).toFixed(1)} km` ``. So the only hazard chip in the row would read km while Hospital, Police and Embassy read mi.
- `adv.pathText[ev.key]` (page.js ~1707) bakes `formatDistance()` into a string when the path is planned. After a unit switch, the "From the hotel" line in the Advance brief keeps the old unit while the nearest-hospital and police lines re-render. Both go into "Copy Day N brief". That is mixed units in a copied text.

**Risk**: An operator sees two unit systems in one card, or reads a briefing aloud with two. A "1.7" next to a "1.2" in different units looks like a contradiction, or gets misread as the same unit. The hazard chip is the worst place for this.

**Spec**
1. Never cache formatted distances. Store meters (`reasonM`, `pathM`, `heat.dM`) and format at render time. `refreshUnitsEverywhere()` should only re-render, never rebuild strings.
2. `KEY` becomes a function, `keyRows()`, called inside `renderLayers()`.
3. The heat chip uses `formatDistance()`.
4. The sensor spec "375 m pixel" is a fact about the source, so keep it native but label it: "Heat detection (sensor pixel 375 m)". Apply the same rule to "8 km grid" and "2 km" in the weather legends.
5. Add a test to `twinPhase5b.test.mjs`. Set the unit to `ft`, render the path card, Layers keys, chips, `responderText`, `pathSummaryText`, `briefText` and `chaperoneShareText` from fixtures, and assert no `/\d\s?(km|m)\b/` outside an allow-list of labelled sensor specs.

### F2 · P1 · Copied texts read aloud use ambiguous unit letters and no stated unit system

**Evidence**
- Shot 1600-08/09 incident panel: "rally point (primary) · **640 m** · walk 10–13 min". The rail and responder rows use "**22m ago**", "**1m ago**" for minutes (`formatAge`).
- `responderText()` (twinHud.js ~706) copies both styles into one clipboard text with no header.
- The default unit is meters for an Austin trip, while the top bar shows **64 °F** (shot 1600-05: "Hospital 1.7 km N" beside °F).

**Risk**: "Copy for responders" exists to be read to 911 or a front desk. Read aloud, "22m" (minutes) next to "640 m" (meters) is ambiguous, and "m" is easily said as "miles" by a US caller under stress. The operator's per-browser unit choice (`save('units')`) silently decides the units a dispatcher hears.

**Spec**
1. All copied texts spell units out and give both systems for distances: "640 meters (0.4 miles)", "990 feet (300 meters)". Ages use "min", never a bare "m": "22 min ago".
2. Line 2 of every copied text states "Distances: meters, with miles in brackets". The screen keeps its compact form.
3. The default display unit comes from the trip locale: US trips start in ft·mi. The Display popover says "Default for this trip: feet · miles".
4. Distances in copied text name their basis: "straight line" or "walking path".

### F3 · P1 · Imperial rounding hides distance differences in the operational band

**Evidence**: `formatDistance` (twinData.js ~703) rounds to 10 ft below 1,000 ft, then switches to miles at 0.1 mi steps. 0.1 mi is 161 m, while metric keeps 10 m steps up to 1 km. That is about 16 times coarser between 305 m and 1.6 km.
- Shot 1600-01: Rally point (primary) **0.2 mi** and Rally point (secondary) **0.2 mi**. The operator cannot tell which is nearer.
- The same primary rally point is "0.2 mi" in the path picker (straight line from Emi, unlabelled) and "640 m · walk" in the incident panel (walking path from the hotel). That is two numbers with different bases and different precision, and neither is labelled.
- `formatRadius(1000)` in ft shows "Within **0.6 mi**" for a 0.62 mi threshold (`HAZARD_NEAR_M`). A path flagged at 0.61 mi then contradicts the rule as written.

**Risk**: Choosing a rally point, or judging whether a path is near a heat detection, depends on exactly these differences. The rounding makes two options look equal and makes a rule look stricter than it is.

**Spec**
1. In ft mode, show feet rounded to 10 below 1,000 ft. From 1,000 ft to 1 mi show two decimals ("0.21 mi"). From 1 mi up, one decimal. Yards follow the same pattern.
2. Rule thresholds keep their native value with a conversion: "Within 1 km (0.62 mi) of a heat detection".
3. When two options in one picker render the same string, add precision until they differ, or mark the nearer one "(nearer)".
4. Picker distances carry a basis suffix: "0.21 mi straight".

### F4 · P1 · The incident site-switch question is skipped by Advance and Exit

**Evidence**: `switchSite()` (page.js ~956) only asks when `lastCtx?.mode.mode === 'incident' && appMode === 'live'`.
- **Covered, and correct to keep**: the S key and Sites pop (→ `switchSite`), site beacons (`onEntityPick` twin-site → `switchSite`), edge site chips, and the exported `switchSite`. The chip that leads *to* the incident site is unprompted, which is correct.
- **Skipped (a)**: press V, or click Advance. Then "Switch to {site}" in the brief (page.js ~1817), a beacon, or S switches with no question, because `appMode === 'advance'`.
- **Skipped (b)**: entering Advance during a live incident is one keystroke (V) with no question. `setAppMode('advance')` runs `clearRoute()`, deselects the person or place, and `clearFloorFocus()`. A hospital path drawn for a person is discarded.
- **Skipped (c)**: "Exit Trip Twin" closes the whole twin during an incident with no question. It also runs `wxLayer?.dispose()` *before* `pathEditor.blockIfDirty('exit')`, so a blocked exit leaves the twin open without its weather layer (page.js ~3510).

**Risk**: An operator ends up with the incident site off screen and their working context (path, floor focus) gone, through the one route the gate was meant to catch. The live-alert banner in Advance helps, but it is not the same promise.

**Spec**
1. The gate predicate is "live incident at the on-screen site", regardless of `appMode`.
2. The same one-line question appears for Live→Advance: "Incident at Fairmont Austin — open planning anyway? Your path to the hospital will be cleared." The buttons are Stay (primary, focused) and Open planning.
3. Exit asks the same question.
4. Move `wxLayer` disposal after the dirty check.
5. Whenever the operator returns to Live with an incident at a site that is not on screen, the first chip is "Back to Fairmont Austin (incident)" and has focus.

### F5 · P2 · The question bar itself: Esc, focus, and a shared toast

**Evidence**: `confirmToast()` (page.js ~2075).
- Esc does not answer the question. The global handler (page.js ~3358) runs the normal Esc chain: `removePath()`, deselect, `clearFloorFocus()` with `restoreView()`. The question stays up. Esc is the reflexive "no", and here it tears down context.
- After the 15 s auto-dismiss, the focused Stay button is hidden and focus drops to `<body>`.
- `offerUndo()` uses the same `#tt-toast`. The site question cancels a pending delete-Undo (10 s window), and an Undo replaces the site question.
- Shot 1280-09: the bar covers floors 1–5 of the ruler, the S.D./P.N. initials and the compass, the very floors the incident is about.

**Risk**: Small, but these all hit during an incident. A keyboard operator loses their place, and a deleted path loses its undo.

**Spec**
1. While the bar is shown, Esc means Stay. It is consumed before the Esc chain runs.
2. On any dismissal, focus returns to the control that asked: the site button, the canvas, or Advance's Switch.
3. Questions and Undo get separate slots, or a queue. A question never cancels an Undo window.
4. Place the bar at the top of the right panel's free edge, or above the toolbar but outside the projected box of the selected building.
5. The text names what will be cleared, if anything ("…your path to the hospital will be removed").
6. Keep 15 s and keep Stay as the default.

### F6 · P1 · A declutter-slid label can hide a pin and point at the wrong place

**Evidence**
- Shot 1600-08/09 and crop: "Rally point (secondary) · Draft · not approved" overprints the **fire-station glyph**. The slid "Fire station / Austin Fire Station Number 1" label now sits directly above the **R2** pin, and no line leads to its own glyph. Read top to bottom, the fire station appears to be at R2.
- Shot 1600-06: the same pair. The rally label covers the green glyph.
- Cause in `twinDeclutter.js`:
  - Only labels are items. Billboards (pins, glyphs, person markers) are never obstacles.
  - `declutterPriority` is set nowhere, so every label is priority 5 and sorts top-to-bottom only. "Texas Capitol · Day 3" can displace a rally point or a hospital.
  - When all 8 tries fail, the loop leaves `dy = -64 px`. The label is moved as far as possible **and** still overlaps.

**Risk**: This is misattribution on a safety map. An operator directing a group to "the fire station" could point them at a draft, unapproved rally point.

**Spec**
1. Pins and glyphs are fixed obstacles. A label may not cover any billboard, including its own.
2. Any label with dy ≠ 0 draws a 1 px leader from the label edge to its anchor, in the label's colour.
3. Priority order: reported floor / ruler (fixed) < hospital, police, fire < approved rally points < people initials < draft places < trip-day landmarks.
4. Maximum slide is 2 steps (32 px). If no slot is found, keep the base position for the higher priority and hide the lower one behind a "+1" count at its anchor. Never leave an overlapping label displaced.
5. Add a test: two co-located places plus a pin, assert neither label box intersects either pin box.

### F7 · P2 · Labels and framed endpoints are clipped under panels

**Evidence**
- Shots 1600-07 and 1280-07: "**oup shelter** · chaperones only" / "**lter** · chaperones only" cut by the rail.
- Shot 1280-02: the framed path's start label reads "**tart** · Emi Sato (position at 21:31…)". The end that matters, the person, is clipped.
- `flySafe()` (tripTwin.js ~643–645) caps the fit multiplier at `1.8`. At 1280 the free width is about 1280 − 292 − 315 = 673 px, a ratio of about 1.9, so the fit is short and edges slide under the panels.
- The safe area also ignores the compass block, the question bar and open popovers.
- Shot 1600-07: labels for R1, GS, R2 and the fire station render with no glyph visible. This may be capture timing; worth a check, because a label without its pin has nothing to point at.

**Risk**: A clipped label reads as a different word ("tart", "lter"). The framing promise ("lands in the free area") fails on the 1280 layout.

**Spec**
1. Remove the 1.8 cap, or raise it to 2.5.
2. Pad the safe area by 24 px plus the endpoint label width for path framing.
3. Treat the compass block and any open popover or question bar as insets.
4. Declutter clamps labels horizontally into the free area and adds a leader. A label whose anchor is under a panel is hidden, and its place stays reachable via edge chips.
5. When the free width is under 480 px, offer "Collapse card" rather than framing under it.

### F8 · P1 · "Go to floor" is missing from the incident panel

**Evidence**
- Shots 1600-08/09: during an incident the floors live in the docked cutaway ("Select a floor to see who may be on it"). The list is compressed and scrolls (37, 11…3). There is **no Go to floor field**: `goFloor` is only in `cutBox` on the hotel card, which collapses to the "Floors and people are in the incident panel above" pointer.
- The H key focuses the docked list but cannot jump to a typed floor.

**Risk**: The field exists for "a chaperone says Maya is on 23". That call happens during an incident, which is exactly when the field is unavailable. The operator has to scroll a compressed stack under time pressure.

**Spec**
1. Render the same Go-to-floor form at the top of the docked cutaway during an incident. Keep the one-copy rule: the form moves with the floors.
2. The success path selects the floor card and announces "Floor 23 · 2 possibly here" in the status region.
3. Bind G-then-digits only if it does not collide with G (grid). Otherwise add "type a floor" to the H-focused list: digits plus Enter.

### F9 · P2 · Go to floor: numbering honesty and input edge cases

**Evidence**
- Shot 1600-05: "Floor 52 is not in this building (1–37) — check the numbering" appears directly above a dashed highlight at 37 and the plate "**Floor 37 · 0 most likely**". It reads as if 52 was clamped to 37.
- `Math.round(Number(goIn.value))` turns "9.5" into floor 10 silently.
- The aria-label promises "as the hotel numbers it", but `twinNumbering.js` models only ground = 0 or 1. There is no skipped 13, so in a hotel that skips 13 every typed floor from 14 up lands one level high.
- Shot 1600-05 shows 13 as a real floor with "1 possible".

**Risk**: An off-by-one floor in a smoke-on-floor-9 scenario. A plate that suggests a clamp the code did not do.

**Spec**
1. On an invalid entry, clear the plate and the dashed focus, and keep the input value selected.
2. Reject non-integers with "Type a whole floor number".
3. Under the field show the numbering in use: "US numbering · lobby = 1 · 13 counted". Add a "Skips 13" option to the operator numbering entry, and map labels from it.
4. Until that exists, typing 13 in a building over 13 floors adds "Some hotels skip 13 — confirm with the desk".

### F10 · P2 · The Display popover over-promises

**Evidence**: Shot 1600-04: "Every distance on screen: cards, paths, chips, grid and contours." F1 lists surfaces where this is false. The popover also does not say that the choice is per browser (`save('units')`), or that copied texts follow it.

**Risk**: The operator trusts the switch and stops checking units. A handover to a second operator on another machine shows different units for the same incident.

**Spec**
1. Once F1 is fixed, keep the sentence and add "Copied texts give both units." (see F2).
2. Add "Saved for this browser".
3. Show a unit tag in the incident panel kicker ("Distances in ft · mi") so a screen share or handover makes the unit system obvious.

---

## Keep list

- Stay is the primary, focused button on the switch question. The bar auto-dismisses after 15 s to Stay, the safe default. It is one line and not modal, which suits a reversible navigation.
- One chokepoint in `switchSite()` covers the S key, the Sites pop, site beacons, edge chips and the exported API. The path-editor dirty check runs first.
- The chip that leads to the incident site ("Reported smoke at …, floor 9 · not verified — show") switches with no question.
- The question text "The incident stays in the top bar". It is honest about what remains visible.
- `formatShort` for accuracy and heights (±39 ft, ~400 ft) with no 10-step rounding.
- `formatRadius` for rule text, once it is wired everywhere (F1/F3).
- Grid and contour options are per unit, with spacing remembered per unit. The relief line ("Ground in this view: −41 ft to +34 ft vs hotel street level") converts.
- The floor ruler is a fixed obstacle that never moves. Labels slide only vertically, so they stay near their anchor.
- The Go-to-floor error names the valid range and says "check the numbering". The input clears on success. The floor card from Go matches the cutaway pick.
- The safe-area framing approach (panels measured live, the shift applied in camera right/up). Shot 1600-02 frames the whole hospital path cleanly between rail, card, chips and toolbar.
- The hazard and provenance lines on the path card ("Suggested · unverified · not checked for closures, crowds or lighting", "Medical emergency: call 911. This path is for an escort, not dispatch.").

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: exception_taxonomy
agents_covered: 0
capabilities_mapped: 5
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
confidence: 0.8
source_artifacts: [shots/1600-01..09, shots/1280-02, shots/1280-07, shots/1280-09, shots/1600-text.json, shots/1280-text.json, page.js, twinData.js, twinUnits.js, twinDeclutter.js, tripTwin.js, twinRoutes.js, twinHud.js, twinAdvance.js, twinCustomPaths.js, twinCutaway.js, twinNumbering.js, twinSafety.js, twinPeople.js, twinWeather.js]
-->
