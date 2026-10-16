# Phase 8 fix list — the wider area (context ring and corridors)
(merged from 01-ux, 02-ui, 03-supervision, 04-ia; 16 Oct 2026; 39 findings → 14 fixes)

## Decision where the reviews differed
UX asked to draw each corridor's recorded walk with its distance; IA and supervision warned that a recorded, unchecked walk drawn on the map reads as a route (and the word "corridor" as an instruction). **Chosen:** the recorded walk is not drawn and the end labels go; the area is renamed **"Toward venues & hospital"** and described as map detail, not a path. To follow a walk the operator plans one (place card → path), which is checked against avoid-areas and hazards.

| # | Fix | Sources |
|---|---|---|
| N1 | **People and places are pinned wherever the map is drawn** (inside the wider area or within 150 m of a toward-strip), not only within ~500 m; the chip counts only what is beyond ("{n} beyond the wider area"). | SUP F1, UX P0-2, IA M2 |
| N2 | **Brightness order: core > toward-strips > ring.** Toward-strip streets use the core street token; ring streets #415e6b .55 / .35 at 1.5 / 1 px; buildings drawn faint (ring fill .04, roof outline only; strips .07 with roof + footprint); estimated heights fainter still. | UI P0-1/P1-3/P1-4, UX P1-5 |
| N3 | **The wider area steps back** in Ways out and during an incident (ring roads and edges hidden, strips' edges hidden except the hospital's during an incident); Ways out no longer forces it on. | UI P0-2, IA M4, SUP F8 |
| N4 | **No "Corridor · …" labels;** the row is "Toward venues & hospital" with "map detail only, not a path"; "corridor" joins the never-list. | IA M1/M3, SUP F3, UI P1-7/P1-8 |
| N5 | **Walkability tags kept in the wider area** (re-captured with tunnel, access, foot, sidewalk tags): tunnels and sidewalks not drawn, motorways / private drawn as "no walking", trunk roads kept in the ring. | SUP F4 |
| N6 | **Seam and edge:** anything already in the detailed core is not drawn again (by OSM id); ring roads clipped to the core edge + 60 m and to the ring edge; roads draped on the ground grid. | UI P1-5/P1-6 |
| N7 | **Honest notes:** recorded date of the wider area, "heights from OpenStreetMap; unmapped heights drawn low and fainter (not a measurement)", units through Display › Units, a failed load says so and unchecks nothing silently. | SUP F2/F6, IA M6/M9, UI P2-10 |
| N8 | **Row order:** Hotel · Surrounding buildings · Streets · Walkways · "Beyond the detailed area" · Wider area · Toward venues & hospital · Scale grid · Elevation. | IA M8/M5 |
| N9 | **A click on the wider area keeps the selection** and says "Wider area — no details on click; the detailed area is selectable". | UX P1-4, SUP F9 |
| N10 | **Venues:** the hotel's ring is not drawn at a venue more than 1 km from the hotel (the row says where the wider area is recorded); the strip toward that venue stays. | SUP F5, UX P1-6 |
| N11 | **Walkways and steps in the strips** only within 1.5 km of the camera, dim. | UI P2-9 |
| N12 | **Ways out text** says detail beyond the detailed area is main streets only. | UX P2-10, IA M7 |
| N13 | **Help:** 1·2·3 row notes City shows the wider area; Esc row as built. | IA M10 |
| N14 | **Tests** for the plan (dedupe, clipping, classes, coverage) and a correct venue capture. | SUP F9, all (shot 06) |

## Deferred
- Rings around each venue and around places beyond the ring (relocation site, embassy) and strips from venues to their own hospital / rally point — production "trip footprint" (UX P1-3/P1-6, SUP F5/F7); needs more captures.
- Dark street map under the 3D to the horizon; water and parks (UX P1-6).
- Comparing today's planned path with the recorded strip (SUP F3).
- Terrain beyond the detailed grid (heights clamp at its edge) (SUP F2).
- Load-time and frame-time measurement with the wider area (SUP F9).

## Status (16 Oct 2026, after implementation)
N1–N14 implemented. The wider area is a ring of plain buildings and main streets out to 1.2 km around the hotel, plus strips toward each venue and the nearest hospital. Everything comes from OpenStreetMap through our own recorder (`scripts/capture-trip-twin-context.mjs`); no Cesium ion token is needed. It is map detail only: no labels, no picking, never a path. Brightness order is core > strips > ring. It steps back in Ways out and during an incident, keeping the hospital strip in an incident. People and places are pinned wherever the map is drawn, and the chip counts only what is beyond ("{n} beyond the wider area"). Walkability tags are kept: tunnels and sidewalks are not drawn, and motorways and private roads are drawn as "no walking". At a venue more than 1 km from the hotel, the hotel's ring is not drawn.

Recording: Austin, DC and London were recorded on 16 Oct 2026. DC's hospital strip comes from the first run of that day, because Overpass returned 502 on the second; the fixture's `meta.note` says so.

Verification: Trip Twin unit tests pass (`twinContext.test.mjs`: dedupe, clipping, classes, coverage). Full suite: 3108 tests, 3104 pass, the same 3 known failures (not Trip Twin). Build and boundaries OK. QA PASS on all 9 sites. After-shots in `after/` at both sizes with zero console errors (Austin City / Neighborhood / Building, Layers rows, Ways out, Capitol venue, DC, London incident).
