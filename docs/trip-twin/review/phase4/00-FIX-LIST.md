# Phase 4 fix list (merged from 01-ux, 02-ui, 03-supervision, 04-ia)

Reviewed 16 Oct 2026 against `shots/` (11 states × 1600×900 and 1280×720). 58 findings → 20 fixes.

## Honesty and safety (first)

| # | Fix | Sources |
|---|---|---|
| H1 | **Say only what happened with avoid-areas.** "routed around: X" only when the router applied it and no crossing is found; "ENTERS avoid-area: X" on a crossing; "not applied (fallback) · checked: none entered"; "planned before N newer avoid-areas — plan again". Never "avoids" next to "enters". Same text in card, brief, copy. | IA P0-1; UX P0-1; UI P0-2; SUP P1 |
| H2 | **Saving a path that enters an avoid-area or does not reach takes a second, explicit click** ("Save anyway — enters an avoid-area"). | UX P0-1 |
| H3 | **Every drawn path is checked against avoid-areas** (card paths, rally path, Advance path), not only the editor. | UX P0-2 |
| H4 | **No traveler data in saved paths.** A path that starts at a traveler's position is live-only: it can be planned and shown, not saved ("Plan from a site or a place to save"). | SUP P0 |
| H5 | **Reviews mean something:** dated stamp; reviewing with open flags asks once; a review goes out of date when the avoid-area outcome or the flags change. | UX P1-9; SUP P1 |
| H6 | **Checks never pass silently:** "Heat detections unavailable — not checked" when the fire feed is down; no day → "after dark not checked (no day set)"; after-dark wording "a stop that day ends after dark — check when this path is walked"; start as well as end reach; "avoid-areas applied" only when there were areas; avoid polygon circumscribes the circle. | SUP P1 ×3; UX P1-10 |

## Editor behaviour

| # | Fix | Sources |
|---|---|---|
| H7 | **Keyboard is safe:** typing in a field is never intercepted (Esc leaves the field); Tab / Space / Enter work on buttons; Enter saves only from the map; view keys (1 2 3 , . N F L D ? G E) keep working; attention keys (A [ ]) keep working in Live; avoid-area key is **X**. | IA P0-3; UX P0-3; SUP P1; IA P1 (A key) |
| H8 | **Nothing lost silently:** Esc ladder (leave field → stop placing → "Discard this path? Esc again"); "Discard" button; discarding removes avoid-areas added during the edit; switching mode / site / exit with unsaved work asks to save or discard first; starting another edit while dirty is refused with a message; > 10 waypoints says so. | IA P0-3; UX P1-7, P2-15; SUP P1, P2 |
| H9 | **The panel keeps focus, caret, scroll and the avoid-area form's values across reroutes.** | UX P0-3 |
| H10 | **Avoid-area flow:** dashed preview of the circle while sizing; removing an area (whole trip) asks once in the editor too; "Other" needs a note. | UX P1-8; UI P1-9; IA P1 |
| H11 | **Frame path** in the editor and on the saved card; End label stays visible. | UX P1-6; UI P0-1 |

## Map and look

| # | Fix | Sources |
|---|---|---|
| H12 | **Three distinct path looks:** suggested = blue glow; **being edited = blue with a white edge**; saved = long dash with gaps; other paths dim while editing; amber only on crossing segments. | UI P0-1, P0-2, P1-5; UX P1-12; SUP P1 |
| H13 | **Waypoint numbers render** (label above the marker); list controls ≥ 24 px. | UI P1-4; UX P1-5 |
| H14 | **Live shows today's saved paths** (Day 1 + any day); Advance shows the selected day. | UX P1-11; IA P1; SUP P1 |
| H15 | **Editing reads as a mode:** one-line banner with keys; `EDITING PATH` chip in the bar; breadcrumb "› New path (not saved)" / "› Saved path: name"; incident panel stays above the editor. | UI P1-3, P1-10; IA P1; SUP P1 |

## Finding and naming

| # | Fix | Sources |
|---|---|---|
| H16 | **One index:** Layers › Paths lists every saved path (by day) and every avoid-area, each opening its card. | IA P0-2; UX P1-11 |
| H17 | **One verb per action:** "Plan your own path" (new, everywhere), "Edit saved path", "Duplicate"; states "NEW PATH · NOT SAVED", "SAVED PATH · NOT REVIEWED / REVIEWED BY …". Short default names; day and mode as facets. | IA P1 ×2; UX P2-13 |
| H18 | **Brief uses the saved path:** "From the hotel" reads the saved walking path when one exists for that stop and day; copied brief carries every flag and the review state. | IA P1; SUP P1 |
| H19 | Editor panel: sticky actions footer, control borders ≥ 3:1, saved card Delete on its own row. | UI P1-6, P1-7; UX P2-14 |
| H20 | 06 §11 vocabulary. | IA P2 |

## Deferred
- Dragging waypoints; street names instead of coordinates for waypoints (needs reverse geocoding) — UX P1-5, IA P2.
- Out/back legs and event-linked times for saved paths — IA P1, UX P1-10 (after-dark wording made honest instead).
- Storage keyed by trip id, undo for delete, chaperone sharing (reviewed paths only) — SUP P2, IA P2 (SOC phase; recorded in 07).

## Status (16 Oct 2026, after implementation)
H1–H20 implemented, except as noted:
- H12: other paths are hidden (not dimmed) while a path is edited, and come back when the editor closes.
- H15: a static `EDITING PATH` chip sits in the top bar; the banner is one line.
- H16: Layers › Paths › "Saved paths N · avoid-areas M" lists every saved path by day (today marked) and every avoid-area, each opening its card.
- H5: review = dated stamp + the avoid-area outcome and the flags at that time; it reads "review out of date" when either changes.

Verification: 70 Trip Twin unit tests (new: "never avoids next to enters", routed around, review out of date, endpoint-in-area left out of the request, fallback reason); browser checks of the editor (typing never fires shortcuts; Esc: field → discard prompt → discard; "Save anyway" second Enter; save → reload persists); full suite 3076 tests, 3072 pass, 3 known failures; twin build OK; boundaries OK; QA PASS on all 9 sites; 22 after-shots in `after/` with zero console errors; no tracked file modified.

**Deferred items done 16 Oct 2026 (review/phase5 status):** dragging waypoints, street names, out/back legs with event times, storage by trip id, undo for delete, copy for chaperones (reviewed paths only).
