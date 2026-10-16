# Trip Twin: project plan

Owner: product owner. Date: 2026-10-15. Status: draft for Jesse, then Justin.
Readers: Jesse Tarva (decides scope and product questions), then Justin Tabb (owns World View and reviews the PR).

This plan assembles eight section files. It summarizes them and points to them. It does not replace them. Where they disagree, section 7 says which one wins.

| File | Owner | What it decides |
|---|---|---|
| `00-CONTEXT.md` | Jesse | The brief. Its late sections are binding: REQUIRED LAYER, FLOOR ESTIMATION, PROTOTYPE DATA STRATEGY, MOCK DATA = THE CONTRACT, COLOR AND BRAND |
| `01-operator-scenarios.md` | Protective operations | The decisions an operator makes, ranked. The three demo scripts (§8) |
| `02-layer-catalog.md` | Risk analyst | Every layer, its source and trust level. Freshness states. Fusion rules R1-R15. Floor model |
| `03-architecture.md` | Architect | How it is built, hooks into Justin's files, budgets, degradation, risks, effort |
| `04-screen-spec.md` | Interface architect | Screen layout, every element, states, accessibility, demo walkthrough |
| `05-motion-language.md` | Motion designer | Every motion, its job, timings, reduced motion |
| `06-layer-taxonomy.md` | Information architect | Layer groups, information tiers, the word list |
| `07-production-delta.md` | Architect | Mock field to production field, per repo |

Markers used here: `ASSUMPTION` (my inference, with a check). `NEEDS ENGINEERING INPUT` (a technical question I will not guess). Section references look like "03 §8" (file 03, section 8).

**Decisions that block the start** (detail in section 13): DJ-01 accept this plan's reconciliations, DJ-02 time-state-only person colors, DJ-03 the floor ruler, DU-01 Justin accepts the hook points, DU-02 which branch the PR targets.

---

> **Update, decided by Jesse after this plan was assembled. These override anything below.**
> 1. **No factory run.** This is a straight prototype. Section 14 is now a prototype readiness checklist.
> 2. **Core and mobile work is on hold.** Nothing in `safetrekr-core` or `mobile-app` is built or scheduled. Section 11 stays as the record of what would change later. Decision DJ-33 now only needs the prototype builder named.
> 3. **No PR for now, and the hooks are simulated.** Trip Twin runs on its own page, `twin.html`, inside `gods-eye-view`. It reuses Justin's modules and the existing dev-server endpoints (`/api/overpass`, `/api/route`, `/api/terrain`) but edits none of his files. A small harness stands in for hooks H-1 to H-9: it supplies the viewer, the mock snapshot feed, selection events and the city switch (`twin.html?city=austin|dc|london`). Decisions DU-01 and DU-02 no longer block the start. Real hook wiring and the PR come later, only if the prototype proves out.
> 4. **What the simulation cannot prove yet:** entering from World View's own panels, and exactly restoring World View on exit (ACs about entry and restore are deferred to integration). The alternate route needs hook H-9, so the prototype takes it from the fixture or a second route request instead.
> 5. **Blocking decisions answered (Jesse):** DJ-01 yes (all section 7 resolutions accepted), DJ-02 yes (person rings show freshness only, no red or green on people), DJ-03 yes (floor ruler is the signature floor visual). DJ-33: Claude builds the prototype.

## 1. Summary

Trip Twin turns a trip's hotel into a translucent 3D model that a SafeTrekr operator can orbit. When the operator opens it, the photoreal city in World View falls away. The hotel and its surrounding blocks stay as glowing glass built from OpenStreetMap. On top sit only the things that help a decision: where each traveler and chaperone is, how old and how exact each position is, an estimated floor band, hazards, approved safety places, and walking paths. It exists because an operator working remotely at 02:00 needs to answer "who might still be in the building, and on which floors" in seconds, and today's globe cannot show that. It is the first building block of a future SafeTrekr security operations centre. This prototype proves four things using mock data in gods-eye-view only: (1) the look is achievable in CesiumJS at 30 fps from OpenStreetMap data, without Google meshes; (2) operators reach the right decisions faster, without asking "where is that from?" or "how old is that?"; (3) a barometric floor estimate can be shown honestly, as a band with an age, so that it helps and does not mislead; (4) the mock data is an exact contract for the mobile and Core work that would follow.

---

## 2. Goal, the five questions, and the purpose rule

**Goal.** An operator can analyze a situation at a group's hotel and make a decision quickly, from the screen alone.

**The five operator questions** (00-CONTEXT "Design rule"). Every element on screen must answer at least one.

| # | Question | Where it is answered first (06 §1.1: readout first, drawing second) |
|---|---|---|
| Q1 | Where are my people? | Roster count block and Needs attention list in the left rail (04 §3) |
| Q2 | What is the threat, and where? | Hazard summary, reported floor slab, incident panel |
| Q3 | Where is safety? | Rally chip, safety glyphs, hotel assembly point |
| Q4 | How do they get there? | Suggested paths with time ranges and arrive-by |
| Q5 | How fresh and trustworthy is this information? | An age on every label, the Sources section, the scan sweep |

**The "sci-fi but purposeful" rule.** The futuristic feel comes from light and material, not from motion or decoration (05 §1 P7). Translucent glass, crisp edges, a measured grid, monospace readouts, and one signature transition do the work. Each of these must also carry a fact. Glass lets the operator see a person behind a tower. The grid gives scale. The one moving element means "traveler data just arrived" (05 §4.1). Anything that answers none of Q1-Q5 is cut, however good it looks (04 §4.3 lists the cuts). Motion, glow and color never carry a meaning alone; a word and a shape always carry it too (06 §5.1).

**How we will know it worked** (measures for the prototype, not a launch):

| Measure | Target | Source |
|---|---|---|
| Time to decision, Demo A (hotel evacuation) | All five decisions in ≤ 60 s | 01 §8, 04 §9.1 |
| Time to decision, Demo B (unrest) and Demo C (missing traveler) | ≤ 90 s and ≤ 60 s | 01 §8 |
| Five-second read | ≥ 80% correct; **0** operators count "At hotel, undetermined" as out | 06 §7 |
| Label comprehension | ≥ 90% match the definition; any "safe" reading of a path or green glyph fails | 06 §7 |
| Guardrail: World View unchanged when the flag is off | Zero diffs in existing smoke tests; no Trip Twin code fetched | 03 §5.3 |
| Guardrail: frame rate | p95 frame ≤ 33 ms on the reference laptop | 03 §8 |
| Guardrail: floor honesty | No bare floor number, room, or unknown-folded-into-below anywhere | 02 §2.5, 06 §3.4 |

Instrumentation is developer-only: `?twinDebug=1` exposes `window.__tripTwinStats` and `performance` marks (03 §8, 05 §7.3). Nothing with names, positions or floors is logged (03 §10.4).

---

## 3. Scope

### In scope (this prototype)

| Item | Detail | Source |
|---|---|---|
| Repo | gods-eye-view only, on Jesse's branch `jesse/world-view-visual-layer`, as a PR to Justin | 00-CONTEXT, 03 §2 |
| Data | Mock data only, in Justin's demo pattern (`demo.js`). Fictional people. Real hotels and real public places so the OSM model is real | 00-CONTEXT "PROTOTYPE DATA STRATEGY" |
| Cities | Austin (Fairmont Austin, OSM way 134786106, 37 levels) as default and hero. Washington DC (Hilton Washington DC Capitol Hill, way 48040879, height-tagged). London (Park Plaza London Waterloo, way 491692833, no height or levels) | 03 §4.1 (measured coverage) |
| Floor estimation | Mock barometer traces with noise, weather drift and an HVAC offset. A pure estimator (`floorEstimate.js`) runs client-side in the fixture only | 00-CONTEXT "FLOOR ESTIMATION", 03 §6.3-6.4 |
| Display | Desktop browser, 1280 × 720 and up; reference 1920 × 1080 | 04 §2.1 |
| Flag | Behind `VITE_TRIP_TWIN=1`, off by default, zero bytes loaded when off | 03 §5.3 |

### Out of scope

| Item | Why | When |
|---|---|---|
| mobile-app and safetrekr-core changes | Binding brief: prototype touches gods-eye-view only | Next phase, gated on this prototype (section 11) |
| Real barometer capture, calibration, snapshot exposure | Same | Next phase |
| Indoor routes, exits, stairwells, floor plans | No data source exists; drawing them would invent life-safety data | Needs a licensed floor-plan source (03 R-13, 02 §4) |
| SOC wall display | Layout is reserved (04 §2.4); 4K performance is unproven (03 R-14) | After a perf pass |
| Coastal city (earthquake and tsunami logic) | Not credible for Austin; deferred | Later (decision DJ-07) |
| Venue twins, hero glTF models, exploded 3D floors | P2 (03 §14) | Later |
| Persisting anything: positions, trails, incidents | Privacy by design | Never in the twin |

---

## 4. The experience in brief

### 4.1 Screen layout (04 §2)

Trip Twin runs inside Justin's existing operations console. It keeps his header. While open, it replaces his left sidebar with a status rail. Regions: header bar with Exit (R1), status rail on the left (R2), the 3D scene (R3), an incident panel on the right that opens only when an incident is in focus (R4), a details card (R5), and a bottom toolbar (R6). Wireframes are in 04 §2.2 (no incident) and 04 §2.3 (Demo A incident).

### 4.2 The five-second read (04 §3, 01 §2.2)

The order is built so the operator learns **who to ask about** before looking at any pin.

| Eye hits | Element | Question |
|---|---|---|
| 1 | Roster count block: `Inside (likely) · At hotel, undetermined · Outside, nearby · Away · Not current · Not located · of N loaded` | Q1 |
| 2 | Amber: Needs attention list, mirrored by amber hotspot rings in the scene | Q1, Q5 |
| 3 | The hotel, green safety glyphs, the blue suggested path to the primary rally point | Q3, Q4 |
| 4 | Hazard summary, or a bounded empty statement with its blind spot | Q2 |
| 5 | Sources: snapshot age and each layer's state; turns amber and jumps to the top when degraded | Q5 |

During an incident, the first look goes to the red hatched reported-floor slab, then to `At or above reported floor 9: 2` (04 §3.2).

### 4.3 Signature visuals

| Visual | What it is | Why it earns its place | Spec |
|---|---|---|---|
| Glass hologram | OSM buildings as slate-teal translucent glass with a fresnel rim, on a dark field `#061a23`, with a 10 m / 50 m grid. The hotel is the brightest structure, in neutral light slate, never green | Nothing is hidden behind a building. The grid gives distance. Neutral hotel: it is not verified safe, and in a fire it is the hazard site | 04 §5.2-5.3, 03 §4.2-4.6 |
| Exploded floor ruler | A lit vertical scale beside the hotel's camera-facing corner. Each person at the hotel gets a bracket from low to high floor, with a tick at the likely floor, initials and age. The reported floor is a red hatched slab across the building and the ruler | The honest version of the film's "pull the engine out". A band on a ruler reads as an estimate, never as a dot in a room | 04 §5.5, 05 §3.3 |
| Scan front | On entry, a bright ring sweeps out from the hotel. The photoreal city disappears exactly where the hologram appears. 1.2 s when calm; ≤ 1.0 s total during an incident; any input skips it | The signature moment. It shows what replaced what (orientation). It never costs time in an emergency | 05 §3.1 |
| Snapshot sweep | One faint band climbs the hotel each time a traveler snapshot arrives. No snapshot, no sweep | The only motion at rest. Its absence means the feed stopped | 05 §4.1 (scope per section 7, X-12) |
| Amber hotspot rings | Rings around items that need a decision now. They pulse three times when first raised, then stay static. Three pulse at most | The film's yellow rings, in brand amber, rationed to keep meaning | 05 §4.3, 04 §5.4 |

### 4.4 Hero demo storyboard: Demo A, hotel evacuation, 02:14 local (01 §8, 04 §9.1, 05 §3.4)

Setting: Fairmont Austin. Fire alarm at 02:10. The hotel desk reported smoke on floor 9 at 02:12. 24 travelers and 3 chaperones loaded. The reported floor is preloaded by the fixture as a human report (01 [A21]).

| Beat | Operator does | Screen shows | Operator concludes | Phase |
|---|---|---|---|---|
| 0 | Opens the sample, then **Open Trip Twin** | Incident open, so the entry is fast. Red hatched slab at floor 9 labeled `Reported: smoke · floor 9 · hotel desk · 02:12 · not verified`. Floor estimates on. Sample watermark | Something is reported on floor 9, unverified, 2 minutes ago | P0 |
| 1 (~5 s) | Reads the rail | `Inside (likely) 3 · At hotel, undetermined 5 · Outside, nearby 16 · Away 0 · Not current 2 · Not located 1 · of 27 loaded` | Up to 8 may still be in the building, plus 3 unaccounted. Undetermined is not out | P0 |
| 2 (~15 s) | Reads the incident panel | `At or above reported floor 9: 2`. `M.R. · Likely floor 10 (9–11) · 40s ago · band unchanged 8 min` (hotspot). `A.K. · Likely floor 9 (8–10) · 40s ago · descending` | M.R. first: likely 10, could be 9 to 11, not moving down. Pass to the hotel | P0 |
| 3 | **Copy for hotel / responders** | Dated, banded relay text (04 §6.7) | The relay is exact | P0 |
| 4 (~30 s) | Reads Needs attention | S.D. stopped in the lobby (last estimate only). T.C. chaperone aging 4m. R.O. last known 34m, 600 m away, battery 6%. E.W. no location reported | R.O. and E.W. are not "inside". Ask the chaperone about S.D. | P0 |
| 5 | Clicks R.O. | Hollow grey pin at the bar, possible-area ring | Not current is a separate problem | P0 |
| 6 (~45 s) | Reads hotel card and "If the group must move" | Hotel assembly point across the street. `Rally point (primary) · 850 m · walk 13–17 min (group pace) · Suggested arrive-by: 36 min (12 prepare + 17 walk + 7 buffer)` | Hold at the hotel assembly point. If moving, about 36 min, not the default 15 | P1 (paths) |
| 7 | Opens **Direct group here**, cancels | Arrive-by prefilled 36; audience prefilled Chaperones; "cannot be recalled" | There is no stand-down control: `Re-entry and stand-down: hotel or authorities only` | P1 |
| 8 | Focuses floors 9–11 | Floors above go outline-only. The card lists both people and `Floor unknown 2` with reasons | Unknowns are listed, never dropped | P0 |

Fail signals (04 §9.1): the operator counts "undetermined" as out, asks "is M.R. on 10?", looks for an evacuate or all-clear button, or cannot find the age of a floor reading.

Demos B (unrest, 04 §9.2) and C (missing traveler, 04 §9.3) need paths and so complete in P1.

---

## 5. Layers and vocabulary

### 5.1 Layer set

02 §5 recommends six P0 layers plus a mandatory status rail. This plan keeps that set and phases it per the dispatch (section 8).

| # | Layer (06 label) | Answers | 02 priority | Phase in this plan | Default |
|---|---|---|---|---|---|
| 1 | Site: Hotel + Surrounding buildings | Q1, Q3, Q4, Q5 | P0 | P0 | On; Hotel locked |
| 2 | People: Travelers & chaperones, with Floor estimates as an attribute | Q1, Q2, Q5 | P0 (mandatory, 00-CONTEXT) | P0 | On, locked. Floor estimates off unless an incident is in focus |
| 3 | People: Group zone & trip boundaries | Q1, Q2 | P0 | Readout in P0; rings in P1 (section 8) | On |
| 4 | Safety: Safety resources (12 categories, coverage gaps) | Q3 | P0 | P0 | On |
| 5 | Paths: Suggested walking paths | Q4 | P0 | P1 | On, to Rally point (primary) |
| 6 | Hazards: Satellite heat detections | Q2 | P0 | P1 | On |
| — | Hazards: Reported incidents (operator-entered floor, crowd reports) | Q2 | P0 (as part of the floor attribute) | P0 (floor); P1 (crowd areas) | On when one exists |
| always | Status rail: snapshot age, `source_issues`, feed states, counts, bounded empty states, sample watermark | Q5 | Mandatory | P0 | Cannot be turned off |

Deferred: earthquakes, geofence crossings layer, mapped entrances, venues (P1-later); CCTV, traffic, driving paths, unvetted OSM services (P2). Cut: aircraft, ships, satellites, visual modes, distance rings (02 §1g, 04 §4.3).

### 5.2 The five groups (06 §2)

The Layers panel has exactly five groups, ordered by the questions: **People, Hazards, Safety, Paths, Site**. Q5 is not a group; it is the rail, which cannot be hidden. "Hazards", not "Threats": a satellite pixel is an observation, not a confirmed threat. "Paths", not "Routes": the line is a suggestion. Turning a layer off never changes a readout; the rail says `{Layer} hidden` (06 §2.3 C7).

### 5.3 Words

06 §3 is the only vocabulary. 04 and 05 use its strings. Key rules:
- Roster words are 06 §3.2. Floor words are 06 §3.4 (`Likely floor 10 (9–11) · 40s ago`). Path words are 06 §3.7 (`Suggested path (unverified)`).
- The banned-word list is 06 §3.11. It includes safe, all clear, accounted for, evacuated, missing, exact, room, and Watch/Warning for our own computations.
- Words marked `[vocab add]` in 04 §10.2 Q9 need approval (decision DJ-10).

---

## 6. Architecture in brief (03)

### 6.1 Approach (03 §0, ADRs in 03 §12)

| Decision | Summary | ADR |
|---|---|---|
| Geometry | OSM buildings fetched once per open through the existing `/api/overpass` proxy, drawn as Cesium `Primitive` batches with a custom translucent material. 1-3 draw calls for all buildings. Fallback: client-built glTF with `CustomShader` if the spike misses the look | ADR-001 |
| Solo | Google tiles and the globe set to `show = false`, with exact save and restore. Google content is never restyled. Clipping is used only for the reveal | ADR-002 |
| Ground | One 21 × 21 heightfield from the existing keyless `/api/terrain/heights` (Re:Earth). Nothing clamps to ground, because nothing is left to clamp to. No Google-derived heights | ADR-003 |
| Hotel verdict | Computed in the browser from the OSM footprint and each fix's accuracy, labeled "not an alert". Group-zone status comes only from Core's `group_zone_state` | ADR-004 |
| Code placement | Isolated lazy module behind a flag, with small hooks into Justin's files | ADR-005 |
| Floor estimate | Per-visit outdoor anchor, drift correction, uncertainty growing with time, unknown after 4 h. Shown as a band. The estimator is a pure, portable module with golden vectors | ADR-006 |

### 6.2 Code placement and the flag

New files, all in `gods-eye-view/src/operations/` (03 §5.1): `tripTwin.js` (controller), `tripTwinData.js` (pure: query, parse, heights, footprint, containment, routes), `tripTwinScene.js` (Cesium), `tripTwinHud.js` (DOM), `tripTwinMotion.js` (motion controller, 05 §8.1), `floorEstimate.js` (pure estimator), `demoTripTwin.js` and `tripTwinFloorTraces.js` (DEV-only fixture), plus tests and `scripts/qa-trip-twin.mjs`. None of these needs a package-boundary change.

**Flags** (SPO-053):

| Flag | Type | Default | Who sees it | Owner | Removal plan |
|---|---|---|---|---|---|
| `VITE_TRIP_TWIN` | Build-time release flag | Off (unset) | Nobody unless the build sets `1` | Justin (build), Jesse (product) | Keep until production GA of the next phase; then decide permanent ops toggle or remove (DU-08) |
| `?demo=twin&city=austin\|dc\|london&scenario=a\|b\|c` | DEV-only sample entry | — | Developers, demos | Prototype engineer | Stays DEV-only, like Justin's `?demo=1` |
| `?fire=1` | DEV-only simulated FIRMS records | Off | QA | Prototype engineer | Stays DEV-only, labeled SIMULATED |
| `?twinDebug=1` | DEV-only stats | Off | Developers | Prototype engineer | Stays DEV-only |

When the flag is off: no button, no layer row, and no `tripTwin*.js` request. A smoke test asserts this (03 §5.3). When the flag is on but the twin is closed, no scene state is touched. **One-line rollback**: unset `VITE_TRIP_TWIN` and redeploy, or revert the PR. Because it is a build-time flag, switching off in production needs a redeploy; see risk RK-18.

### 6.3 Hook points in Justin's files (03 §5.2)

About 120 lines in his files in total. Everything else is new files.

| ID | File and function | Change | Phase |
|---|---|---|---|
| H-1 | `globe.js` `createOperationsGlobe` | `openTwin`, `closeTwin`, `twinActive`; dynamic import; dispose on cleanup | P0 |
| H-2 | `globe.js` `setSnapshot`, aging timer | Forward snapshot and age ticks to the twin | P0 |
| H-3 | `globe.js` `focus`, `frameTrip`, `resetView`, `follow` | Twin-aware behavior; follow disabled in the twin | P0 |
| H-4 | `main.js` `renderDetail` (lodging place) | "Open Trip Twin" button behind the flag | P0 |
| H-5 | `main.js` `lockView`, `changeFilters`, `acceptSnapshot` | Close the twin before any scope change renders | P0 |
| H-6 | `main.js` `openSession`, demo button | DEV-only twin sample and query params (plus `scenario`, per 04 [SS-A13]) | P0 |
| H-7 | `worldControls.js` | "Open Trip Twin" **button** (not a checkbox, section 7 X-41); visual-mode digit keys suspended while open | P0 |
| H-8 | `src/data/firmsHeatmap.js` | Additive `setPresentationSuppressed(flag)` | P1 |
| H-9 | `server/providers/places/routes.js` | Additive `alternatives=1`; byte-identical when absent | P1 |

Entry points E2 (person card) and E3 (alert card) from 06 §4.1 need small extra hooks not in this list. They are P1-later (section 7 X-46).

### 6.4 Performance budget (03 §8, 05 §7)

| Metric | Budget |
|---|---|
| Frame rate | Sustained 30 fps (World View's cap). p95 frame ≤ 33 ms on the reference laptop (Apple M1/M2, 1440p, DPR 2, Chrome). ≥ 24 fps on Intel Iris Xe class |
| Buildings | ≤ 2,500 instances (measured 80-201 in 400 m at the three hotels) |
| Triangles / draw calls | ≤ 350k / ≤ 15 for the twin |
| Added GPU memory / retained JS heap | ≤ 64 MB / ≤ 15 MB |
| Time to first hologram | ≤ 3 s warm, ≤ 12 s cold, with progressive status text |
| Requests on open | 1 Overpass + 3 terrain + 0 Google. P1 adds ≤ 3 route requests. 0 per snapshot |
| Motion cost | ≤ 1.5 ms GPU for motion shader terms; 0 post-processing stages |
| Low-end ladder | One merged ladder (05 §7.2): sweep off → edges off → dissolve becomes a cut → MSAA down → panel blur off → resolution 0.75 → flights capped → building cap 800. People, rings, labels, hazards and readouts are never degraded |

Absolute fps is measured by hand on the reference machines. The puppeteer harness uses SwiftShader, so it asserts counts, timings and relative cost only (03 §8).

### 6.5 Degradation (03 §9, 04 §7)

Every failure has a worded state. Nothing fails into an empty scene that reads as "nothing here".

| Failure | What the operator sees |
|---|---|
| Overpass down or rate-limited | "OpenStreetMap busy, retrying in 5 s", then a minimal twin (grid, hotel as a dashed 30 m cylinder, people, zones, safety glyphs, paths) and `Buildings unavailable since {time}` with Retry. `Inside (likely)` shows `—` |
| OSRM down | Dashed straight line, `Path unavailable: routing service did not respond ({time})` |
| Terrain down | `Ground elevation approximate` |
| Snapshot older than 45 s | Amber Sources at the top of the rail, counts "as of {time}", sweep stops, pins drop one state |
| No Google key | Same twin; the reveal works from the satellite globe |
| Floor data missing | `Floor unknown — {reason}`, counted, never guessed |
| Reduced motion | Every change in one frame; information timing identical |

### 6.6 Licensing (03 §10.3)

- OpenStreetMap (ODbL): visible `Map data © OpenStreetMap contributors (ODbL)` in the scene at all times, with a link.
- Re:Earth terrain (CC BY 4.0): visible credit.
- OSRM / FOSSGIS: credit while paths are drawn; fair use (≤ 3 automatic routes per open).
- Google Photorealistic 3D Tiles: never exported, cached, derived from or restyled. Google credits are never covered by Trip Twin chrome. A unit test greps the twin code for `clampToHeight` and `sampleHeight`.
- Open-Meteo: the free API is non-commercial. This already affects existing World View code (02 §4). Flagged as risk RK-17.

### 6.7 Privacy (03 §10, 02 §2.5, 03 §11.5)

- The prototype adds no new data path. It reads only the already-authorized snapshot shape (mock in the prototype).
- The twin persists nothing: no positions, no trails, no history. Reported floors live in session memory only.
- No room is ever shown or inferred. Floors appear only as a band with age and confidence.
- Floor-level location is more sensitive than street position. In the next phase it needs separate consent, a DPIA, staff-only exposure, 24 h retention and off-by-default display (03 §11.4-11.5).
- Fixtures: fictional people, placeholder avatars, no phone or email fields on participants. "No real traveler data in fixtures, ever" (00-CONTEXT).
- Scene labels show initials. Full names appear only in the console panels and the copy text.

---

## 7. Cross-file reconciliation

### 7.1 Rules used

1. A binding decision in 00-CONTEXT wins over every section file.
2. Where a specialist already resolved a conflict (04 §10.1, 05 §0, 06 §0 and §3.12), that resolution is adopted unless it breaks rule 1.
3. Otherwise the file that owns the topic wins: 06 for words, 04 for static visuals, 05 for motion, 03 for algorithms and code, 01 for operator doctrine, 07 for the wire contract.
4. Where two owners overlap, the more conservative choice for life safety wins.

None of the adopted resolutions conflicts with a binding brief decision. Two needed a check against the brief: X-01 (the brief reserves green for "ours / safe"; keeping the hotel neutral still honors that, because green stays reserved for approved safety places) and X-28 (the brief anchors "when the traveler crosses into the lodging geofence"; 03's outdoor-approach anchor is taken at that crossing and re-taken on each re-entry).

### 7.2 Conflict register

| ID | Topic | What the files say | Resolution adopted | Wins |
|---|---|---|---|---|
| X-01 | Hotel color | 03 §4.5 `twin-ours` brand green. 01 AP22, 04 C2, 05 MF1, 06 §5.1: neutral | Neutral light slate: glass `#b8c3c7`, edges `#e3e7e9`. Green only for approved safety places and, in text, muster "present" | 04 |
| X-02 | Person ring colors | 03 §4.5/§7.1 and 02 §2.3 use Justin's `PEOPLE_COLORS` (green traveler, blue chaperone, amber aging, red stale). 04 C1, 06 F6: ring = time state only | Inside the twin the ring shows time state only: current `#eff7f3` solid, aging `#f59e0b` dashed, last known `#9aa8ac` dotted and hollow. Role is the T/C badge. No red or green on a person. World View keeps Justin's colors | 04 / 06 |
| X-03 | Floor display | 02 §1d and 06 §2.2/§5.1: slab across the footprint with tether. 03 §7.2: "stack gutter" beside the building. 04 §5.5: exploded floor ruler. 05 §3.3: a schematic DOM ruler FLIPs into the panel on floor focus | The in-scene exploded floor ruler beside the hotel (04 §5.5) is the display. The reported floor stays a full-footprint slab. Tether only for the selected person. 05's FLIP into the floor-range card is the floor-focus motion; it is P1 polish and can fall back to a static card. 06's legend row and layer description change to "brackets on the floor ruler" | 04 (static), 05 (motion) |
| X-04 | Inside/outside radius | 02 §2.3 and 03 §7.1: 1× accuracy. 01 §2.4, 06 F2, 04 C4: 2× | 2× accuracy for the hotel verdict (life-safety rule). 1× stays only inside Core's group-zone verdict, shown unchanged | 01 / 06 |
| X-05 | Null accuracy | 03 [A-6]: assume 50 m. 02: verdict unknown. 06 HTL-02: undetermined | No assumed radius and no ring. Near the hotel the verdict is `At hotel, undetermined`; elsewhere `Away` with `Accuracy unknown` | 06 |
| X-06 | Roster bucket names | 02: At hotel / Hotel edge / Elsewhere / Not current / Not located. 03: Inside / Outside / Uncertain / Not current / No location. 06: Inside (likely) / At hotel, undetermined / Outside, nearby / Away / Not current / Not located | 06 §3.2 everywhere, including the HUD and QA assertions | 06 |
| X-07 | "Inside (likely)" corroboration | 01 §2.4 and 06 HTL-01 include "fix inside and floor band ≥ 2 above lobby" and "stopped · current since last hotel entry". 03 `hotelContainment` is geometry only | `hotelContainment` implements the full HTL-01 rule | 01 / 06 |
| X-08 | Aging person "at hotel" | 02 §6 fixture P05 is aging yet AT HOTEL | Counted under Not current with "Last known inside (likely) · 5m ago" (06 F3) | 06 |
| X-09 | Hotel footprint match | 02 R12: inside / nearest ≤ 30 m / unmatched. 03 §4.3: contains / name match ≤ 120 m / nearest ≤ 40 m and ≥ 150 m² / synthesized 30 m circle | 03's ladder (it handles node-only hotels such as Hilton Austin and has test cases). 06 SIT-03 wording becomes "Matched by name or proximity". 02 [A2] sampling validates it in the next phase | 03 |
| X-10 | Missing building height | Existing resolver guesses 10-70 m from size (02 §0.4). 03 §4.3: fixed type defaults (9.9 m), flagged approximate | 03 defaults, labeled `Height unknown (shape only)` (06 SIT-07, definition updated) | 03 |
| X-11 | Metres per level | 00-CONTEXT "~3 m". Code 3.3 m | 3.3 m. It matches the code and sits inside the brief's 3-3.5 m floor-height range | 03 |
| X-12 | Scan sweep | 03 §4.5 and 04 S4: free-running 6 s loop while the feed is live (04: hotel only). 05 MF2: one 1.6 s sweep per received snapshot, over all glass | One 1.6 s sweep per received snapshot (05), on the hotel only (04). Same stop rule: none when the snapshot is older than 45 s, none in reduced motion | 05 (trigger), 04 (scope) |
| X-13 | Height-ramp shader | 03 §4.5 includes it. 04 §4.3 cuts it | Cut. It answers no question | 04 |
| X-14 | Path dashes | 03 §7.4 flowing `GevRouteFlow`; 04 §5.9 "chevron flow". 05 MF3: draw on once, then static chevrons | Draw on once (480 ms), then still. Nothing implies people moving along the path (01 §6.2) | 05 |
| X-15 | Path hazard distance | 03 §7.4: 300 m. 02 R2 and 01 R2: 1 km for satellite detections | 1 km, tunable (01 [A16], 02 [A11]) | 01 / 02 |
| X-16 | Hero incident floor | 01 Demo A: smoke on floor 9. 02 §6: fire on level 5. 03 examples use floor 22 | Floor 9 in the hero. The level-5 case stays as a unit-test vector for R15 | 01 |
| X-17 | Hero "at or above" count | 05 §3.4: 3. 04 §9.1: 2 | 2. It is what the canonical cast produces under 06 FLR-11 (section 7.3) | 04 |
| X-18 | Hero "Not current" count | 05 §3.4: "Not current 3". 04 §9.1: Not current 2, Not located 1 | 04. 06 counts Not located separately | 04 / 06 |
| X-19 | Priority person's reading age | 04: "4m ago". 05: "40s ago" | 40 s. "Band unchanged" only means something when readings are fresh; a 4-minute-old reading would be FLR-03 Aging and cannot show it is unchanged now. 04's copy text updates to "reading 40s old" | 05 |
| X-20 | "Not descending" threshold | 01 §2.6: 10 min. 04: 8 min. 05: 10 min, wording "not descending" | 8 min, wording `band unchanged {n} min` (the hero is scripted at 8). ASSUMPTION: ops review confirms 8 min | 04 |
| X-21 | R.O.'s last fix | 01 §8: 21:40 (4h 34m before 02:14). 04 §9.1: "Last known 34m" | Last fix 01:40, so the label and the fixture agree | 04 |
| X-22 | Fixture casts | 01 §8: one 27-person roster. 02 §6: 23 state rows. 03 §6.1: 14 per city. 04/05: 27 | One canonical 27-person cast (section 7.3). 03 §15.2's Austin count assertion is replaced | This plan |
| X-23 | How the hero starts | 05 §3.4: operator submits "Add reported floor". 04 §9.1 and 01 [A21]: preloaded | Preloaded in Demo A. 05 §3.4 is the spec for an operator adding or editing a report, shown as a facilitator variant | 04 / 01 |
| X-24 | Entry timing | 03: 1.2 s. 01 [A19]: ~1 s cap in an incident. 04: instant (≤ 150 ms) in an incident. 05: calm = flight + 1.2 s dissolve; incident = ≤ 600 ms flight + 400 ms dissolve, ≤ 1.0 s total | 05. Information is on screen at the first frame either way. Any input skips | 05 |
| X-25 | Floor estimates default | 03 §10.2/§11.5: off per session. 06 §2.2: on when an incident is in focus | Off by default. On automatically when an incident is in focus. Forced off on a wall unless an incident is open (04 C7) | 04 / 06 |
| X-26 | Floor "unknown" codes | 03 §6.4: `no_barometer, no_anchor, anchor_too_old, sample_too_old, too_uncertain, not_at_lodging, consent_off`. 02 §2.5 adds `position_stale, inconsistent_with_building, sensor_jump` and names two differently | Wire enum = 03's codes plus 02's three extra codes. Display uses 06 §3.4 words through 04 C5's mapping. 07 owns the enum. NEEDS ENGINEERING INPUT: can floor-v1 detect `sensor_jump` and `inconsistent_with_building` from one sample per post? | 07 / 03 |
| X-27 | Floor confidence bands | 02: ±1 if ≤ 2 levels wide; rough 3-4; unknown > 4. 03 and 06: ≤ 3 high; ≤ 5 rough; wider unknown | 03 / 06 thresholds | 03 |
| X-28 | Anchor rule | 02: median over the first 60 s of footprint dwell. 03: outdoor approach 30-150 m from the lodging point, using only fields Core stores. Brief: anchor on entering the lodging geofence, re-anchor each re-entry | 03. It is Core-portable and meets the brief | 03 |
| X-29 | Lobby allowance default | 02 [A17]: ground storey 4.5 m. 03: `lobby_height_m` null means no allowance | Default 4.5 m when null (brief: "lobby/mezzanine allowance"). ASSUMPTION; golden vectors cover both | 02 |
| X-30 | Fire-mode HVAC error | 02 §2.5: σ_hvac 3.0 m when a reported floor exists. 03: none | Not in floor-v1, because production Core will not know about an alarm. The traces model stairwell pressurization so the demo shows the effect honestly. NEEDS ENGINEERING INPUT after the field test | 03 |
| X-31 | Trace generator parameters | 01, 02 and 03 give different noise, drift and HVAC values | 03's generator, parameterized to include 01's hero specifics and 02's failure cases | 03 |
| X-32 | Floor unit on screen | 02: levels above lobby. 03: levels from street on the wire, label with convention. 06: floor numbers when numbering is set | 06 on screen; 03 on the wire | 06 / 03 |
| X-33 | Numbering field | 02: `places[].floor_numbering:'us'`. 03/07: `ground_floor_label` 0 or 1 | `ground_floor_label` | 07 |
| X-34 | Consent field | 02: fixture boolean `floor_consent`. 07: `barometer:'denied'` → `unknown_reason:'consent_off'` | 07. No new boolean in the snapshot | 07 |
| X-35 | Floor-focus glass | 04: range α 0.22. 05: α 0.16 → 0.32 | 05 values, 04's caption `Floors above: outline only` | 05 |
| X-36 | Phase scope | 02 §5: P0 includes paths and heat detections. 03 §14: P0 includes zone rings and three cities | Dispatch slicing (section 8). The outside-group-zone **readout** stays P0 because the brief makes it a primary at-a-glance answer; the drawn rings move to P1 | 00-CONTEXT + dispatch |
| X-37 | Second and third cities | 01: one coastal, one sparse non-US. 02: one with no height tags, one with an unmatched hotel point. 03/04: DC and London | DC and London. London covers "sparse, non-US, no height". The unmatched-hotel case is covered by unit fixtures (Hilton Austin node, synthetic case). Coastal deferred (DJ-07) | 03 / 04 |
| X-38 | Fire in the demos | 02 §6: mock FIRMS in the sample. 03: live by default, `?fire=1` simulated. 01 §8: do not script a wildfire | Live FIRMS by default. Simulated records only behind `?fire=1`, labeled SIMULATED, for QA of hazard rules. Not in the scripted demos | 01 |
| X-39 | Hazard distance band names | 02 R1: Awareness / Watch / Warning | Distance wording only (`Heat detections within 3 km`). Watch and Warning are reserved for official sources (06 F4) | 06 |
| X-40 | Distance rings | 02: P1 layer. 06: off. 01 AP23 and 04 C9: noise | Cut | 04 |
| X-41 | World controls entry | 03 H-7: checkbox row | Button "Open Trip Twin". A mode is not a layer (04 C10) | 04 |
| X-42 | Radius | 03: 400 m fetch. 02/06: ~500 m | Fetch 400 m; Neighborhood frames 500 m; the grid fades where data ends (04 C11) | 04 |
| X-43 | Send buttons for view-only roles | Justin hides them. 06 shows them disabled | Disabled with `View-only role` inside the twin only (04 C8) | 04 |
| X-44 | Crowded pins | 03 fans them. 06 clusters them | Both. The true dot and ring never move (04 C13) | 04 |
| X-45 | Roster layout | 06: one line. 04: stacked rows | Stacked rows on the desktop rail; one line for wall, copy text and screen readers (04 C12) | 04 |
| X-46 | Entry points | 06/04: E1-E5. 03 hooks cover the lodging card, the sample and World controls | P0: lodging card, sample, World controls button. P1-later: person card (E2), alert card (E3). Deep link (E5) deferred ([IA-A3]) | 03 |
| X-47 | Sample labels | 02: "DEMO DATA". 03: `SIMULATED DATA · SAMPLE TRIP`. 06/04: `SAMPLE DATA · fictional people and events` | Header badge stays Justin's `SIMULATED DATA · SAMPLE TRIP`. Watermark uses 06's text | 04 / 06 |
| X-48 | HUD wording | 03: "Fix inside hotel footprint"; "Above / On ±1 / Below / Floor unknown" | 06 HTL and FLR-12 wording | 06 |
| X-49 | Geofence display name | 03 §7.1: "Hotel Safe Zone" | "Hotel perimeter" (06 F8). The wire value `category:'safe_zone'` stays | 06 |
| X-50 | Drive time in path cards | 06 PTH-04 shows walk and drive time. 03 requests foot routes only | Request the car duration on demand for the destination card (no drawn driving path), else show "drive time not computed". ASSUMPTION: ≤ 1 extra route request per destination | This plan |
| X-51 | "Last co-located" (Demo C) | 04 §9.3 needs it for decision 2. It needs location history, which the snapshot does not carry and the twin must not store (02 §2.3) | Replace with a proxy from existing `geofence_events`: `Left the hotel perimeter with: J.O. (exits recorded 2 min apart, 19:05)`. Traceable to production today (07 §1.3, EXPOSED) | This plan (DJ-23) |
| X-52 | Hotel card | 01 §1.2: slot empty in the prototype. 01 §8 Demo A: filled. 07: no row | Filled in the Demo A fixture under a proposed `places[].hotel_card` object. 07 must add a row (NOT-COLLECTED; mobile capture + Core storage). DC and London show `Interior unknown · Hotel card not provided` | This plan (DJ-22) |
| X-53 | Default paths on open | 02: rally primary, safe house, nearest hospital. 03: ≤ 3 automatic. 06: draw rally primary only, max two destinations | Compute up to 3 on open for the readouts (03). Draw only the primary rally point (06). Others on demand | 03 / 06 |
| X-54 | Zone `valid_for_seconds` in fixtures | 02: 30 s. 03: 45 s | 45 s in the hero (no false "Update overdue"); 30 s in the baseline scenario to exercise `Update overdue` | This plan |

### 7.3 The canonical fixture cast

One fictional roster of **27 people: 24 travelers and 3 chaperones**, used in every scenario and every city (01 §8). Initials are on scene labels. The few full names appear only in console text and are fictional (04 §6.7). No name, place label or geofence uses the word "safe" (06 F8). Avatars are placeholder art.

| Person | Role | Demo A, 02:14 (hero, Austin) | Floor at 02:14 | Baseline scenario (state coverage) |
|---|---|---|---|---|
| M.R. (Maya Ruiz) | T | Inside (likely): fix inside footprint, live | `Likely floor 10 (9–11) · 40s ago`, band unchanged 8 min (priority) | Inside (likely), live 12 m, floor ±1 |
| A.K. (Aron Kim) | T | Inside (likely), live | `Likely floor 9 (8–10) · 40s ago · descending` | At hotel, undetermined (45 m straddling edge), Rough ±2 |
| S.D. | T | Inside (likely): stopped · current in lobby since last entry, ±30 m | Last est. only (FLR-04b, vertical movement not tracked while stopped) | Stopped · current; floor last estimate misses an elevator ride (02 P07) |
| L.B. (Leo Brandt) | T | At hotel, undetermined | `Floor unknown — phone has no pressure sensor` | Inside (likely), `no_barometer` |
| I.S. (Ivy Stone) | T | At hotel, undetermined | `Floor unknown — no ground reference since this phone entered the hotel` | Inside (likely), `no_anchor` |
| 3 travelers (T15-T17) | T | At hotel, undetermined, live, 35-60 m | Below floor 9 (one band visibly off by one from a +1 m HVAC offset against ground truth) | T15-T17: Inside (likely), stopped · current |
| R.O. | T | Not current: Last known 34m (fix 01:40) at a bar 600 m away, battery 6% | No floor | Not current: Last known 2h |
| E.W. | T | Not located (never reported) | No floor | Not located |
| T.C. | C | Not current: Aging 4m | No floor | Not current: Aging (02 P05) |
| 14 travelers (T01-T14) + 2 chaperones (K.V., H.L.) | 14 T, 2 C | Outside, nearby: live, 8-25 m, at the hotel assembly point across the street, placed ≥ 2× accuracy from the footprint | No floor | See baseline counts below |
| N.F. | T | (one of T01-T14 in Demo A) | — | Away at a venue 2 km off with H.L. (Demo C's missing traveler) |
| J.O., J.P. | T | (in T01-T14 in Demo A) | — | J.O. Inside (likely); J.P. Away, outside group zone, unaccompanied, at night (02 P03, R4) |

**Hero expected counts at 02:14** (Demo A, Austin; these are QA assertions):

| Readout | Expected |
|---|---|
| Roster block | `Inside (likely) 3 · At hotel, undetermined 5 · Outside, nearby 16 · Away 0 · Not current 2 · Not located 1 · of 27 loaded` |
| Zone line | `Outside group zone 0 · Unaccompanied 0 · Zone unknown 3` (R.O., T.C., E.W.) |
| Priority count | `At or above reported floor 9: 2` (M.R., A.K.) |
| Floor partition | `Above 0 · At or near 2 · Below 3 · Last est. only 1 · Floor unknown 2 · Not shared 0 · No floor (not at hotel) 19 · of 27 loaded` |
| Chaperones | `3 · 2 outside, nearby · 1 aging` |
| Needs attention | M.R. and A.K. (at or above), S.D. (last est. only, stopped), T.C. (aging), R.O. (last known), E.W. (no location reported) |

Checks: 3 + 5 + 16 + 0 + 2 + 1 = 27. At the hotel: 2 + 3 + 1 + 2 = 8 = 3 inside + 5 undetermined. 19 = 16 + 2 + 1.

**Baseline scenario** (Austin at 21:32 before the alarm; also the only scenario in DC and London). ASSUMPTION: the fixture author freezes these numbers in `demoTripTwin.test.mjs`. At load: `Inside (likely) 15 · At hotel, undetermined 3 · Outside, nearby 1 · Away 3 · Not current 4 · Not located 1 · of 27 loaded`. One traveler (T11) walks out over 3 minutes (03 §6.1), giving `Inside (likely) 14 · Outside, nearby 2` by +3 min. The baseline assigns every state in 02 §6 (P01-P23) to a cast member, including `Approx. ±180 m`, `Accuracy unknown`, `Time unknown`, `Did not answer a location check`, `Floor not shared`, `anchor_too_old`, `sensor_jump` and `inconsistent_with_building`. In London the floor labels switch to `Likely level {n} above lobby … · Floor numbering not verified` with confidence capped at Rough.

**Demos B and C** (proposed counts, ASSUMPTION, to be confirmed by the fixture author against 01 §8):
- Demo B, Saturday 17:30: `Inside (likely) 20 · Away 6 · Not current 1 · of 27 loaded`; zone line `Outside group zone 2 · Unaccompanied 2 · Zone unknown 1`.
- Demo C, 22:40: `Inside (likely) 26 · Not current 1 · of 27 loaded`. N.F.: `Last known 1h 28m · battery 4% · discharging`; exit recorded 19:05.

---

## 8. Phases and milestones

Effort figures come from 03 §14. Where this plan re-slices scope, the change is marked.

| Phase | Contents | Effort | Exit criteria |
|---|---|---|---|
| **Spike S-1** | Fresnel glass and edge look on `Primitive` (03 ADR-001). Clip-reveal support and per-frame clip cost ≤ 2 ms (05 [M-A1]). Animating `skyAtmosphere.brightnessShift` (05 [M-A4]). Tile reload on exit (05 [M-A2]). Clipping on the keyless globe (05 [M-A3]) | 1 dev-day (03) | Jesse and Justin approve the look against `./reference/`. If not: switch to the glTF path (ADR-001 option C). Each 05 motion assumption has a measured yes or a chosen fallback (veil cut) |
| **P0** | Hologram from OSM; heightfield; solo and exact restore; grid; hotel footprint and edges. Traveler positions: pins, accuracy rings, all states, 2× hotel verdict, roster block, Needs attention, zone **readout** from Core's field. Floor ruler from mock traces: estimator, traces, golden vectors, brackets, reported floor input, partition, copy text. Safety points: glyphs, rings, beacons, draft and review states, coverage gaps, rally chip with straight-line distance (walk times arrive in P1). Rail and Sources, attribution, legend, layers panel, keyboard and screen reader structure, motion controller. Austin fixture with the canonical cast, baseline and Demo A. Unit tests and QA script | 03: 8-12 dev-days. Re-slice (safety points in, zone rings and two cities out): ASSUMPTION ≈ net zero. 04/05 chrome not in 03's estimate (incident panel, cards, legend, keyboard, motion controller): ASSUMPTION +4-6 dev-days. **Planning figure: 12-18 dev-days** | All P0 acceptance criteria pass (section 9). Demo A beats 0-5 and 8 pass in a dry run. Repo checks green. Justin has reviewed the hooks |
| **P1** | Paths: primary + alternate (H-9), independence rule, hazard proximity, arrive-by arithmetic, chokepoints, draft note from path, car duration. Heat detections: live FIRMS (H-8), pixel footprints, off-screen chips, `?fire=1` for QA. Group zone rings drawn. Crowd report areas and region banner. DC and London fixtures. Demos B and C | 03: 5-8 dev-days. Chokepoints, arrive-by, Demo B/C scripting, two city fixtures: ASSUMPTION +2-3 dev-days. **Planning figure: 7-11 dev-days** | All acceptance criteria pass, including the prototype pass bar (AC-PB01 to PB07) |
| **Gate review** | Jesse decides whether the next phase starts | — | Pass bar met; field-test plan, DPIA owner and production owners named |
| **Next phase (gated)** | Production delta (07, section 11 here): Core floor pipeline, mobile barometer capture, lodging metadata | 03 §14: mobile ~5 dev-days, Core ~8 dev-days, app-v2 ~2 dev-days | Field test passes (03 §11.6: likely floor within ±1 in ≥ 70% of `high` samples and **zero** `high` estimates off by more than 2 floors, in 3 hotels, iOS and Android); DPIA signed; Justin's stopped-phone branches merged |

Prototype total, ASSUMPTION: about 20-30 dev-days. The factory run must re-estimate (section 14).

**Definition of Ready** (per phase): every blocking decision in section 13 for that phase is answered; the canonical cast and expected counts are frozen; the hotel's OSM way ID and nearby POIs are recorded; Justin has acknowledged the hook list.

**Definition of Done** (per phase): the phase's acceptance criteria pass; repo checks pass; no forbidden word in UI strings or fixtures; screenshots of every phase-relevant state are attached to the PR; open defects are listed with owners; 07 is updated for any field the phase added to the fixture.

**P1 cut list if time runs short** (in order): 05's ruler FLIP into the panel (keep a static card); the information steps checklist (E21); crowd report areas (Demo B then uses the region banner only); car duration in path cards.

---

## 9. Acceptance criteria

IDs are stable; section 10 traces elements to them. "Phase" is when the criterion must pass. Strings in backticks are exact.

### 9.1 Function (AC-F)

| ID | Criterion | Phase |
|---|---|---|
| F01 | GIVEN the flag is on and a trip with a lodging is open WHEN the operator clicks `Open Trip Twin` on the lodging card THEN the twin opens on that lodging, and the rail shows counts from the snapshot already in memory before the hologram finishes | P0 |
| F02 | The hologram uses only OSM data from `/api/overpass`. Mapped heights draw solid; heights from levels draw solid with `Height ~{n} m (est. from {n} levels)`; missing heights draw fainter with `Height unknown (shape only)`. No building is invented where OSM has none | P0 |
| F03 | The hotel footprint follows the 03 §4.3 ladder. The state reads `Building matched`, `Matched by name or proximity`, or `Hotel location approximate` (dashed 30 m cylinder, containment off, `Inside (likely)` shows `—`) | P0 |
| F04 | GIVEN the twin is open WHEN the operator exits THEN tileset and globe visibility, sky, fog, background, camera, visual mode, enabled public layers, selected record and open panel equal their pre-open values. If the basemap changed while open, exit lands on the new basemap | P0 |
| F05 | GIVEN the twin is open WHEN scope changes, the operator signs out or the view locks THEN the twin closes before any new data renders | P0 |
| F06 | Each located person has a fix dot and an accuracy ring at true scale on the ground. Pins sit at street level. On each snapshot, pins snap; they never glide. Crowded pins fan out with leader lines; the dot and ring never move. A cluster bubble always states its not-current members (`6 · 1 not current`) | P0 |
| F07 | The hotel verdict uses 2× accuracy and 06 HTL-01 to HTL-06. Roster buckets are mutually exclusive, always sum to `of N loaded`, and stay visible at 0 | P0 |
| F08 | The zone line comes only from Core's `group_zone_state` and `group_zone_ambiguous`. The twin never recomputes zone containment. When the zone is overdue, people move to `Zone unknown` | P0 |
| F09 | Needs attention lists not current (oldest first, with battery), not located, outside group zone, unaccompanied, at or above the reported floor, and last estimate only. Every row has a matching hotspot ring in the scene. `[` `]` step through rows; `A` jumps to the next attention item | P0 |
| F10 | With Floor estimates on, the floor ruler sits beside the hotel and switches corners with 20° hysteresis. Brackets appear only for people at the hotel whose `floor_estimate.place_id` matches. Approximate floor lines appear on the hotel only | P0 |
| F11 | `Add reported floor` requires a floor and a source. The slab is stamped with source, time and initials. Edits and removal keep a session history line. Nothing is persisted. Exiting with a report shows `Reported floor kept for this session` | P0 |
| F12 | The priority count and partition follow 06 FLR-11 and FLR-12 exactly (see FL06) | P0 |
| F13 | `Copy for hotel / responders` previews and copies the 04 §6.7 format, including floor unknown reasons, the not-current count and the closing caveat | P0 |
| F14 | Safety resources show one glyph per category (06 §3.6) with `Approved` or `Draft, not approved`; `Reviewed {n} mo ago` in amber over 12 months; `No location on file` listed, not placed; visibility tags; coverage-gap chips `No approved {category} on file for this hotel`. Draft and internal points cannot be Direct group destinations | P0 |
| F15 | Paths draw primary and alternate. The alternate is used only if it shares no chokepoint and not the first ~200 m; otherwise `No independent alternate: both paths use {name}`. Every path card carries `OSM street path · not checked for closures, crowds, lighting, crime or damage` and walking time as a range | P1 |
| F16 | GIVEN a hazard is loaded WHEN a path passes within 1 km of it THEN that segment turns amber and the card shows `Closest approach to hazard: {n} m`. A path inside a buffer is greyed, `Passes within buffer`, and is not a candidate. The card shows `Suggested arrive-by: {n} min ({a} prepare + {b} walk + {c} buffer)` and warns when the operator's value is below the lower bound. No path is drawn from a non-current fix; the card says `From last known position, {n} min old` | P1 |
| F17 | Heat detections draw as footprints sized to the sensor pixel. They are never `Live`. ≤ 6 h is recent; 6-24 h is dashed `Stale`. Low-confidence detections are hidden by default. Off-screen detections become edge chips. FIRMS's own sprites are suppressed while the twin is open. Live FIRMS is the default; simulated records appear only with `?fire=1` and are labeled SIMULATED | P1 |
| F18 | Group zone rings draw on the ground. Overdue: dashed with `Update overdue` in amber. Degraded: dashed with `Approximate boundary` | P1 |
| F19 | Items beyond the current scale appear as edge chips (`{label} {distance} {bearing} →`), at most 6. Clicking moves to a scale that contains the item, or offers `Show in World View` | P0 |
| F20 | `1` `2` `3` select Building, Neighborhood, City. `P` toggles Plan view (north up). `N` sets north up. `Home` resets. Justin's visual-mode digit keys do nothing while the twin is open | P0 |
| F21 | The Layers panel shows five groups in order: People, Hazards, Safety, Paths, Site. Locked rows show `Locked in Trip Twin`. Turning any layer off changes no readout, and the rail adds `{Layer} hidden` | P0 |
| F22 | No `Evacuate`, `All clear` or `Stand down` control exists. `Send alert` and `Direct group here` follow `capabilities`; for view-only roles they show disabled with `View-only role`. Both use two steps and state "This sends a push notification. It cannot be recalled." In a hotel evacuation, audience prefills to Chaperones and arrive-by prefills from the path card | P0 (gating), P1 (arrive-by prefill) |
| F23 | On entry, aircraft, ships, satellites, military, traffic, CCTV and earthquake layers turn off and visual modes reset to normal. All are restored on exit | P0 |
| F24 | In sample mode the header shows `SIMULATED DATA · SAMPLE TRIP`, R1 shows `SAMPLE`, the scene shows the watermark `SAMPLE DATA · fictional people and events`, and Sources shows `Sample · {n}s ago` | P0 |
| F25 | Local time shows in the trip's timezone with its abbreviation. The night chip reads `Night · civil dusk {time}` when the sun is below −6° | P0 |
| F26 | The incident panel opens when an incident is in focus. Order: official slot (`No official instruction on file. Check local authorities.` when empty), reported incident, priority count, partition, promoted items, information steps, destinations and `Shelter in place`, message status as three separate counts, `Re-entry and stand-down: hotel or authorities only`, actions | P0 (hotel evacuation), P1 (unrest, missing person) |
| F27 | The person card shows state, age, `±{n} m`, hotel verdict with a `Why?` explanation of rule and inputs, group zone, floor or `Floor unknown — {reason}`, battery, last 3 crossings, nearest current chaperone and distance, and toggles for the 2× ring and (if not current) `Possible area, not a prediction` | P0 |
| F28 | A city-level item appears as a banner with `Location approximate (city)` and is never pinned. A crowd report draws as an area at its stated uncertainty radius with source and time | P1 |
| F29 | Demo C shows `Left the hotel perimeter with: {initials} ({time})` from `geofence_events`, not from position history | P1 |

### 9.2 Five-second read (AC-R)

| ID | Criterion | Phase |
|---|---|---|
| R01 | GIVEN Demo A at 02:14 THEN every readout equals the hero table in section 7.3 | P0 |
| R02 | The roster block is the largest text, top left, and sticky. Amber appears only on attention items. In the incident panel the official slot is first in reading order | P0 |
| R03 | While the footprint loads, `Inside (likely)` and `At hotel, undetermined` read `pending outline`. No bucket ever shows 0 while pending | P0 |
| R04 | Five-second test with 8-12 staff: ≥ 80% answer "how many might still be in the building" correctly, and 0 count `At hotel, undetermined` as out (06 §7) | P1 (with pass bar) |
| R05 | Label comprehension with 8-12 staff: ≥ 90% match the 06 definition; any "safe" reading of a path or green glyph fails | P1 |

### 9.3 Confidence and freshness states (AC-S)

| ID | Criterion | Phase |
|---|---|---|
| S01 | Each position state renders exactly as 04 §5.4 and 06 §3.1: `Live · {n}s ago`, `Stopped · current` (with `At this location for {n} · contact {n} ago`), `Aging · {n}m ago` (amber dashed), `Last known · {n} ago` (grey dotted hollow, desaturated photo), `Did not answer a location check · Updated {n} ago`, `Capture time unknown` (ghost pin, no ring, no verdicts), `No location reported` (not drawn, counted) | P0 |
| S02 | `accuracy_m` null: no ring, `Accuracy unknown`. Over 100 m: dashed ring at true scale, `Approx. · ±{n} m`, verdicts undetermined. Display cap 500 m with `≥ 500 m` | P0 |
| S03 | GIVEN the last poll is older than 45 s THEN Sources moves to the top in amber with `Traveler data delayed {n}`, counts read `as of {time}`, the sweep stops, pins drop one state, and the zone line becomes `Zone unknown` | P0 |
| S04 | GIVEN `source_issues` touch participants THEN affected counts carry `(incomplete)` and Sources names the source | P0 |
| S05 | Every layer reports its state with 06 FRS words (`Live`, `Updated {n} ago`, `Stale · last update {time}`, `Unavailable — {reason}`, `Key needed`). A failed layer never renders as empty | P0 |
| S06 | Empty states are bounded statements (`No FIRMS heat detections within 25 km in the last 24 h (latest data {time}). Satellites miss fires under cloud or smoke and between passes.`). No empty state uses green, a check mark, or a 06 §3.11 banned word | P0 |
| S07 | Overpass slow after 8 s: `OpenStreetMap is slow · still trying ({n}s)`. Rate-limited: one retry with the wait shown. Failed: minimal twin with `Buildings unavailable since {time}` and Retry. Stale cache: `OSM buildings · from cache`. No OSM data: `No OSM buildings mapped here` | P0 |
| S08 | Terrain failure shows `Ground elevation approximate` and the twin stays internally consistent | P0 |
| S09 | A path older than 10 min, or whose endpoint or hazard changed, draws dashed with `Stale · Recompute`. A routing failure draws a straight dashed line with `Path unavailable: routing service did not respond ({time})` | P1 |
| S10 | With no Google key, the twin is identical in steady state | P0 |
| S11 | Below 1280 px wide the scene switches to Plan view with drawers; below 1024 px only the rail shows, with "Trip Twin needs a wider window. Counts above are current." | P0 |

### 9.4 Floor estimate honesty (AC-FL)

| ID | Criterion | Phase |
|---|---|---|
| FL01 | No screen, label, copy text or fixture shows a bare floor number, a room, a unit, a wing or a side of the building for a person. A lint test checks UI strings for the 06 §3.4 forbidden forms | P0 |
| FL02 | Floor labels follow FLR-01 to FLR-04 with age and confidence. Rough bands show no likely number. Aging and last-estimate bands use amber dashed and grey dotted brackets | P0 |
| FL03 | Each unknown reason shows its 06 §3.4 text, followed by "Ask the chaperone or check the hotel's room list." | P0 |
| FL04 | `Floor not shared` is its own partition bucket and never merges with `Floor unknown` | P0 |
| FL05 | People not at the hotel get no floor and fall in `No floor (not at hotel)` | P0 |
| FL06 | GIVEN a reported floor WHEN a band touches or crosses it THEN that person counts `At or near`. Above and Below require the whole band. `Floor unknown`, `Not shared` and `Last est. only` are never folded into Below. The priority count = Above + At or near, plus a note when a last estimate touches or is above the floor | P0 |
| FL07 | When numbering is not set, labels read `Likely level {n} above lobby … · Floor numbering not verified`, and `Add reported floor` asks "Lobby is floor 1 / G / 0?" before accepting. Where floor heights are default, confidence is capped at Rough | P0 (logic), P1 (London) |
| FL08 | GPS altitude is never read, displayed or used | P0 |
| FL09 | Floor estimates are off by default. Adding a reported floor turns them on. If the operator turns them off, the partition stays in the panel | P0 |
| FL10 | `floorEstimate.js` is pure and deterministic (same input gives byte-identical output). It passes `scripts/fixtures/trip-twin/floor-vectors.json`, covers every unknown reason in the adopted enum (X-26), is monotonic in pressure, and widens with anchor age | P0 |
| FL11 | The estimator is called only by the fixture. The twin reads `participants[].floor_estimate` only | P0 |
| FL12 | Hero traces include descending evacuees, one flat priority band for 8 minutes, one phone without a barometer, one without an anchor, and a +1 m HVAC offset that shows one band off by one against ground truth | P0 |

### 9.5 Off by default, no change when off (AC-O)

| ID | Criterion | Phase |
|---|---|---|
| O01 | GIVEN `VITE_TRIP_TWIN` is unset WHEN World View loads and runs its existing smoke test THEN no `tripTwin` chunk is requested, no new DOM appears, and existing tests pass unchanged | P0 |
| O02 | GIVEN the flag is on and the twin was never opened THEN no scene flag, layer or camera setting has changed | P0 |
| O03 | The lifecycle test shows every added primitive, listener and DOM node removed on close, and every render-governor hold released | P0 |
| O04 | After 5 open/close cycles, JS heap returns to within 5 MB of the start | P0 |

### 9.6 Performance (AC-P)

| ID | Criterion | Phase |
|---|---|---|
| P01 | On the reference laptop, a scripted 10 s orbit holds 30 fps with p95 frame ≤ 33 ms in each city | P0 (Austin), P1 (all) |
| P02 | On an Intel Iris Xe class machine, ≥ 24 fps | P1 |
| P03 | Budgets in section 6.4 hold: buildings, triangles, draw calls, GPU memory, heap | P0 |
| P04 | First hologram ≤ 3 s warm and ≤ 12 s cold, with progressive status text | P0 |
| P05 | Opening makes 1 Overpass, 3 terrain and 0 Google requests (P1 adds ≤ 3 route requests). A snapshot update makes 0 requests | P0 |
| P06 | When p95 exceeds 50 ms over 3 s, the ladder steps in order and the chip `Reduced detail for this device` appears. People, rings, labels, hazards, the reported slab and readouts never degrade | P0 |
| P07 | At rest: ≤ 1 moving element (the sweep while it travels), ≤ 3 pulsing elements, 0 camera motion, < 2% changed pixels without the sweep and < 6% with it (05 §4.4) | P0 |

### 9.7 Motion and reduced motion (AC-M)

| ID | Criterion | Phase |
|---|---|---|
| M01 | Information timing marks (`trip-twin:info:roster`, `:partition`) are equal within 50 ms in full and reduced motion | P0 |
| M02 | GIVEN `prefers-reduced-motion: reduce` WHEN any sequence triggers THEN the next frame equals the end state. No transition frames | P0 |
| M03 | A system setting change mid-session applies at once. The in-app `Reduce motion` setting can reduce motion further but cannot force full motion | P0 |
| M04 | Calm entry: flight then a 1.2 s scan-front dissolve. Incident entry: ≤ 1.0 s from data ready to settled. Any pointer, wheel or key input skips to the end state | P0 |
| M05 | The sweep runs once per applied snapshot, for 1.6 s, on the hotel only. It never starts when the snapshot is older than 45 s or in reduced motion | P0 |
| M06 | No data value animates between readings. Changed positions and bands snap and leave a hollow echo for 1.2 s. No `SampledPositionProperty`, no trails | P0 |
| M07 | At most 3 elements pulse (at most 1 in the DOM), for 3 cycles at 0.83 Hz, then hold a static ring. The same item re-pulses only if it worsens and not within 60 s. Reduced motion shows a static double ring | P0 |
| M08 | The camera never moves because data arrived. It never rolls. Heading changes over 120° are cuts. Incident reframing happens only if the operator has not touched the camera for 10 s; otherwise `Frame incident` appears | P0 |
| M09 | Paths draw on once and then hold still. The hotel never pulses or breathes | P1 (paths), P0 (hotel) |

### 9.8 Accessibility and contrast (AC-A)

| ID | Criterion | Phase |
|---|---|---|
| A01 | Measured on rendered frames (04 §8.4: 3 cities × 4 views × 2 states, DPR 1 and 2), against the brightest background pixel within 4 px: text ≥ 4.5:1; glyphs, lines, focus and state rings ≥ 3:1. The palette unit test asserts ≥ 3:1 on `#061a23` | P0 (Austin), P1 (all) |
| A02 | Every function works by keyboard. Tab order: R1 → R2 → R4 → R6 → scene → R5. Skip links "Skip to status" and "Skip to incident". `Esc` unwinds one level and never exits. Single-letter keys are off while a text field has focus | P0 |
| A03 | Every drawn item has a list row with the same text. The canvas has a live summary. Live regions are polite, at most every 30 s, and on attention changes. Ages are read in words | P0 |
| A04 | Under deuteranopia, protanopia, tritanopia and achromatopsia emulation, a reader names every state in the Demo key frames | P0 (Demo A), P1 (B, C) |
| A05 | Controls are at least 24 × 24 px. Scene labels are at least 12 px | P0 |
| A06 | Nothing flashes more than 3 times per second | P0 |
| A07 | A lint test finds no 06 §3.11 banned word in UI strings, tooltips, legend text or fixture names | P0 |

### 9.9 Licensing and privacy (AC-L)

| ID | Criterion | Phase |
|---|---|---|
| L01 | `Map data © OpenStreetMap contributors (ODbL)` is visible in the scene whenever the twin is open, links to the copyright page, and no panel covers it | P0 |
| L02 | The Re:Earth credit is always visible; `Routing: OSRM / FOSSGIS` is visible while paths are drawn | P0, P1 |
| L03 | Google credits are never covered by twin chrome or the veil | P0 |
| L04 | A unit test finds no `clampToHeight` or `sampleHeight` call in `tripTwin*.js` | P0 |
| L05 | The fixture test finds no phone or email fields on participants, only placeholder avatars, and only fictional people. Real names appear only for hotels and public places, with OSM IDs in comments | P0 |
| L06 | The twin writes nothing to storage except the device-level reduced-motion preference | P0 |
| L07 | An OSM name containing markup renders as plain text (unit test with `<img onerror>`) | P0 |
| L08 | Twin log lines carry codes only, with no names, coordinates or floors | P0 |

### 9.10 Prototype pass bar (AC-PB)

| ID | Criterion | Phase |
|---|---|---|
| PB01 | Three real cities render with their honesty states: Austin `Height {n} m` or levels path with US numbering; DC `Height 50.75 m (mapped)` with measured floor height; London `Height unknown (shape only)` on the hotel and many neighbors, `Floor numbering not verified`, confidence capped at Rough | P1 |
| PB02 | Orbit is smooth in all three cities (P01), and no building floats or is buried by more than 3 m | P1 |
| PB03 | Every layer toggles on and off in all three cities with zero console errors and no readout change | P1 |
| PB04 | Demo A: 5-8 operators reach all five decisions in ≤ 60 s without asking where something came from or how old it is | P1 |
| PB05 | Demo B: same, ≤ 90 s | P1 |
| PB06 | Demo C: same, ≤ 60 s | P1 |
| PB07 | Jesse and Justin approve the look against `./reference/` frames | S-1, then P1 |

### 9.11 Repo checks (AC-RC), in gods-eye-view

| ID | Command | Must |
|---|---|---|
| RC01 | `npm test` | Pass, including the new `tripTwinData`, `floorEstimate`, `demoTripTwin`, `tripTwinLifecycle` and palette tests |
| RC02 | `npm run format:check` | Pass |
| RC03 | `npm run build` | Pass, with Trip Twin in a separate lazy chunk |
| RC04 | `npm run check:boundaries` | Pass with no boundary file edits |
| RC05 | `node scripts/qa-trip-twin.mjs` | Pass in fixture mode in all three cities. The live pass may degrade but must never throw |

---

## 10. Traceability

Questions: Q1-Q5 (section 2). Scenarios: S1-S8 from 01 §3 (S1 wildfire, S2 hotel evacuation, S3 unrest, S4 medical, S5 earthquake, S6 active threat, S7 missing, S8 transport); demos A, B, C from 01 §8. Element IDs are 04 §4.

### 10.1 Readouts and chrome

| Element | Q | Scenarios | AC | Note |
|---|---|---|---|---|
| E1 Exit Trip Twin | — | all | F04, O03, A02 | Control. Kept as the kill switch. No question; exempt as an action (06 §1.1) |
| E2 Title and SAMPLE tag | Q5 | all | F24 | |
| E3 Breadcrumb | — | all | F04, A02 | Control. Weak trace; keep only because it is also the exit and focus indicator |
| E4 Local time and night chip | Q2 | S2, S3, S7, A | F25 | |
| E5 Roster count block | Q1 | all, A, B, C | F07, R01-R04, S03, S04 | |
| E6 Zone line | Q1 | S2, S3, S6, B | F08 | |
| E7 Needs attention list | Q1, Q5 | all, A, B, C | F09, A03 | |
| E8 Chaperones line | Q1 | S2, S4, S7, A | R01 | |
| E9 Rally chip | Q3, Q4 | S1, S2, S3, S5, A | F14, F15 | Straight line in P0, walk range in P1 |
| E10 Hazard summary | Q2 | S1, S3, S6, A, B | S06, F17 | |
| E11 Sources section | Q5 | all | S03-S08 | |
| E12 Live dot | Q5 | all | M05, S03 | Reduced-motion stand-in for the sweep |
| E13 Incident panel header | Q2 | A, B, C | F26 | |
| E14 Official instruction slot | Q2, Q3 | all, A | F26 | Fixture only; no production source (section 11.3) |
| E15 Reported incident card | Q2 | S2, A | F11 | |
| E16 Priority count | Q1 | S2, S4, S5, A | F12, FL06, R01 | |
| E17 Floor partition | Q1 | S2, S5, A | F12, FL04, FL06 | |
| E18 Hotel card block | Q3 | S2, A | F26 | Mock field without a 07 row today (X-52) |
| E19 "If the group must move" card | Q3, Q4 | S1, S2, S3, A, B | F15, F16 | |
| E20 Shelter in place card | Q3 | S3, S6, B | F26 | |
| E21 Information steps | Q1-Q5 (indirect) | S2, A | F26 | **Cut candidate**: weakest trace, decision DJ-04 |
| E22 Message status | Q1, Q5 | all | F26 | |
| E23 Stand-down line | Q3 (authority) | S2, A | F22, F26 | Doctrine 1 (01 §0); replaces a control that must never exist |
| E24 Send alert / Direct group here | — | all, A, B | F22 | Existing levers; action, exempt |
| E25 Copy for hotel / responders | Q1 | S2, S4, S7, A | F13 | |
| E26 Person card | Q1, Q5 | all, A, C | F27 | |
| E27 Safety resource card | Q3, Q4 | S4, S7, C | F14 | |
| E28 Path card | Q4 | S1-S3, S8, A, B, C | F15, F16, S09 | |
| E29 Hazard card | Q2, Q5 | S1, S3, S6, B | F17, F28 | |
| E30 Region banner | Q2 | S3, B | F28 | Mock field without a 07 row today (section 11.3) |
| E31 Edge chips | Q1, Q3 | S1, S7, C | F19 | |
| E32 Toolbar | — | all | F20, F21 | Control |
| E33 Layers popover | — | all | F21, PB03 | Control |
| E34 Legend | Q5 | all | F21 | |
| E35 More drawer | Q3, Q5 | S4, S5 | F21 | Tier 2 container |
| E36 Source line (attribution) | Q5 | all | L01, L02 | Legal obligation |
| E37 Sample watermark | Q5 | all | F24 | |
| E38 Reduced detail chip | Q5 | all | P06 | |

### 10.2 Scene elements

| Element | Q | Scenarios | AC | Note |
|---|---|---|---|---|
| S1 Context building glass | Q4, Q1 | all | F02, P03 | |
| S2 Building edges | Q4 | all | F02 | |
| S3 Hotel | Q1, Q3 | all | F03, X-01 | |
| S4 Scan sweep | Q5 | all | M05 | |
| S5 Grid floor | Q4 | all | F02 | |
| S6 Streets | Q4 | S3, S7, B, C | F15 | |
| S7 Fix dot and accuracy ring | Q1, Q5 | all | F06, S01, S02 | |
| S8 Photo pin | Q1 | all | F06, S01 | |
| S9 Hotspot ring | Q1, Q2 | all | F09, M07 | |
| S10 Cluster bubble | Q1 | S2, A | F06 | |
| S11 Floor ruler and floor lines | Q1 | S2, S4, S5, A | F10, FL07 | |
| S12 Person floor bracket | Q1 | S2, S4, S5, A | F10, FL02 | |
| S13 Reported floor slab | Q2 | S2, A | F11 | |
| S14 Group zone rings | Q1 | S3, S6, B | F18 | P1 |
| S15 Trip boundary | Q1, Q3 | S7, C | F18 | |
| S16 Safety glyph, ring, beacon | Q3 | all | F14 | |
| S17 Hotel assembly point | Q3 | S2, A | F26 | From the hotel card (X-52) |
| S18 Suggested path, primary and alternate | Q4 | S1-S3, S8, A, B, C | F15, M09 | P1 |
| S19 Path segment near hazard / in buffer | Q2, Q4 | S1, S3, B | F16 | P1 |
| S20 Chokepoint glyph | Q4 | S3, S7, S8, B, C | F15 | P1. NEEDS ENGINEERING INPUT: not in 03's module list (RK-20) |
| S21 Heat detection footprints | Q2 | S1 | F17 | P1. No scripted demo uses it (X-38); QA only |
| S22 Reported crowd area | Q2 | S3, S6, B | F28 | P1 |
| S23 Possible-area ring | Q1 | S7, C, A (R.O.) | F27 | |
| S24 2× accuracy ring | Q1, Q5 | S2, A | F27 | |
| S25 Selection tether | Q1 | S2, A | F10 | |
| S26 Geofence crossing tick (layer) | Q1 | S7, C | F27, F29 | Readout in the card covers Demo C. **Cut candidate** as a layer for the prototype |
| S27 Mapped entrance (layer) | Q4 | S2 | — | **No AC; cut candidate** for the prototype (P1-later, off by default) |
| S28 Edge-of-data fade | Q5 | all | F02 | |

### 10.3 Layers and motion with weak or no trace

| Item | Q | Scenarios | AC | Verdict |
|---|---|---|---|---|
| Venues & itinerary stops (06 5.3) | Q1 | none scripted | — | **Cut candidate** for the prototype |
| Earthquakes (06 2.3) | Q2 | S5 (not scripted) | — | **Cut candidate**: rail chip only, later |
| Disabled rows `Not in prototype` (cameras, unvetted OSM, driving paths, traffic) | — | none | — | **Cut candidate**: they answer nothing and add clutter; hide the rows instead of showing them disabled |
| Distance rings | — | none | — | Cut (X-40) |
| Height-ramp shader, bloom | — | none | — | Cut (X-13, 04 §4.3) |
| Photoreal context ring | — | none | — | Deferred (DJ-20) |
| Entry flight and scan-front dissolve | — (orientation) | all | M04 | Kept. It serves the brief's "feel like stepping into the future" requirement, not an operator question. Skippable and ≤ 1.0 s in an incident |
| Exit contraction and flight back | — (orientation) | all | F04, M04 | Kept; any input skips |
| Echoes, number crossfades, changed highlights | Q5 | all | M06 | Kept |
| Toast `Reported floor kept for this session` | Q5 | A | F11 | Kept |

---

## 11. If this works: production change summary (07)

### 11.1 Gates before any code in other repos (07 §3 Step 0)

1. The prototype passes its bar (section 9.10).
2. Real barometer recordings in 3 hotels meet the field-test bar (03 §11.6).
3. A DPIA covering floor-level location of minors is signed off.

### 11.2 Changes per repo, in dependency order (07 §3)

**Merge prerequisite.** Justin's stopped-phone work must merge first. Without it, every phone that stops on purpose turns `Last known` after 10 minutes, which reads as a false alarm and erodes trust (02 §0 finding 1).
- safetrekr-core `origin/stopped-phone-staff-ops` (commit `3cfc955`) exposes `presence`, `stationarySince`, `lastContactAt`.
- mobile-app `origin/stopped-phone-app` sends `stationary_since`.
- gods-eye-view: Jesse's branch is built on Justin's `stopped-phone-world-view`; the prototype PR depends on that branch (DU-02).

| Order | Repo | Change (07 ID) | Effort | Depends on |
|---|---|---|---|---|
| 1 | safetrekr-core | C1 merge `stopped-phone-staff-ops` | S | — |
| 2 | mobile-app | M1 merge `stopped-phone-app` | S | C1 |
| 3 | safetrekr-core | C2 add `geofences.source_id`; read `lodging_guests` → `places[].participant_ids` | S | verify 07 D-1, D-2 |
| 4 | safetrekr-core | C3 migration: 4 nullable lodging columns (`levels_above_ground`, `floor_height_m`, `lobby_height_m`, `ground_floor_label`) | S | — |
| 5 | safetrekr-app-v2 | A1 analyst fields for lodging metadata | M | C3 |
| 6 | safetrekr-core | C4 accept and validate `pressure_hpa`, `pressure_captured_at`, `barometer`; never write them to `participant_locations` (it is in Realtime); server-side lodging-proximity gate | S | — |
| 7 | safetrekr-core | C5 migration: `participant_vertical_anchors`, `participant_floor_estimates`; service role only; not in Realtime; down migration | M | — |
| 8 | mobile-app | M2 add `expo-sensors`, motion permission, background-read spike (native module fallback) | M | — |
| 9 | mobile-app | M3 consent screen and toggle ("never your room") | M | legal copy |
| 10 | mobile-app | M4 one-shot pressure read beside the battery read; additive body fields | M | M2, M3, C4 |
| 11 | mobile-app | M5 gate: active trip + near a lodging + consent | S | M4 |
| 12 | safetrekr-core | C6 `floor_estimate.py` (Python port of floor-v1, passes the shared golden vectors), anchor rule, terrain lookup, drift reference | L | C4, C5 |
| 13 | safetrekr-core | C7 hourly purge (≤ 24 h, trip end + 24 h), consent-off deletion | S | C5 |
| 14 | safetrekr-core | C8 attach `participants[].floor_estimate` to the snapshot; docs and OpenAPI | S | C6 |
| 15 | gods-eye-view | G1 enable `VITE_TRIP_TWIN` in production; fixture stays DEV-only | S | C1-C8 |
| 16 | gods-eye-view | G2 show `participant_floor_estimates` source issues | S | C8 |
| later | safetrekr-app-v2 | A2 analyst confirms OSM footprint for node-only hotels (P2) | M | — |

The snapshot additions are all additive, and gods-eye-view feature-detects each one (07 §2). This keeps the prototype PR separable from the Core and mobile PRs.

### 11.3 Gaps this plan found in the contract

The brief says every mocked field must trace to production. These prototype fields have no 07 row yet. They must be added to 07 before the P0 fixture is frozen (risk RK-05).

| Mock field or behavior | Used by | Proposed 07 status | Production path |
|---|---|---|---|
| `places[].hotel_card` (group floors and counts, assembly point, evacuation plan photo, lobby levels, people needing stair help as a count) | E18, S17, Demo A | NOT-COLLECTED | Chaperone check-in capture in mobile-app; Core storage; same role gating (01 §1.2) |
| Official instruction (filled slot) | E14 | NOT-COLLECTED (HUMAN) | Operator-entered field on a future Core incident record |
| Reported crowd areas and incident type | S22, E13 | SESSION | Future Core incident record (07 §1.6 already lists the reported floor as SESSION) |
| City-level advisory banner | E30 | NOT-EXPOSED | TarvaRI feeds exist in SafeTrekr but are not wired to World View (01 [A10]) |
| "Left the perimeter with" proxy | F29, Demo C | EXPOSED | Derived from existing `geofence_events` (X-51) |
| Floor consent off | FL04 | NOT-COLLECTED | `barometer:'denied'` → `unknown_reason:'consent_off'` (07 §1.5, X-34) |
| Extra unknown codes `position_stale`, `inconsistent_with_building`, `sensor_jump` | FL03 | NOT-COLLECTED | Added to the floor-v1 enum (X-26) |

---

## 12. Risks

Red route = it can block the demo or harm a decision. Owners: Jesse (product), Justin (World View), prototype engineer (ASSUMPTION: named by Jesse; see DJ-33), Core owner and mobile owner (to be named), legal/privacy reviewer (to be named).

| ID | Risk | L | I | Mitigation | Trigger / contingency | Owner |
|---|---|---|---|---|---|---|
| **RK-01** (red, 03 R-01) | Public Overpass at capacity (seen on 2026-10-15). On Vercel the disk cache is not writable and 4 mirrors × 22 s can exceed the 60 s limit | H | H | Minimal-twin degradation; 25 s client timeout; recorded OSM fixtures for demos and QA; P1 one-line `/tmp` cache change | Cold-open success < 90% over a demo week → demo from fixtures | Prototype engineer |
| **RK-02** (red, 03 R-02) | Operators read the client-derived verdict or floor band as verified fact | M | H | 06 wording, three-state verdicts, bands with age and confidence, "Not an alert", `Why?` explanations | Any operator reads `undetermined` as `inside` or out → copy change before merge | Jesse |
| **RK-03** (red, 03 R-03) | FOSSGIS OSRM fair-use limits or downtime; foot routes ignore hazards | M | M | ≤ 3 automatic routes; cache; honest captions; hazard proximity flag. Production: self-hosted router | > 5% route failures → on-demand routes only | Prototype engineer |
| **RK-04** (red, 03 R-04) | Real floor accuracy too low to help (HVAC, drift, no anchor) | M | H | Bands, unknown thresholds, field-test gate before any Core work | Field test fails → floor stays prototype-only; consider a commercial z-axis service (ADR-006 option D) | Jesse, Core owner |
| **RK-05** (red, new) | Mock fields with no production source break "mock data = the contract" (section 11.3) | H | M | Add rows to 07 before fixture freeze; replace co-location with a geofence proxy | Any fixture field without a 07 row → fixture review fails | Jesse, architect |
| **RK-06** (red, new) | Justin's stopped-phone branches stay unmerged | M | H (production) | Production prerequisite in section 11.2; prototype mocks the fields | Not merged by the gate review → next phase cannot start | Justin, Core owner |
| RK-07 (new) | 03's estimate predates 04 and 05, so the UI and motion scope is under-estimated | H | M | Planning figure adds +4-6 days (ASSUMPTION); P1 cut list in section 8 | P0 passes 15 dev-days → apply the cut list | Jesse |
| RK-08 (03 R-05) | The glass look is not futuristic enough with `Primitive` materials | M | M | Spike S-1 on day 1; glTF fallback | S-1 review fails → path C | Prototype engineer |
| RK-09 (03 R-06) | World View not restored exactly after exit | M | M | Single save/restore; lifecycle test; QA after a basemap change | Any flag difference → block merge | Prototype engineer, Justin |
| RK-10 (03 R-08) | Cesium floats to ≥ 1.140 (billboards need WebGL 2); custom shaders break | M | M | Pin `cesium` to 1.138.0 in this PR (DU-03) | Smoke failure on upgrade | Justin |
| RK-11 (03 R-10) | Hotel footprint mismatch for node-only hotels | H | M | 03 ladder; approximate cylinder with "not assessed"; analyst confirmation later (A2) | — | Prototype engineer |
| RK-12 (03 R-12) | Privacy objection to floor-level tracking of minors | M | H (next phase) | Consent, DPIA, staff-only, 24 h retention, off-by-default display | Legal review gate | Legal/privacy reviewer |
| RK-13 (03 R-11) | iOS background barometer read not possible through `expo-sensors` | M | H (next phase) | Spike; small native module fallback | — | Mobile owner |
| RK-14 (03 R-13) | Stakeholders expect indoor routes | H | M | Stated as out of scope here and in 03 | — | Jesse |
| RK-15 (new) | Hook drift and merge conflicts with Justin's active branch | M | M | Small hooks; lifecycle test through a fake globe; agree base branch first (DU-02) | Conflicts in more than 2 hook files → rebase review with Justin | Justin, Jesse |
| RK-16 (03 R-07, R-09) | Translucency artifacts; load spike when 8 layers re-enable on exit | L-M | L | Default OIT; `restoreEnabledLayerIds` with allSettled semantics | Visual QA in 3 cities | Prototype engineer |
| RK-17 (new, from 02 §4) | Open-Meteo's free API is non-commercial and existing World View code already uses it | M | M (business) | Paid plan or another source | Before any production use | Jesse |
| RK-18 (new) | `VITE_TRIP_TWIN` is build-time, so switching it off in production needs a redeploy | M | M (next phase) | Add a runtime switch before production enablement (DU-08) | — | Justin |
| RK-19 (03 R-14) | SOC wall performance at 4K | M | M | Out of scope; perf pass later | — | Justin |
| RK-20 (new) | Chokepoint detection, arrive-by arithmetic and car duration are required by demos B and C but are not in 03's module list | M | M | Add to `tripTwinData.js` scope in P1; NEEDS ENGINEERING INPUT on the chokepoint method (OSM bridge/tunnel/steps tags along the route vs shared-segment analysis) | Not specified by P1 start → Demo B uses "No independent alternate" text only | Prototype engineer |

---

## 13. Decisions needed

One list, deduplicated across 01-07. "Blocks" says when an answer is needed: **START** (before the prototype starts), P0, P1, or NEXT (next phase). Where I recommend an answer, the plan already assumes it.

### 13.1 Jesse decides

| ID | Question (sources) | Recommended answer | If yes | If no | Blocks |
|---|---|---|---|---|---|
| DJ-01 | Accept the reconciliations in section 7, including the 2× rule (06 F2, Q6) and aging counts as Not current (06 F3)? | Yes | One spec; fixture counts are fixed | Each conflict reopens; fixture and QA counts cannot be frozen | **START** |
| DJ-02 | Inside the twin, person rings show time state only, with no red or green on people (04 Q1, 06 F6)? | Yes | Color keeps one meaning; color-blind safe | Green travelers read as "safe", red as "hazard" | **START** |
| DJ-03 | Approve the exploded floor ruler as the signature floor visual (04 Q2, 05 [M-A11])? | Yes | Honest, legible, the most "sci-fi" element | Slabs on the building overlap and imply a known floor | **START** |
| DJ-04 | Keep the Information steps checklist (04 Q3)? | Keep, information steps only | Gives a sequence under stress | Less clutter; first P1 cut candidate anyway | P0 |
| DJ-05 | Operator-facing name: "Trip Twin" or "3D site view" (04 Q4, 06 Q7)? | Keep "Trip Twin"; test in the five-second test | — | Rename strings before the operator test | P1 |
| DJ-06 | May view-only roles add a reported floor (session only) (04 Q5, [SS-A8])? | Yes | Security officers can brief others; nothing is sent | They read only | P0 |
| DJ-07 | Build a coastal city now (01 §8, 04 Q6)? | Defer | Scope holds | Adds S5 logic and a fourth fixture | — |
| DJ-08 | Build any wall display in the prototype (04 Q7, 06 Q13)? | No; spec only | — | Needs a 4K perf pass first | — |
| DJ-09 | Bundle Intel One Mono in gods-eye-view (04 Q8, [SS-A3])? | Yes, with `ui-monospace` fallback (Justin to confirm the licence) | Brand type for HUD numbers | System mono | P0 |
| DJ-10 | Approve 04's `[vocab add]` strings (04 Q9) | Yes | Strings are final | Words change late | P0 |
| DJ-11 | Cut distance rings (06 Q9, 04 C9)? | Cut | One fewer row with no decision | — | — |
| DJ-12 | Transition: calm 1.2 s, incident ≤ 1.0 s, any input skips (05 MF4, 01 [A19])? | Yes | — | — | P0 |
| DJ-13 | When numbering is unknown, ask the lobby convention when a floor is reported (06 Q11); do not let operators set numbering elsewhere in the twin (06 Q10)? | Yes / no | Report and estimates compare correctly | Off-by-one risk | P1 |
| DJ-14 | Metric only (06 Q12, [IA-A7])? | Metric, as World View | — | Adds a unit setting | — |
| DJ-15 | "Unaccompanied" applies to travelers only (06 Q14)? | Yes | — | — | P0 |
| DJ-16 | Multi-lodging default (06 Q15)? | The lodging with most current people, else first by check-in | Predictable entry | — | P1 |
| DJ-17 | Keep blue for paths although World View uses blue for chaperones (06 Q3)? | Yes; the twin does not use blue for people | — | Pick another hue from the brand ramps | P1 |
| DJ-18 | Device-level reduced-motion preference in `localStorage` (05 [M-A5])? | Yes | — | System setting only | P0 |
| DJ-19 | Restore World View's followed person on exit (05 [M-A6])? | Yes, if the entity still exists | — | Follow is lost | P0 |
| DJ-20 | Photoreal "context ring" outside the twin in P1 (03 Q4)? | Defer | Simpler, cheaper | Adds Google cost and labeling | — |
| DJ-21 | Hotel verdicts never feed Core alerts (03 Q1, ADR-004)? | Confirm: never | Stays "not an alert" | Needs a Core footprint store | — |
| DJ-22 | Include the hotel card in the Demo A fixture and add it to 07 (01 [A2], X-52)? | Yes | Demo A works as scripted | Demo A shows `Interior unknown`; decision 4 is weaker | P0 |
| DJ-23 | Replace "Last co-located" with the geofence co-exit proxy (X-51)? | Yes | Traceable to production today | Needs location history and a privacy review | P1 |
| DJ-24 | "Band unchanged" flag at 8 min (X-20, 01 §2.6 says 10)? | 8 min; ops review later | Hero works as scripted | Re-script the hero to 10 min | P0 |
| DJ-25 | Offer the hotel as a path destination for "return to hotel" even though Direct group refuses it (04 [SS-A14], 01 [A12])? | Yes, paths only | Demo B works | Demo B loses the path back | P1 |
| DJ-26 | Require an "I verified …" tick before acting on a cross-source judgment (02 [A13])? | Yes | Friction where trust is lowest | — | P1 |
| DJ-27 | Accept the starting thresholds as written: rally ≥ 90° apart, ≤ 10 min, ≥ 50 m; hospital ≤ 20 min; outside-nearby 150 m; buffers 1 km fire / 500 m crowd; group pace 3-4 km/h at night; 25% buffer; detections stale after 6 h; review age 12 months; required categories per lodging (01 [A3], [A5], [A16], [A17]; 02 [A3], [A8], [A11], [A12]) | Yes, as starting values; ops review after the operator test | — | Values change in fixtures and tests | P1 |
| DJ-28 | Open-Meteo licence for existing code (RK-17) | Buy the commercial plan or replace before production | Clears exposure | Exposure remains | NEXT |
| DJ-29 | Field-test hotels and devices (03 Q5) | 3 hotels, ≥ 10 floors, ≥ 2 iOS and ≥ 2 Android devices | — | — | NEXT |
| DJ-30 | Name the DPIA and legal owner (03 §10.4, R-12) | Name before the gate review | — | Next phase cannot start | NEXT |
| DJ-31 | Traveler nationality (embassy choice) and minor status are not in the snapshot (01 [A1], [A14]) | Leave out of the prototype; escalation stays "check the organization's policy" | — | — | NEXT |
| DJ-32 | Who maintains lodging floor metadata: analyst in app-v2 or OSM prefill (03 Q2)? | Analyst field, with OSM shown as a prefill and mismatches shown | Single owner | — | NEXT |
| DJ-33 | Name the prototype engineer and the Core and mobile owners | Name before the start | Every roadmap item has an owner | Plan has no accountable builder | **START** |

### 13.2 Justin decides

| ID | Question (sources) | Recommended answer | If yes | If no | Blocks |
|---|---|---|---|---|---|
| DU-01 | Accept hooks H-1 to H-9 (about 120 lines in his files) (03 §5.2, ADR-005)? | Yes | Isolated, reviewable PR | Redesign of the integration | **START** |
| DU-02 | Which base branch does the PR target, and in what order do `stopped-phone-world-view` and this PR merge? | Target his `stopped-phone-world-view` (or its merge target) after it lands | Clean diff | Rebase churn (RK-15) | **START** |
| DU-03 | Pin `cesium` to 1.138.0 in this PR (03 Q3, R-08)? | Yes | Stable shaders and WebGL behavior | Upgrade drift risk | P0 |
| DU-04 | Suspend visual-mode digit keys inside the twin; confirm `A`, `[`, `]` are free (06 F5, Q5; [SS-A10], [IA-A4]) | Yes | No accidental FLIR on the hologram | — | P0 |
| DU-05 | World controls entry as a button "Open Trip Twin" (04 C10) | Yes | — | Checkbox implies a layer | P0 |
| DU-06 | Show send controls disabled with `View-only role` inside the twin only (04 C8) | Yes | — | — | P0 |
| DU-07 | Should World View later adopt "Approved", "Satellite heat detections", "Group zone" and time-state ring colors (06 Q8, F7, F9; 04 Q1)? | Consider after the operator test | One vocabulary across views | Two names for one thing | — |
| DU-08 | Add a runtime kill switch before production enablement (RK-18) | Yes | Off without redeploy | Redeploy needed | NEXT |
| DU-09 | FYI: `pulseFactor()` ignores reduced motion; `globe.js` misses mid-session setting changes; his sample geofence is named "Sample group safety zone" (05 MF6, 06 F8) | Fix in World View when convenient | — | — | — |
| DU-10 | Lodging deep link `?twin={id}` (06 [IA-A3]) | Later | — | — | — |

### 13.3 Mobile and Core owners decide (next phase)

| ID | Question (sources) | Recommended answer | Consequence | Blocks |
|---|---|---|---|---|
| DM-01 | Merge `stopped-phone-staff-ops` and `stopped-phone-app` (02 §0, 07 C1, M1) | Yes, before the gate | Without it, stopped phones read as last known | NEXT |
| DM-02 | Confirm `geofences.source_id` = `trip_lodging.id` and `lodging_guests.participant_id` = `trip_participants.id` (07 D-1, D-2) | Verify by query | Wrong joins break hotel-specific chips and assigned counts | NEXT |
| DM-03 | Can silent location checks carry a pressure reading (07 D-3)? | Verify on the branch | Stopped travelers otherwise get FLOOR STALE | NEXT |
| DM-04 | Does `expo-sensors` read the barometer inside the iOS background task, and are lodging geofences readable there (03 [A-7], [A-8], 07 D-4)? | Spike first | If not, a ~100-line native module | NEXT |
| DM-05 | Raw pressure retention: none beyond the computed estimate; 24 h for anchors and estimates (02 [A20], 03 §11.4) | Yes | Minimization | NEXT |
| DM-06 | Floor-v1 details: default lobby height 4.5 m (X-29), no fire-mode term (X-30), extra unknown codes (X-26) | As recommended | Golden vectors fixed in P0 | **P0** (vectors are written in P0) |
| DM-07 | Drift reference source: peer outdoor phones plus a paid weather trend (03 §11.3) | Yes | Accuracy beyond 1 h | NEXT |
| DM-08 | Self-hosted Overpass and OSRM when usage grows (03 §16) | Decide on usage data | Cost about $1.2-2.8k per year | NEXT |
| DM-09 | Hotel card capture and storage (X-52, 01 §1.2) | Plan with the next phase | Interior and assembly point become real | NEXT |

---

## 14. Prototype readiness checklist

No factory run (see the update at the top). Before and during the prototype, check:

1. **Blocking decisions.** DJ-01, DJ-02 and DJ-03 are answered, and the prototype builder is named.
2. **Fixture arithmetic.** The hero counts in section 7.3 add up from the per-person states under 06's rules. Freeze the baseline, Demo B and Demo C counts marked ASSUMPTION before writing the fixture.
3. **Contract completeness.** Every fixture field has a 07 row, including the gaps in section 11.3, so the later Core and mobile work is fully specified. Field names follow the naming rule.
4. **No edits to Justin's files.** `git diff` against `stopped-phone-world-view` shows only new files (`twin.html`, `src/operations/tripTwin*`, fixtures, tests).
5. **Testability.** Each AC in section 9 that the standalone page can prove names its test. ACs about entry from World View and exact restore are marked "deferred to integration".
6. **Engineering gaps.** Chokepoint detection, arrive-by arithmetic and car duration (RK-20) are specified before Demos B and C.
7. **Measurability.** The 30 fps and calm budgets are measured on the reference laptop.
8. **Repo checks pass:** `npm test`, `npm run format:check`, `npm run build`, `npm run check:boundaries`.
9. **Hygiene.** No secrets or real traveler data in any file.

---

## Plan-level assumptions

| ID | Assumption | How to check |
|---|---|---|
| PA-01 | Moving safety points into P0 and zone rings plus two cities into P1 roughly nets out against 03's estimates | Factory re-estimate |
| PA-02 | 04/05 chrome and motion add about 4-6 dev-days to P0; P1 extras add about 2-3 | Factory re-estimate |
| PA-03 | Baseline, Demo B and Demo C counts in section 7.3 are correct derivations of 01 §8 | Fixture author |
| PA-04 | One extra car-profile route request per destination stays within OSRM fair use | Route request counts in QA |
| PA-05 | The geofence co-exit proxy answers "who to ask first" as well as co-location did | Demo C operator run |
| PA-06 | An 8-minute "band unchanged" flag is acceptable to operations | Ops review |
| PA-07 | A prototype engineer can be named before the start | DJ-33 |

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: prd
skills_used: [SPO-041 PRD and RFC writing, SPO-001 acceptance criteria and DoR/DoD, SPO-044 prototyping and feasibility assessment, SPO-060 R&D evaluation and prototyping frameworks, SPO-053 feature flags, SPO-042 problem framing, SPO-033 decision logs, SPO-047 stakeholder alignment and decision facilitation, scope slicing, risk management, dependency coordination, traceability]
assumptions: [PA-01 re-slice nets out, PA-02 UI and motion add 4-6 days to P0 and 2-3 to P1, PA-03 baseline/B/C counts, PA-04 car duration within fair use, PA-05 geofence co-exit proxy, PA-06 8-minute band-unchanged flag, PA-07 engineer named, X-29 lobby default 4.5 m, X-50 car duration on demand]
confidence: 0.8
open_questions: [DJ-01 reconciliations, DJ-02 person colors, DJ-03 floor ruler, DJ-33 owners, DU-01 hooks, DU-02 base branch, DM-06 floor-v1 details, RK-20 chokepoint method, X-26 sensor_jump detectability, section 11.3 contract gaps]
source_artifacts: [plans/trip-twin/00-CONTEXT.md, plans/trip-twin/01-operator-scenarios.md, plans/trip-twin/02-layer-catalog.md, plans/trip-twin/03-architecture.md, plans/trip-twin/04-screen-spec.md, plans/trip-twin/05-motion-language.md, plans/trip-twin/06-layer-taxonomy.md, plans/trip-twin/07-production-delta.md, gods-eye-view/package.json (scripts only)]
-->
