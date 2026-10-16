# Trip Twin: shared brief for every agent

Read this whole file before writing anything. Write ONLY your own section file in this folder. Do not edit any code repository.

## The idea
SafeTrekr staff use "World View", a fork of the open-source God's Eye View globe (CesiumJS, vanilla JS, Vite). Repo: /Users/jessetarvambp1/Sites/Safetrekr/gods-eye-view, branch `jesse/world-view-visual-layer` (built on Justin Tabb's `stopped-phone-world-view`). It shows trips, travelers, flights, alerts, public live layers (aircraft, ships, fires, quakes, cameras) on a photorealistic globe.

New feature, working name **Trip Twin**: a staff member picks a trip's hotel (lodging). The photoreal city falls away and the hotel and surrounding blocks become a translucent, glowing 3D hologram they can orbit. They toggle purposeful layers on top: escape/evacuation routes, venues, hospitals, police, fire stations, pharmacies, embassies/consulates, shelters, rally points, safe houses, relocation sites, live fire detections, traveler positions.

It must feel INCREDIBLY futuristic, like stepping into the future, almost sci-fi. BUT every element on screen must have a purpose. The main goal: the operator can quickly analyze a situation and make a decision. It is the first building block of a future SafeTrekr Security Operations Centre (SOC).

## Design rule (non-negotiable)
Every on-screen element must answer at least one operator question:
1. Where are my people?
2. What is the threat, and where?
3. Where is safety?
4. How do they get there?
5. How fresh and trustworthy is this information?
Anything that answers none of them is cut.

## Visual reference: Rolls-Royce "future shore control centre" concept film (2016, VTT + Univ. of Tampere research)
Frame contact sheets are in ./reference/ (sheet_*.jpg = 4:45-5:40 at 3s; full_s_*.jpg = 0:00-4:44 at 4s). Look at them.
- 0:00-0:20 photoreal control-centre building dissolves into a blue wireframe x-ray showing its interior. (The photoreal-to-hologram transition we want.)
- 0:24-1:32 operator at a curved world-map wall; alert "DGPS lost connection for vessel RR-9835", with a suggested course of action. Glass HUD status "NOMINAL".
- 1:36-2:20 eye-tracking/gesture control; drones launched with live + thermal feeds; a small hologram ship floats near the operator.
- 2:24-3:44 supervisors: touch map wall, procedure index/checklist on tablet, on-duty roster.
- 3:48-4:51 "Situation handling" screen pulls named specialists into the incident (collaboration).
- 4:54-5:45 KEY SCENE: physical ship model on a table becomes a translucent blue x-ray hologram on a grid table; yellow circular ring hotspots on components; engineer pulls the engine out of the ship and inspects it exploded in his hand, then returns it.
Design takeaways: subject isolated and surroundings dimmed; monochrome translucent blue, glowing edges; grid ground plane; yellow ring hotspots; drill-down into a component; calm, dark room.

## What already exists in code (reuse, don't reinvent)
- gods-eye-view/src/mapStartup.js: Google Photorealistic 3D Tiles (one continuous textured mesh, no per-building features) when a Google key is set; otherwise satellite globe.
- gods-eye-view/src/annotations/worldAnnotationRenderer.js: highlights a single building with an extruded, pulsing "classification" volume over the 3D tiles; dashed outline for approximate/synthesized footprints, solid for real ones.
- gods-eye-view/src/annotations/annotationResolver.js + server/providers/local.js: cached OpenStreetMap Overpass proxy (/api/overpass) resolving building footprints and heights, with retry/rate-limit handling.
- gods-eye-view/server/providers/places/routes.js: OSRM routing via FOSSGIS (walking/driving), cached, rate-limited.
- gods-eye-view/src/operations/: Justin's World View. globe.js (trip markers: places, itinerary, safety points, boundaries, participant photo pins), main.js, worldControls.js (world layer toggles), visualModes.js (whole-globe shader modes: night vision, FLIR, CRT, etc.), defaultLayers.js (independent layer loading with Promise.allSettled), alertsPanel.js, actions.js (broadcast + "direct group to destination").
- Live public layers already present: FIRMS satellite fire detections, earthquakes, aircraft, AIS ships, traffic, CCTV cameras.
- safetrekr-core/src/services/staff_operations.py builds the read-only snapshot World View consumes: trips, participants (with location freshness), flights, places (kind = lodging | venue, with name, address, lat, lon), itinerary, safety_points, geofences, geofence_events, group_zones, musters, alerts, source_issues. Safety points are attached per lodging/venue.
- safetrekr-core/src/models/safety_point.py categories: rally_primary, rally_secondary, safe_house, hospital, police, fire, pharmacy, embassy, consulate, shelter, relocation, other.
- safetrekr-core/docs/staff-operations.md: access rules (org admins, security officers view-only, HQ staff), privacy (no medical/contact data), freshness, source_issues ("read counts must not be presented as an all-clear").

## Known constraints
- Google 3D tiles may not be exported, cached offline, or modified (Map Tiles API terms). The hologram must be built from OpenStreetMap data (ODbL, attribution required), not from Google meshes.
- OSM building heights are often missing; fallback = building:levels x ~3 m, else a default, and approximate geometry must be visibly marked as approximate.
- No available source has indoor data (stairwells, exits, floors). Outdoor routes are feasible now; indoor routes need a new data source (floor plans) later.
- The layer must be off by default and must not change anything for existing World View users when off.
- Prototype first, on Jesse's branch, as a PR to Justin. Plan documents live here, outside every repo.
- Runs in a desktop browser today; a large SOC wall display is the future target.

## Output files (one per agent)
01-operator-scenarios.md (protective agent) | 02-layer-catalog.md (risk analyst) | 03-architecture.md (CTA) | 04-screen-spec.md (interface architect) | 05-motion-language.md (motion designer) | 06-layer-taxonomy.md (information architect) | PROJECT-PLAN.md (product owner)

Writing style for all files: plain, specific, decision-oriented. Use tables for catalogs. No filler. Mark every assumption as an assumption.

## REQUIRED LAYER (added by Jesse after kickoff)
**Traveler positions overlay is mandatory, P0.** The Trip Twin must show exactly where each traveler and chaperone is, placed on the hologram (street level, and inside/outside the hotel footprint where the data supports it). Source: snapshot `participants` (positions with location freshness via location_freshness.evaluate_freshness, avatar_url photo pins, role traveler/chaperone), plus group_zones, geofences and geofence_events. Existing rendering to reuse: gods-eye-view/src/operations/participantPins.js and globe.js. "Exactly" must be honest: show each person's last-fix age and accuracy (uncertainty radius where available), distinguish live vs stopped-but-current vs stale, never imply precision the data doesn't have, and never show a room. Floor is shown only as a labeled estimate (see FLOOR ESTIMATION below). Who is inside vs outside the hotel, and who is outside their group zone, are primary at-a-glance answers.

## FLOOR ESTIMATION (added by Jesse, IN SCOPE FOR THIS PHASE)
Jesse decided floor estimation is part of this phase: even an approximate floor helps responders (e.g., who is above a fire floor during an evacuation). Same physics as US E911 vertical (z-axis) location, which uses phone barometers.
Facts verified in our repos:
- mobile-app (Expo, expo-location ~19) already sends GPS `altitude` with each location event (mobile-app/lib/location/locationEvent.ts, lib/supabase/client.ts); Core stores it (safetrekr-core/src/api/v1/routes/trips.py). GPS altitude is too coarse for floors (often 10-30 m error, worse indoors). altitudeAccuracy is not sent. The barometer is not read anywhere. The staff operations snapshot does not expose altitude.
Approach to plan for:
- Mobile: read the barometric pressure sensor (iOS CMAltimeter relative altitude; Android pressure sensor via an Expo sensors package or native module), sampled only while a trip is active and the traveler is inside/near a lodging geofence, battery-aware, background-limit-aware.
- Calibration: anchor ground level when the traveler crosses into the lodging geofence / passes the lobby; re-anchor on each re-entry; correct drift with public weather-station pressure where available. Building HVAC offsets are a known error source.
- Core: store pressure/relative-altitude samples and compute floor estimate = f(height above anchor, ground elevation, floor height from OSM building:levels or default ~3-3.5 m, lobby/mezzanine allowance), with a confidence band and age. Expose in the snapshot under existing access rules.
- World View: show floor as a band/range on the hologram (e.g., "likely 7, ±1", with age and confidence), never a bare number, never a room. Floors above/below a reported incident floor are a key at-a-glance answer.
- Privacy: floor-level location is more sensitive; requires consent copy, same role gating as positions, short retention, no new data to non-staff.
- Honest failure: unknown floor count, no recent anchor, Android phones without a barometer, stale data -> show "floor unknown", never a guess dressed as fact.

## PROTOTYPE DATA STRATEGY (decided by Jesse; overrides earlier scope notes)
The prototype uses MOCK DATA ONLY and touches ONLY gods-eye-view. No mobile-app or safetrekr-core changes in the prototype.
- Follow Justin's existing demo pattern: gods-eye-view/src/operations/demo.js (`demoSnapshot()`, "Explore a sample trip" button, fictional fixtures, "never fetched from production"). Add a Trip Twin sample trip in the same style and same snapshot shape.
- City: a real city with a real hotel building so the hologram uses real OpenStreetMap buildings and real nearby hospitals/police/fire stations. Default: Austin, TX (matches Justin's existing demo). Verify OSM footprint/height coverage for the chosen hotel. Two more cities are needed for the pass bar.
- Travelers: fictional people with realistic positions inside and around the hotel, realistic accuracy radii and fix ages, covering fresh, aging, stale, stopped-but-current, unknown, outside-group-zone.
- Floor estimation in the prototype: mock barometer traces (relative altitude over time with realistic noise, weather drift and an HVAC offset), replayed as if from phones, with the floor-estimate logic running client-side in the prototype. A real recording from a sensor-logging phone app walking a real building (with noted ground-truth floors) can be swapped in later to measure accuracy.
- No real traveler data in fixtures, ever.
- The production path (mobile barometer capture, Core storage/calibration, snapshot exposure) is the NEXT phase, planned but not built now, and gated on the prototype's results.

## MOCK DATA = THE CONTRACT (purpose of the mock approach)
The mock fixture is deliberately the specification for production. Every field the prototype mocks must be traceable to where production will get it, so that if the prototype works we know exactly what to change in the other apps.
Required deliverable: **07-production-delta.md** (owned by the architect), a field-by-field inventory:
| mocked field / behavior | used by which Trip Twin element | production source today (repo + file + field) | status: exists and exposed / exists but not exposed in the snapshot / collected but unusable / not collected | change needed per repo (mobile-app, safetrekr-core, gods-eye-view, safetrekr-app-v2 if relevant) | data-model/migration impact | privacy/consent impact | effort (S/M/L) | depends on |
Then a per-repo change list (what mobile-app must add, what safetrekr-core must add, what the snapshot schema must add), ordered by dependency. The mock fixture's field names should match the snapshot's existing naming (camelCase participant freshness fields, snake_case elsewhere, per safetrekr-core/docs/staff-operations.md) so nothing is renamed later.

## COLOR AND BRAND (decided by Jesse)
Use SafeTrekr's own brand colors. The Rolls-Royce film is a reference for composition, materials and motion ONLY; do not copy its blue/yellow palette.
Source of truth: safetrekr-app-v2/docs/design-tokens.md and safetrekr-app-v2/src/app/globals.css (also mobile-app/design-tokens/tokens.ts). Key tokens (dark theme, which suits an operations screen):
- Background #061a23, card #07212c, border #1e404f, muted #2a4a59, ring/secondary #365462, secondary #123646.
- Brand primary green #4ba467. Green ramp (chart): #edf6f0, #c9e4d1, #81bf95, #4ba467, #2f7e48.
- Slate-teal ramp (light chart): #b8c3c7, #80959b, #415e6b, #2a4a59, #123646.
- Semantic: destructive #ee7789 (dark) / #c1253e (light); warning #f59e0b / #f97316; success #4ba467; info #2a4a59 (light) / #3b82f6 (dark).
- Typography: Inter (sans), Intel One Mono (mono, good for HUD readouts).
Justin's World View (gods-eye-view/src/operations/operations.css) already uses a muted green-teal and amber palette (e.g. #77c798, #8cd6a4, #83b89b, #e8be75, #d98585, #2a3d40). Trip Twin must sit comfortably next to it.
Direction for designers: derive the hologram's glass, edge-glow and grid tints from the brand slate-teal and green ramps on the #061a23 field; reserve brand green for "ours / safe" meanings; hazards use the semantic destructive/warning colors. Every color carries one meaning across the whole view. Never rely on color alone (green vs red is a color-blindness trap): pair color with shape, icon and label. Check contrast on the dark field. Propose any new hologram-specific tokens as additions derived from the brand ramps, with hex values.
