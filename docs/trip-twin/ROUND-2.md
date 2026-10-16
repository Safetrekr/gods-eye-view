# Trip Twin — round 2 backlog (requested by Jesse during the prototype build)

> **Decisions (Jesse, 2026-10-15):**
> - Cutaway floor colours: **white = likely occupied (estimate), amber = assigned here but no one detected, red hatch = reported floor only.** No green or red on occupancy.
> - Weather: **free / open-source sources**; research the best options before building (not WeatherFlow-only).

Captured 2026-10-15. Not in the current prototype scope; plan each before building.

## 1. Building cutaway mini-map (floor selector)

**Ask.** Clicking the hotel opens its stats card on the right (already built in the prototype). Above that card, add a cutaway of the whole building: a vertical "mini-map" of every floor. Clicking a floor zooms the 3D view to that floor. Floors are highlighted by status, e.g. "green if kids are on them, red if they are supposed to be but are not".

**Inputs we already have.** Floor-estimate bands per person (floor-v1), the hotel card's assigned group floors (`places[].hotel_card.group_floors`), the reported incident floor, and the floor ruler geometry.

**To decide when planning:**
- Color meanings. The approved plan reserves green for "approved place of safety" and red for "hazard" (06 F6, DJ-02). A floor colored green would read as "safe floor". Options: keep Jesse's green/red but scope it to the cutaway with a legend, or use "occupied (estimated)" in brand slate/white and "assigned but nobody detected" in amber.
- Honesty. Floor presence is an estimate (±1 floor). A floor should read "likely occupied", and an empty assigned floor should read "no one detected", never "empty".
- Where "supposed to be" comes from. Room/floor assignments today exist only as the hotel card (07 gap list). Production needs a source (analyst entry or rooming list).

### 1b. Click a floor: who is assigned vs. who appears there

**Ask.** In the hotel, click a floor (in the 3D view or the cutaway) to see the students for that floor, ideally as a per-floor list of who is there and who is not.

**Shape.** Three columns per floor, from data the twin can defend:
- *Assigned here* — from a rooming list (who should sleep on this floor).
- *Likely here now* — people whose current floor band includes this floor (estimate, ±1).
- *Assigned here, not detected here* — assigned but their band is elsewhere, or their floor is unknown / not current. Never "missing"; show the reason ("Floor unknown — no pressure sensor", "Last known 34m ago").

**Prerequisite.** A rooming list: room or floor per traveler. SafeTrekr does not store this today (07 gap list has only the hotel card's group floors). Options: analyst entry in app-v2, chaperone check-in form on mobile, or hotel-provided list. Room numbers are more sensitive than floors; store floor only unless rooms are needed.

**Works without it.** The "Likely here now" list can ship first using floor bands only.

## 2. 3D weather

**Ask.** Bring weather into the twin, in 3D: cloud cover, rain, accumulation (rain/snow totals), lightning strikes.

**Notes so far:**
- The repo already calls Open-Meteo for weather effects. Its free API is non-commercial only (RK-17), so a commercial plan or another provider is needed for production.
- WeatherFlow Tempest (the GitHub link Jesse shared, Ghawken/WeatherFlowTempest, is a home-automation plugin for Tempest stations) gives hyper-local station data through WeatherFlow's API, but only for stations a token can access. It is not a global feed. Tempest stations also report barometric pressure, which could serve as a drift reference for floor estimation.
- Lightning needs a dedicated feed (e.g. a commercial lightning network). Radar-based precipitation needs a radar tile source.
- Rendering options in CesiumJS: particle systems for rain/snow, volumetric-looking cloud layers (Cesium CloudCollection), strike markers with short-lived flashes. All must follow the purpose rule: show only what changes a decision (e.g. lightning within X km of an outdoor assembly point).

## 3. Weather as a floor-estimate input

Station pressure (Tempest or METAR) as the reference series for floor-v1 drift correction, replacing or supplementing peer phones.

## 4. Keyboard map (3D-tool conventions)

**Ask.** A key to zoom to the selected object, and a proper keyboard map.

**Industry standard.** `F` = frame/focus the selection (Unity, Unreal, Maya, 3ds Max, most Cesium apps; Blender uses numpad `.`). The prototype already binds `F` and `Z` to "zoom to selected".

**Round-2 proposal** (to confirm against 06 §4.6 / F20):
- `F` / `Z` frame selection · `Esc` clear selection (never exits Trip Twin) · `1` `2` `3` Building / Neighborhood / City
- `[` `]` previous / next person in Needs attention · `A` jump to the first attention item
- `G` cycle ground (grid / contours / both / none) · `L` layers panel · `?` key help overlay
- Mouse: left-drag orbit, right-drag zoom, middle-drag pan (Cesium defaults), double-click frame.
- Every shortcut also reachable by visible controls (accessibility), and none fire while typing in an input.

## 5. Production notes found during the prototype

- **FIRMS payload size.** `/api/firms` (server/providers/firms.js, Justin's) returns every detection worldwide: ~31.6 MB / ~160,000 records on 2026-10-15. Trip Twin needs only ~12 km around one hotel. Add a bounding-box query parameter to the proxy so the server filters before sending. The FIRMS key now lives in gods-eye-view/.env.local (git-ignored).

## 6. Multi-site trips: hotel + venues across a city (advance work and real time)

**Ask (Jesse).** In a city like Washington DC the venues are spread out. The SOC team must do advance work (before the trip) as well as real-time monitoring.

**Model: every trip place is a site.** The hotel is just the first site. Venues (`places[].kind = 'venue'`, with `visit_date`) and itinerary stops are sites too. Core already sends them, plus safety points per venue (`venue_pois`), so the basic version needs no Core change.

- **Trip view (city scale).** All sites shown as small beacons across the city with a day filter (Day 1 · Day 2 …). Planned legs between sites drawn as routes. People shown as counts per site, not 27 pins: "Hotel 15 · Air & Space Museum 8 · in transit 3 · away 1".
- **Site twin.** Click a site (or pick it in a site switcher in the top bar: `Hotel · Air & Space (Day 2, 10:00) · …`) to fly in and build that site's 400 m hologram, exactly like the hotel today. Only one detailed hologram at a time; others are cached and unloaded when far away, to protect frame rate.
- **The rail follows the site.** Roster buckets become "at this site / nearby / elsewhere", Needs attention stays trip-wide (nobody is hidden because they are at another site).

**Advance mode vs Live mode** (a switch in the top bar):
- *Advance* — a time scrubber over the itinerary ("Day 2 · 10:00 → 12:30 Smithsonian"). Per site: entrances/exits (OSM entrances), the venue's safety points and rally point, hospital/police distances, walking and driving legs from the hotel with times, day/night at the planned time, and an advance checklist with notes (what was checked, by whom, when). Output: an advance brief per day (copy/print).
- *Live* — today's twin, but the group may be split across sites; the top line says so ("Group split across 2 sites · 1 in transit").

**Suggested phasing.** Finish round 2 (cutaway, floor list, weather) first, but reserve the site switcher slot in the top bar now. Then a "Sites & Advance" phase.

## 7. Phase 3 — route to any place on click (Jesse)

Click any place (hospital, police, fire station, embassy, rally point, shelter, venue, or a person) → "Route from here": from the hotel, from the selected person, or from the group's current centre; walking and driving. Same OSRM proxy and path cards as today (primary + alternate, 1 km heat-detection buffer, "Suggested · unverified"). On demand only, one route set visible at a time.

## 8. Phase 4 — custom routes (Jesse)

Operator-drawn or edited routes: waypoints, avoid-areas, saved per trip/day for advance work, included in the advance brief.

## 9. Standing rule (Jesse)

After every phase, run the same four design reviewers (UX, UI, supervision-surface, information architecture) on fresh screenshots at 1600×900 and 1280×720, merge into a fix list, implement, re-verify.

## 10. Decisions, 15 Oct 2026 (Jesse, after phase 2)

- Lightning watch radius stays **10 km** (supervision review suggested 16 km; declined).
- Add the **"How does this building number its floors?"** prompt in phase 3 (sites are where that setting lives).
- Add a **clickable compass** on the map: shows north, and clicking a side views the site from that side.
- Phase 3 plan: `PHASE-3-PLAN.md`.
