# 07 — Production delta: the mock fixture is the contract

Owner: Chief Technology Architect. Date: 2026-10-15. Companion to `03-architecture.md`.

**Purpose.** The prototype (gods-eye-view only) runs on `tripTwinDemoSnapshot()` mock data. This file traces each mocked field or behavior to where production gets it today. If the prototype passes, the work list for mobile-app, safetrekr-core and safetrekr-app-v2 is known, and **no field is renamed**.

**Naming rule** (from `safetrekr-core/docs/staff-operations.md`): participant freshness fields are camelCase (they reuse `location_freshness.to_payload`). Every other new field is snake_case. The fixture follows this exactly.

**Verification.** Each "today" claim was checked against code on 2026-10-15:
- `safetrekr-core` `develop` @ `d6e7001`, plus remote branch `origin/stopped-phone-staff-ops`
- `mobile-app` `develop`, plus remote `origin/stopped-phone-app`
- `safetrekr-app-v2` `develop`
- `gods-eye-view` `jesse/world-view-visual-layer` @ `d59ca04`

**Status vocabulary:**

| Status | Meaning |
|---|---|
| EXPOSED | Exists and is exposed in the snapshot |
| NOT-EXPOSED | Exists in the database but not in the snapshot |
| BRANCH | Implemented on an unmerged branch |
| UNUSABLE | Collected, but unusable for this purpose |
| NOT-COLLECTED | Not collected |
| PUBLIC | Public data fetched by gods-eye-view, not SafeTrekr data |
| SESSION | Operator input that is deliberately never stored |

---

## 1. Field-by-field inventory

### 1.1 Snapshot envelope and trip

| Mocked field / behavior | Used by (Trip Twin element) | Production source today (repo · file · field) | Status | Change needed per repo | Data-model / migration impact | Privacy / consent impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|---|
| `schema_version, generated_at, scope, capabilities, page, source_issues` | HUD freshness strip, "incomplete" suffix on counts | core · `src/services/staff_operations.py` `build_operations_snapshot` | EXPOSED | none | none | none | — | — |
| `trips[].id, title, destination, start_date, end_date, status, timezone` | HUD title, times shown in trip-local time | core · `staff_operations.py` `TRIP_COLUMNS` | EXPOSED | none | none | none | — | — |

### 1.2 Participants: identity and position (traveler-positions overlay, P0)

| Mocked field / behavior | Used by | Production source today | Status | Change needed per repo | Data-model / migration impact | Privacy / consent impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|---|
| `participants[].id, trip_id, user_id, name, role, status` | Pins, labels, HUD lists, entity id `person:${trip_id}:${id}` | core · `staff_operations.py` `PARTICIPANT_COLUMNS` → `_person()` (from `trip_participants`) | EXPOSED | none | none | Existing (staff scope) | — | — |
| `participants[].avatar_url` | Photo pins via `participantPins.createParticipantPinCache` | core · `staff_operations.py` reads `users.id,avatar_url` for the authorized roster | EXPOSED | none | none | Existing; gods-eye-view `participantPhotoUrl` allowlist | — | — |
| `participants[].coordinates {lat,lng}` | Pin placement on the heightfield; hotel containment | mobile · `lib/location/locationEvent.ts` `LocationPostBody.lat/lng` → core · `api/v1/routes/trips.py` `update_traveler_location` → `participant_locations.lat/lng` → `staff_operations.py` `LOCATION_COLUMNS` | EXPOSED | none | none | Existing | — | — |
| `participants[].accuracy_m` | Accuracy disc; inside / outside / uncertain test | mobile · `LocationPostBody.accuracy` → `participant_locations.accuracy` → `_person()` `"accuracy_m"` | EXPOSED | none | none | Existing | — | — |
| `participants[].capturedAt, locationAgeSeconds, isFresh, freshness, freshMaxAgeSeconds, staleAgeSeconds` | Age label; fresh / aging / stale styling via `model.js` `currentFreshness` | core · `src/services/location_freshness.py` `LocationFreshness.to_payload()` (camelCase) | EXPOSED | none | none | none | — | — |
| `participants[].presence, stationarySince, lastContactAt` | "Stopped but current" vs "did not answer" via `model.js` `derivePresence` | core `develop`: `participant_locations.stationary_since, last_contact_at` stored (migration `supabase/migrations/20261013170000_participant_locations_stationary.sql`; `trips.py` writes them). **Snapshot exposure only on `origin/stopped-phone-staff-ops`** (`_person` adds `presence`, `stationarySince`, `lastContactAt`; `LOCATION_COLUMNS` adds `stationary_since,last_contact_at,low_power_mode`). mobile `develop` **does not send** `stationary_since`; it is on `origin/stopped-phone-app`. | BRANCH (core column exists; snapshot and mobile sender unmerged) | core: merge `stopped-phone-staff-ops`. mobile: merge `stopped-phone-app`. gods-eye-view: none (`model.js` already reads these). | none (migration already applied) | Existing | S | Justin's branches |
| `participants[].battery_level, battery_state` | Person detail panel only (not on the hologram) | mobile `LocationPostBody.battery_*` → `participant_locations` → `LOCATION_COLUMNS` | EXPOSED | none | none | Existing | — | — |
| `participants[].group_zone_state` (`inside/outside/unknown`), `group_zone_ambiguous` | "Outside group zone" count and chevron; label via `boundaries.js` `groupBoundaryLabel` | core · `staff_operations.py` `_group_zone()` → `evaluate_containment(...)` per current trip | EXPOSED | none | none | Existing | — | — |
| GPS `altitude` | **Not used.** The floor comes only from `floor_estimate`. | mobile `LocationPostBody.altitude` → `participant_locations.altitude` (`trips.py`, ~line 5099). Not in `LOCATION_COLUMNS`. No `altitudeAccuracy` sent. | UNUSABLE (10-30 m error, worse indoors) | none. Do **not** expose. | none | Exposing it would add vertical location without benefit | — | — |

### 1.3 Zones, geofences and events

| Mocked field / behavior | Used by | Production source today | Status | Change needed per repo | Data-model / migration impact | Privacy / consent impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|---|
| `group_zones[] {trip_id, model, radius_m, centers[], valid_for_seconds, degraded}` | Group-zone rings on the hologram; "update overdue" dashing (`boundaryIsDelayed`) | core · `staff_operations.py` `_group_zone()` | EXPOSED | none | none | Existing | — | — |
| `geofences[] {id, trip_id, name, type, category, center_lat, center_lng, radius, polygon, source_type, active}` | Lodging safe-zone ring and fixed boundaries via `tripBoundaries` | core · `staff_operations.py` `geofences = read("geofences", "id,trip_id,name,type,category,center_lat,center_lng,radius,polygon,source_type,active")` | EXPOSED | none | none | Existing | — | — |
| `geofences[].source_id` (links the lodging safe zone to `places[].id`) | Picks *this hotel's* safe-zone ring; "exited Hotel Safe Zone" chips | core · column `geofences.source_id` exists (written by `src/services/geofence_sync.py` `sync_lodging_geofence`: `source_type: "location"`, `source_id: location_id`, `DEFAULT_LODGING_RADIUS = 400`); **not in the snapshot `read()` column list** | NOT-EXPOSED | core: add `source_id` to the geofences column list | none | none | S | ASSUMPTION D-1: `source_id` equals `trip_lodging.id` (`geofence_sync` reads a `location` record with `type == "lodging"`; confirm it is the same id the snapshot uses for `places[].id`) |
| `geofence_events[] {id, trip_id, participant_id, geofence_id, geofence_name, direction, timestamp, coordinates}` | Recent enter/exit chips | core · `staff_operations.py` reads `geofence_violations` (last 24 h) | EXPOSED | none | none | Existing | — | — |

### 1.4 Places and safety points

| Mocked field / behavior | Used by | Production source today | Status | Change needed per repo | Data-model / migration impact | Privacy / consent impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|---|
| `places[] {id, trip_id, kind:'lodging', name, address, lat, lon, coordinates, checkin_date, checkout_date, phone}` | Twin center, Overpass query origin, hotel footprint match by name | core · `staff_operations.py` reads `trip_lodging` `id,trip_id,name,address,lat,lon,checkin_date,checkout_date,phone`, adds `kind`, `coordinates` | EXPOSED | none | none | Existing (business phone, not participant contact) | — | — |
| `places[].participant_ids` (guests assigned to this lodging; name mirrors `flights[].participant_ids`) | HUD "Assigned here 18 · Fix inside 12 · …"; who should be in this hotel | app-v2 · `src/shared/api/supabase/lodging-guests.ts` (`lodging_guests.lodging_id, participant_id`); core · migration `migrations/20260526_st1803_lodging_guests_rls.sql`. Not read by `staff_operations.py`. | NOT-EXPOSED | core: `read("lodging_guests", "lodging_id,participant_id", key="lodging_id", values=lodging ids)`, then attach the list to each place | none | Low (roster association already visible to staff) | S | ASSUMPTION D-2: `lodging_guests.participant_id` = `trip_participants.id` (the snapshot's `participants[].id`) |
| `places[].levels_above_ground, floor_height_m, lobby_height_m, ground_floor_label` | Floor slabs; floor-band conversion; numbering label (US 1 vs UK/EU 0) | Nothing. `trip_lodging` columns are `id, trip_id, name, address, lat, lon, phone, email, website, stars, opening_hours, checkin_date, checkout_date, notes` (app-v2 `src/shared/api/supabase/trip-lodging.ts` `TripLodgingRow`). The prototype reads OSM `building:levels`/`height` instead. | NOT-COLLECTED | core: migration + `read` columns. app-v2: `TripLodgingRow`/`Insert`/`Update` types + analyst lodging form fields. gods-eye-view: none (fixture already uses these names; OSM is the fallback). | `ALTER TABLE trip_lodging ADD COLUMN IF NOT EXISTS levels_above_ground smallint, floor_height_m numeric(4,2), lobby_height_m numeric(4,2), ground_floor_label smallint CHECK (ground_floor_label IN (0,1))`. All nullable, no default, no backfill. | none | M | — |
| `safety_points[] {id, trip_id, location_id, category, source, name, address, coordinates, contact, instructions, approval_status, priority, visibility, chaperone_only}` | Ring hotspots, rim indicators, route destinations, "draft" grey state | core · `staff_operations.py` → `safety_points_aggregator._map_rally_rows / _map_safe_house_rows / _map_relocation_rows / _map_poi_rows` → `models/safety_point.py` `SafetyPoint` | EXPOSED | none | none | Existing | — | — |

### 1.5 Floor estimation (mock in the prototype; next phase in production)

| Mocked field / behavior | Used by | Production source today | Status | Change needed per repo | Data-model / migration impact | Privacy / consent impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|---|
| `participants[].floor_estimate` (object, schema in `03-architecture.md` §6.4: `status, unknown_reason, place_id, level_likely/low/high, label_likely/low/high, ground_floor_label, height_above_ground_m, sigma_m, confidence, sample_at, anchor_at, basis, levels_basis, model_version`) | Floor bands; incident-floor counts (Above / On ±1 / Below / Unknown) | Nothing. The barometer is read nowhere (`mobile-app/package.json` has no `expo-sensors`; there are no barometer references in `lib/` or `providers/`). | NOT-COLLECTED | mobile: capture pressure (rows below). core: tables, `floor_estimate.py` (Python port of `floor-v1`, must pass `scripts/fixtures/trip-twin/floor-vectors.json`), snapshot attach. gods-eye-view: none (reads the same object). | New tables `participant_vertical_anchors`, `participant_floor_estimates` (below). **Not** columns on `participant_locations`, which is in the `supabase_realtime` publication (`20261012_st2090`), so its columns reach phones. | **High.** Floor-level location of travelers, often minors. Needs separate consent, a DPIA, staff-only exposure, 24 h retention, off by default in the UI. | L | Prototype pass; field test (`03` §11.6); DPIA |
| Mock barometer trace sample `{t, pressure_hpa}` | Input to the estimator (fixture-side only) | Nothing | NOT-COLLECTED | mobile: additive `LocationPostBody` fields `pressure_hpa: number\|null`, `pressure_captured_at: string\|null` (ISO `Z`), `barometer: 'available'\|'unavailable'\|'denied'\|'not_sampled'`. `schema_version` stays 1 (same additive pattern as ST-2034 battery; the server reads the body with `.get()`). One-shot read at capture time next to the battery read, before `buildLocationPostBody`. Offline queue replays the body verbatim (no change). core: `update_traveler_location` reads the keys, validates (800-1100 hPa, `pressure_captured_at` within 10 s of `captured_at`), and hands them to the vertical service. **Not** written to `participant_locations`. | none on the location row | New iOS prompt: `NSMotionUsageDescription` (CMAltimeter needs Motion & Fitness; `app.config.js` `infoPlist` has none today). Consent screen and toggle. | M | `expo-sensors` (SDK 54) spike for background reads (A-8) |
| Sampling gate: "only while a trip is active and near a lodging" | Ensures no pressure data away from lodging | mobile · `lib/location/tripWindowStore.ts` (trip active); `lib/geofencing/types.ts` (geofence categories include `lodging`, `safe_zone`) | NOT-COLLECTED (the gate inputs exist; the gate does not) | mobile: gate the read on active trip + inside or within 250 m of a lodging/safe-zone geofence + consent. core: **re-enforce server-side**. Drop pressure when the fix is > 250 m from every lodging of the trip (minimization does not trust the client). | none | Reduces collection to the purpose | S | — |
| Anchor `{t, pressure_hpa, ground_m, kind:'outdoor_approach'}` | Calibration zero for the band | Inputs exist: `participant_locations.lat, lng, accuracy, speed` (`trips.py` writes `speed`); lodging `trip_lodging.lat/lon`. No anchor concept. | NOT-COLLECTED | core: the vertical service applies the anchor rule (fix 30-150 m from the lodging point, accuracy ≤ 20 m, speed > 0.5 m/s, in the 3 min before the first fix within 30 m). Re-anchor on each re-entry. The prototype uses the **same rule and inputs**. | `participant_vertical_anchors` (PK `trip_id, user_id, place_id`): `anchor_pressure_hpa numeric(6,2), anchor_at timestamptz, anchor_ground_m numeric(7,2), anchor_kind text, reference_pressure_hpa numeric(6,2) null, reference_source text null, created_at timestamptz`. Upsert. RLS on, no `authenticated` policy, not in realtime. | Stores one pressure value + time per traveler per hotel; purged ≤ 24 h | M | Pressure capture |
| `anchor.ground_m`, `entrance_ground_m` (terrain at anchor and hotel) | Corrects for sloped streets | gods-eye-view · `/api/terrain/heights` (`server/providers/terrain.js`, Re:Earth). Core has no terrain lookup. | NOT-COLLECTED (in Core) | core: small client for Re:Earth `heights.json` (keyless, CC BY 4.0), cached per lodging; or an analyst-entered entrance elevation | Optional cache table or Redis key (existing `CacheClient` pattern in `safety_points_aggregator.py`) | none (public data) | S | — |
| Drift reference `reference[] {t, pressure_hpa, source:'peer_outdoor'\|'weather'}` | Narrows σ over time | Peers: other travelers' pressure samples. Not collected until pressure capture ships. Weather: no integration exists. | NOT-COLLECTED | core: peer reference = same-trip outdoor samples within 1 km / 30 min, ground-corrected. Weather trend source to be chosen: Open-Meteo **commercial** plan (its free API is non-commercial) or another provider; most non-US METARs report QNH in whole hPa, which is too coarse. | none (computed on the fly) or a small hourly cache | Peer samples are already covered by the same consent | M | Pressure capture |
| `floor_estimate` computation (`floor-v1`) | Floor bands | Prototype: `gods-eye-view/src/operations/floorEstimate.js` (pure, JSON in/out) | NOT-COLLECTED in Core | core: `src/services/floor_estimate.py` port; golden vectors shared verbatim; `model_version` carried on the wire | `participant_floor_estimates` (PK `trip_id, user_id`): `place_id uuid, sample_pressure_hpa numeric(6,2), sample_at timestamptz, height_above_ground_m numeric(6,2), sigma_m numeric(5,2), level_low smallint, level_likely smallint, level_high smallint, confidence text, status text, unknown_reason text, levels_basis text, model_version text, computed_at timestamptz`. Upsert, no history. RLS on, service role only, not in realtime. Hourly purge of rows older than 24 h or trips ended > 24 h. | Retention ≤ 24 h; never visible to travelers, chaperones on mobile or guardians in this phase | L | Anchor, lodging metadata (optional) |
| Snapshot exposure of `floor_estimate` | World View twin | core · `staff_operations.py` | NOT-COLLECTED | core: `read("participant_floor_estimates", …, key="trip_id")` for the authorized page; attach to `_person` output as `floor_estimate` (snake_case object); a read failure appends `{"source": "participant_floor_estimates", "reason": "unavailable"}` to `source_issues` (existing `_read` behavior) and the twin shows "Floor unknown: source unavailable" | none beyond the tables | Same role gating as positions (`operations_scope`: platform HQ or org admin / security officer) | S | Tables |
| Consent off → `floor_estimate.status='unknown', unknown_reason='consent_off'` | Honest "floor unknown" | Nothing | NOT-COLLECTED | mobile: toggle sends `barometer: 'denied'` and stops reading. core: delete the anchor and estimate on `denied` and return `consent_off`. | none | Revocation honored immediately | S | Consent screen |

### 1.6 Data gods-eye-view fetches or derives itself (no other repo changes)

| Mocked field / behavior | Used by | Production source today | Status | Change needed per repo | Data-model / migration impact | Privacy / consent impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|---|
| OSM buildings, hotel footprint, entrances, streets | Hologram, containment, route origin | gods-eye-view · `server/providers/local.js` `overpassProxy` (`/api/overpass`) | PUBLIC | gods-eye-view only (prototype). P1: Overpass disk cache to `/tmp` on Vercel. | none | ODbL attribution | — | — |
| Ground heightfield | All twin geometry | gods-eye-view · `src/data/terrainHeights.js` `resolveEllipsoidalGround` → `/api/terrain/heights` | PUBLIC | none | none | CC BY credit | — | — |
| Hotel containment `inside/outside/uncertain/not_current/not_assessed` | HUD counts, pin badges | Derived in the browser (`tripTwinData.hotelContainment`) | Derived; nothing stored | none. Deliberately not in Core (ADR-004). | none | Labeled "derived in browser, not an alert" | — | — |
| Routes (primary + alternate) | Route lines, distances | gods-eye-view · `server/providers/places/routes.js` (`alternatives=false` today) | PUBLIC | gods-eye-view: additive `alternatives=1` (H-9) | none | none | S | — |
| Fire detections | Fire discs, route hazard flag | gods-eye-view · `src/data/firmsHeatmap.js` `getAnalystRecords` | PUBLIC (needs `FIRMS_MAP_KEY`) | gods-eye-view: `setPresentationSuppressed` hook (H-8) | none | none | S | — |
| Simulated fire records (`?fire=1`) | Demo only | — | Demo only | Remove nothing; DEV-only | none | Labeled SIMULATED | — | — |
| Incident floor ("reported incident on floor n") | Above / On ±1 / Below counts | Operator input in the twin HUD | SESSION | none in this phase. A future Core "incident" object is out of scope. | none | Never stored | — | — |

---

## 2. Snapshot schema additions (all additive, v1 envelope unchanged)

| Path | Type | Null | Naming | Source |
|---|---|---|---|---|
| `participants[].presence` | `'moving'\|'stopped'\|'stopped_no_answer'` | yes | as on Justin's branch | merge `stopped-phone-staff-ops` |
| `participants[].stationarySince`, `lastContactAt` | ISO string | yes | camelCase (freshness family) | same |
| `participants[].floor_estimate` | object (§1.5) | yes (absent = not supported; `status:'unknown'` = supported but no estimate) | snake_case | new |
| `places[].participant_ids` | `string[]` | no (empty list) | snake_case, mirrors `flights[].participant_ids` | `lodging_guests` |
| `places[].levels_above_ground` | int | yes | snake_case | `trip_lodging` new column |
| `places[].floor_height_m`, `lobby_height_m` | number | yes | snake_case | same |
| `places[].ground_floor_label` | `0\|1` | yes | snake_case | same |
| `geofences[].source_id` | uuid string | yes | snake_case (DB column name) | add to the read |

gods-eye-view **feature-detects** each addition. A missing field means "not supported by this Core", which the UI renders as "not available" and never as a value. This is what keeps the prototype PR separable from the Core and mobile PRs.

---

## 3. Per-repo change lists, ordered by dependency

**Step 0: gates (no code in the other repos).**
- Prototype passes `03` §15.2.
- Real barometer recordings (CSV swap-in, `03` §6.3) in 3 hotels meet the field-test bar (`03` §11.6).
- A DPIA covering floor-level location of minors is signed off.

### safetrekr-core
| # | Change | Effort | Depends on |
|---|---|---|---|
| C1 | Merge `origin/stopped-phone-staff-ops` (presence trio in the snapshot) | S | — |
| C2 | `staff_operations.py`: add `source_id` to the geofences read; read `lodging_guests` → `places[].participant_ids` | S | verify D-1, D-2 |
| C3 | Migration `supabase/migrations/<ts>_trip_lodging_vertical_metadata.sql` (4 nullable columns, `SET lock_timeout = '5s'`, `IF NOT EXISTS`; `supabase/migrations/` is authoritative per ST-2045, `migrations/` is frozen); add the columns to the lodging `read` | S | — |
| C4 | `update_traveler_location` (`api/v1/routes/trips.py`): accept and validate `pressure_hpa`, `pressure_captured_at`, `barometer`; never write them to `participant_locations`; server-side lodging-proximity gate | S | — |
| C5 | Migration `<ts>_participant_vertical.sql`: `participant_vertical_anchors`, `participant_floor_estimates`, RLS enabled with no `authenticated` policies, explicit `REVOKE` from `anon, authenticated`, **not** added to `supabase_realtime`; plus a down migration (the repo pairs `.down.sql`, e.g. `20260731193000_st2050_*.down.sql`) | M | — |
| C6 | `src/services/floor_estimate.py` (Python `floor-v1`, passes the shared vectors), anchor rule, Re:Earth ground lookup, peer/weather drift reference, upsert of estimate | L | C4, C5 |
| C7 | Purge job (hourly) for both tables (≤ 24 h / trip end + 24 h); consent-off deletion | S | C5 |
| C8 | Snapshot: attach `participants[].floor_estimate`; `source_issues` on read failure; update `docs/staff-operations.md` and `openapi/` | S | C6 |

### mobile-app
| # | Change | Effort | Depends on |
|---|---|---|---|
| M1 | Merge `origin/stopped-phone-app` (sends `stationary_since`) | S | C1 for display |
| M2 | Add `expo-sensors`; config-plugin motion permission (`NSMotionUsageDescription`); spike the background read inside the location task (`lib/location/backgroundTask.ts`); fall back to a small Expo Module if needed | M | — |
| M3 | Consent screen + settings toggle ("floor estimate during emergencies, never your room"), persisted locally, sends `barometer:'denied'` when off | M | legal copy |
| M4 | One-shot pressure read beside the battery read; extend `LocationPostBody` / `buildLocationPostBody` in `lib/location/locationEvent.ts` with the three additive fields; tests in `lib/location/__tests__` (the null vs absent distinction, as with battery) | M | M2, M3, C4 |
| M5 | Gate: active trip (`tripWindowStore.ts`) + near a lodging/safe-zone geofence (`lib/geofencing`) + consent | S | M4 |

### safetrekr-app-v2
| # | Change | Effort | Depends on |
|---|---|---|---|
| A1 | Lodging metadata fields (levels above ground, floor height, lobby height, ground-floor numbering) in `src/shared/api/supabase/trip-lodging.ts` types and the analyst lodging form | M | C3 |
| A2 (P2, optional) | Analyst confirms the OSM footprint / entrance for node-only hotels | M | — |

### gods-eye-view (production switch)
| # | Change | Effort | Depends on |
|---|---|---|---|
| G1 | None needed to consume production data: the twin reads the same fields. Turn on `VITE_TRIP_TWIN` in production once Core fields ship; keep the fixture DEV-only. | S | C1-C8 |
| G2 | Show `source_issues` for `participant_floor_estimates` in the twin strip (existing pattern) | S | C8 |

---

## 4. Assumptions to verify before the next phase

| ID | Assumption | Check |
|---|---|---|
| D-1 | `geofences.source_id` for lodging safe zones equals `trip_lodging.id` | Query dev DB: join `geofences` (`source_type='location'`) to `trip_lodging` |
| D-2 | `lodging_guests.participant_id` = `trip_participants.id` | Schema review of `migrations/20260526_st1803_lodging_guests_rls.sql` and app-v2 usage |
| D-3 | Silent location checks (`kind: 'check'`) can carry a pressure reading on the stopped-phone path | mobile `stopped-phone-app` branch review |
| D-4 | The `expo-sensors` Barometer works in the iOS background-location task (same as A-8 in `03`) | Device spike |

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: production_delta
skills_used: [CTA-010 integration architecture, CTA-053 privacy by design, CTA-011 red-route prioritization, database and schema architecture]
services_defined: 4
adrs_created: 0
security_verified: true
cost_estimated: false
confidence: 0.8
open_questions: [D-1 geofence source_id mapping, D-2 lodging_guests participant id, D-3 checks carry pressure, D-4 iOS background barometer]
source_artifacts: [safetrekr-core/src/services/staff_operations.py (develop and origin/stopped-phone-staff-ops), safetrekr-core/src/services/location_freshness.py, safetrekr-core/src/services/geofence_sync.py, safetrekr-core/src/api/v1/routes/trips.py, safetrekr-core/supabase/migrations/20261013170000_participant_locations_stationary.sql, safetrekr-core/migrations/20261012_st2090_participant_locations_realtime.sql, mobile-app/lib/location/locationEvent.ts, mobile-app/app.config.js, mobile-app/package.json, mobile-app/lib/geofencing/types.ts, safetrekr-app-v2/src/shared/api/supabase/trip-lodging.ts, safetrekr-app-v2/src/shared/api/supabase/lodging-guests.ts, gods-eye-view/src/operations/{demo,model,boundaries}.js]
-->


## Phase 2 additions (prototype build, 15 Oct 2026)

| mocked field / behavior | used by | production source today | status | change needed | data-model impact | privacy | effort |
|---|---|---|---|---|---|---|---|
| `places[].room_assignments[] = {participant_id, floor_label}` (floor only, never a room) | Building cutaway, per-floor roster, EX-FLR-03 ("assigned above the reported floor, floor not detected") | none | not collected | safetrekr-core: new table `lodging_floor_assignments` (lodging_id, participant_id, floor_label, source, updated_at) exposed in the staff snapshot; safetrekr-app-v2: analyst entry / import from hotel rooming list; mobile-app: optional chaperone check-in form | new table + snapshot field | floor is less sensitive than room; staff-only, trip-scoped, deleted with the trip | M |
| Weather now / warnings via `/api/twin-weather/*` | Weather chip, official slot, EX-WX rules | none | not collected | gods-eye-view server: weather ingest/proxy service with caching and attribution (see WEATHER-SOURCES.md) | none in Core | none | M |
| Lightning "strikes" from the nowCOAST / MTG-LI **density raster** (non-empty cells → points) | EX-WX-01 distance, edge chip | none | prototype approximation | production: GOES GLM / MTG-LI individual flashes (time + position) so the rule uses real strike age and position, not an 8 km / 2 km grid cell | none in Core | none | M |
| "Outdoors at a gathering point" = ≥ 3 current people within 75 m of the hotel-card assembly point or a rally point | EX-WX-01 | hotel card is mock; rally points exist (safety_points) | partial | production: assembly point from the hotel card (Core field), plus venue outdoor areas from phase 3 sites | hotel card field | none beyond existing positions | S |
| "Outside for N min" for EX-WX-02 = minutes since the incident report | EX-WX-02 | none | prototype approximation | production: per-person outdoor dwell from geofence exit events or presence state history | none (derived) | derived from existing positions | S |
| NWS polygon "warning walls" | Weather official slot | NWS zone alerts carry no geometry | not built | fetch zone geometry (`/zones/...`) and cache; draw walls only when the site is inside or within 10 km | none | none | S |
| Weather credits per layer (IEM, NOAA nowCOAST/MRMS, EUMETSAT, MeteoAlarm) | Sources line, Layers notes | n/a | partial (footer credits MET Norway only; layer notes name the source) | add each layer's credit to the footer while that layer is on | none | none | S |

## Phase 3 additions (prototype build, 15–16 Oct 2026)

| mocked field / behavior | used by | production source today | status | change needed | data-model impact | privacy | effort |
|---|---|---|---|---|---|---|---|
| `places[]` of `kind: 'venue'` with `site_key`, `visit_date`, OSM id, levels, ground-floor label | Sites, switcher, beacons, per-site counts | Core sends venues + itinerary coordinates; no OSM id / levels | partial | enrichment job: match each venue to an OSM building (id, levels, height), store on the place; operator can correct | 3 nullable columns on places | none | M |
| `itinerary[]` with `place_id`, `start_time`, `end_time` | Advance timeline, brief, "Day N" labels | itinerary exists in Core | available | ensure every stop links to a place id | none | none | S |
| Per-site safety points (`location_id` = venue place id) | Venue rally points, brief rally status, routes | `venue_pois` exist; rally per venue not modelled | partial | rally/assembly point per venue (approval status) in app-v2 | `location_id` already on safety points | none | S |
| Operator floor numbering `{ground_floor_label, levels_above_ground, levels_source:'operator', entered_by, entered_at}` | Numbering prompt, at-or-above, Floors | none | prototype: browser storage | place fields + audit; shown as "operator entry, not verified" everywhere the count is used | 4 nullable columns + audit row | operator id stored | S |
| Advance checklist and notes `{site, day, item, checked_by, checked_at, note}` | Advance panel, copy brief | none | prototype: session only | new table per trip/site/day; included in the advance brief export | new table | staff only | M |
| Driving routes (`/api/route?profile=car`) | Route from any place | FOSSGIS routing.openstreetmap.de (fair use only) | prototype | own routing service (self-hosted OSRM or Valhalla); traffic provider if wanted | none | none | M |
| Forecast at event time (MET Norway full series, per site) | Advance brief | proxy returns the full series | prototype | `/api/twin-weather/now?time=` summarised server-side; cache per site | none | none | S |
| Sample trip dates shifted to start today | Advance demo | n/a | prototype only | real trips use their own dates | none | none | — |
| Site anchors (`computeAnchors`) | Demo placement only | n/a | prototype only | not needed in production (real positions) | none | none | — |

## Phase 4 additions (prototype build, 16 Oct 2026)

| mocked field / behavior | used by | production source today | status | change needed | data-model impact | privacy | effort |
|---|---|---|---|---|---|---|---|
| Saved paths `{id, trip_id, name, day, profile, from/to labels, points[], area_ids[], endpoint_area_ids[], geometry, distance, duration, engine, notes, saved_by, saved_at, reviewed_by, reviewed_at}` | Path editor, Layers › Saved paths, advance brief | none | prototype: browser storage per trip | new table `trip_paths` (geometry as GeoJSON LineString), versioned (an edit clears the review) | new table | staff only | M |
| Avoid-areas `{id, trip_id, center, radius_m, reason, note, added_by, added_at}` | Path editor, map, brief | none | prototype: browser storage per trip | new table `trip_avoid_areas`; later polygons, time windows (event crowds) | new table | staff only | S |
| Routing with waypoints and avoid-areas (`POST /api/twin-path`) | Path editor | FOSSGIS Valhalla public instance (fair use) | prototype | own Valhalla instance (supports `exclude_polygons`, through-locations); OSRM stays as fallback | none | none | M |
| Review of a saved path | Saved path card, brief | none | prototype: "you" + time | reviewer identity from staff auth; review history | column + audit | staff only | S |

## Phase 5 additions (panel clarity + phase-4 deferred, 16 Oct 2026)

| Area | Prototype | Production |
|---|---|---|
| Street names for waypoints | Site's OpenStreetMap streets first; else `/api/twin-place` → Nominatim reverse (≤ 1 req/s, cached ~10 m) | Own geocoder (Nominatim/Photon self-hosted) or a licensed one; never send traveler positions |
| Out / back legs | `trip_paths.event_id`, `trip_paths.leg ('out'|'back')`; times derived from the event and the router duration | Columns on `trip_paths`; event end times required for back legs |
| Chaperone sharing | "Copy for chaperones" on reviewed paths only; `sharedBy` stamp; nothing sent | Send through the trip's chaperone channel; only reviewed paths; re-share needed after a new review |
| Undo delete | 10 s toast, browser only | Soft delete (`deleted_at`) with restore |
| Storage | `tripTwin.paths.{trip_id}.{site}` in the browser (old per-site key migrated) | `trip_paths` / `trip_avoid_areas` keyed by trip id (as phase 4) |
| Hospital on a person path | Nearest listed hospital to the person among all on file; ED status from OpenStreetMap `emergency=yes` (unverified) | Analyst-verified medical facilities per trip, ED status verified |
| Copy path summary | Clipboard only, first name + initial, no coordinates | Same rule in any export |

## Phase 6 additions (weather in 3D and a timeline, 16 Oct 2026)

| Area | Prototype | Production |
|---|---|---|
| 3D rain / snow / clouds / haze | Browser particles and clouds from the MET Norway site forecast; location from radar / forecast map frames | Same client; a server-side weather service caches frames per trip site and serves one bundle (no per-viewer calls to IEM / DWD / EUMETSAT) |
| Past frames | IEM NEXRAD WMS-T (US, 5 min); EUMETSAT H SAF (Europe, ~1 h behind, gaps) | Ground radar for Europe (OPERA, licence check) or a commercial nowcast; frames stored for incident review |
| Forecast map | NOAA HRRR via IEM (US, 15 min to +18 h); DWD ICON-EU (Europe, hourly to +78 h) | Same models ingested server-side (GRIB), plus minute-scale nowcasts; model run shown everywhere |
| Timeline state | Per viewer, not shared; snaps to now when an incident arrives | Same rule; forecast views never sent to responders without "forecast" on every line |
| Attribution | Credits line lists every source on screen | Same, per frame |


## Phase 10 — SOC multi-view (wall screens + remote)
The prototype uses a dev-server WebSocket relay (`server/tripTwin/syncRelay.js`): plain `ws`, LAN only, no sign-in, 4-digit pairing codes, a QR setup token valid for 10 minutes, and one controlling remote at a time (30 s lease, hand-over). Production needs:
- TLS (`wss`), device enrolment with per-device keys and revocation, operator SSO, a per-site allow-list.
- Signed commands and an append-only audit log of every push (who, what, which screens, undo).
- A session service (not the dev server) holding session and screen state, with presence and alerting when a wall screen drops.
- Wall rendering budget: six 3D screens on one machine need a GPU per one or two screens or a render server; screens without 3D (incident board, trips) should not load Cesium at all (today they load it and pause the render loop).
- Multi-trip data from Core for Trips on watch (today: three sample trips from recorded cities).


## Phase 11 — polish: Instrument skin, motion tiers (16 Oct 2026)
| Mocked or local behaviour | Used by | Production source today | Status | Change needed | Effort |
|---|---|---|---|---|---|
| Motion tier switches per wall (`screens[n].motion`) | Walls, remote 06 Layers | None | Prototype only | Store with the wall session in the SOC service; audit who changed a tier and when | S |
| Motion switches on the All-in-one (`tripTwin.motionLive/Event/Cine`, localStorage) | Display popover | None | Device preference | Keep per device; no server state | — |
| Change log for the S3 idle board (count and attention deltas from the data tick) | S3 idle board | None (the snapshot has no change feed) | Derived client-side | Core: a change feed per trip (counts, attention transitions) with server timestamps, so every wall shows the same log | M |
| Idle drift on the Site wall | S1 under the Cinematic tier | None | Client only | None; a production SOC may disable the Cinematic tier by policy | — |
| Fonts from Google Fonts (Inter, Manrope, Intel One Mono) | Every page | CDN | Prototype | Self-host the three faces in the app's static assets (offline SOC) | S |
