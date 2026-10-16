# Phase 4 plan: custom paths (Trip Twin prototype)

Status: Jesse said "go for it" (16 Oct 2026) — build directly, then the standing four-reviewer pass.
Builds on ROUND-2 §8: operator-drawn or edited paths, waypoints, avoid-areas, saved per trip/day for advance work, included in the advance brief.
Same prototype rules: mock data, new files only (Justin's untouched), no commit until asked, production needs into `07-production-delta.md`. Vocabulary: "path" (06 §10).

## A. Routing with waypoints and avoid-areas
- New dev proxy `server/tripTwin/routingProxy.js` → `POST /api/twin-path` → FOSSGIS Valhalla (`valhalla1.openstreetmap.de`, verified 16 Oct: honours `exclude_polygons`). Body: `{costing: pedestrian | auto, locations: [from, …waypoints (through), to], avoid: [polygon]}`. Server decodes the polyline6 shape; returns `{ok, distanceM, durationS, geometry, engine:'valhalla'}`.
- If Valhalla is down: fall back to OSRM through the waypoints (existing `/api/route`) and say "avoid-areas not applied — the path is checked against them instead"; any crossing is flagged.
- Avoid-area check is always run client-side too (segment × polygon), so a flagged crossing is never hidden.

## B. Path editor (operator action only)
- Entry points: "Edit this path" on any shown path card (rally path, place path, advance path) and "New path" in the site card (from this site to any place / site).
- Edit mode banner across the map top: `EDITING PATH · click the map to add a waypoint · click a waypoint to remove it · A avoid-area · Enter to save · Esc to cancel`. The camera never moves by itself.
- Waypoints: click the twin to add (inserted at the nearest leg); numbered markers; list in the card with ↑/↓ reorder and ×. Each change re-asks the router (debounced), at most one request in flight.
- Avoid-areas: press A or "Add avoid-area", click the centre, pick radius 50 / 100 / 200 m and a reason (Construction · Crowd / event · Poor lighting · Traffic · Other + note). Drawn as amber hatched discs with their reason; listed in the card with ×. They apply to every path of the trip (not only this one) and show in Layers.
- Mode: Walk / Drive toggle in the editor.

## C. Saved paths
- Save: name (default "Hotel → Long Center · Day 2"), day (from the itinerary), mode, from/to labels, waypoints, avoid-areas, notes, author "you", saved time, status `Draft` / `Reviewed by you · Thu 22:21 CDT`.
- Prototype storage: browser storage per trip (production: a trip table, recorded in 07).
- Layers › Paths gains `Saved paths · Day N` rows (one per day with saved paths) and `Avoid-areas`. Saved paths draw in a distinct dash so they never look like a suggested path.
- Saved path card: show / edit / duplicate / delete (delete asks once), mark reviewed.

## D. Advance brief
- Each stop's brief lists the saved paths for that day touching that site, with distance, time, avoid-areas used, flags (crosses avoid-area, within 1 km of a heat detection, after dark), and review status.
- "Copy Day N brief (draft)" includes them.

## E. Checks shown on every custom path
- Crosses an avoid-area (only possible on the OSRM fallback) → amber, named.
- Within 1 km of a heat detection (existing rule).
- Longer than 1.8× the straight line → "much longer than the straight line — check waypoints".
- Ends > 150 m from the destination → "does not reach the destination".
- Walking after sunset at the planned time (when tied to an event) → "after dark".

## Files
New: `server/tripTwin/routingProxy.js`, `twinPathEditor.js` (state, pure checks, DOM card), `twinCustomPaths.js` (storage model, brief lines, Cesium layer for saved paths + avoid-areas), tests for the pure parts. Changed (Trip Twin only): `vite.twin.config.js`, `page.js`, `tripTwin.js` (map clicks in edit mode), `twinHud.js`, `twinAdvance.js`, `twin.html`, `tripTwin.css`, `07`, `06` (§11 vocabulary).

## Verification
Unit tests (polyline decode, avoid-area crossing, insert-at-nearest-leg, checks, storage round-trip, brief lines), browser QA (editor flow, save/reload, layers, advance brief), all-sites QA, full suite, build, boundaries, new-files-only; then the four reviewers on `review/phase4/shots`, merged fix list, fixes, after-shots.
