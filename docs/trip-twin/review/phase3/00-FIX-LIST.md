# Phase 3 fix list (merged from 01-ux, 02-ui, 03-supervision, 04-ia)

Reviewed 16 Oct 2026 against `shots/` (18 states × 1600×900 and 1280×720). 57 findings → 21 fixes. Recorded decisions (10 km lightning, colours, floor estimates on by default) are not reopened.

## Correctness (first)

| # | Fix | Sources |
|---|---|---|
| G1 | **Floor-numbering answer can't make a false zero.** Ask "Top floor number (as on the lift buttons)" and derive the floor count. One form, "Use this numbering" to confirm. A reported floor outside the building's floors shows **no count** ("outside this building's floors … check the floor numbering") + a "Set floor numbering" link in the hero. "Floor numbering from operator entry · not verified" on the top line, hero, copy and Floors. No bare 0 while people at the site have no current floor. Stored per trip + site with time. | UX P0-1, P1-2; UI P0-2; SUP P0-3, P2; IA P0-2 |
| G2 | **Rooming list belongs to its place.** Assignments come only from the site on screen (venues have none); back link names the site ("‹ Long Center"). | UX P1-11; SUP P1; IA P0-1; UI P2-13 |
| G3 | **An incident anywhere on the trip is never hidden.** Top line and chip name the incident site when another site is on screen; mode chip `INCIDENT · OTHER SITE`; a rail group "At or above floor 9 at Fairmont Austin (by phone estimate)" from estimates tied to that place. Lint test: never "No incident reported" while a report exists. | SUP P0-1 |
| G4 | **Operator reports and dismissals are per place.** A floor entered at the hotel never follows the operator to a venue. | SUP P0-2 |
| G5 | **Site counts only count current fixes**; stale fixes counted as "not current". Rail "Away" reads "Away from this site" at any site. | SUP P1; IA P1-7; UX P1-12 |

## Advance mode

| # | Fix | Sources |
|---|---|---|
| G6 | **Live never disappears.** Live strip always at the top of the Advance panel (calm: "Live: Monitoring · 6 to check on — first: Jay Patel"; incident: red); `INCIDENT · switch to Live` chip in the top bar; "Add reported floor", A, [ ], R disabled in Advance; any person card closes on entering Advance; no "N here" counts in Advance. | UX P1-6; UI P1-5; SUP P1 ×2; IA P1-8, P1-10 |
| G7 | **The panel rebuilds only when its content changes**; scroll and focus kept. | UX P1-7 |
| G8 | **Brief vs screen:** "On screen: Fairmont Austin" line when the brief is another site; button "Go to Long Center"; changing event clears the path; clearing the path resets "path shown". Checks and notes per **event**. | UX P1-3; IA P0-3, P1-8 |
| G9 | **Brief honesty:** forecast covers start → end (thunder anywhere in the window, most rain); "Forecast unavailable" vs "not yet"; alerts unavailable state; "straight line" on Nearest; hospital "emergency department not confirmed"; light covers the end time ("ends 21:30 after dark — walk back in the dark"); checks dated ("you · Thu 22:21 CDT"); copied brief is a **draft for review** with reviewed / not reviewed per line. | SUP P1 ×2; UX P2-13 |

## Paths (route from any place)

| # | Fix | Sources |
|---|---|---|
| G10 | **Vocabulary: "path" everywhere** (06 §5): "PATH HERE", "Walk / Drive", "Clear path (Esc)", "Show walking path from the hotel". | IA P1-4 |
| G11 | **Paths say where they start and end:** title "Walk from Fairmont Austin to Dell Seton …"; a person origin shows its fix age; start/end markers labelled; standing rally path dims while an on-demand path is shown; "Frame path" button (operator action); path cleared on Live/Advance switch. | UX P1-8; UI P2-10; SUP P1; IA P1-4 |
| G12 | **Person destinations:** To this site · To the hotel (when elsewhere) · To nearest rally point · To nearest hospital. | UX P1-9; IA P1-5 |

## Top bar, compass, framing

| # | Fix | Sources |
|---|---|---|
| G13 | **Top bar fits:** site button never shrinks (▾ always visible); trip name and "World View ›" shrink first; TRIP TWIN kicker hidden below 1600; Advance chip "PLANNING" (no sentence in the bar); data age "data 11s"; weather chip keeps its time below 1440, badge "NOW" in Live, and in Advance follows the scrubbed event's forecast. | UX P1-4; UI P0-1, P1-4; IA P0-3 |
| G14 | **Compass reads unambiguously:** caption under the dial "Viewing from S · looking N"; the centre is "North up" (key N); a fixed north tick on the dial; no rotation transition; rim contrast ≥ 3:1; 72 px below 1440. | UX P1-10; UI P1-7, P2-12; SUP P2; IA P1-6 |
| G15 | **Trip view shows the trip:** "Whole trip" row in the switcher frames all sites (operator action); off-screen sites get edge chips. | UX P1-5; UI P1-3 |
| G16 | Label collisions: stack threshold widened; ruler initials offset clear of the numbers. | UI P1-8; UX P2-15 |

## Polish

| # | Fix | Sources |
|---|---|---|
| G17 | Route / numbering / advance buttons: one segmented style; numbering options as a vertical radio group; shorter advance button labels; sticky "Copy" footer in the Advance panel. | UI P1-6, P2-9, P2-11 |
| G18 | Help and keys: H = "Site and its Floors"; Esc row matches the real order; V toggles Live / Advance. | IA P1-10; UX P2-14 |
| G19 | Remaining "hotel" wording at venues; one name pattern per site. | IA P2-11/12 |
| G20 | 06 §10 vocabulary (sites, advance, paths, numbering). | IA P2-15 |
| G21 | Single-floor ranges read "floor 1", not "(1–1)". | UX P2-15 |

## Deferred
- Path framing inside the panel-free area for every camera move (only "Frame path" now) — UI P1-3.
- Beacon click confirmation during an incident — SUP P2.
- Return-leg items per day (the light item now covers the end time) — IA P1-8.
- SOC prep: `place.id` as site key, multi-trip trip switcher — IA P2-14.
- Green chips on OpenStreetMap places (settled in phase 1: green = places of safety on the trip's list; OSM-only places are labelled "not verified by SafeTrekr" on the card).

## Status (16 Oct 2026, after implementation)
G1–G21 implemented, except as noted:
- G1: the two-step confirm is the single "Use this numbering" button (a deliberate click after choosing); the answer is stored per trip + site in browser storage with its time (author "you" until there are operator accounts).
- G3: the rail group for the other site's incident uses phone estimates tied to that place only (the other site's twin isn't built, so no in/out verdicts there).
- G11: the standing rally path is hidden (not dimmed) while an on-demand path is shown, and comes back when it is cleared.
- G15: "Whole trip" frames every site; general safe-area framing for every camera move stays deferred.
- G17: radio group for numbering, sticky Copy footer and one segmented style done; advance labels shortened.

Verification: 61 Trip Twin unit tests pass (new: out-of-range reported floor → no count, no bare zero, operator label on the top line, top floor → floor count, incident at another site never "No incident", compass caption); full suite 3067 tests, 3063 pass, 3 known failures (2 in Justin's code, 1 macOS temp-path test); twin build OK; boundaries OK; QA PASS on all 9 sites; site-switch ×6 and exit/reopen leak-free; 36 after-shots in `after/` with zero console errors; no tracked file modified.
