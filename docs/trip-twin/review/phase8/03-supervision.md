# Phase 8 review: supervision (wider area: context ring and corridors)

Reviewer: supervision / autonomous-interface lens. Review only, no code edits.

**What I read**
- BACKLOG.md ("More of the city in 3D", including the trip-footprint production rule) and 07-production-delta.md. The delta does not carry the footprint rule yet.
- Shots 01–08 at 1600 and 1280, plus 1600-text.json and 1280-text.json.
- Code: `twinContext.js` (whole file), `tripTwin.js` (`loadContext`, `setContext`, the entry sequence, `teardownSelection`, the pick handler, chips), `page.js` (`WAYS_KEYS`, `viewLayer`/`setViewLayer`, the `keys()` context and corridor notes, `GROUPS`, `renderLayers`), `twinPeople.update`, `twinSafety.update`, `twinData.makeHeightfield`/`gridPoints`, `twinStreets.roadClass`, `twinDeclutter`, and `scripts/capture-trip-twin-context.mjs`.
- I tallied the three `*.context.json` fixtures: height sources, road classes, corridor walk lengths, and which hospital was chosen against the `*.pois.json` candidates.

**Verdict.** The view no longer ends in darkness, and the base rules are right: plain, neutral, not pickable, merged geometry. But the new geometry claims more coverage than the supervision layers give.
- People and safety places still stop at 500 m. The map now draws 1.2 km around the hotel, and corridors out to 4.5 km.
- The recorded date, the share of estimated heights and the flat ground beyond 500 m are not shown anywhere.
- Corridors are a frozen OSRM path from capture day. Nothing tells the operator when today's path leaves them.
- Corridor streets drop the tags phase 7 relies on, so motorways, tunnels and sidewalks are drawn wrongly again. This brings back phase-7 F2.
- Failure is silent. Venue twins show the hotel's ring under a label that implies it is their own.

---

## P0

### F1. The map now draws the ground where off-site travelers are, but still does not pin them. The chip says "outside the mapped area" while the area is visibly mapped
**Evidence.**
- `twinPeople.update`: `limit = site.radius + 100` (500 m). Anyone beyond is counted into `beyond` and never pinned. `tripTwin.js:948` turns that count into the chip "`N` outside the mapped area".
- `twinSafety.update`: `inView = site.radius + 100`. Safety places beyond 500 m become edge chips, not glyphs.
- The context ring is drawn to 1,200 m. Corridors run to the venue door: 1.7 km (Austin), up to 4.46 km of walk (DC → Kennedy Center).
- Shots 01, 05 and 07 (City): the corridors to Long Center, Texas Capitol and Air and Space are drawn and labelled with no pins along them, while the chip says "4 outside the mapped area".
- Austin: the corridor to Ascension Dell Seton is drawn and labelled at the hospital door. The hospital itself is only the chip "Hospital 1.0 mi N", with no glyph where the corridor ends.

**Risk.** Before phase 8, the darkness past 500 m told the operator "nothing shown here". Now a drawn, lit corridor with no pins reads as "nobody on the way to the venue". A traveler walking the Long Center corridor alone is the case the operator most needs to see, and it is the case the view now hides behind a scene that looks complete. The chip copy is now factually wrong.

**Spec.**
1. Define the **drawn footprint** when the context is ready: within `meta.ringM` of the ring centre, or within `meta.corridorM` of any `corridors[].path`. The path is already in the fixture.
2. Pin located people inside the footprint with a "beyond detail" style: ground-level, no floor ruler, outlined pin, tag "wider area · position only". Same selection and attention rules as core pins.
3. Draw safety places inside the footprint as glyphs, not chips. The corridor's hospital end must carry the hospital glyph.
4. The chip counts only people outside the footprint: "`N` beyond the wider area". If the context is not ready or unavailable, keep today's 500 m rule and today's wording.
5. Tests:
   - A fixture person on the Austin Long Center corridor, 900 m from the hotel, gets a pin and drops out of the chip count.
   - With the context missing, the same person goes back to the chip.

---

## P1

### F2. The recorded date, OSM caveats, estimated heights and flat ground are not visible for the wider area
**Evidence.**
- **Date.** `loadContext` stores `contextInfo.fetchedAt` (`2026-10-16T15:50Z` Austin, `15:53Z` DC, `15:57Z` London), but nothing renders it. The `keys()` notes (`page.js:2913–2931`) carry no date.
- **Date shown elsewhere is a different capture.** The footer "OSM buildings · recorded 2026-10-15" and the Ways out banner "(recorded 2026-10-15)" (shot 05) describe the detailed core. Read together, they imply everything on screen is from the 15th.
- **Estimated heights.** The note says only "heights mapped or estimated". The fixtures:

  | City | Ring buildings | Default 9 m (no height, no levels) | From levels × 3.2 m |
  |---|---|---|---|
  | Austin | 2,266 | 759 (33%) | 149 |
  | DC | 3,648 | 3,244 (89%) | 316 |
  | London | 3,707 | 2,821 (76%) | 840 |

  In DC, almost all of downtown is drawn as 9 m (about 3 storeys) in a city of 30–40 m blocks.
- **No visual difference for estimates.** The core layer encodes estimated heights ("Mapped height · fainter = approximate", shot 03). The context layer draws every building at one alpha (`#415e6b` 0.08 / 0.14).
- **Flat ground.** `gridPoints` covers ±(400+100) m and `makeHeightfield.at` clamps beyond that. Every context building and street past 500 m sits on the edge height of the core field. Austin's Capitol hill, about 30 m above the hotel, is flat. Elevation contours stop at the core.

**Risk.**
- The operator cannot tell how old the wider area is, or that most of it is guessed.
- A low, flat skyline misleads on sightlines, landmarks and walking effort (uphill to the Capitol).
- Two capture dates with one label is the "trust me" pattern this product has avoided so far.

**Spec.**
1. The Wider area note in Layers reads: "Recorded 16 Oct 2026 · OpenStreetMap · {n} buildings · {pct}% heights estimated (9 m default or levels × 3.2 m) · ground drawn flat beyond 500 m · not selectable". Corridors add: "path suggested by OSM routing (FOSSGIS OSRM, foot) on 16 Oct".
2. Draw estimated-height buildings (no `h`) outline-only, or at half the fill alpha. Add a legend swatch, matching the core rule.
3. The footer and the Ways out banner name each layer's date: "Detailed area 15 Oct · Wider area 16 Oct". If the two differ by more than 30 days, or either is older than 90 days, show "recorded N days ago" in amber.
4. Extend the heightfield (a coarse 1.2 km grid, about 100 m spacing) or say "flat" as above. Do not leave it implicit.

### F3. Corridors are one frozen walking path. When today's path differs, nothing shows it, and the "Corridor · X" label reads as the route
**Evidence.**
- `walkPath()` makes one OSRM foot call (`alternatives=false`) at capture time. Its geometry is thinned to ≤50 points (`thin()`) for the Overpass buffer and stored as `corridors[].path`.
- The runtime never compares that path with the twin's live suggested paths, saved paths or avoid-areas. `twinContext.js` has no reference to paths or avoid-areas.
- Map label: "Corridor · Texas Capitol" at the venue door (shots 01, 07, 08). Legend: "Buildings and streets along the walk to each venue".

**Risk.** The operator saves a different path, or an avoid-area closes a street on the corridor. The bright strip still marks the old way, and the saved path runs through plain ring or darkness. Travelers on the real path appear "off corridor" and, with F1, not pinned at all. The lit strip quietly acts as a second, unreviewed path suggestion. Phase 7 settled that a suggested path stays "Suggested · unverified" until it is reviewed.

**Spec.**
1. Rename it "recorded area". The map label becomes "Recorded area · to Texas Capitol", and the legend reads "Buildings and streets within 150 m of a walking path suggested on 16 Oct. Not a planned path."
2. Whenever a suggested path or saved path exists between the same ends, compute how many metres of it lie more than `corridorM` from `corridors[].path`. If that is over 100 m, show it:
   - Path card: "Leaves the recorded area for 340 m. Buildings there are plain or not drawn."
   - Layers corridors note: the same line.
   - Do the same for an avoid-area that intersects the corridor path: "The recorded path crosses avoid-area 'X'".
3. Corridors never use path colours (blue, dashed), never draw their own centreline and never get chevrons. Today's code complies; keep it as a rule.
4. Production (trip-footprint rule): rebuild corridors from the saved or approved path at trip set-up and again when a path is saved. Store the source path id and date with the corridor.

### F4. Corridor and ring streets drop the tags phase 7 relies on, so motorways, tunnels and sidewalks are drawn wrongly again (phase-7 F2 returns)
**Evidence.**
- `compact()` in the capture script keeps only `k: highway` and `n: name`. It drops `tunnel`, `footway`, `access`, `foot`, `bridge` and `layer`. So `roadClass(r.k)` can never return `hidden` (tunnels, `footway=sidewalk`). It also cannot detect `access=private` or `foot=no`.
- Corridor `colorFor` falls through for `nowalk` to `{w: 1, c: #80959b 0.45}`. That is a thin grey line, which reads as phase 7's "Alley or service road", not the thick `#415e6b` "No walking".
- DC corridors contain 35 motorway and 17 trunk segments, including the I-395 tunnel near the Capitol Hill hotel, drawn at street level. They also contain 2,687 footways, many of them sidewalks the phase 7 legend says are "part of the street".
- The ring filter keeps only `major`/`minor`, so trunk roads vanish from the ring entirely (London 105 trunk segments, DC 48 trunk + 21 motorway). These are the dual carriageways a group cannot cross.
- The Ways out banner (shot 05) says "tunnels not drawn". That is false for corridors.

**Risk.** In Ways out (which forces `context`/`corridors` on via `WAYS_KEYS`), the operator can read a motorway tunnel as a walkable street next to the hotel. A real barrier road beyond the core is simply missing.

**Spec.**
1. Capture `tunnel`, `bridge`, `layer`, `footway`, `access` and `foot`, and pass the object to `roadClass`.
2. Ring and corridors use the same class-to-style map as `twinStreets`: `nowalk` thick `#415e6b`, `hidden` not drawn. The ring keeps `nowalk` roads.
3. The Ways out banner caveats and date cover the wider area too (see F2).
4. Test: in the DC fixture, no drawn corridor or ring segment has class `hidden`, and every motorway or trunk segment draws with the `nowalk` style.

### F5. Venue twins show the hotel's ring, labelled as if it were theirs. The venue case was not captured
**Evidence.**
- `loadContext` loads `siteConfig(key).city`, so every venue gets the hotel-centred fixture. `contextPlan` subtracts only the venue's own core.
- The Layers row still reads "Wider area (1.2 km) · {n} buildings".
- DC Kennedy Center is 3.9 km from the hotel. Its twin gets only the end of one corridor strip. The "1.2 km" ring is about 4 km away, and every context base height comes from the venue's 500 m heightfield (clamped).
- Austin Capitol is 1.37 km away, so the ring only partly covers it.
- Shot 06 "capitol-venue-city" shows the hotel ("Fairmont Austin" header, hotel card, same view as 01). The venue state is not in evidence.

**Risk.**
- At a venue, the operator believes there is 1.2 km of context around them when there is a strip.
- Hotel-side context is drawn at the wrong ground height.
- The production rule ("site cores + path corridors + rings around safety places") is not reflected or flagged.

**Spec.**
1. Until there are per-site rings, show the row note "Around the hotel (Fairmont Austin), 1.4 km from this venue". When the ring centre is more than `ringM` from the active site, show the row unchecked and disabled, with "No wider area recorded around this venue".
2. The capture script records a ring per venue (and per approved safety place) at `RING_M`. The fixture becomes per-site, or carries `rings[]` with centres.
3. Re-shoot 06 with the venue actually selected, at City and Neighborhood.

### F6. A missing or failed wider area is silent, and the controls say it is on
**Evidence.**
- On a fetch or parse error, `loadContext` sets `contextInfo = {status:'unavailable'}` and writes a `console.warn`.
- `contextState` stays `{ring: true, corridors: true}`, so both Layers checkboxes stay checked.
- The ring note becomes "Wider area unavailable for this site". The corridors note falls back to "About 150 m either side of a suggested walking path", which implies it is there.
- Nothing appears on the map or in the footer. Ways out "turns on" layers that do not exist.
- At capture time, a failed corridor is skipped (`corridor → X skipped`). The fixture then lacks that venue, and the UI lists only the corridors present ("To Long Center, Texas Capitol, …") with no "missing" line.

**Risk.** The view falls back to 500 m without telling anyone. An operator who has learned that corridors exist assumes an absent corridor means the area is empty, or that the venue was never part of the trip.

**Spec.**
1. Rows follow the status:
   - **Loading** (more than 3 s): "Loading the wider area…".
   - **Unavailable:** checkbox disabled and unchecked, with the note "Not loaded ({HTTP status / parse error}). The map ends at the detailed area (500 m)." Corridors get the same treatment.
   - **Ready:** as today, plus F2.
2. Show a footer badge: "Wider area: not loaded" while unavailable.
3. Compare the trip's venues (and the approved hospital) with `corridors[].key`. For each one without a corridor, show "No corridor recorded for Kennedy Center".
4. Retry once on network error (not on 404).
5. Tests: a 404, malformed JSON, and a fixture missing one venue's corridor.

---

## P2

### F7. The hospital corridor is a walking route to an ER chosen by a capture rule, not the trip's approved hospital
**Evidence.**
- The capture picks `emergency=yes` first, then the nearest, on the foot profile.
- Results:
  - DC: Howard University Hospital, 2.8 km walk.
  - Austin: Dell Seton, 1.8 km.
  - London: Evelina London Children's Hospital (paediatric). St Thomas' (adult A&E, same `emergency=yes`) is about 90 m away.
- The legend says "the walk to each venue and the nearest hospital".
- The demo's approved hospital uses the same rule, so they agree here. In production the approved hospital comes from `safety_points`, and the two can diverge.

**Risk.**
- The view implies walking a hurt student 2.8 km to an ER.
- An adult chaperone would be pointed at a children's hospital.
- If the corridor's hospital and the approved hospital differ, there are two "hospitals" on screen.

**Spec.**
1. Source the hospital corridor from the trip's approved hospital safety point (category `hospital`, `approval_status: active`).
2. Label it "Area toward {name}". Above 1 km, add "by vehicle {x} km" and use the car profile.
3. If the hospital is paediatric-only, add "Children's hospital · adults: {nearest adult ED}".
4. If the recorded end differs from the approved hospital, show "Recorded to X; approved hospital is Y".

### F8. In an incident and in Ways out, venue corridors keep their weight. Corridor labels collide, and corridor and ring look the same
**Evidence.**
- Shot 08 is the London incident (smoke, floor 9). It shows "Corridor · Festival Hall" and "Corridor · Westminster Abbey" at City view. No hospital corridor label is visible; it is probably decluttered behind the H glyph.
- `setContextDim` dims only the core buildings. Outside the core, shot 05 (Ways out) looks the same as shot 01.
- Labels stack under venue beacons: "Long Center · Day 2 19:00" over "Corridor · Long Center" (shots 01, 02). In 02 they also sit under "Group shelter · chaperones only".
- The hospital corridor label runs under the chip row (1600-01, 1600-05). The declutter bounds cover left and right only.
- Ring and corridor differ only by fill alpha (0.08 vs 0.14) and edge tint. In shot 01 you cannot tell which buildings belong to a corridor.

**Risk.**
- During an incident, the labels that compete for attention are venue errands, while the one corridor that matters (the hospital) is hidden.
- Corridor recognition depends on a brightness step that fails the non-text contrast rule (1.4.11) against the ring.

**Spec.**
1. In incident status: venue corridors drop to the ring style and their labels hide. The hospital corridor stays, and its label merges into the hospital glyph's label ("Hospital · {name} · recorded area").
2. Fold the venue corridor label into the venue beacon as a second line ("recorded area to here") instead of a separate entity.
3. Set the declutter top bound to the bottom of the chip row.
4. Mark corridors with something other than alpha, for example a brighter edge colour at ≥3:1 against ring edges, plus a legend swatch in the Corridors row.

### F9. Wider-area cost is unmeasured. readyMs excludes it, and every site switch rebuilds it
**Evidence.**
- `loadContext(site)` runs after `stats.timings.readyMs` is set (readyMs 9.2–11.4 s in the shots), and there is no context timing.
- Fixture sizes: 1.7, 2.8 and 2.1 MB of uncompressed JSON.
- DC alone builds about 3.6k ring and 1.6k corridor extruded translucent polygons, each with an outline, plus about 11k polylines.
- `teardownSelection` disposes the layer, so hotel ↔ venue switches in the same city re-fetch, re-parse and rebuild it.
- Clicking a context building calls `select(null)` and drops the hotel card, though the layer is described as "not selectable".

**Risk.** The view jank at City scale on the laptops operators use is not known, and nothing would show a regression. Losing the card on a stray click into the context is a small but real loss of state.

**Spec.**
1. Record `stats.timings.contextFetchMs`, `contextBuildMs` and `contextReadyMs` (until all Primitives report `ready`), plus p95 frame time over a 5 s City orbit with the context on and off.
2. Budget: context ready ≤2 s after the twin is ready, p95 frame ≤33 ms on an integrated-GPU laptop. Over budget, drop the ring outlines first, then cull the ring by camera distance.
3. Cache parsed data per city across site switches (rebuild primitives only), and serve the fixtures gzipped.
4. A pick that hits a context primitive does nothing: no `select(null)`.
5. Add a unit test for `contextPlan`: dedup, core subtraction, and the class filters.

---

## Evidence gaps
- Shot 06 does not show a venue (see F5).
- There are no frame-time or context-load numbers (F9).
- The hospital corridor label in shot 08 cannot be confirmed as decluttered rather than missing.

<!-- FACTORY_OUTPUT_METADATA
artifact_type: supervision_review
agents_covered: 0
capabilities_mapped: 0
autonomy_tiers_defined: 0
exceptions_categorized: 0
reversibility_documented: false
multi_surface_covered: false
kill_switch_specified: false
audit_log_surface_designed: false
wcag_level: aa
metrics_leading: 0
metrics_lagging: 0
kill_criteria_defined: 0
confidence: 0.8
source_artifacts: [BACKLOG.md, 07-production-delta.md, review/phase8/shots/*, twinContext.js, tripTwin.js, page.js, twinPeople.js, twinSafety.js, twinData.js, twinStreets.js, twinDeclutter.js, capture-trip-twin-context.mjs, fixtures/trip-twin/*.context.json, *.pois.json]
-->
