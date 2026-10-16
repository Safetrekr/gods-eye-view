# Phase 3 plan: Sites & Advance (Trip Twin prototype)

Status: **draft for Jesse's approval** · 15 Oct 2026
Builds on ROUND-2 §6 (multi-site, advance vs live), §7 (route to any place), phase-2 fix list deferrals, and Jesse's decisions of 15 Oct:
- Lightning radius stays **10 km**.
- Add the **"How does this hotel number its floors?"** prompt.
- Add a **clickable compass**: shows where north is and lets the operator view the site from any side.

Same prototype rules as before: mock data only, no Core/mobile changes, Justin's files untouched (new files only, plus our own Trip Twin files), no commit/PR until Jesse asks. Production needs go into `07-production-delta.md`.

---

## Part A — Sites (data and switching)

**Model: every trip place is a site.** Lodging plus each venue / itinerary stop with coordinates. Prototype data lives in the demo fixture in the same shape Core already sends (`places[]` with `kind`, `itinerary[]` with `coordinates`, `start_time`, `end_time`).

Venues per city (a choir tour: one performance venue and one daytime visit each, all real public places so the OSM capture works):

| City | Hotel (existing) | Venue 1 (performance) | Venue 2 (day visit) |
|---|---|---|---|
| Austin | Fairmont Austin | Long Center for the Performing Arts | Texas State Capitol |
| Washington DC | Hilton Washington DC Capitol Hill | Kennedy Center | National Air and Space Museum |
| London | Park Plaza London Waterloo | Royal Festival Hall | Westminster Abbey |

- **OSM fixtures** for each venue via the existing `capture-trip-twin-osm.mjs` (one file per site), so every site opens offline like the hotels do.
- **Site switcher** in the reserved `#tt-site` slot. The breadcrumb's hotel segment becomes it: `World View › Trip › [Fairmont Austin ▾] › Floor 9`. The list shows each site with its day and time: `Fairmont Austin (hotel) · Long Center (Day 2, 19:00) · Texas Capitol (Day 3, 10:00)`. Key `S` opens it.
- **Switching** flies out to City scale, builds the chosen site's 400 m hologram (same dissolve as today), and flies in. One detailed hologram at a time; the previous one is disposed.
- **Trip view.** At City scale every site appears as a small beacon with its name and day, so the operator can see how spread out the trip is and click any beacon to switch.
- **Everything follows the site** (the phase-2 IA seams):
  - floor focus carries the site id;
  - Floors and the rooming list come from that site (rooming exists only for lodging; venues get Floors without a rooming list when their levels are mapped);
  - weather is fetched for the site's own coordinates;
  - the hotel assembly point becomes the site's assembly point;
  - "the hotel" strings become the site's name or kind.
- **Rail follows the site, attention stays trip-wide.**
  - Roster buckets read `At this site · Nearby · Elsewhere`, with the other sites as counts (`Hotel 3 · Long Center 21 · in transit 2 · away 1`).
  - Needs attention is never filtered by site: nobody is hidden because they are somewhere else.

## Part B — Advance mode vs Live mode

A two-state switch next to the mode chip: `Advance · Live`. The chip says which one is on, so a planning screen is never mistaken for live data.

- **Live** (today's twin, multi-site aware). If the group is split, the top line says so: `Group split across 2 sites · 2 in transit`.
- **Advance** (before the trip; no traveler positions drawn):
  - **Time scrubber** over the itinerary (`Day 2 · 19:00–21:30 · Long Center`). It moves the sun (day/night at the planned time) and the weather forecast.
  - **Site brief card** for the selected site:
    - distance and walk/drive time from the hotel (with a Route button, Part C);
    - nearest hospital, police and fire with distances;
    - rally point status (approved / draft / not set);
    - floor numbering status (mapped / operator entry / not set);
    - MET Norway forecast for the event time, including "thunder in forecast" when the symbol says so;
    - official alerts that cover the event time.
  - **Advance checklist per site:** the brief's items plus free notes, each with "checked by / when". Session-only in the prototype; the production field is recorded.
  - **Copy advance brief:** plain text for the day (all sites), with "as of", sources, and SIMULATED labels where they apply.
- Demo data:
  - Advance mode works for every city.
  - A new Live scenario, **"Evening concert (Demo B)"**, has the group at the Long Center, 3 people back at the hotel and 2 in transit, so the split-group line, per-site counts and venue Floors all show.

## Part C — Route from any place (ROUND-2 §7)

- Every place becomes clickable, and its card gets a **Route from here** section. That covers hospitals, police, fire stations, embassies, rally points, shelters, site beacons, and buildings with a name.
  - **From:** `Hotel · Selected person · Group centre` (person only when one is selected; group centre = the median of current positions at this site).
  - **Mode:** `Walk · Drive`.
- Routing uses the existing `/api/route` proxy (`profile=foot` or `car`). Path cards are generalised from "rally point" to any destination and keep:
  - primary + alternate;
  - the 1 km heat-detection check;
  - `Suggested · unverified · not checked for closures, crowds or lighting`;
  - the rain allowance (walking only);
  - driving shown as distance plus a time range from OSRM, labelled "no live traffic".
- **One route set visible at a time.** A new route replaces the old one; Esc or the card's `Clear route` removes it. Routes are never computed without an operator action.
- **Clicking a person** offers the inverse ("Route to the hotel / site / nearest rally point").

## Part D — Compass (Jesse)

A compass rose on the map, bottom-right above the toolbar, clear of the right column at both 1600 and 1280:

- The **needle** turns with the camera, so north is always readable.
- Click **N, E, S or W** and the camera orbits to view the site **from that side**, looking across it. Pitch and distance are kept; the orbit centre is the current selection, else the site. Clicking N means "stand on the north side, look south".
- Click the **centre** to return to a north-up view.
- Hover shows `View from north` and similar; the current side is highlighted. Reduced motion means an instant move, no animation.
- **Keys:** `,` and `.` rotate the view 90° left/right; `N` returns north-up. All three go in the `?` help.
- Accessible: real buttons with labels; focus order after the toolbar.

## Part E — Floor numbering prompt (Jesse)

When a building's floor numbering is not mapped (London today, many venues), the hotel/site card shows a short form instead of the bare note:

> **How does this building number its floors?**
> `Ground floor = 0 (UK / Europe)` · `Ground floor = 1 (US)` · `Not sure`
> Floors above ground: `[ ]` (optional)
> Operator entry · not verified · used only for this trip

- Once answered, Floors and the at-or-above count work, labelled `numbering from operator entry`.
  - Phone estimates already carry levels above the lobby; the twin relabels them with the operator's numbering, so no estimate is recomputed.
  - The London false-zero guard stays until it is answered.
  - `Not sure` keeps today's honest "can't be matched" wording.
- The answer can be changed or cleared from the card. In the prototype it is stored per site in the browser. In production it is a place field: `ground_floor_label`, `levels_above_ground`, `levels_source: 'operator'`, plus who and when.

## Part F — Phase-2 deferrals picked up here

- Dim the hotel glass during floor focus (twinScene material opacity), so the focused slab reads first.
- Scene label collisions: fire station vs rally point labels; initials vs the floor ruler (priority order plus leader lines).
- The phase-2 IA seams listed in Part A.

## Production delta (to record in 07)

- **Sites:** venue `places` and `itinerary` coordinates already exist in Core. Venue OSM ids and level counts need an enrichment step.
- **Operator floor numbering:** a place field, with audit of who entered it and when.
- **Advance checklist and notes:** new table, per site per day, with author and time.
- **Driving routes:** FOSSGIS routing.openstreetmap.de is fair-use only. Production needs its own routing service (self-hosted OSRM or Valhalla) and traffic if wanted.
- **Forecast for event times:** the weather proxy gains `?time=`; MET Norway covers about 9 days.

## Files

- **New:**
  - `twinSites.js` (site model, switcher, beacons)
  - `twinCompass.js`
  - `twinRoutes.js` (generalised from `twinPaths.js`; the rally-point path becomes one caller)
  - `twinAdvance.js` (scrubber, brief, checklist, copy)
  - `twinNumbering.js` (prompt + relabel)
  - tests for each pure part
  - venue OSM fixtures
- **Changed (all Trip Twin):** `demoTripTwin.js` (sites, Demo B, advance data), `twinCities.js`, `twinData.js`, `tripTwin.js`, `twinHud.js`, `twinPeople.js`, `twinScene.js`, `page.js`, `twin.html`, `tripTwin.css`, `07-production-delta.md`, `06-layer-taxonomy.md`.

## Build order

1. Site model and fixtures, then the switcher, then the IA seams. Verify all three cities still pass QA.
2. The compass (small, independent; useful during the rest of the build).
3. The floor numbering prompt.
4. Route from any place.
5. Advance mode and Demo B.
6. Phase-2 deferrals.

## Verification

- **Unit tests:**
  - site model (from places + itinerary);
  - per-site roster counts (nobody dropped);
  - relabel with operator numbering (London at-or-above becomes real only after the prompt);
  - compass heading per side;
  - route request building (foot / car, from hotel / person / group centre);
  - advance brief text (as of, sources, SIMULATED, banned words).
- **Browser QA** (`qa-trip-twin.mjs` extended to open every site in every city), with no console errors except the allowed FIRMS 503.
- Lifecycle: exit / reopen and site switch × 3 with no leaked data sources.
- Full `npm test` (only the known failures), twin build, boundaries, and `git status` showing new files only.
- **Design review (standing rule):**
  - Capture screenshots at 1600×900 and 1280×720 into `review/phase3/shots/`, covering:
    - trip view with beacons;
    - site switch;
    - Demo B split group;
    - advance mode with the brief;
    - route walk and drive;
    - compass in each direction;
    - the numbering prompt before and after.
  - Run the four reviewers (UX, UI, supervision, IA), merge the fix list, implement, and re-verify with after-shots in `review/phase3/after/`.

## Open choices (defaults in bold; say if you want otherwise)

1. **Site switch rebuilds the hologram** (about 5–6 s with the dissolve). The alternative is keeping two holograms loaded, which costs frame rate.
2. **Advance checklist stays session-only** in the prototype. The alternative is saving it in browser storage.
3. **Compass sits bottom-right above the toolbar.** The alternative is top-right under the chips.
