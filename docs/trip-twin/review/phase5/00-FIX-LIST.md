# Phase 5 fix list — panel clarity (merged from 01-ux, 02-ui, 03-supervision, 04-ia)

Reviewed 16 Oct 2026 against `shots/` (14 states × 1600×900 and 1280×720). 57 findings → 16 fixes.
Brief from Jesse: keep all the information; make the order, labels and hierarchy obvious (hospital run from a traveler card), and close Layers/Display when the user clicks anywhere else.

## Decision where the reviews differed
How a suggested path appears. UX: draw on the destination click, no button. UI: a primary "Show walking path". IA: "Show Walking / Driving path" action buttons. Supervision: one primary "Path to hospital" that fetches walk and drive.
**Chosen:** one click on a destination (or start) draws the path, with walk and drive fetched together and both times shown on the mode switch. The mode follows the operator's choice; until they choose, Drive is drawn when the straight line is ≥ 1.2 km or the walk would take over 20 min, and the result says why. Nothing is preselected in step 1. This gives the 1-click hospital run (supervision), visible feedback for every click (UX), and visible mode actions with times (IA/UI). After a path is shown, the single primary action is **Copy path summary**.

## Paths on cards (Jesse's example first)

| # | Fix | Sources |
|---|---|---|
| J1 | **Stepped path section on person and place cards.** Kicker names the fixed end (`PATH FROM EMI SATO` / `PATH TO DELL SETON…`). Step 1 `To` / `From` as radio rows, nothing preselected, the person's own site disabled with a reason; step 2 `How` as a Walk/Drive switch showing both times; then the result; then `or Plan your own path`. The wrong hint "Pick where from…" is gone. | UX P0-1, UI P0-1/P0-3, SUP 1/13, IA F1/F2 |
| J2 | **Honest endpoints.** Nearest hospital is nearest to the start among all hospitals on file ("Nearest listed hospital · 1 of N"); rally point = the primary (approved) one, others as `Rally point (secondary) · not approved`; `Group center · N people`; a person endpoint that is no longer selected says `· last selected`. | SUP 3, IA F3 |
| J3 | **Result block that reads at a glance:** kicker, big `1.8 km · 28–37 min`, `From → To` line, warnings as amber rows above the dim caveats, hospital address / phone / emergency-department status and "Medical emergency: call 911 — this path is for an escort, not dispatch". | UI P1-5, SUP 3/6 |
| J4 | **Position age stays true.** The start point and its clock time are fixed when the path is planned ("position at 21:31 · 1 min old when planned"); if the person has moved > 50 m or has a fix ≥ 2 min newer, the result offers "Re-plan from the current position" (never automatic). Not-current people: "last known position (2 h old)". | SUP 2 |
| J5 | **Copy path summary** (primary) under the result; no coordinates, traveler as first name + initial. Frame path / Remove path (Esc) as compact tools. | SUP 5, UI P1-6, UX P1-12 |
| J6 | **A drawn path outlives its card:** closing the card or opening a place keeps the path, shown as a pill above the toolbar (Show · Copy · Remove). | SUP 7 |

## Popovers

| # | Fix | Sources |
|---|---|---|
| J7 | **Click outside closes** Layers, Display, Sites, Help, Prototype and Report: a click on another control closes and still acts; a click on the 3D view closes and is swallowed (no accidental select or waypoint), while a drag still orbits; native selects don't count as outside; focus leaving a popover closes it. **Report with a typed floor stays open** with "Not shown yet — Show on twin or Cancel". Esc in a popover field closes it; every close by Esc returns focus to its trigger. | UX P0-3, UI P0-4, SUP 8/9, IA F4 |
| J8 | **Popover anatomy:** sticky header (title, key hint, ×); toggle rows 32 px; legends indented under their toggle with a tree line; notes dim after legends; locked rows show a lock and "always shown"; disclosure rows show state ("Weather overlays · 0 of 4 on", "Saved paths 0 · avoid-areas 0"); Display sections spaced; Keyboard shortcuts in a footer. | UI P0-4, UX P1-9/10, IA F9/F10 |
| J9 | **Simulation is visible after the drawer closes:** `Prototype · SIM ON` pill and `· SIMULATED DATA` on the status while any simulated feed is on. | SUP 10 |

## Visual system

| # | Fix | Sources |
|---|---|---|
| J10 | **Button roles:** one solid primary per panel; secondary outline (≥ 3:1 border); compact tool; segmented single choice and radio rows with an unmistakable selected state (tint + bright border + weight + ✓/● glyph); popover toggles with ▾/▴; destructive is neutral then **amber** on confirm (red only for incidents); × 28 px. The G17 selected override is removed. | UI A, P0-2, P1-11, P2-14; UX P0-2, P1-11 |
| J11 | **Card anatomy:** kicker · 16 px title · lead fact (the verdict) · facts · provenance footnote; sections divided with 16 px rhythm; kickers never carry instructions. Hotel facts above the floor stack. | UI P1-7/P2-13, UX P1-6/7, IA F5 |

## Rail, incident, Advance, editor

| # | Fix | Sources |
|---|---|---|
| J12 | **Rail head in lines:** status · "First: **Jay Patel** (A)" as a button · group meta · official alert. Section heads outrank subgroup heads; counts always two columns; `Unaccompanied or outside group zone`. | UI P1-8/9/10, UX P1-4/5, SUP 12, IA F8 |
| J13 | **Incident:** rail head in three lines; the docked hotel card collapses to its title; the incident panel's Official line moves up under the hero; "FLOORS" kicker + a note. | SUP 11, UX P1-8, IA F6, UI P2-13 |
| J14 | **Toolbar:** Building / Neighborhood / City as one segmented control; Layers / Display as toggles with carets. | UI P2-14, UX P1-11 |
| J15 | **Advance:** "Switch to {site}" is secondary (one primary per panel: Copy brief); review checkboxes get a visible "Reviewed" label; footer fades content instead of cutting it. | UX P2-14, UI P1-12, IA F13 |
| J16 | **Words:** Remove path (not "Clear"); "Finding a suggested path…"; center (US); "Saved paths" (no "(operator)"); "street path not checked"; editor name field labelled. | UX P1-12/P2-15, IA F8 |

## Deferred
- Moving grid spacing / contour interval from Display into Layers › Site and making Units global — IA F11 (needs Jesse's call on whether Units should change card distances).
- Two-column Layers at ≥ 1440 — UX P1-9 (the 360 px single column with legends tucked under toggles fits once rows are compact).
- Snapping a person's start to the building entrance when "inside (likely)" — SUP 2 (needs entrance data per building; the label says the position is inside).
- Moving the saved-paths index from Layers to the rail — IA F10 (kept in Layers with counts; revisit with the SOC rail).
- First-click / tree tests — IA validation plan, with the next usability round.

## Status (16 Oct 2026, after implementation)
J1–J16 implemented, except as noted:
- J1: the destination click draws the path; walk and drive are fetched together and both times sit on the Walk/Drive switch; Drive is drawn first when the straight line is ≥ 1.2 km, with the reason shown. The card scrolls to the result (the camera never moves).
- J4: position times read on the sample clock (as the top bar); the start is not snapped to the building entrance (deferred).
- J8: Layers stays one column, 360 px; the saved-paths index stays in Layers with counts.
- J13: the hotel card folds to its title during an incident at this hotel; the move summary line sits under Official.

Phase-4 deferred items, done in the same pass: dragging waypoints; street names for waypoints; out / back legs tied to events (with leg-timed after-dark check and "Plan return leg"); storage keyed by trip id (old key migrated); undo for delete (paths and avoid-areas); "Copy for chaperones" for reviewed paths.

Verification: 75 Trip Twin unit tests (5 new in `twinDeferred.test.mjs`); full suite 3081 tests, 3077 pass, 3 known failures (CCTV temp path, FIRMS cache, root config — not Trip Twin); twin build OK; boundaries OK; QA PASS on all 9 sites; after-shots in `after/` at 1600×900 and 1280×720 with zero console errors; browser checks: outside click closes Display, a typed report stays open, hospital path in one click, path pill after the card closes, waypoint street name + drag, back leg after sunset, copy for chaperones, delete + undo; only Trip Twin files changed.
