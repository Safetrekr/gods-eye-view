# 02 · Trip Twin layer catalog, confidence model, fusion rules, gaps

Owner: travel risk intelligence analyst. Status: draft for PROJECT-PLAN.md.
Scope: what may be drawn in a Trip Twin and how much the operator can trust it. Visual treatments are stated as requirements; exact styling belongs to 04-screen-spec.md and 05-motion-language.md.

Code read for this section (read-only):
- gods-eye-view on `jesse/world-view-visual-layer`, which includes Justin's commit `d59ca04` ("stopped travelers read as current").
- safetrekr-core `develop`, plus Core branch `origin/stopped-phone-staff-ops` (commit `3cfc955`).

Assumptions are tagged **[A#]** inline and listed in section 7. Section 5.1 maps every P0 field from prototype source to production source; section 6 specifies the mock fixture.

---

## 0. Findings that change the plan

1. **The stopped-phone fields are not in Core `develop`** (a production concern; the prototype mocks them). `presence`, `stationarySince` and `lastContactAt` are emitted only on Core branch `origin/stopped-phone-staff-ops` (commit `3cfc955`). World View's `derivePresence()` (`src/operations/model.js`) does nothing without them. Against Core `develop`, a phone that stopped on purpose ages from fresh to stale like any other phone, so a sleeping traveler looks "last known 3h ago". The P0 traveler layer depends on that Core branch being merged.
2. **Traffic and CCTV can show fabricated content.**
   - Traffic: without a TomTom key the layer runs as a simulation. In live mode, roads that are not matched to TomTom data still carry simulated white dots (`src/data/traffic.js`).
   - CCTV: `CAMERA_SEEDS` are invented camera positions (`sourceKind:'seed'`). Frame requests can fall back to Street View or a `synthetic` image (`server/providers/local.js`, around lines 2700-2740).
   - Trip Twin must exclude all of these. They must never be shown, even with a caveat.
3. **FIRMS gives detections, not fire perimeters.** World View already says so in `alertFeed.js`: "not confirmed fire incidents or boundaries". No current source can answer "does the route cross the fire". We can only answer "the route passes within X km of a heat detection".
4. **Small upstream fields are dropped that the confidence model needs:**
   - FIRMS `scan`/`track` (pixel size) are discarded by `firmsCsv.js`.
   - The OSRM snap distance is discarded by `projectRouteResult` (`src/data/placeProviderPayloads.js`).
   - The USGS `status` field (automatic or reviewed) is dropped in `earthquakes.js`.
   - The building height source is not recorded. `buildingHeightFromTags` in `annotationResolver.js` returns explicit height, levels × 3.3 m, or a footprint-size guess (10-70 m) as the same unlabeled number. Note: the brief says ~3 m per level; the code uses 3.3 m.
   - `trip_lodging` coordinates carry no provenance: no geocode source and no `updated_at` is selected in `staff_operations.py`.
5. **No usable vertical data reaches World View today.**
   - The mobile app sends GPS `altitude` (`mobile-app/lib/location/locationEvent.ts`, `lib/supabase/client.ts`).
   - Core stores it in `participant_locations.altitude` (`routes/trips.py`). `supabase/schema/tiers.sql` classifies it `pii_tier:T3 restricted, encryption at rest always, retention 7d`.
   - `altitudeAccuracy` is not sent, the barometer is not read, and the staff snapshot does not select altitude.
   - GPS altitude errors are often 10-30 m, worse indoors. That is too coarse for floors.
   - Floor estimation (in scope this phase, per 00-CONTEXT "FLOOR ESTIMATION") therefore needs new mobile and Core work before World View has anything real to draw. Section 2.5 defines the confidence model the Twin is built against. A room is never shown.

---

## 1. Layer catalog

Question key (from the brief): **Q1** Where are my people? **Q2** What is the threat, and where? **Q3** Where is safety? **Q4** How do they get there? **Q5** How fresh and trustworthy is this?

Confidence vocabulary (defined in section 2):
- Time states: LIVE / RECENT / STALE / UNKNOWN. Static reference data is marked REFERENCE instead.
- Certainty flags: APPROXIMATE, UNVERIFIED.
- EXCLUDED means the item is never rendered.

### 1a. Site model

| Layer | Answers | Source | Exists in code today? | Refresh / latency | Confidence and why | How staleness or low confidence must look | Priority |
|---|---|---|---|---|---|---|---|
| Context buildings (hologram, ~500 m radius **[A1]**) | Q4 (street geometry, what blocks a path), Q1/Q3 orientation | OSM via `/api/overpass` (ODbL) | Partly. Footprint and height resolution for one building in `src/annotations/annotationResolver.js`; Overpass proxy and cache in `server/providers/local.js`. No bulk neighborhood extraction. | Static. Overpass cached 24 h in memory, 7 days on disk (`OVERPASS_CACHE_MS`, `OVERPASS_DISK_TTL_MS`). OSM edit age unknown unless queried with `out meta`. | Footprints: medium (volunteer-mapped, usually good in cities, sparse elsewhere). Heights: low-to-medium. Real height only when the `height` tag exists; `building:levels` × 3.3 m is an estimate; the footprint-size heuristic is a guess. | Height source drives the extrusion style: explicit = solid edge; levels = solid edge with "est." on hover; heuristic = uniform low-contrast block, no height label. Missing OSM coverage shows as empty grid floor plus "No OSM buildings mapped here" in the status rail. Never infill with invented blocks. | **P0** |
| The hotel itself (highlighted footprint) | Q1 (inside/outside hotel), Q3 (shelter in place), Q4 (origin of routes) | Hotel point: `places[kind=lodging]` (`trip_lodging.lat/lon`, `name`, `address`, `phone`, `checkin_date`, `checkout_date`). Footprint: OSM building nearest the point. | Partly. `worldAnnotationRenderer.js` draws one highlighted building; a solid outline means a real footprint, dashed means synthesized. No lodging-to-footprint match rule exists. | Point: Core snapshot, polled every 15 s (`SnapshotPoller`, `src/operations/api.js`). Footprint: as above. | Point: medium, with unknown provenance. Match: needs a rule (section 3, R12). Hotels inside mixed-use towers share a footprint with other uses. | Matched (point inside a real footprint) = solid hotel highlight. Probable (nearest real footprint ≤ 30 m **[A2]**) = solid with "matched by proximity". Unmatched = dashed synthesized disc labeled "Hotel location approximate". Any hotel-relative judgment then reads "near hotel", never "in hotel". | **P0** |
| Venues and itinerary stops | Q1 (where people are expected), Q4 (routes from venues) | `places[kind=venue]` (`trip_venues`); `itinerary[]` with `coordinates`, `start_at`, `end_at`, `location_id` | Yes (markers). `src/operations/globe.js`, `renderContext()` | Snapshot, 15 s | Medium. An itinerary point may be inherited from its venue (`staff_operations.py` falls back to `place.coordinates`); that fact is not flagged on the wire. | Inherited coordinates get the APPROXIMATE flag ("location from venue record"). An event without coordinates is listed in the panel, never placed. Shown inside the Twin only when within the site radius; otherwise as an edge bearing. | P1 |
| Range rings (250 m / 500 m / 1 km from the hotel) | Q4 (distance at a glance) | Derived from the hotel point | No | Static | High, as plain geometry. It inherits the hotel point's certainty. | If the hotel is unmatched, rings are dashed. | P1 |
| Day/night state (sun altitude at the hotel) | Q2 (night raises exposure; feeds R4) | Derived (solar position from lat/lon and time; no external source) | No | Computed each minute | High (deterministic) | Small rail chip "Night · civil dusk 18:42 local". It does not dim the scene; the scene stays dark by design. | P1 |
| OSM building entrances | Q4 (where a route leaves the hotel) | OSM `entrance=*` nodes on the hotel way (`main`, `service`, `emergency`, `exit`) | No (no `entrance` query anywhere in the repo) | Static, as Overpass | Low. Sparsely tagged and unverified; emergency exits are rarely mapped. | Small ring glyph on the footprint edge with "OSM-mapped entrance, unverified". Never labeled "exit route" or "fire exit". | P1 |

### 1b. Safety resources (all from `snapshot.safety_points`)

Common source: `SafetyPoint` (`safetrekr-core/src/models/safety_point.py`, schema 2.3.0).
- Fields used: `category`, `source` (`poi` / `rally_point` / `safe_house` / `relocation`), `coordinates` (nullable), `approval_status` (draft/active), `approved_at`, `updated_at`, `visibility`, `priority` (safe houses), `contact.hours`, `location_id` (which lodging or venue).
- Built by `staff_operations.py` from `rally_points`, `safe_houses`, `trip_relocation_points`, `lodging_pois`, `venue_pois`. Retired rows are filtered out server-side.
- Rendering exists as plain markers in `globe.js` (active `#72d5c5`, draft grey). There are no category glyphs.

Rules shared by every category:
- Refresh is the 15 s snapshot poll. This is REFERENCE data: show its review age (`approved_at`, else `updated_at`).
- Draft = UNVERIFIED: grey, dashed glyph, label "Draft, not approved". Core's direct-group action already rejects drafts.
- Missing coordinates: listed in the side panel ("No location on file"), never placed.
- Review age over 12 months **[A3]**: amber "Reviewed 14 mo ago".
- `visibility=chaperone_only|org_internal`: staff see it; tag it "Chaperone-only" or "Internal". Core blocks broadcasting internal points.

| Layer | Answers | Source specifics | Exists in code today? | Confidence and why | Low-confidence look (beyond the shared rules) | Priority |
|---|---|---|---|---|---|---|
| Rally point, primary | Q3, Q4 | `rally_points.is_primary=true` → `rally_primary` | Yes (generic marker) | High when active. Analyst-authored with approval lifecycle (`approved_by/at`). | Missing for this lodging → coverage-gap chip "No primary rally point" (R7). | **P0** |
| Rally point, secondary | Q3, Q4 | `rally_secondary` | Yes | High when active | As shared rules | **P0** |
| Safe house (primary / secondary) | Q3, Q4 | `safe_houses` with type `safe_house`; `priority` primary/secondary/none | Yes | High when active. Lifecycle as rally points. | Undesignated safe houses render smaller than primary/secondary | **P0** |
| Relocation site | Q3, Q4 | `trip_relocation_points` → `relocation` | Yes | High when active. Often trip-wide (`location_id` null) and far from the hotel. | Usually beyond the site radius → edge bearing with distance | **P0** |
| Shelter | Q3 | `safe_houses.type` in `shelter` and legacy `church/ngo/university/hotel` → `shelter` | Yes | Medium. Legacy types are folded together, so a "hotel" typed shelter looks like a shelter. | Show the raw legacy type in the hover ("Shelter (legacy: church)") | **P0** |
| Hospital / ER | Q3 | `lodging_pois.poi_type` in `er`, `hospital` (and `safe_houses.type=hospital/clinic`) | Yes | Medium-high. Analyst-selected POI with no approval lifecycle (always `active`). No capability data: trauma level, 24 h ER, language. `contact.hours` is free text. | Never claim "open now". Hover shows the raw hours text. Missing → coverage gap (R7). | **P0** |
| Police | Q3 | `poi_type=police` | Yes | Medium-high (as hospital) | As hospital | **P0** |
| Fire station | Q3 | `poi_type=fire` | Yes | Medium-high | As hospital | **P0** |
| Pharmacy | Q3 | `poi_type=pharmacy` | Yes | Medium. Hours matter most here and are free text only. | "Hours unverified" by default | **P0** |
| Embassy | Q3 | `poi_type=embassy` | Yes | High for location; contact data analyst-entered | Usually beyond the site radius → edge bearing | **P0** |
| Consulate | Q3 | `poi_type=consulate` | Yes | High | As embassy | **P0** |
| Other | Q3 | `category=other`, incl. legacy `private_site` | Yes | Low. The semantics are unknown. | Neutral glyph; name and instructions required in hover | **P0** (inside the safety-points layer) |
| Safety coverage gaps (derived) | Q3, Q5 | Absence of an active point per required category for this lodging's `location_id` | No | High, as a fact about the record set, not about the city. Note: POIs the analyst marked `is_na` are silently dropped by `_map_poi_rows`, so "analyst confirmed none" and "never reviewed" are indistinguishable today. | Amber chip "No approved pharmacy on file for this hotel". Never "none nearby". | **P0** (rendered as part of the safety-points layer) |
| Unvetted OSM emergency services | Q3 (fallback only) | OSM `amenity=hospital/clinic/pharmacy/police/fire_station`, `office=diplomatic` | No | Low. Volunteer data, no hours, may be closed or wrong. | Shown only when the analyst set lacks that category. Hollow glyph labeled "OSM · not vetted by SafeTrekr". Never a direct-group destination (Core only accepts approved points). | P2 |

### 1c. Movement

| Layer | Answers | Source | Exists in code today? | Refresh / latency | Confidence and why | How staleness or low confidence must look | Priority |
|---|---|---|---|---|---|---|---|
| Outdoor walking routes (hotel → selected safety point or venue) | Q4 | `/api/route?profile=foot` → FOSSGIS OSRM (`routing.openstreetmap.de`), `server/providers/places/routes.js`. Returns `distanceM`, `durationS`, `geometry`. | Partly. The proxy exists; the operations UI does not request routes. | On request. Server cache 10 min (`ROUTE_CACHE_MS`). Upstream timeout 12 s. `alternatives=false`. | Geometry: medium. It is the shortest legal path on the OSM graph, and it is blind to hazards, closures, crowds, lighting and indoor egress. Duration: a generic walking speed. Start and end are snapped to the nearest road, but the snap distance is dropped. | Always UNVERIFIED for safety. Permanent caption "Shortest mapped path · not hazard-checked". Route older than 10 min, or an endpoint moved → STALE dashed with "Recompute". Endpoint snap > 30 m **[A4]** (needs a code change to keep OSRM `waypoints[].distance`) → APPROXIMATE start/end tick. When R2/R3 fire, the affected segment turns warning-colored. | **P0** |
| Driving routes | Q4 (vehicle extraction) | Same proxy, `profile=car` | Partly (proxy only) | As above | Lower. No live traffic or closures in the routing. | As above, plus R13 when traffic is LIVE | P2 |
| Traffic flow on the vehicle route | Q4 | TomTom flow tiles via `/api/tomtom/flow` (`server/providers/traffic.js`), matched onto OSM roads (`src/data/flowMatch.js`) | Yes (global layer) | Tile TTL 120 s. Serve-stale on failure. Daily budget 40,000 tiles. | Medium when live. Simulated roads are EXCLUDED: keyless mode, and unmatched roads in live mode. | Only TomTom-matched segments are drawn. Keyless or over budget → layer unavailable, rail says "Traffic unavailable (no live source)". Never show the simulation in the Twin. | P2 |

### 1d. People (REQUIRED, P0)

| Layer | Answers | Source | Exists in code today? | Refresh / latency | Confidence and why | How staleness or low confidence must look | Priority |
|---|---|---|---|---|---|---|---|
| Traveler and chaperone positions (photo pins + accuracy ring) | Q1, Q5 | `snapshot.participants[]`: `coordinates`, `accuracy_m`, `capturedAt`, `locationAgeSeconds`, `freshness`, `isFresh`, `freshMaxAgeSeconds` (120), `staleAgeSeconds` (600), `role`, `avatar_url`, `battery_level/state`. Stopped-phone fields `presence`, `stationarySince`, `lastContactAt` exist only on Core branch `stopped-phone-staff-ops`. | Yes on the globe. `src/operations/participantPins.js` (photo pins with role badge), `model.js` `currentFreshness()` / `derivePresence()`, `globe.js`. Accuracy appears only as text (`±N m` in `main.js`); no ring is drawn. | Snapshot every 15 s. Device reporting cadence is ~60 s while moving (Core's alert gate `LOCATION_MAX_FIX_AGE_SECONDS=180` = "three missed reporting cycles"). Ages are extrapolated client-side every 5 s. | Varies per person. Full state table in section 2.3. | Section 2.3 | **P0** |
| Inside / outside hotel (derived per person) | Q1 | Person fix + `accuracy_m` vs the matched hotel footprint | No | Recomputed per snapshot and per 5 s age tick | Only as good as the worse of fix and footprint. Rules in section 2.3. | Verdict badge on the pin, plus partition counts in the rail | **P0** (part of the positions layer) |
| Estimated floor (per person; attribute of positions) | Q1 (who is above or below an incident floor), Q5 | **New pipeline.** Inputs:<br>- Phone barometer: iOS `CMAltimeter` relative altitude; Android `TYPE_PRESSURE`. Not read anywhere today.<br>- Lobby anchor: ground reference set on entry into the lodging geofence.<br>- Public pressure for drift correction (METAR / national stations).<br>- Floor height: OSM `height` ÷ `building:levels`, else levels × 3.3 m, else default.<br>- GPS `altitude` (already stored, T3): sanity check only, never displayed.<br>Core computes and exposes `floor_estimate {levels_above_ground_low, _high, _mid, method, anchor_at, sampled_at, reason_unknown}` in the snapshot (new fields). | No. Mobile: no barometer read. Core: altitude stored, no floor model. Snapshot: no vertical fields. World View: nothing. | Sample cadence and thresholds in section 2.5. Ages follow the position thresholds: LIVE ≤ 2 min, RECENT ≤ 10 min. | Low-to-medium even when working. Per-floor error is driven by weather drift (~1 hPa ≈ 8 m), building HVAC and stairwell pressurization offsets (worse during a fire alarm), and unknown floor heights and lobby heights. Typical honest band ±1 floor shortly after a lobby anchor, widening with time. | Never a bare number.<br>- On the hologram: a translucent horizontal band over the hotel footprint spanning the floor range, joined by a dashed vertical tether to the person's ground pin.<br>- Label: "≈ level 6 above lobby (5-7) · 3 min · est."<br>- STALE: hollow band, "last est. 25 min ago".<br>- Failure: no band, pin tag "Floor unknown: no lobby anchor" (reasons in 2.5).<br>- No consent: "Floor not shared".<br>- Never a room, never a room-level horizontal snap. | **P0** (attribute of the positions layer; real data depends on mobile + Core work) |
| Incident floor marker (operator input) | Q2 | Operator enters "incident reported on level N (from …)" on the hotel hologram. No source in SafeTrekr data today. | No | Manual; shows entry time and who entered it | As good as the report. Labeled with the reporter's source text. | Red slab across the footprint at that level, captioned "Reported, not verified · 22:41 · by J. Smith". Drives R15. | **P0** (part of the floor attribute) |
| Group zone (chaperone containment) and per-person zone state | Q1, Q2 | `snapshot.group_zones[]` (`model`, `centers`, `radius_m`, `degraded`, `valid_for_seconds`); per person `group_zone_state` (inside/outside/unknown) and `group_zone_ambiguous` | Yes. `src/operations/boundaries.js` (`tripBoundaries`, `boundaryIsDelayed`, `groupBoundaryLabel`), `globe.js` `renderBoundary`/`ageBoundaries` | Snapshot 15 s. Core computes containment only for current trips and fresh fixes. Chaperone anchors are valid for `RECENCY_MINUTES=60`. Default radius 400 m (`DEFAULT_RADIUS_M`), floor 150 m. | Medium-high. Core's validated model, with an accuracy gate (`GEOFENCE_MAX_ACCURACY_METERS=100`) and `degraded` when chaperone fixes are poor. | Existing rules carry over. Delayed once elapsed > min(45 s, `valid_for_seconds`): dashed edge, fill alpha 0.06, "Update overdue". `degraded` → amber, "Approximate". Person state → "Unknown · location not current" when the fix is not current. Zone rings sit on the ground plane, never extruded. | **P0** |
| Static trip geofences | Q1, Q3 | `snapshot.geofences[]` (`type` circle/polygon, `radius`, `polygon`, `active`; `chaperone_avg` excluded) | Yes (`boundaries.js`) | Snapshot 15 s | High as a definition (REFERENCE) | Teal static outline. No time state. | P1 |
| Recorded geofence transitions (24 h) | Q1, Q2 | `snapshot.geofence_events[]` (`direction`, `timestamp`, `coordinates`, `geofence_name`) | Yes (`alertFeed.js` turns them into feed items) | Snapshot 15 s; 24 h window | High as a record (C0). It says nothing about current position. | A small hollow tick at the transition point with its time: "Exit recorded 22:14". Existing copy: "The map point is the recorded transition location, not a current position." A later re-entry is shown on the same tick. | P1 |
| Muster / roll call | Q1 | `snapshot.musters[]` with `counts` {present, absent, excused, unmarked, expected}; `morning_musters[]` | Yes (panel) | Snapshot 15 s | High (C0). `expected` = eligible active roster. | Badge on the rally point: "Muster 14:00 · 11 present · 2 absent · 3 unmarked". Unmarked is never folded into present. | P1 |

### 1e. Threats

| Layer | Answers | Source | Exists in code today? | Refresh / latency | Confidence and why | How staleness or low confidence must look | Priority |
|---|---|---|---|---|---|---|---|
| Satellite heat detections | Q2 | NASA FIRMS VIIRS NRT (NOAA-20, NOAA-21, S-NPP) via `/api/firms` (`server/providers/firms.js`). Records parsed by `src/data/firmsCsv.js`, adapted by `firmsAdapt.js` (`confidence` l/n/h → 0.3/0.6/0.9, `acqMs`, `frp`, `night`). Grouped into 0.1° cells by `fireAlertAreas.js`. | Yes. Globe heatmap `firmsHeatmap.js`; ground anchoring `fireAnchors.js`; proximity feed `alertFeed.js` (`HAZARD_RADIUS_KM.fire = 25`) | Server TTL 30 min; client refresh 10 min (`REFRESH_INTERVAL_MS`); trailing 24 h window. FIRMS NRT arrives roughly 3 h after the satellite pass **[A5]**. Passes are hours apart, and the satellites miss fire under cloud or thick smoke. | Low-to-medium for "there is a wildfire here". Each pixel is ~375 m at nadir and larger off-nadir; pixel size is dropped today. Includes industrial and other non-wildfire heat. Never confirmed. | Never LIVE (section 2.2). Detections are drawn as ground-clamped footprints sized to the pixel, not as glowing points, with "VIIRS · 3 h ago · nominal". Low confidence (`l`) is hidden by default and shown on toggle at reduced opacity. Off-screen detections → edge bearing "Heat detections 6.2 km NE →". Feed stale or keyless → rail warning; empty-state copy in section 2.4. | **P0** |
| Earthquakes | Q2 | USGS `all_day.geojson` (`src/data/earthquakes.js`), M2.5+ | Yes (globe and `alertFeed.js`, radius 250 km, priority raised at M≥6) | Client poll 60 s. USGS updates the feed about every minute. Magnitudes get revised. | Medium for location and magnitude (`status` automatic vs reviewed is dropped). Low as an impact signal: the distance check is not a shaking estimate (existing copy). | Not drawn inside the Twin unless the epicenter is within the site radius. Otherwise a rail and alert chip: "M5.4 · 82 km SW · 12 min ago · USGS automatic". | P1 |
| SafeTrekr trip alerts and group directions | Q2, Q4 | `snapshot.alerts[]` (`headline`, `severity`, `priority`, `arrive_by`, `acknowledged_count`, `operations_event{kind:group_direction, destination_id, destination_source}`) | Yes (`alertsPanel.js`, `alertFeed.js`, `actions.js`) | Snapshot 15 s | High as a record. Ack count has no denominator (Core doc: "no required-recipient denominator is invented"). | A direction draws a hotel-to-destination route with an `arrive_by` countdown. Acks show as "7 acknowledged", never "7/24". Push acceptance is never shown as delivery. | P1 |
| Wind and weather at the hotel | Q2 (smoke drift, heat), Q4 | Open-Meteo forecast (`server/providers/local.js`, around line 4235; regional brief only) | Partly (cockpit regional brief, not in operations) | Hourly model data | Medium (model forecast, not observation) | Rail chip "Wind NE 18 km/h (forecast)". Only feeds R1's upwind/downwind wording (C3). | P2 |
| News context (region) | Q2 | Google News RSS then GDELT ArtList (`server/providers/local.js`, around lines 4195-4230; `src/data/regionalBrief.js`) | Partly (cockpit) | On request, 48 h window | Low. Not geolocated to the street. Headlines only. | Not drawn on the Twin. Panel list only, labeled "News mentions, unverified". | P2 |

### 1f. Verification aids and data health

| Layer | Answers | Source | Exists in code today? | Refresh / latency | Confidence and why | How staleness or low confidence must look | Priority |
|---|---|---|---|---|---|---|---|
| Public CCTV near the hotel or route | Q2 (see what is happening), Q5 (eyes-on check) | `/api/cctv/sources` (Austin open data, Caltrans districts 3/4/7/11, TfL JamCams, configured), frames via proxy (`server/providers/local.js`). Client `src/data/cctv.js`. Helper `nearbyCameras()` in `model.js`. | Yes (global layer, US-CA, Austin and London coverage only) | Catalog 15 min. Active frame refresh 10 s. Upstream image cadence varies by provider **[A6]**. | Medium for what it shows. Pose is approximate. Coverage is near-zero outside those cities. Excluded: `sourceKind` `seed`, `streetview`, `synthetic`. | Only real provider cameras within 300 m of the hotel or route **[A7]**. Frame age printed on the thumbnail. No frame for > 5 min → STALE grey thumbnail "Last frame 7 min ago". Never fill with Street View. | P2 |
| Source status rail (always on, not toggleable) | Q5 | Snapshot `generated_at`, poll success time, `source_issues[]`; per-feed `stats` (`loading`, `error`, `stale`) as already consumed by `alertFeed.js`; OSM / route / FIRMS fetch times | Partly. `alertFeed.js` emits notices; `main.js` shows sync state. No unified rail. | 5 s UI tick (existing `setInterval` in `main.js`) | High. It reports facts about the pipeline itself. | Section 2 drives the content | **P0 (mandatory element, not counted as a layer)** |

### 1g. Cut from Trip Twin

Aircraft, AIS ships, satellites and launches, bikeshare (GBFS), military installations, submarine cables, data centres, and dams are cut. None of them answers Q1-Q5 at hotel scale.

Trip flights are also cut from the Twin. They stay in World View's flight watchlist.

If a future scenario needs one of these (for example a helicopter landing zone), it re-enters through this catalog with a stated question.

---

## 2. Confidence and freshness model

### 2.1 States

Every rendered item carries one **time state** and zero or more **certainty flags**. The view never has a single combined green state.

| State | Definition | Visual rule (requirement for 04/05) |
|---|---|---|
| **LIVE** | The observation's age is within its source's live threshold (table 2.2), the feed is healthy, and the snapshot is not delayed | Full-intensity glow; age shown on hover |
| **RECENT** | Older than live, but within the source's stale threshold | Reduced glow; age always printed beside the item |
| **STALE** | Beyond the stale threshold, OR the feed is serving past its TTL, OR the snapshot is delayed past 45 s | Desaturated, dashed or hollow; label begins "Last known" or "Delayed"; no pulse |
| **UNKNOWN** | No usable timestamp, no data, source unavailable, keyless, or not loaded | Not drawn as a position. Listed or counted in the rail with the reason. Absence is never rendered as empty-and-fine. |
| **REFERENCE** | Static vetted record with no observation time (safety points, geofences, lodging) | Normal rendering; review age on hover; amber when older than 12 months **[A3]** |
| Flag **APPROXIMATE** | Position or geometry known, but uncertainty is at or above the decision scale. Examples: synthesized footprint, heuristic height, accuracy > 100 m, inherited coordinates, FIRMS pixel or cell, degraded group zone, hotel point unmatched. | Dashed outline, or an uncertainty ring drawn to scale; word "approx." |
| Flag **UNVERIFIED** | The source is not designed to answer the safety question asked. Examples: draft safety point, OSRM route as a safe route, OSM unvetted service, low-confidence FIRMS, news. | Hollow glyph, caption naming what it is not ("not hazard-checked", "not approved") |
| **EXCLUDED** | Simulated, synthetic, seeded, Street View fallback, or demo data | Never rendered in Trip Twin. Exception: demo mode (`src/operations/demo.js`, "Development-only fictional fixtures"), shown with a full-frame "DEMO DATA" watermark. |

Two composition rules:
- **Fusion never upgrades.** A derived judgment takes the worst time state and every certainty flag of its inputs. Its age is the age of its oldest input.
- **Snapshot staleness spreads.** If the Core snapshot is STALE, every private layer (people, zones, alerts, safety points) is STALE, whatever its own timestamps say. Public feeds keep their own state.

### 2.2 Thresholds per source

| Source | LIVE | RECENT | STALE | UNKNOWN | Code anchor |
|---|---|---|---|---|---|
| Core snapshot (whole private picture) | Last successful poll ≤ 20 s ago | ≤ 45 s | > 45 s, or poll error / 503 | Never loaded; 401/403 locks the view | `SnapshotPoller` 15 s (`api.js`). 45 s matches the `boundaryIsDelayed` cap (`boundaries.js`). |
| Participant fix | See 2.3 | See 2.3 | See 2.3 | See 2.3 | `location_freshness.py`, `location_presence.py`, `model.js` |
| Group zone | Elapsed since receipt ≤ min(45 s, `valid_for_seconds`) and not `degraded` | Not used | Beyond that ("Update overdue") | No zone, or `source_issues` contains `group_zone` | `boundaries.js`, `staff_operations._group_zone` |
| FIRMS detection | **Never LIVE** (satellite snapshot) | Acquisition ≤ 6 h ago **[A8]** | 6-24 h; or proxy `stale:true` (served past 30 min TTL) | No key (`503 no_key`), fetch error with no cache, layer off | `firms.js`, `firmsHeatmap.js` |
| Earthquake event | Not used (event, not state) | Event ≤ 24 h ago, feed fetched ≤ 5 min ago | Feed last fetched > 5 min ago | Feed error with no data, layer off | `earthquakes.js` |
| TomTom traffic segment | Tile age ≤ 120 s | ≤ 5 min | Served stale / over budget, > 5 min | Keyless, unmatched road (EXCLUDED) | `traffic.js` (server), `trafficQueue.js` |
| CCTV frame | Video healthy, or snapshot frame ≤ 60 s **[A6]** | ≤ 5 min | > 5 min | No frame, health error. Seed, Street View and synthetic are EXCLUDED. | `cctv.js`, `local.js` health map |
| OSRM route | Computed ≤ 10 min ago with unchanged endpoints | Not used | > 10 min, or an endpoint moved, or a hazard changed | Upstream failed (`ok:false`), rate limited | `routes.js` |
| OSM buildings and entrances | REFERENCE (fetched ≤ 7 days) | Not used | Fetch older than 7 days (disk TTL) | Overpass failed with no cache | `local.js` Overpass cache |
| Safety points, geofences, lodging, venues | REFERENCE | Not used | Snapshot STALE (spreads) | Missing coordinates (listed, not placed) | `staff_operations.py` |

### 2.3 Traveler positions: precise states (P0 requirement)

**Inputs per person** (snapshot fields):
- `coordinates`, `accuracy_m`.
- `capturedAt` and `locationAgeSeconds`: age measured from device capture time by the server clock.
- `freshness` (fresh/aging/stale/unknown) and `isFresh`.
- `freshMaxAgeSeconds` (default 120, `LOCATION_FRESH_MAX_AGE_SECONDS`) and `staleAgeSeconds` (default 600, `LOCATION_STALE_AGE_SECONDS`).
- From the Core stopped-phone branch: `presence` (moving/stopped/stopped_no_answer), `stationarySince`, `lastContactAt`.
- `group_zone_state`, `group_zone_ambiguous`.

The client adds `elapsed` (seconds since the snapshot was received) to every age, as `currentFreshness(person, elapsed)` does today.

| Trip Twin state | Exact condition (first match wins) | Pin | Label |
|---|---|---|---|
| **NOT LOCATED** (UNKNOWN) | `coordinates` null | Not on the map | Rail count "1 not located", person listed with reason "No location reported" |
| **TIME UNKNOWN** (UNKNOWN) | Coordinates present but `freshness=="unknown"` or `locationAgeSeconds` null (no `captured_at`, or capture more than 120 s in the future, `LOCATION_MAX_CLOCK_SKEW_SECONDS`), and presence is not stopped | Grey hollow ghost pin with "?". No ring, no inside/outside verdict, no zone verdict. | "Capture time unknown" |
| **STOPPED · CURRENT** (LIVE) | `presence=="stopped"`. The phone stopped GPS on purpose and the server heard from it within `STATIONARY_CONTACT_MAX_AGE_SECONDS` (2400 s; clamped to ≥ check interval 1800 + 300 s). Contact age = server-clock age of `lastContactAt` + elapsed. | Full-color photo pin; a "still" glyph in place of the motion trail; accuracy ring from the fix taken when the phone stopped | "At this location for 3h · contact 4m ago". Both ages are visible. The fix age is never hidden. |
| **LIVE · MOVING** | Presence absent or `moving`, and age ≤ `freshMaxAgeSeconds` (120 s) | Full-color photo pin and accuracy ring | "34s ago · ±18 m" |
| **RECENT (aging)** | Moving and 120 s < age ≤ 600 s | Pin with amber outer ring (`PEOPLE_COLORS.aging #e6bb66`); ring dashed | "Aging · 4m ago · ±18 m" |
| **STALE (last known)** | Moving and age > 600 s, OR `presence=="stopped_no_answer"` (contact age ≥ 2400 s) | Hollow, desaturated pin (`#d98585` ring); no photo glow; accuracy ring faded | "Last known · 2h ago", or "Did not answer a location check · updated 52m ago" |
| Modifier **APPROXIMATE** | `accuracy_m` > 100 m (`GEOFENCE_MAX_ACCURACY_METERS`) or `accuracy_m` null | Large ring drawn to scale. If accuracy is null, no ring at all (never a guessed radius) and the word "accuracy unknown". | Inside/outside and zone verdicts become "uncertain" |
| Modifier **SNAPSHOT DELAYED** | Snapshot STALE (> 45 s) | All pins drop one state, because the extrapolated ages keep growing anyway | Rail: "Traveler data delayed 1m 10s" |

**Dependency:**
- Prototype: the fixture supplies `presence`, `stationarySince` and `lastContactAt` directly, as `demo.js` already does.
- Production: STOPPED · CURRENT needs Core branch `origin/stopped-phone-staff-ops` (commit `3cfc955`) merged and deployed. Without it, every stopped phone falls through to the age rule and becomes STALE after 10 minutes. That reads as a false alarm, not a false all-clear, but it erodes trust. Treat the merge as a production prerequisite.

**Accuracy ring:**
- Radius = `accuracy_m`, drawn on the ground plane at true scale. This is the same 1.0 × accuracy that Core's containment uses (`GEOFENCE_ACCURACY_CONFIDENCE_K` default 1.0).
- Phone horizontal accuracy is roughly a 68 % radius **[A9]**. The hover says "about 2 in 3 chance the phone is inside this ring".

**What "exact" may imply:**
- The last horizontal position the phone reported, at `capturedAt`, within `accuracy_m`.
- For STOPPED · CURRENT: the phone has been in contact recently and has not reported leaving its stop. How far it could move before reporting depends on the traveler app's stop geofence radius, which is not verified here **[A10]**.

**What "exact" must not imply:**
- **No room, ever, and no floor except the labeled estimate band in section 2.5.**
  - The horizontal pin stays on the ground plane inside the translucent hologram. The floor band is a separate, explicitly estimated element joined by a tether.
  - The pin is never snapped to a room, a building face, or a single storey line.
  - GPS altitude is never used to place anyone vertically.
- No "inside the hotel" verdict when the accuracy ring crosses the footprint edge.
- No current position for RECENT or STALE pins.
- No guarantee that the person is with their phone.
- No location for unlocated people.
- No "in the hotel" when the footprint is a mixed-use building. Say "in the hotel building".
- No smoothing or animated interpolation between fixes in the Twin. `mobile-app/components/maps/markerInterpolation.ts` exists for the traveler app; do not port it, because a glide invents positions.

**Inside or outside the hotel (per person):**
- **AT HOTEL**: state LIVE or STOPPED · CURRENT, accuracy known, the hotel footprint is real (not synthesized) and matched (R12), and the fix point is inside the footprint with distance to the nearest edge ≥ `accuracy_m`.
- **OUTSIDE HOTEL**: same preconditions, and the whole accuracy circle lies outside the footprint.
- **AT HOTEL EDGE (uncertain)**: the preconditions hold but the circle straddles the edge. Indoor GPS in tall hotels often reports ±30-65 m, so expect many of these. That is the honest answer.
- **UNKNOWN**: the fix is not current, accuracy is missing or > 100 m, or the hotel footprint is synthesized or unmatched (then only "within N m of hotel point" is allowed).
- STALE people may carry "last known at hotel 2h ago". They are never counted as at hotel.

**Group zone state:** shown as Core computed it. Do not recompute it in the client.
- `group_zone_state` inside/outside, with "· uncertain boundary" when `group_zone_ambiguous` or `zone.degraded` is set.
- Forced to "Unknown · location not current" or "Unknown · boundary update overdue" by the existing `groupBoundaryLabel()` rules.

**At-a-glance partition** (rail and pin legend). The groups are mutually exclusive and always sum to the loaded roster.
- Example: "At hotel 9 · Hotel edge 4 · Elsewhere 7 · Not current 3 · Not located 1 · of 24 loaded".
- A second line: "Outside group zone 2 · Zone unknown 5".
- Roster size comes from `trip.loaded_participants`.
- Never "24 safe" or "all accounted for".

### 2.4 Absence is never an all-clear

The rule comes from Core:
- `safetrekr-core/docs/staff-operations.md`: "Incomplete or unavailable sources are explicit … **Read counts must not be presented as an all-clear.**"
- The module docstring of `staff_operations.py`: "A failed source is explicitly incomplete, never an all-clear."
- `source_issues[]` entries carry `{source, reason: unavailable | row_limit}`.

World View already follows it in `alertFeed.js` notices ("Active fires layer is off or unavailable…", "…this event list is incomplete"). Trip Twin must:

1. Show every `source_issues` entry relevant to the trip in the rail, naming the source ("Geofence history unavailable", "Safety points incomplete (row limit)").
2. Never use green, a check mark, or the words "clear", "safe", "no threats", "all good", or "secure" for the absence of hazards or alerts. Green is reserved for positive confirmations, for example "present" at a muster.
3. Word empty states as bounded observations, each with source, window and blind spot:
   - Fire: "No FIRMS heat detections within 25 km in the last 24 h (latest data 14:20 UTC). Satellites miss fires under cloud or smoke and between passes."
   - Earthquakes: "No M2.5+ USGS events within 250 km in 24 h."
   - Traffic: "No live traffic source."
4. When a feed is off, keyless, loading or erroring, the layer toggle and the rail show that state. The layer must not render as empty.
5. Count only what was loaded ("of 24 loaded"). Never use a roster denominator Core did not supply. This matches Core's acknowledgment rule.
6. "Floor unknown" people are always counted, both in the floor partition and in R15. They are never dropped from an "above the incident floor" count.

### 2.5 Estimated floor: computation, confidence and failure states (P0 attribute)

The physics is the same as E911 vertical location: barometric pressure falls about 0.12 hPa per metre near the surface, so **1 hPa ≈ 8.3 m ≈ 2.5 floors**. The method is only usable as a *relative* measure against a recent ground anchor in the same building.

- In the prototype, the logic runs client-side in gods-eye-view over mock traces.
- In production (next phase), Core runs the same logic and exposes only the result.

**Inputs:**
- Phone relative altitude from the barometer, `rel_alt_m`. Semantics follow iOS `CMAltimeter.relativeAltitude`; Android derives it from `TYPE_PRESSURE`.
- Raw pressure `pressure_hpa`.
- Lobby anchor time `anchor_at`.
- A nearby public station pressure series for drift correction.
- Building floor height from OSM.
- GPS `altitude` (production only): a gross sanity check (anchor error > 20 m → re-anchor). Never displayed, never used to place anyone.

**Step 1. Anchor ("lobby level").**
- Set when the person's fix first becomes AT HOTEL or AT HOTEL EDGE (section 2.3) after being outside, or crosses into the lodging geofence.
- Anchor value = median `rel_alt_m` over the first 60 s of that dwell **[A15]**.
- Re-anchor on every re-entry.
- No anchor since the phone started reporting at the hotel → `no_anchor`.

**Step 2. Height above lobby.**
- Δh = rel_alt(t) − anchor − drift(t), where drift(t) = −8.3 m/hPa × (station_pressure(t) − station_pressure(anchor_at)).
- Use a station ≤ 25 km away whose newest reading is ≤ 60 min old **[A16]**; otherwise `drift_corrected=false`.

**Step 3. Convert to levels.**
- Ground storey height g = 4.5 m (hotel lobbies run tall) **[A17]**.
- Floor-to-floor height h_f, best source first:
  - OSM `height` ÷ `building:levels`, clamped to 2.8-4.5 m.
  - Else 3.3 m, matching the resolver's levels multiplier.
  - Else 3.2 m with the "levels unknown" penalty.
- Level above lobby: L = 0 if Δh < g/2; else L = 1 + round((Δh − g) / h_f).
- Basements are allowed down to −`building:levels:underground` when tagged, else −2.

**Step 4. Uncertainty.** σ (1σ, metres) = √(σ_sensor² + σ_drift² + σ_hvac² + (L × σ_hf)²) **[A18]**:

| Term | Value |
|---|---|
| σ_sensor | 0.5 m |
| σ_drift, corrected | 0.4 m per hour since anchor |
| σ_drift, uncorrected | 1.5 m per hour since anchor (typical weather tendency ≈ 0.2 hPa/h) |
| σ_hvac, normal | 1.5 m (building pressurization and stack effect) |
| σ_hvac, fire mode | 3.0 m. Applies when an incident floor marker is set; stairwell pressurization during a fire alarm biases readings. |
| σ_hf | 0.3 m per level (height + levels tagged) / 0.5 m (levels only) / 0.7 m (no levels) |

The band is [level(Δh − 2σ), level(Δh + 2σ)], **forced to at least ±1 level**. A bare number is never shown.

**States:**

| State | Exact condition | Display |
|---|---|---|
| **FLOOR EST. ±1** | Band width ≤ 2 levels; newest sample ≤ 120 s old (≤ 600 s → RECENT styling); anchor present; person AT HOTEL or HOTEL EDGE and position not STALE | Band slab plus "≈ level 6 above lobby (5-7) · 40 s · est." With known numbering, a second line: "≈ US floor 7". |
| **FLOOR ROUGH ±2** | Band width 3-4 levels; other conditions as above | Wider, fainter slab; "Rough: levels 4-8" |
| **FLOOR STALE** | Newest sample > 600 s old, OR the person is STOPPED · CURRENT and barometer sampling stopped with GPS. A stopped phone does not notice an elevator ride, because there is no horizontal exit. | Hollow slab; "Last est. levels 5-7, 25 min ago · vertical movement not tracked while phone is stopped" |
| **FLOOR UNKNOWN** | Any reason code below | No slab. Pin tag "Floor unknown" plus the reason. Counted in the floor partition. |
| **FLOOR NOT SHARED** | Traveler has not consented to floor-level location (production consent flag; mocked in prototype) | No slab; "Floor not shared". Distinct from unknown. |

**Reason codes for FLOOR UNKNOWN** (proposed wire field `floor_estimate.reason_unknown`):

| Code | Meaning |
|---|---|
| `no_barometer` | Some Android phones have no pressure sensor |
| `no_anchor` | No lobby anchor since the phone started reporting at the hotel |
| `anchor_expired` | Anchor older than 4 h without drift correction, or 12 h with it **[A19]** |
| `not_at_lodging` | Outside the hotel, or verdict unknown. Floors are meaningless outdoors, and hills read as storeys. |
| `position_stale` | The horizontal position is STALE or UNKNOWN |
| `band_too_wide` | Band wider than 4 levels |
| `inconsistent_with_building` | Band entirely above `building:levels` + 1, or below the allowed basement depth |
| `sensor_jump` | Pressure step > 0.5 hPa in < 5 s with no plausible vertical speed (door slam, HVAC event). The estimator re-anchors only on the next lobby dwell. |
| `building_levels_unknown` | Never a failure on its own. It only widens σ_hf. |

**Numbering:** the primary unit is "levels above lobby". A local floor label (US lobby = 1; UK/EU ground = G/0; hotels often skip 13; mezzanines) is a secondary line, shown only when the convention is set for the building. The prototype hotel is set by hand. Production would need a new lodging field.

**What a floor estimate may imply:** "probably within this level range, measured relative to this building's lobby, as of this time".

**What it must not imply:**
- A room, unit or side of the building.
- That someone is on an exact floor.
- Any floor for someone who is outside the hotel or whose position is stale.

**Privacy sensitivity: higher than horizontal position.**
- Floor plus hotel narrows a person to a set of rooms.
- Treat `floor_estimate` and any raw pressure or relative-altitude data at least like `participant_locations.altitude`, which is `pii_tier:T3 restricted`, encrypted at rest, 7-day retention (`safetrekr-core/supabase/schema/tiers.sql`).
- Production rules (next phase):
  - Explicit traveler consent copy, and a "Floor not shared" state when consent is absent.
  - Same role gating as positions: org_admin, security_officer, HQ roles. Nothing new reaches travelers, guardians or non-staff.
  - Raw samples kept no longer than needed to compute the estimate **[A20]**.
  - No floor history or vertical trails in the UI.
  - Floor values never appear in logs or telemetry. `safetrekr.tracking.staff_snapshot_read` stays count-only.
  - Floor is shown only while the trip is current and the person is at the lodging.
- Prototype: fictional traces only. "No real traveler data in fixtures, ever" (00-CONTEXT).

---

## 3. Data fusion: candidate judgment rules

These are deterministic, geometry-only candidate rules, not ML. Every rule shows its inputs on hover (rule ID, input items, their states).

The trip timezone comes from `trips.timezone`. Distance thresholds are starting values to tune with the protective agent (01-operator-scenarios.md) **[A11]**.

**Caveat levels** (each judgment card shows its level as a word, not a number):
- **C0 Record**: restates a source record ("Core recorded an exit at 22:14").
- **C1 Core-computed**: the result of Core's validated model (`group_zone_state`), shown unchanged.
- **C2 Proximity**: client geometry over valid inputs (distance, intersection, bearing). Wording uses "within", "toward", "near". Never "affected" or "at risk".
- **C3 Cross-source**: combines sources of different freshness, or uses a source for a purpose it was not built for (FIRMS heat vs a route). The card says "Verify" and links the verification aid (CCTV, call the chaperone).
- **C4 Not shown**: fire spread, crowd or intent prediction. Out of scope; must not appear.

**Ordering** (E2, risk-based prioritization):
- **Tier A, people exposure**: R4, R5 during an active hazard, R6, R10.
- **Tier B, site and route exposure**: R1, R2, R3, R8.
- **Tier C, capability gaps**: R7, R12, route unavailable.
- **Tier D, data health**: rail items.

Within a tier, order by number of people involved, then proximity, then recency. Any input in STALE or UNKNOWN keeps the item in its tier, but labels it "based on data from 2h ago".

| ID | Judgment the screen surfaces | Inputs | Rule (candidate) | Caveat | Wording example | Suppress / downgrade when |
|---|---|---|---|---|---|---|
| R1 | Heat detection near the hotel | FIRMS detection (conf n/h), hotel point | Awareness ≤ 25 km (existing `HAZARD_RADIUS_KM.fire`), Watch ≤ 10 km, Warning ≤ 3 km. Distance = edge of the pixel footprint (half-pixel ~0.19 km at nadir) to the hotel point. Groups of detections within 1 km are clustered for the card, not merged into a "fire". | C2. C3 if wind direction is added ("upwind"). | "3 heat detections 2.4 km NW of Hotel X · VIIRS · 3 h old · not confirmed as wildfire" | Detection overlaps OSM `landuse=industrial` / `man_made=flare\|works` → add "possible industrial heat source". Conf `l` only → Awareness at most. |
| R2 | Route passes near a heat detection | OSRM route geometry, FIRMS detections | Any route vertex or segment within 1 km **[A11]** of a detection footprint → mark that segment | C3 (FIRMS is not a perimeter; OSRM is not hazard-aware) | "Walking route to Rally A passes 0.6 km from a heat detection (5 h old). Verify before directing." | Route STALE → "Recompute route first" |
| R3 | Destination lies toward the hazard | Hotel, destination point, nearest detection | Bearing hotel→destination within ±45° of bearing hotel→hazard, AND the destination is closer to the hazard than the hotel is | C2 | "Safe House 2 is in the direction of the heat detections; Safe House 1 is not." | Hazard > 25 km |
| R4 | Traveler outside the group zone at night | `group_zone_state`, person state, sun altitude at the zone center | `outside` AND person LIVE or STOPPED · CURRENT AND sun altitude < −6° (civil dusk to dawn) | C1 (zone) + C2 (night) | "Sam T. outside group zone · 640 m from nearest chaperone · 22:40 local · fix 40s" | `group_zone_ambiguous` or `degraded` → "possibly outside". Fix not current → "last known outside, 25m ago" (C0). |
| R5 | People who cannot be placed during an active hazard | Partition counts (2.3), any active R1/R8 item at Watch or above | NOT LOCATED + TIME UNKNOWN + STALE > 0 while a Tier B item is active → raise to Tier A | C0 | "5 travelers cannot be placed while heat detections are 2.4 km away" | Never |
| R6 | Person near a hazard | LIVE or STOPPED · CURRENT person, detection | Person within 3 km of a detection footprint (minus `accuracy_m`) | C2 | "2 travelers within 3 km of heat detections (fixes 1 min)" | Person stale → C0 "last known within 3 km" |
| R7 | Safety coverage for this hotel | Safety points with `location_id` = this lodging, plus trip-wide (`location_id` null) | Required set **[A12]**: `rally_primary`, `hospital`, `police`, and one of `safe_house` / `shelter` / `relocation`. For each: nearest active point, walking distance and duration (OSRM) from the hotel. | C0 for missing; C2 for distances | "Hospital: St. Mary's, 1.8 km walk, ~23 min (OSRM estimate) · No approved pharmacy on file" | Point is draft → listed as "draft only". Coordinates missing → "on file, no location". |
| R8 | Earthquake near the hotel | USGS event, hotel | M ≥ 4.5 within 100 km, or M ≥ 6 within 250 km (the existing priority bump) **[A11]** | C2 | "M5.4 · 82 km SW · 12 min ago · distance only, not a shaking estimate" | Feed STALE |
| R9 | Muster not closed | Muster `scheduled_time`, `counts.unmarked` | `unmarked > 0` 10 min after `scheduled_time` **[A11]** and `completed_at` null | C0 | "Muster 14:00 at Rally A: 3 unmarked after 12 min" | Never |
| R10 | Progress of a group direction | `alerts[].operations_event` (destination), `arrive_by`, person states | Person LIVE or STOPPED · CURRENT whose accuracy circle intersects a 50 m radius around the destination → "at destination"; LIVE elsewhere → "en route"; all others → "unknown" | C2 | "Directed to Rally A by 22:55: 6 at destination · 10 en route · 8 position unknown · 14 acknowledged" | Never shows "all arrived". Acks are never treated as arrival. |
| R11 | Exit recorded, no current position | `geofence_events` exit with no later enter, person STALE or UNKNOWN | Exit within 24 h, no re-entry, no current fix | C0 | "Left 'Hotel perimeter' at 22:14 · no current position since 22:20" | Re-entry recorded → resolved |
| R12 | Hotel location quality | Hotel point, OSM footprints | Point inside a real footprint → matched. Nearest real footprint ≤ 30 m **[A2]** → probable. Else unmatched, use a synthesized disc. | C0 (data quality) | "Hotel location approximate: address point is 70 m from the nearest mapped building" | Never |
| R13 | Vehicle egress slow | Car route, TomTom segments (LIVE only) | > 30 % of route length on segments below 40 % of free-flow speed **[A11]** | C2 | "Driving route to Relocation B: heavy congestion on 2.1 of 5.4 km (TomTom, 1 min)" | Traffic not LIVE → rule silent, and the rail says so |
| R14 | Eyes-on available | CCTV (real provider, frame ≤ 5 min), route or hotel | Camera within 300 m of the hotel or route **[A7]** | C0 | "Caltrans camera 180 m from route, frame 40 s old" | Seed, Street View or synthetic → never |
| R15 | Who is above, at, or below a reported incident floor | Incident floor marker (operator input), per-person floor estimates (2.5), hotel verdicts (2.3) | Band low > incident level → **above**; band high < incident level → **below**; band overlaps → **at/near**. FLOOR UNKNOWN, STALE, NOT SHARED and not-at-hotel people are counted in their own groups. | C3 (estimate plus unverified report) | "Reported fire L5 (22:41, front desk call). Above: 4 · At/near: 2 · Below: 3 · Floor unknown: 3 · Not shared: 1 · Not in hotel: 9 · of 22 loaded" | Never collapses unknown into below. In fire mode (σ_hvac 3 m), more people fall into at/near. That is intended, not hidden. |

**From judgment to action (F4):**
- The Twin suggests, never sends.
- A suggested action links to the existing human-initiated actions in `src/operations/actions.js`:
  - `POST …/broadcast`
  - `POST …/direct-group` with destination sources `rally_point`, `safe_house`, `relocation` or `poi`
- Each suggestion carries the judgment ID and caveat level into the confirmation dialog. C3 judgments require the operator to tick "I verified …" before the button enables **[A13]**.
- Capability gates stay as Core defines them: `capabilities.send_alert` and `capabilities.direct_group`. Security officers are view-only.
- After sending, the Twin shows Core's `push_delivery` counts as "accepted by push provider", never as "delivered", per the Core doc.

---

## 4. Gaps: data the scenarios need that SafeTrekr does not have

| Need | Scenario impact | Today | Suggested future source | Licensing / handling caveat |
|---|---|---|---|---|
| Indoor floor plans, stairwells, floor count, interior exits, assembly points | Indoor evacuation routes; "which stair" questions | None. No altitude is collected. | (1) Hotel-provided evacuation plan (photo/PDF) attached during the analyst's lodging review, hand-georeferenced to the footprint. (2) OSM Simple Indoor Tagging (sparse). (3) Commercial indoor maps: Mappedin, Pointr, Esri Indoors. | Hotel plans may be copyrighted and are security-sensitive. Store per organization, never in public layers. Apple IMDF venue data is licensed for Apple Maps, not third-party reuse. OSM indoor data is ODbL. |
| Verified building exits | Route start points | OSM `entrance=*` (unverified, sparse) | Advance-team verification field on `trip_lodging` (new Core column: exit points with photo) | Internal data; same sensitivity as above |
| Lodging coordinate provenance and building identity | R12 quality, inside/outside verdicts | `trip_lodging.lat/lon` only | New Core fields: `geocode_source`, `geocoded_at`, analyst-confirmed `osm_way_id` | None (internal) |
| Wildfire perimeters | "Route crosses the fire" (impossible today) | FIRMS points only | US: NIFC WFIGS Interagency Perimeters (ArcGIS feature service). Canada: CWFIS. EU: EFFIS. Australia: state feeds. | NIFC/US federal data is public domain. CWFIS uses the Open Government Licence – Canada. EFFIS and the Australian state feeds have per-provider terms that need legal review before commercial use **[A14]**. Perimeters lag hours to a day. |
| FIRMS pixel size and faster US detections | R1/R2 geometry accuracy | `scan`/`track` dropped by the parser | Keep `scan`/`track` in `firmsCsv.js` (code change). FIRMS US/Canada ultra-real-time product. | NASA FIRMS data is free to use with attribution. MAP_KEY quota is 5,000 transactions per 10 min (already handled). |
| Smoke and air quality (asthma, heat) | Shelter-in-place vs move decisions | None | AirNow (US), OpenAQ, Copernicus CAMS, NOAA HMS smoke polygons | AirNow data is preliminary and needs an API key. OpenAQ licences vary by upstream provider. CAMS: Copernicus licence with attribution. HMS: public domain. |
| Official weather warnings | Storm or heat decisions | Open-Meteo forecast in the cockpit only | NWS CAP alerts (`api.weather.gov`, US). National CAP feeds via WMO. Meteoalarm (EU). | NWS: public domain. Meteoalarm reuse terms restrict redistribution, so check them. **Open-Meteo's free API is non-commercial; SafeTrekr's commercial use needs a paid plan.** This affects existing code. |
| Civil unrest, protests, crowd events | "Threat near hotel" for the non-natural hazards that dominate real incidents | None geolocated (GDELT / Google News headlines in the cockpit) | Commercial event intelligence (Dataminr, Crisis24, Samdesk, Everbridge). ACLED for historical baselines. GDELT Events as a noisy signal. City event permits. | ACLED: free for non-commercial use, commercial use needs a paid licence, roughly weekly updates (not real-time). GDELT: free with citation, but city-level geocoding and duplicates. Google News RSS is not licensed for redistribution. Commercial feeds are contract-gated and often forbid storage. |
| Live crowd density | Route choice through crowded areas | None | Telco or mobility aggregates, venue-provided counts | Commercial and privacy-heavy. Google Popular Times has no API, and scraping breaks Google's terms. |
| Road closures and incidents | Driving egress | TomTom flow only | TomTom Traffic Incidents (same vendor/key). Waze for Cities. City 511 feeds. | TomTom terms restrict caching and storage. Waze requires a partnership data-sharing agreement. 511 terms vary by agency. |
| Hazard-aware routing and isochrones | R2 without manual rerouting; "everything within a 10-min walk" | OSRM via FOSSGIS, no avoid-areas, no alternatives | Self-hosted Valhalla (exclude polygons, isochrones; MIT licence) or GraphHopper custom models | The FOSSGIS public OSRM servers are best-effort with a fair-use policy and are not for production load. Production needs self-hosting with OSM data (ODbL attribution). |
| Hospital capability (trauma level, 24 h ER, language) | Choosing the right hospital, not just the nearest | Name, phone, free-text hours | New SafetyPoint fields entered by analysts. US: CMS Hospital General Information. | CMS: public domain. Elsewhere it is mostly manual. |
| Machine-readable opening hours | "Is the pharmacy open now" | `contact.hours` free text | OSM `opening_hours` as a hint; analyst-structured hours field | ODbL; unverified |
| "Analyst confirmed none" vs "not reviewed" | R7 honesty | `is_na` POIs dropped silently by `_map_poi_rows` | Emit `is_na` as an explicit coverage record in the snapshot (Core change) | None |
| Earthquake shaking at the hotel | R8 beyond distance | Distance only | USGS ShakeMap / PAGER (detail feed) | Public domain |
| Building heights (measured) | Hologram fidelity | OSM tags or heuristic | Overture Maps buildings; national LiDAR-derived datasets where open | Overture has mixed licences (ODbL for OSM-derived parts, CDLA-Permissive for others), so attribution is per theme. Google 3D tiles are forbidden for this use (Map Tiles API terms, per 00-CONTEXT). |
| Traveler floor (barometric) | R15; "who is above the fire floor" | Barometer not read (mobile-app). GPS `altitude` collected but unusable for floors and not in the snapshot. | Next phase: mobile barometer capture, Core ingest and estimator, `floor_estimate` in the snapshot (section 2.5). Field-by-field delta in 07-production-delta.md. | T3-restricted class, consent copy, short retention (section 2.5). Apple background limits: `CMAltimeter` updates may not run while the app is suspended **[A21]**, which is why FLOOR STALE exists for stopped phones. |
| Station pressure for drift correction | Floor accuracy beyond ~1 h after anchor | None | NOAA/NWS METAR via aviationweather.gov (e.g. KAUS for Austin, ~12 km from downtown **[A22]**). National met-service station feeds elsewhere. | METAR/NWS: public domain. Open-Meteo `surface_pressure` is model output, and the free tier is non-commercial. Meteostat is CC BY-NC (non-commercial). Netatmo crowd stations: API terms restrict reuse. |
| Indoor positioning (room, wing) | Not wanted | Not collected | Out of scope. Any future BLE or Wi-Fi RTT needs a privacy assessment and consent. | Room-level location is the most sensitive form and is excluded by design |
| Incident floor | R15 input | No data model | Prototype: operator-entered marker in the Twin. Production: a structured `incident` record (location, level, source, reporter, time). | Internal |

---

## 5. Recommended P0 layer set (six layers plus the mandatory rail)

| # | Layer | Answers | Why it is in P0 |
|---|---|---|---|
| 1 | **Site model**: hotel footprint (matched per R12) plus OSM context buildings within ~500 m, height-source styling | Q1, Q3, Q4, Q5 | The hologram is the feature. Without the matched footprint there is no inside/outside verdict, no floor band and no route origin. |
| 2 | **Traveler and chaperone positions, with estimated floor** (both required by Jesse): photo pins, accuracy rings to scale, the 2.3 states incl. STOPPED · CURRENT, inside/outside-hotel verdict, partition counts, the 2.5 floor band and states, and the operator's incident-floor marker | Q1, Q2, Q5 | Mandatory. Floor is an attribute of the person, so it shares this layer and keeps the cap at six. Reuses `participantPins.js`, `currentFreshness()` and `derivePresence()`. New work: ground accuracy ring, footprint verdict, client-side floor estimator, band rendering, R15. |
| 3 | **Group zone**: chaperone containment rings plus per-person zone state (static trip geofences share the toggle) | Q1, Q2 | "Who is outside their group zone" is a primary at-a-glance answer. Honest delay and degraded handling already exist in `boundaries.js`. |
| 4 | **Safety points for this lodging** (12 categories, one layer, category glyphs, draft/active, plus the R7 coverage chips) | Q3 | This is SafeTrekr's own vetted data, the thing no public globe has. |
| 5 | **Outdoor walking routes** from the hotel to the operator-selected safety point (default: primary rally point, primary safe house, nearest hospital) | Q4 | Routes are the decision. The OSRM proxy exists. The permanent "not hazard-checked" caption keeps it honest. |
| 6 | **FIRMS heat detections**: pixel-sized footprints, R1/R2/R3 cards, off-screen bearings | Q2 | It makes the core scenario run end to end: "fire near the hotel at night: where are my people, which floor, where do they go". |
| (always on) | **Source status rail**: snapshot age, `source_issues`, per-feed state, partition counts, empty-state wording, DEMO watermark in sample mode | Q5 | Not toggleable. It enforces "never an all-clear" (2.4). |

**Deferred:**
- P1: earthquakes, trip alerts and directions (R10), geofence transitions, musters, OSM entrances, range rings, day/night chip. The day/night computation is needed by R4 even though its chip is P1.
- P2: CCTV, traffic, driving routes, weather, news, unvetted OSM services.

**gods-eye-view-only prerequisites (allowed in the prototype):**
- Keep FIRMS `scan`/`track` in `src/data/firmsCsv.js`.
- Return a height source from `buildingHeightFromTags` in `src/annotations/annotationResolver.js`.
- Keep OSRM `waypoints[].distance` in `projectRouteResult` (`src/data/placeProviderPayloads.js`).

### 5.1 Prototype source vs production source (input to 07-production-delta.md)

Status values follow 00-CONTEXT:
- **EXPOSED**: exists and exposed in the snapshot.
- **NOT EXPOSED**: exists but not exposed in the snapshot.
- **UNUSABLE**: collected but unusable.
- **NOT COLLECTED**.
- **CLIENT**: derived in gods-eye-view in both phases.
- **PUBLIC**: external public feed, same in both phases.

Wire naming follows `safetrekr-core/docs/staff-operations.md`: camelCase for the participant freshness and presence fields, snake_case for everything else, including the proposed new fields.

| P0 layer | Field / behavior | Prototype source (gods-eye-view only) | Production source today (repo / file / field) | Status |
|---|---|---|---|---|
| 1 Site model | Hotel point | Fixture `places[{kind:'lodging', coordinates}]` set to a real Austin hotel's coordinates | safetrekr-core `src/services/staff_operations.py`: `trip_lodging.lat,lon` → `places[].coordinates` | EXPOSED |
| 1 | Hotel coordinate provenance, OSM building id | Fixture comment notes the OSM way id | None (`trip_lodging` has no geocode source; `updated_at` not selected) | NOT COLLECTED |
| 1 | Building footprints and heights | Real OSM via `/api/overpass` (gods-eye-view `server/providers/local.js`) | Same | PUBLIC |
| 1 | Height source (explicit / levels / heuristic) | New return value from `annotationResolver.js` | Same (gods-eye-view change) | CLIENT |
| 1 | Floor numbering convention | Fixture field `places[].floor_numbering:'us'` (proposed) | None | NOT COLLECTED |
| 2 Positions | `coordinates`, `accuracy_m`, `capturedAt`, `locationAgeSeconds`, `freshness`, `isFresh`, `freshMaxAgeSeconds`, `staleAgeSeconds`, `battery_level`, `battery_state` | Fixture `participants[]` (same shape as `demo.js`) | safetrekr-core `staff_operations._person()`, from `participant_locations.lat,lng,accuracy,captured_at,battery_level,battery_state` via `location_freshness.evaluate_freshness().to_payload()` | EXPOSED |
| 2 | `presence`, `stationarySince`, `lastContactAt` | Fixture (as `demo.js` does) | Core branch `origin/stopped-phone-staff-ops` (`3cfc955`), from `participant_locations.stationary_since,last_contact_at` via `location_presence.derive_presence` | NOT EXPOSED on `develop` (branch only) |
| 2 | `name`, `role`, `avatar_url`, `trip_id`, `id` | Fixture (fictional names; avatars initials only, no real photos) | `trip_participants.name,role`; `users.avatar_url` | EXPOSED |
| 2 | `group_zone_state`, `group_zone_ambiguous` | Fixture | `staff_operations._group_zone` → `chaperone_geofence.evaluate_containment` | EXPOSED |
| 2 | Inside/outside hotel verdict | Client computation (2.3) | Same | CLIENT |
| 2 | GPS altitude | Not used | mobile-app `lib/location/locationEvent.ts` `altitude` → Core `routes/trips.py` → `participant_locations.altitude` (T3, 7-day retention); not selected in `staff_operations.py` | UNUSABLE for floors; NOT EXPOSED |
| 2 | Barometric relative altitude / pressure samples | Mock traces (section 6) replayed client-side | Not read by mobile-app; no Core table | NOT COLLECTED |
| 2 | Lobby anchor event | Derived client-side from the fixture position track entering the footprint | Partial ingredients: `geofences` + `geofence_violations` (enter/exit) exist; no anchor concept | NOT COLLECTED |
| 2 | Station pressure series | Mock series in fixture | None in gods-eye-view or Core (Open-Meteo use in `local.js` is a forecast for the cockpit only) | NOT COLLECTED |
| 2 | `floor_estimate {level_low, level_high, level_mid, state, reason_unknown, method, anchor_at, sampled_at, drift_corrected}` (proposed) | Computed client-side from traces | None | NOT COLLECTED |
| 2 | Floor consent flag `floor_consent` (proposed) | Fixture boolean | None | NOT COLLECTED |
| 2 | Incident floor marker | Operator input in the Twin, held in memory only | None | NOT COLLECTED |
| 3 Group zone | `group_zones[]` (`model`, `centers`, `radius_m`, `degraded`, `valid_for_seconds`) | Fixture | `staff_operations._group_zone` | EXPOSED |
| 3 | Static `geofences[]` | Fixture | `geofences` table via `staff_operations.py` | EXPOSED |
| 4 Safety points | `safety_points[]` (SafetyPoint 2.3.0: `category`, `source`, `coordinates`, `approval_status`, `approved_at`, `updated_at`, `visibility`, `priority`, `contact`, `location_id`) | Fixture. Hospital, police, fire and pharmacy names and coordinates copied from real OSM features near the hotel (OSM ids in comments). Rally points and safe houses are fictional. | `rally_points`, `safe_houses`, `trip_relocation_points`, `lodging_pois`, `venue_pois` via `safety_points_aggregator` mappers in `staff_operations.py` | EXPOSED |
| 4 | Analyst "not available" for a category | Fixture flag `coverage_na:['pharmacy']` (proposed) | `lodging_pois.is_na` / `venue_pois.is_na`, dropped by `_map_poi_rows` | NOT EXPOSED |
| 5 Routes | Route geometry, distance, duration | Real OSRM via `/api/route` (gods-eye-view `server/providers/places/routes.js`) between fixture endpoints | Same (production needs a self-hosted router, section 4) | PUBLIC |
| 5 | Snap distance | New field from `waypoints[].distance` | Same (gods-eye-view change) | CLIENT |
| 6 FIRMS | Detections (`lat`, `lon`, `acqDate`, `acqTime`, `confidence`, `frp`, `daynight`, `satellite`, `instrument`, plus `scan`, `track`) | **Mock records** in the `/api/firms` record shape, injected only in the Trip Twin sample and labeled DEMO. Real Austin detections are rarely near a hotel, so the scenario must be scripted. In sample mode the real feed is not merged with mock records. | NASA FIRMS via gods-eye-view `server/providers/firms.js` (key `FIRMS_MAP_KEY`); `scan`/`track` currently dropped in `firmsCsv.js` | PUBLIC |
| Rail | `generated_at`, `source_issues[]`, feed `stats` | Fixture plus scripted toggles (section 6) | `staff_operations.py` envelope; feed stats in gods-eye-view layers | EXPOSED / CLIENT |

---

## 6. Prototype fixture specification (must exercise every state)

This builds on the `demo.js` pattern: a new Trip Twin sample trip in the same snapshot shape, fictional people only.

Three cities are needed for the pass bar **[A23]**:
- **Austin** (default): hotel with a real OSM footprint and `building:levels` tagged.
- **City B**: hotel footprint with no height tags, to exercise the heuristic-height styling.
- **City C**: hotel whose address point is more than 30 m from any footprint, to exercise R12 "unmatched" and the "near hotel only" verdicts.

Verify OSM coverage before choosing B and C.

**Clock control:**
- Fixtures are authored relative to "now", as `demo.js` does with `iso(delta)`.
- A scenario clock (play / pause / scrub) drives the trace replay.
- A "night" toggle forces the sun below −6° so R4 can be shown in daylight demos.

**People** (Austin fixture; one row per required state; names fictional):

| # | Role | Position state | Accuracy | Hotel verdict | Zone | Floor state (trace behavior) |
|---|---|---|---|---|---|---|
| P01 | chaperone | LIVE moving, 30 s | 12 m | AT HOTEL | anchor | ±1, level 7, drift-corrected |
| P02 | traveler | LIVE, 45 s | 45 m straddling the edge | HOTEL EDGE | inside | ROUGH ±2 |
| P03 | traveler | LIVE, 20 s | 15 m | OUTSIDE HOTEL | **outside**, not ambiguous (R4 at night) | UNKNOWN `not_at_lodging` |
| P04 | traveler | LIVE, 60 s | 30 m | OUTSIDE HOTEL | outside, **ambiguous** | UNKNOWN `not_at_lodging` |
| P05 | traveler | RECENT (aging), 300 s | 20 m | AT HOTEL | inside | ±1, RECENT styling |
| P06 | traveler | STALE moving, 2 h | 18 m | last known at hotel (counted Not current) | unknown | UNKNOWN `position_stale` |
| P07 | traveler | STOPPED · CURRENT: fix 3 h old, contact 4 min | 10 m | AT HOTEL | inside | FLOOR STALE: samples stop at the stop; ground truth shows a later elevator ride that the estimate misses (deliberate) |
| P08 | traveler | STOPPED · CURRENT, barometer still sampling | 10 m | AT HOTEL | inside | ±1, live samples |
| P09 | traveler | STALE: `stopped_no_answer`, contact 52 min | 25 m | Not current | unknown | UNKNOWN `position_stale` |
| P10 | traveler | TIME UNKNOWN: coordinates set, `capturedAt` null, `freshness:'unknown'` | 20 m | none | unknown | UNKNOWN `position_stale` |
| P11 | traveler | NOT LOCATED: coordinates null | n/a | none | unknown | none |
| P12 | traveler | LIVE, `accuracy_m` 180 (APPROXIMATE) | 180 m | UNKNOWN | inside, ambiguous | UNKNOWN `position_stale` (position too coarse) |
| P13 | traveler | LIVE, `accuracy_m` null | null | UNKNOWN | unknown | UNKNOWN |
| P14 | traveler | LIVE at hotel, `barometer_available:false` | 14 m | AT HOTEL | inside | UNKNOWN `no_barometer` |
| P15 | traveler | LIVE at hotel, trace starts inside (no entry) | 14 m | AT HOTEL | inside | UNKNOWN `no_anchor` |
| P16 | traveler | LIVE at hotel, anchor 6 h ago, no station data | 14 m | AT HOTEL | inside | UNKNOWN `anchor_expired` (or `band_too_wide`) |
| P17 | traveler | LIVE at hotel, `floor_consent:false` | 14 m | AT HOTEL | inside | NOT SHARED |
| P18 | traveler | LIVE at hotel, trace drifts above the roof | 14 m | AT HOTEL | inside | UNKNOWN `inconsistent_with_building` |
| P19 | traveler | LIVE at hotel, 0.8 hPa step in 2 s | 14 m | AT HOTEL | inside | UNKNOWN `sensor_jump` |
| P20 | traveler | LIVE, descending stairwell during the fire scenario (+3 m pressurization offset in the trace) | 25 m | AT HOTEL | inside | ±1 widening to ROUGH (fire mode) |
| P21 | traveler | LIVE, walking the route to the rally point (R10 "en route") | 10 m | OUTSIDE HOTEL | inside | UNKNOWN `not_at_lodging` |
| P22 | traveler | LIVE at a venue 2 km away (edge indicator, "Elsewhere") | 12 m | OUTSIDE HOTEL | outside | UNKNOWN `not_at_lodging` |
| P23 | chaperone | LIVE near P22 (second zone anchor) | 12 m | OUTSIDE HOTEL | anchor | UNKNOWN `not_at_lodging` |

**Barometer trace format** (prototype input, not a snapshot field; in production these become a mobile → Core ingest contract):
- Per person: `{ barometer_available, floor_consent, samples:[{t, rel_alt_m, pressure_hpa}], ground_truth:[{from, to, level}] }`.
- Sampling 1 Hz while moving, 0.2 Hz at rest **[A24]**.
- Each trace is the sum of:
  - True path: lobby → elevator ~1.5 m/s or stairs ~0.3 m/s → dwell.
  - White noise σ 0.3 m.
  - Random walk 0.1 m/√min.
  - Weather drift: a linear pressure tendency of −0.3 hPa/h (≈ +2.5 m/h apparent rise).
  - HVAC offset: +1.2 m on guest floors; +3 m in the stairwell when fire mode is active.
- The ground truth allows scoring. A real recording can replace any synthetic trace later: a sensor-logging phone app exporting time, relative altitude and pressure, walked through a real building with noted floors **[A25]**.

**Station pressure series** (mock): 10-min readings for a "KAUS-like" station 12 km away matching the weather drift, including one 90-minute gap. That gap forces `drift_corrected:false` and band widening.

**Hotel and building:**
- Real footprint with `building:levels` (e.g. 14; verify).
- Floor numbering `us`.
- Ground storey 4.5 m.
- One fixture variant with levels removed, to exercise σ_hf "no levels".

**Group zones:**
- Zone A (hotel, anchored on P01): `valid_for_seconds: 30`, so "Update overdue" appears 30 s after load.
- Zone B (venue, anchored on P23): `degraded: true`.

**Static geofence:** "Hotel perimeter" polygon. **Geofence events:** P03 exit 22:14 with no re-entry (R11), and an exit-then-enter pair for another traveler.

**Safety points (lodging-attached):**
- Active, one per category: `rally_primary`, `rally_secondary`, `safe_house` (`priority:'primary'`) and a second `safe_house` (`priority:'secondary'`), `relocation` (trip-wide, ~4 km away → edge bearing), `shelter`, `hospital`, `police`, `fire`, `embassy`/`consulate` (consulate stand-in; Austin has honorary consulates, verify).
- One `draft` rally point.
- One safe house with `coordinates: null`.
- One point with `approved_at` 14 months ago.
- One `chaperone_only` and one `org_internal`.
- **No pharmacy** (R7 gap), plus the `coverage_na` variant.
- One safe house about 60 m from the nearest road, to trigger the snap-distance APPROXIMATE flag.

**FIRMS mock detections:**
- A cluster of 3 `n` detections 2.4 km NW, 3 h old (R1 Warning-band test at 3 km).
- One `h` detection 0.8 km from the route to rally secondary (R2), 1 h old.
- One `l` detection (hidden by default).
- One detection 9 h old (STALE).
- One on an OSM industrial polygon (industrial caveat).
- One placed so that one safe house lies toward it and the other does not (R3).
- `scan`/`track` set to realistic values (0.38-0.8 km).

**Scripted feed and snapshot toggles (status rail tests):**
- FIRMS keyless (`503 no_key`).
- FIRMS proxy `stale:true`.
- Snapshot poll failure held for 60 s (all private layers drop to STALE).
- `source_issues: [{source:'geofence_violations', reason:'unavailable'}, {source:'safe_houses', reason:'row_limit', limit:5000}]`.
- Route upstream failure (`ok:false`).
- The DEMO watermark is always on in sample mode.

**Incident:** an operator-entered fire on level 5, used to demo R15 with every partition group non-empty.

---

## 7. Assumptions

| ID | Assumption | How to retire it |
|---|---|---|
| A1 | A site radius of ~500 m covers the decisions made in the Twin (default group-zone radius is 400 m) | Validate against 01-operator-scenarios; measure render cost in 03-architecture |
| A2 | A hotel point within 30 m of a real OSM footprint can be matched to it | Sample 50 production `trip_lodging` rows against OSM |
| A3 | Safety-point review age over 12 months deserves an amber flag | Confirm with SafeTrekr analyst operations |
| A4 | An OSRM snap distance over 30 m makes route endpoints approximate | Sample snap distances on real lodging and rally pairs |
| A5 | FIRMS NRT data arrives ~3 h after acquisition outside the US/Canada URT product | Measure `fetchedAt − acqMs` from `/api/firms` over a week |
| A6 | CCTV frame age can be read from upstream response headers; provider image cadence is 1-5 min | Inspect Caltrans, TfL and Austin frame responses |
| A7 | 300 m is a useful radius for "eyes-on" cameras | Operator scenarios |
| A8 | Heat detections older than 6 h should read as STALE | Protective agent and operator feedback |
| A9 | Phone `accuracy` is roughly a 68 % confidence radius (platform convention) | Confirm for the iOS and Android location APIs the traveler app uses |
| A10 | A stopped phone resumes GPS after leaving a stop radius set in the traveler app (spec `2026-10-13-stopped-phone-location-design.md`, not present locally) | Read the traveler spec; state the radius in the STOPPED · CURRENT hover |
| A11 | All fusion distance and time thresholds (3/10/25 km fire, 1 km route buffer, M4.5/100 km, 10 min muster, 40 % congestion) are starting values | Tune with 01-operator-scenarios and post-trip reviews |
| A12 | Required safety categories per lodging: rally primary, hospital, police, one of safe house / shelter / relocation | SafeTrekr analyst standard |
| A13 | Requiring an explicit "verified" tick before acting on a C3 judgment is acceptable friction | Operator testing |
| A14 | EFFIS and Australian state fire feeds need legal review for commercial use | Legal review |
| A15 | A 60 s median at the first footprint dwell is a good lobby anchor | Real-building recordings (A25) |
| A16 | A station ≤ 25 km away and ≤ 60 min old corrects weather drift well enough | Compare corrected vs uncorrected error on recordings |
| A17 | Hotel ground storey ≈ 4.5 m; floor-to-floor 2.8-4.5 m | Spot-check with OSM `height` ÷ `levels` and hotel data |
| A18 | Error terms σ_sensor 0.5 m, σ_drift 0.4 / 1.5 m/h, σ_hvac 1.5 / 3.0 m, σ_hf 0.3-0.7 m/level | Calibrate against ground-truth recordings; adjust before any production claim |
| A19 | Anchor expiry at 4 h uncorrected / 12 h corrected | Recordings over long dwells |
| A20 | Raw pressure samples need not be retained after the estimate is computed | Privacy review with Core owners (tiers.sql policy) |
| A21 | iOS `CMAltimeter` relative-altitude updates may pause while the app is suspended; Android pressure sampling is constrained by background limits | Mobile spike in the production phase |
| A22 | KAUS (Austin-Bergstrom) is ~12 km from downtown and reports hourly METAR pressure | Check aviationweather.gov station metadata |
| A23 | Cities B and C with the stated OSM properties exist and are suitable | OSM survey before fixture authoring |
| A24 | 1 Hz moving / 0.2 Hz at rest is a realistic, battery-tolerable sampling plan | Mobile spike in the production phase |
| A25 | A sensor-logging phone app can export time, relative altitude and pressure for a ground-truth walk | Pick the app and test one export before relying on it |
