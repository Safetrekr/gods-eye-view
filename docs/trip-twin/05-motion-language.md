# 05 Trip Twin motion language

Owner: motion designer. Status: draft for PROJECT-PLAN.md. Date: 2026-10-15.

Inputs read: 00-CONTEXT.md, 01-operator-scenarios.md, 02-layer-catalog.md, 03-architecture.md, 06-layer-taxonomy.md, the reference frames in `./reference/`. Code read (read-only) in gods-eye-view on `jesse/world-view-visual-layer`: `src/operations/globe.js`, `visualModes.js`, `operations.css`, `model.js` (`PEOPLE_COLORS`), `src/annotations/worldAnnotationRenderer.js` (`GevRouteFlow`, `pulseFactor`), `src/renderGovernor.js`.

What this file decides:
- How Trip Twin moves, why each motion exists, and its exact parameters (ms, cubic-bezier, stagger, Cesium options).
- The five signature sequences, frame by frame.
- What may move while the scene is at rest, and the hard limits that keep the scene calm.
- How motion marks freshness, uncertainty and change, and the static equivalent each one must have.
- The reduced-motion behavior of every sequence, and the in-app toggle.
- The GPU and CPU budget for motion inside 03's 30 fps budget, and what degrades first.

Labels used here are the exact strings from 06. Colors use the SafeTrekr brand tokens from 00-CONTEXT and the semantic roles set by 06 section 5.1. Assumptions are tagged **[M-A#]** and listed in section 10. Conflicts with other sections are in section 0.

---

## 0. Findings that change other sections

| # | Finding | Resolution used in this file | Owner to confirm |
|---|---|---|---|
| MF1 | 03 section 4.5 tints the hotel `twin-ours` brand green. 06 section 5.1 says green is never drawn on the hotel, and 01 anti-pattern 22 says a glowing hotel reads as "safe zone". | The hotel uses the neutral subject treatment from 06: edges `#b8c3c7`, brighter than context, no green. Motion never makes the hotel glow, pulse or breathe. | 03 architect, 04 |
| MF2 | 03 section 4.5 runs the scan sweep on a free-running 6 s cycle, meaning "feed is live". A metronome that runs whether or not data arrived is ambient motion with a weak link to the fact. | One sweep per **received snapshot** (every 15 s when healthy). No snapshot, no sweep. The stop rule (snapshot older than 45 s) is the same. Same shader uniform, different trigger. Duty cycle drops from 27% to 11%. | 03 architect |
| MF3 | 03 section 7.4 draws the primary path with continuously flowing dashes (`GevRouteFlow`). 01 section 6.2 forbids implying "that people are moving along the route", and continuous flow is ambient motion with no new information after the first second. | A path draws on once from origin to destination (480 ms), then holds still with static direction chevrons (06 legend). No flow at rest. | 03 architect, Justin |
| MF4 | 01 [A19] caps the transition at about 1 s during an incident. 03 section 8 sets 1.2 s. | Calm entry: camera flight plus a 1.2 s dissolve. Incident entry: at most 1.0 s from data ready to settled, with all information on screen at the first frame of the dissolve (section 3.1). | Product owner |
| MF5 | 02 section 6 scripts a fire on level 5. 01 Demo A (the hero) scripts smoke on floor 9. | Section 3.4 uses 01 Demo A: smoke reported on floor 9 by the hotel desk at 02:12, at the Fairmont Austin (03: OSM way 134786106, 37 levels). | 02 analyst |
| MF6 | `worldAnnotationRenderer.js` `pulseFactor()` (0.8 + 0.2 sin, period about 1.26 s) runs forever and ignores `prefers-reduced-motion`. `globe.js` reads `matchMedia` only at call time, so a setting change mid-session is missed until the next flight. | Trip Twin does not reuse `pulseFactor`. All twin motion goes through one motion controller that listens to `matchMedia(...).addEventListener('change')` (section 8.1). The World View issue is noted for Justin, not fixed here. | Justin |
| MF7 | The existing global rule in `operations.css` (`@media (prefers-reduced-motion: reduce)` sets `animation: none !important; transition: none !important`) cannot be overridden from inside the app. | The in-app control can only reduce motion further. It cannot force full motion when the operating system asks for reduced motion (section 6.3). | Product owner |

---

## 1. Motion principles

Every Trip Twin motion has exactly one of five named jobs. The job is written next to the motion in every table in this file, and a motion with no job is cut.

| Job | Meaning |
|---|---|
| **ORIENT** | Keep the operator's spatial model intact across a change of view (where am I, what replaced what) |
| **CAUSE** | Show where a change came from, or what it applies to |
| **FRESH** | Mark that data arrived, or that its time state changed |
| **ATTEND** | Pull the eye to something that needs an operator decision now |
| **CONFIRM** | Acknowledge an operator action |

### P1. Information never waits for motion

Readouts and data are on screen at their final values before, or at the first frame of, any animation. A sequence animates presentation around information that is already there. Any pointer or key input during a sequence finishes it at once, at its end state. A snapshot that arrives mid-sequence applies immediately; it is never queued behind an animation.

| This | Not that |
|---|---|
| The roster line fills in the rail as soon as the snapshot and footprint are parsed, while the hologram is still dissolving | Counts that appear after the cinematic, or numbers that count up from 0 |
| People pins swap from World View pins to twin pins in one frame at the start of the dissolve | Pins that wait for the reveal front to reach them, leaving people off screen for up to 900 ms |

### P2. One motion, one job

Each motion names one job. If two meanings need to be shown, two different static encodings carry them, and at most one of them moves.

| This | Not that |
|---|---|
| The sweep up the hologram glass means "a traveler snapshot just arrived" and nothing else. It stops when data stops | A shimmer on the glass, a breathing glow on the hotel, rotating HUD rings, an idle orbit of the camera |

### P3. Data snaps; presentation moves

A data value never animates between two readings, because the intermediate values were never observed. Positions, accuracy radii, floor bands, counts and ages jump to the new value. The previous value is shown for 1.2 s as a hollow **echo** at its old place, which shows that a change happened and where it came from without inventing a path. This applies 01 anti-pattern 2 to every data-bearing element. No easing curve in Trip Twin overshoots (no spring, back or elastic), because an overshoot shows a value the data never had.

| This | Not that |
|---|---|
| A pin jumps to its new fix; a hollow ring at the old fix fades out over 1.2 s; there is no line between them | A pin gliding from A to B (01 anti-pattern 2), or a floor bracket sliding from 6–8 to 4–6 as if the phone was read in between |

### P4. Calm by default; attention is rationed (E40, calm under complexity)

At rest, at most one thing moves continuously (the per-snapshot sweep), and at most three things pulse at the same time across the whole screen. A pulse **announces** a new or worsened attention state for three cycles and then stops; a static amber hotspot ring **persists** for as long as the state lasts. When several people share one reason, the group's marker pulses, not each member.

| This | Not that |
|---|---|
| "At or above reported floor 9: 3" pulses once as a group bracket for 3.6 s, then holds as a static amber bracket with its count | Twelve pins blinking until someone clicks them |

### P5. Motion starts at the cause

Anything that appears spreads out from the thing that caused it or that it belongs to. Nothing flies in from a screen edge.

| This | Not that |
|---|---|
| The photoreal city falls away from the hotel outward; a path draws from the hotel's street start to the destination; the at-or-above bracket grows upward from the reported floor slab | Layers fading in all at once from nowhere, panels zooming from the center of the screen, a hazard footprint growing from a point (which reads as "spreading", forbidden by 02 C4) |

### P6. The operator owns the camera

The camera moves only as a direct result of the operator's own action (open, focus, change scale, add a report). Data arriving from a feed never moves the camera; it raises a chip the operator can click. Camera motion has hard speed caps (section 6.4), never rolls, never auto-orbits, and never runs at the same time as a scene transformation. Every sequence can be cancelled, and leaving is always faster than entering.

| This | Not that |
|---|---|
| A new heat detection appears in place with a rail chip "Satellite heat detections · 2.4 km NW · View"; the view stays where the operator left it | The camera swinging to a new hazard while the operator is reading a person card |

### P7. Sci-fi through light and material, not through movement

The future feel comes from translucent fresnel glass, crisp edge light, the grid, monospace HUD readouts (Intel One Mono) and one signature transition: the scan front that replaces the city with the twin. That front echoes the reference film (0:12–0:20 building dissolve; 5:03 scan-plane reveal on the table). Everything else is still or nearly still.

| This | Not that |
|---|---|
| A single bright scan front crosses the city once at entry; afterwards the hologram is quiet glass | Particle sparkle on the scan front, scanlines on panels, data-stream text, a permanent radar sweep, the film's exploded-component spin |

---

## 2. Motion tokens

### 2.1 Duration scale

Tokens are in milliseconds. Cesium takes seconds, so divide by 1000. The canvas renders at 30 fps (`viewer.targetFrameRate = 30`, 03 section 1), so one canvas frame is 33.3 ms. Canvas animations are evaluated from `performance.now()`, not from frame counts, so a dropped frame shortens nothing.

| Token | ms | Canvas frames at 30 fps | Use | Rule |
|---|---|---|---|---|
| `dur.instant` | 0 | 0 | Reduced motion; data snaps | — |
| `dur.micro` | 120 | (DOM only) | Button press, toggle thumb, text swap | Canvas has no 120 ms token: below 200 ms a canvas change is instant, because 3–4 frames read as a flicker |
| `dur.short` | 200 | 6 | Single-item fade, ring line-style morph, label in, hotspot ring appear | — |
| `dur.medium` | 320 | 10 | Panel or card enter, layer show, floor ruler transfer (FLIP) | — |
| `dur.long` | 480 | 14–15 | Camera recenter or drill, path draw-on, scale change | — |
| `dur.dissolve` | 1200 | 36 | Entry reveal, calm profile | Fixed by 03 section 8 |
| `dur.dissolve.incident` | 400 | 12 | Entry reveal, incident profile | 01 [A19] |
| `dur.echo` | 1200 | 36 | Hollow echo of a previous value; changed-row highlight | — |
| `dur.pulse` | 1200 per cycle, 3 cycles | 36 per cycle | Hotspot ripple | 0.83 Hz, far below the 3 Hz flash threshold |
| `dur.sweep` | 1600 | 48 | One snapshot sweep, ground to roof | One per received snapshot |
| `dur.flight(d)` | 600–2400 | 18–72 | Camera flight across distance `d` | Formula below |

Flight duration from distance `d` (metres, straight line from the current camera position to the destination):

`dur.flight(d) = clamp(600 + 350 × log10(d / 100), 600, 2400)` ms.

Examples: 100 m → 600 ms; 1 km → 950 ms; 10 km (World View city zoom) → 1300 ms; 1,000 km → 2000 ms; globe overview (~18,000 km) → 2400 ms. Long flights slow down logarithmically so the operator is not carried across a continent at a speed that disorients them.

Profile multipliers (applied by the motion controller, section 8.1):

| Profile | When | Multiplier | Floor | Stagger |
|---|---|---|---|---|
| Calm | Default | 1.0 | — | Per 2.3 |
| Incident | An operator-entered report exists, a Tier A judgment is active (02 section 3), or the twin was opened from an alert (06 E3) | 0.6 on `dur.short` to `dur.long` for everything except the camera; flights capped at 600 ms; focus and incident camera moves keep `dur.long` (480 ms), because a faster camera is a vestibular risk (6.4); dissolve uses `dur.dissolve.incident` | 200 ms (canvas), 120 ms (DOM) | None |
| Exit | Any leaving or hiding motion | 0.75 | Same floors | None |
| Reduced | `prefers-reduced-motion: reduce` or the in-app setting | 0 for everything | — | None |

### 2.2 Easing curves

Every curve stays inside y ∈ [0, 1]: no overshoot anywhere (P3). The same four curves drive CSS, the Web Animations API and Cesium, through one cubic-bezier solver (section 8.2).

| Token | cubic-bezier | Character | Use |
|---|---|---|---|
| `ease.standard` | `(0.2, 0, 0, 1)` | Quick start, long soft settle | Things changing in place: reveal radius, ring morph, bracket growth, path draw-on, layer show |
| `ease.enter` | `(0, 0, 0.2, 1)` | Decelerate | Arrivals: panels, cards, labels, hotspot ripple expansion |
| `ease.exit` | `(0.4, 0, 1, 1)` | Accelerate | Departures: hides, closes, exit dissolve, the dissolve's horizon phase |
| `ease.camera` | `(0.4, 0, 0.1, 1)` | Gentle start, long deceleration tail | Every camera flight. The last 30% of the time covers about 3% of the distance, so the view is nearly still when the operator starts reading |
| `linear` | — | Constant | Only the sweep's travel and the existing loading spinner (`ops-spin`). Never on a discrete state change |

Cesium's built-in `EasingFunction` constants are not used, because they cannot match the CSS curves. Every `flyTo` passes `easingFunction` explicitly (section 8.3); the Cesium default is never relied on.

### 2.3 Stagger rules

| # | Rule |
|---|---|
| S1 | Order by attention priority (06 D2: reported incidents and nearest hazard, people with a hotspot, chosen destination and path, hotel name, rally points, everything else), never by DOM order, distance alone or alphabet |
| S2 | DOM lists: 30 ms per item. Canvas: no per-item stagger; use a radial delay from the hotel, `delay = dur.medium × (d / R)`, so a layer spreads from the subject (P5) |
| S3 | Total stagger is at most 240 ms. Items past the 8th appear with the 8th |
| S4 | Incident, exit and reduced profiles: no stagger |
| S5 | Never stagger inside a readout. A card, a roster line or a partition line appears complete |
| S6 | Hides never stagger |

### 2.4 Where each token goes: Cesium vs CSS

| Surface | Mechanism | Token use | Notes |
|---|---|---|---|
| Camera (canvas) | `camera.flyTo` / `flyToBoundingSphere` with `duration = ms / 1000`, `easingFunction = bezier(ease.camera)`, `maximumHeight` capped; `camera.cancelFlight()` on input | `dur.flight(d)`, `dur.long`; `ease.camera` | Section 8.3 |
| Hologram glass, edges, grid, roads (canvas) | Material uniforms written in one `scene.preRender` listener from `performance.now()` | `u_reveal` (dissolve), `u_sweepH` (sweep), `u_layerAlpha` (layer show), `u_cutH` (floor focus) | Section 8.4. One listener for the whole twin |
| Google tileset / globe (canvas) | `ClippingPolygonCollection` radius, entry and exit only | Same radius as `u_reveal` | Section 8.5 |
| Pins, rings, labels, bands (canvas) | Entity `show`, `Color` alpha, billboard `scale`; positions through `ConstantPositionProperty.setValue` only | `dur.short`, `dur.echo`, `dur.pulse` | Never `SampledPositionProperty`: it interpolates between fixes, which P3 forbids |
| Hotspot ripples (canvas) | One small `BillboardCollection`, at most 3 live billboards | `dur.pulse`, `ease.enter` | Section 8.6 |
| HUD, rail, panels, cards, legend (DOM) | CSS transitions and keyframes on `transform` and `opacity` only; WAAPI (`element.animate`) for sequences that need `finish()` on skip | All tokens as CSS custom properties | Section 8.7. DOM animates at the display rate (60/120 Hz) on the compositor, independent of the 30 fps canvas |

Do not choreograph DOM and canvas to within one canvas frame (33 ms). They run on different clocks; any hand-off between them (the floor ruler in 3.3) reads its start position once and then animates on one surface only.

### 2.5 Motion color tokens (additions derived from the brand ramps)

All values come from 00-CONTEXT "COLOR AND BRAND" and keep 06's one-color-one-meaning rule. Motion adds no new hue.

| Token | Value | Derived from | Meaning |
|---|---|---|---|
| `twin-scanfront` | `#b8c3c7`, line α 0.9, glass band α +0.35 | Slate-teal ramp, lightest | The entry and exit scan front only |
| `twin-sweep` | `#80959b`, additive α 0.08 | Slate-teal ramp (`twin-edge`) | Snapshot-arrival sweep only |
| `twin-select` | `#eff7f3`, 2 px ring | Justin's pin text (06 "person, current") | The operator's current selection |
| `twin-attention` | `#f59e0b` static ring α 0.9; ripple α 0.9 → 0 | Brand warning (06 hotspot) | Needs an operator decision now |
| `twin-echo` | The item's own color at α 0.35, hollow | — | Previous value of something that just changed |
| `twin-veil` | `#061a23` | Brand background | Cut fallback (reduced detail, cross-surface cuts) |
| `twin-hazard` | `#ee7789` | Brand destructive (dark) | Reported floor slab arrival edge |

Contrast: `#b8c3c7` on `#061a23` is about 10:1; `#80959b` at α 0.08 is deliberately below any text threshold because it carries a cue, not text. Measured values belong to 04.

---

## 3. Signature sequences

Notation: `T0` is the operator's click. Times are milliseconds after the named origin; `fN` is the canvas frame at 30 fps. "DOM" is the HUD, rail and panels. "Canvas" is the Cesium scene. Every row names its job.

### 3.1 (a) Entry: the city falls away and the twin forms around the hotel

**Trigger.** "Open Trip Twin" (06 E1–E5). The controller saves World View state first (03 section 4.7), including the exact camera (`positionWC`, `directionWC`, `upWC`, `transform`, `viewer.trackedEntity`).

**Poses.** Final pose for Neighborhood scale (06 2.4): heading 0° (north up), pitch −40°, range 2R (800 m for R = 400 m), centered on the hotel footprint centroid at ground height from the twin heightfield. The flight ends exactly on this pose, so the dissolve happens with a still camera (P6: never stack camera motion and scene transformation).

**Phase A: approach (T0 to T0 + F), calm profile.** `F = dur.flight(d)`.

| Time | Canvas | DOM | Job |
|---|---|---|---|
| T0 + 0 | `camera.flyToBoundingSphere` starts toward the final pose, `ease.camera`, duration F, `maximumHeight = max(startHeight, endHeight) × 1.1` so a city-scale flight does not hop up and down. If the current heading differs from north by more than 120°, the heading is set at once at T0 and only position and pitch fly (6.4). Public layers that Trip Twin turns off (03 section 7.6) are turned off now, in one frame. | Button press state, `dur.micro`. Header and breadcrumb: opacity 0 → 1 and translateY −6 px → 0, `dur.medium`, `ease.enter`. Rail: opacity 0 → 1 and translateX 12 px → 0, `dur.medium`. | CONFIRM, ORIENT |
| T0 + 0 | If a World View visual mode (FLIR, night vision...) is active, its post-process `intensity` uniform ramps 1 → 0 over `dur.medium`, then `setMode('normal')`. | — | ORIENT |
| T0 + 0 | — | Rail content is real from the first frame: **Not current** and **Not located** counts are filled from the snapshot already in memory. The four hotel-verdict buckets read "assessing" until the footprint is parsed, then fill in one swap (`dur.micro` opacity crossfade). Load steps listed as text: "Buildings (OpenStreetMap) · Ground · People", each changing to "done" as it completes. No skeleton shimmer. | FRESH (latency masked by real progress, not by animation) |
| T0 + F | Flight complete: `camera.setView` to the exact final pose (removes float drift), then `camera.lookAtTransform(ENU(hotel), HeadingPitchRange)` for orbiting. | — | ORIENT |

**Data gate.** The dissolve starts at `D0 = max(T0 + F, data ready)`, where "data ready" means the buildings are built and the heightfield is loaded. While waiting after the flight, the camera holds still on the photoreal city with World View's own pins, which is useful context; nothing idles or orbits. If data is not ready by `T0 + F + 3000`, the dissolve starts anyway into the minimal twin (03 section 9: grid, hotel as a dashed approximate cylinder, people, zones, safety rings), and buildings arrive later (3.1 "Late buildings").

**Phase B: dissolve (D0 to D0 + 1200), calm profile.**

| Time | Frame | Canvas | DOM | Job |
|---|---|---|---|---|
| D0 + 0 | f0 | `scene.backgroundColor = #061a23`. `skyBox`, `sun`, `moon` hidden; `fog.enabled = false`. `skyAtmosphere.brightnessShift` starts 0 → −1 over 600 ms. Clipping polygon (64-vertex circle, `inverse: false`) attached to the Google tileset (or `globe.clippingPolygons` when keyless), radius 0. `u_reveal = 0`. | — | ORIENT |
| D0 + 0 | f0 | **All information-bearing overlays appear in this one frame:** World View's `people` and `context` sources hidden, twin pins, accuracy discs, group-zone rings, safety rings, hotspot rings (static), floor bands (if on) shown at full opacity on the heightfield (pins have `disableDepthTestDistance: Infinity`, so they read over the photoreal that is still there). | — | P1 |
| D0 + 0 → 900 | f0–f27 | `u_reveal` and the clip radius both grow 0 → R + 100 m with `ease.standard`. The photoreal city disappears exactly where the hologram appears (the twin replaces the photo of the same place). Buildings, edges, grid and roads become visible 20 m behind the front (`smoothstep`). The scan front is drawn twice: a ground ring at the radius (`twin-scanfront` line, α 0.9) and a +0.35 α band, 12 m wide, in the glass shader where the front cuts each building. The hotel (within about 60 m of the center) is fully revealed by f4 (≈ 130 ms). | — | ORIENT, CAUSE |
| D0 + 0 → 300 | f0–f9 | Hotel edge polylines (`PolylineGlow`, `#b8c3c7`): α 0 → 1, `ease.enter`. Dashed if the footprint or height is approximate (06 SIT-04, SIT-07). | — | ORIENT |
| D0 + 600 | f18 | `skyAtmosphere.show = false` (already dark). | — | — |
| D0 + 900 → 1200 | f27–f36 | Hologram reveal is complete at R + 100 m (the grid fades radially there, 03 section 4.6). The clip radius keeps growing from R + 100 m to the horizon radius H with `ease.exit`, so the remaining photoreal city falls away to the edge of the view. The ground ring fades α 0.9 → 0 as it leaves the grid. `H = clamp(1.2 × h_cam / tan(max(3°, abs(pitch) − vfov/2)), 2 km, 20 km)`; about 2 km for the default pose. | — | ORIENT |
| D0 + 1200 | f36 | `tileset.show = false`, `globe.show = false`, clipping collection removed, `u_reveal` set to "off" (−1). `releaseContinuousRender('trip-twin-motion:entry')`. | Edge chips (beyond the site radius) fade in, `dur.short`. On the first entry of a session, the legend opens (`dur.medium`, closes on first interaction, 06 5.2). | ORIENT |
| D0 + 1200 | f36 | Hotspot ripples start (section 4.3), at most 3. They wait until here so they do not compete with the scan front; the static hotspot rings and their labels have been on screen since f0. | Rail "+n more need attention" chip, if any. | ATTEND |
| D0 + 1400 | f42 | Settled. Nothing moves except the next snapshot sweep. | — | — |

Typical calm totals (warm cache): from a World View city view (d ≈ 10 km), 1.3 s flight + 1.2 s dissolve = 2.5 s. From the globe overview, 2.4 s + 1.2 s = 3.6 s. Information (roster line, not-current list) is on screen at T0 + 0 (partial) and at footprint-parse time (complete), independent of both numbers.

**Incident profile entry** (an incident is open, or entered from an alert, 06 E3).

| Time | Canvas | DOM | Job |
|---|---|---|---|
| T0 + 0 | If d ≤ 50 km: flight `min(dur.flight(d), 600)` ms. If d > 50 km: no flight. A `twin-veil` DOM layer (between the canvas and the HUD, never over the HUD) goes opacity 0 → 1 in 80 ms, `camera.setView` jumps to the final pose under it, and the veil goes 1 → 0 in 80 ms. | Header, rail and the incident panel appear at once (opacity only, `dur.micro`). The incident panel's official-instruction slot and floor partition are complete when it appears. | CONFIRM, P1 |
| D0 + 0 (f0) | All overlays at full, as in the calm profile. | — | P1 |
| D0 + 0 → 400 (f0–f12) | `u_reveal` and the clip radius go 0 → H in one segment, `ease.standard`. Same scan front. | — | ORIENT |
| D0 + 400 (f12) | Tiles and globe hidden, clipping removed. Ripples start. | — | ATTEND |

Total from data ready to settled: at most 400 ms (dissolve) plus at most 600 ms (flight) = 1.0 s, meeting 01 [A19]. If data is not ready after the flight, the incident profile does not wait the 3 s: it dissolves straight into the minimal twin.

**Late buildings** (Overpass slow, 03 R-01). When buildings arrive after the dissolve, they reveal with the same front from the hotel outward, `u_reveal` 0 → R + 100 m over `dur.long` (480 ms, `ease.standard`), with no clipping (the city is already gone). The rail line "Buildings unavailable" changes to "Buildings (OpenStreetMap) · done". Job: FRESH, CAUSE.

**Interrupts.**
- Any pointer down, wheel or key during Phase A or B: `camera.cancelFlight()`, `camera.setView(final pose)`, dissolve jumps to its D0 + 1200 state, ripples start. The operator's input then acts on the settled twin.
- "Exit Trip Twin" during entry: the exit sequence (3.5) starts from the current `u_reveal` and clip radius, not from the settled state.
- Tab hidden (`visibilitychange`, which already stops the render loop in `globe.js`): the sequence completes to its end state immediately, so the operator never returns to a half-dissolved scene.

### 3.2 (b) Layer reveal and hide

A layer toggle never changes a readout (06 C7). The rail adds "{Layer} hidden" when a layer is off: that chip fades in with `dur.short` and never pulses.

| Layer type (06 2.2) | Show | Hide | Job |
|---|---|---|---|
| Toggle control itself | Checkbox and row state, `dur.micro`, `ease.standard` | Same | CONFIRM |
| Structures: Surrounding buildings, Venues & itinerary stops | `u_layerAlpha` 0 → 1 with a radial delay from the hotel (S2): total `dur.medium` + up to `dur.medium` of radial delay, `ease.standard` | `u_layerAlpha` 1 → 0, `dur.short` × 0.75 = 150 ms (floored to 200 ms on canvas), `ease.exit`, no radial delay | CAUSE |
| Point items: Safety resources, Mapped entrances, Geofence crossings | Opacity 0 → 1, `dur.short`, radial delay (S2, S3). Labels follow 80 ms after their glyph | Opacity 1 → 0, 200 ms, all at once | CAUSE |
| Satellite heat detections | Opacity 0 → 1 (scaled to the recency opacity of 03 section 7.5), `dur.short`. **No growth from a point** (would read as spreading, 02 C4). Off-screen detections update their edge chips at the same time | Opacity 1 → 0, 200 ms | — (show only) |
| Suggested walking paths | Primary draws from the origin (street start) to the destination along its length, 0 → 100%, `dur.long`, `ease.standard`. The alternate starts 120 ms later and draws the same way. Direction chevrons appear when the draw completes and then hold still (MF3). Path cards appear complete | Opacity 1 → 0, 200 ms, no reverse draw | CAUSE |
| Floor estimates | Hotel approximate floor-height lines (06 SIT-09) fade in, `dur.short`. Each person's bracket appears at its likely tick and extends to its low and high ends, `dur.short`, `ease.standard`; the dashed tether to the ground pin draws upward from the pin, `dur.short` | Opacity 1 → 0, 200 ms | CAUSE |
| Group zone & trip boundaries | Ring opacity 0 → 1, `dur.short`. Rings never scale or grow | Opacity 1 → 0, 200 ms | — |
| Reported incidents | See 3.4 (arrival). Toggle re-show: opacity 0 → 1, `dur.short` | Opacity 1 → 0, 200 ms; rail "Reported incidents hidden (1)" | — |
| Layer unavailable or failed | No motion. The row and the rail change text (06 FRS-04). A failed layer never fades in an empty state | — | — |

Rapid toggling reverses from the current value; it never restarts from 0.

### 3.3 (c) Drill-down: into a person, and into a floor band

#### Person focus (click a pin, a list row, or a name in the not-current or outside-zone list; 06 4.3)

| Time | Canvas | DOM | Job |
|---|---|---|---|
| 0 | Selection ring (`twin-select`, 2 px) around the pin: opacity 0 → 1 and scale 1.15 → 1.0, `dur.short`, `ease.enter`. A short "lock-on": the sci-fi cue is the ring closing onto the target. | List row selected state, `dur.micro` | CONFIRM |
| 0 | Other people, their rings and labels: α 1.0 → 0.45, `dur.short`, `ease.standard`. They stay visible and counted. Buildings do not change. | — | ORIENT |
| 0 → 480 | Camera pans to center the person, `dur.long`, `ease.camera`, keeping range, heading and pitch (no forced zoom, 06 4.3). **No camera move** if the pin is already inside the central 50% of the viewport. | — | ORIENT |
| 0 → 320 | — | Person card: opacity 0 → 1 and translateX 16 px → 0 from the details side, `dur.medium`, `ease.enter`. Content complete on arrival (S5). | — |
| 0 → 200 | If the person has a floor band and Floor estimates is on: tether draws from the ground pin up to the band, `dur.short`. | — | CAUSE |
| on request | "Possible area" ring (06 HAZ-13) for a not-current person: appears at its current radius, opacity 0 → 1, `dur.short`. It never grows from the accuracy ring. On each 5 s aging tick its radius snaps to the new value (P3). | — | — |

- Next or previous person (`[` / `]`): camera pan `dur.medium`; card content crossfades in `dur.micro`; the selection ring jumps to the new pin with the same lock-on.
- Esc (clear focus): selection ring and dimming reverse at the exit multiplier (150 ms → floored to 200 ms on canvas). **The camera stays where it is.** Leaving a focus does not move the view.

#### Floor-range focus (click a floor band, the reported floor slab, or a partition row)

The film's key moment (5:24–5:33) pulls the engine out of the ship and holds it up. Trip Twin does **not** physically lift or explode floors out of the building: moved floors would sit at false heights relative to the reported floor and every person's band, which 01 anti-pattern 4 and 6 forbid. The "pull-out" is instead a schematic **floor ruler** that transfers from the hotel's screen position into the panel, while the 3D floors stay where they are.

| Time | Frame | Canvas | DOM | Job |
|---|---|---|---|---|
| 0 | f0 | Floor-height lines and slabs inside the range: α 0.16 → 0.32, `dur.short`. | Partition row or band selected, `dur.micro` | CONFIRM |
| 0 → 480 | f0–f14 | Camera moves to read the floors side-on: pitch to −15°, heading toward the stack gutter side (03 7.2 places the gutter on the camera-facing side, so the heading change is small, at most 90°), range fitted to the range plus 3 floors above and below. `dur.long`, `ease.camera`. Previous camera pose saved for Esc. | — | ORIENT |
| 160 → 480 | f5–f14 | Hotel glass above the range: `u_cutH` falls from roof height to the range top, so glass α goes to 0 above the cut and only edges remain (06 Q4). A caption appears on the hotel: "Floors above: outline only". Glass below the range is unchanged (dimming "below" could read as "safe below", which 06 FLR-12 forbids). | — | ATTEND |
| 160 | f5 | — | The floor ruler (a DOM vertical scale with each person's bracket, initials, age and confidence) starts at the screen rectangle of the selected range, read once with `SceneTransforms.worldToWindowCoordinates`, and moves to its slot in the panel with a FLIP transform (translate + scale) plus opacity, `dur.medium`, `ease.standard`. Labeled "Floor estimates (schematic). Not a floor plan." | ORIENT, CAUSE |
| 480 | f14 | Approximate floor-height labels for the range only, `dur.short`. "Interior unknown" (06 SIT-08) on the focused range. | Breadcrumb gains `Floors {9}–{11}`, opacity `dur.micro`. | — |

- Esc: the ruler returns to the hotel rectangle and fades (`dur.medium` × 0.75 = 240 ms), `u_cutH` returns to the roof (240 ms), and the camera returns to the saved pose, `dur.long` × 0.75 = 360 ms. This focus moved the camera for legibility, so leaving it restores the view (reversible).
- Person focus nested inside floor focus (06 4.3) uses the person rules above and does not move the camera if the person's band is already on screen.

### 3.4 (d) Incident focus: hotel evacuation at night (hero, 01 Demo A / S2)

**Setting.** Fairmont Austin (03: OSM way 134786106, 37 levels, US numbering). 02:14 local, night (the scene is dark by design; night changes nothing). The fire alarm sounded at 02:10. The twin is open in the calm profile. The operator has a phone call from the hotel desk: smoke on floor 9, reported 02:12. Roster: 24 travelers and 3 chaperones (27 loaded). Hotel card: group on floors 8, 9 and 11. State at the moment of the report (01 Demo A): most evacuees are live across the street; 5 "At hotel, undetermined"; 2 "Inside (likely)" with current bands 9–11; one person's band has been flat at "Likely floor 10 (9–11)" for 8 minutes (the priority person); one traveler last known 600 m away at a bar, battery 6%; one never reported; one chaperone aging (4 min).

**Trigger.** The operator submits "Add reported floor" (06 1.3) with floor 9, "smoke", source "hotel desk", time 02:12. Origin `I0`. This is the operator's own action, so the camera may move (P6).

| Time | Frame | Canvas | DOM | Job |
|---|---|---|---|---|
| I0 + 0 | f0 | Global motion profile switches to **Incident** (2.1). | Submit button press, `dur.micro`. The form collapses: opacity 1 → 0 in 120 ms, then it is removed. | CONFIRM |
| I0 + 0 | f0 | Reported floor slab at floor 9 (06 FLR-10, hatched, `twin-hazard`): opacity 0 → final in `dur.short`, `ease.enter`. Its outline starts at 1.8× brightness and settles to 1.0× over 600 ms: a one-shot arrival marker that does not repeat and does not count as a pulse. | — | CAUSE |
| I0 + 0 | f0 | — | Incident panel opens: opacity 0 → 1 and translateX 16 px → 0, about 200 ms (incident profile: `dur.medium` × 0.6), `ease.enter`. **Complete on arrival:** "No official instruction on file. Check local authorities." (06 HAZ-11), "Reported: smoke · floor 9 · hotel desk · 02:12 · not verified", the partition line (06 FLR-12) and "At or above reported floor 9: 3". "Re-entry and stand-down: hotel or authorities only" (06 MSG-06) at its fixed place. | P1 |
| I0 + 0 | f0 | — | Rail: the Not current list expands. Height changes in one step (no layout animation); rows fade in with translateY 6 px → 0, 120 ms, no stagger (incident). The "Not current 3" header gets a static 3 px `twin-attention` left rule. | ATTEND (static) |
| I0 + 100 | f3 | Floor estimates layer turns on (06 C3) if it was off: brackets appear at their likely ticks and extend to low/high, `dur.short`, `ease.standard`. Tethers draw up from the ground pins. Hotspot rings (static, `twin-attention`) appear on the bands and ground pins of the three people at or above floor 9, `dur.short`. | — | ATTEND (static) |
| I0 + 200 | f6 | Floor-height lines from floor 9 to the roof: α 0.2 → 0.5, `dur.short`. They hold at 0.5 (static emphasis on the floors that matter). | — | ATTEND (static) |
| I0 + 200 → 680 | f6–f20 | **Only if floor 9 is not visible in the current view, or the pitch is steeper than −25°:** camera moves to the incident pose: side-on (pitch −12°), heading toward the stack gutter (small change, 3.3), range fitted to ground through `min(roof, floor 9 + 15 floors)` with floor 9 in the lower-middle third. `dur.long` (camera tokens are not shortened below 480 ms; a faster camera is a vestibular risk), `ease.camera`. Otherwise the camera does not move. | — | ORIENT |
| I0 + 680 → 1040 | f20–f31 | The at-or-above group bracket on the stack gutter grows **upward from the top edge of the slab** to the top of the highest at-or-above band, 360 ms, `ease.standard`. Its label "At or above reported floor 9: 3" fades in at the end, `dur.short`. Attention travels from the cause to the people it concerns (P5). | — | CAUSE, ATTEND |
| I0 + 1040 | f31 | Ripples start, exactly 3 slots (4.3): **slot 1** the at-or-above group bracket (the group pulses, not its members); **slot 2** the priority person's band, whose label reads "Likely floor 10 (9–11) · 40s ago · not descending · 8m"; | **slot 3** the "Not current 3" rail header (DOM ripple, 8.7). | ATTEND |
| I0 + 4640 | f139 | Ripples end after 3 cycles. Static rings, bracket and rule remain for as long as the states last. The scene is calm again apart from the per-snapshot sweep. | — | — |

When each answer is available:

| Operator question (01 S2) | On screen at |
|---|---|
| Who is at or above floor 9, as a count and a list | I0 + 0 (panel text) |
| Where their bands are on the building | I0 + 100 → 300 |
| Who to ask about (not current) | I0 + 0 (rail list, static amber rule) |
| A readable side-on view | I0 + 680 at the latest |
| Eye pulled to the three things that matter most | I0 + 1040 |

**While the incident runs (each 15 s snapshot).**
- Bands snap to the new estimate; the previous band shows as a hollow echo for `dur.echo` (P3). When two consecutive estimates fall, a static "descending" glyph and word appear on the band label. There is no animated downward arrow.
- A person whose band moves entirely below floor 9 leaves the group. The group count changes in one swap (`dur.micro` crossfade on the number), with a static note "−1 at 02:15:20" for 60 s; their hotspot ring fades out over `dur.short`.
- A person newly at or above floor 9 joins the group: static ring at once; a ripple only if a slot is free (4.3).
- A person whose band stays unchanged for 10 minutes gets "not descending · {10m}" (01 2.6), shown as text; if their state worsens and a slot is free, one new 3-cycle ripple.
- The sweep keeps running once per snapshot. It is the visible proof that the floor data is still arriving. When the snapshot is older than 45 s, the sweep stops and the rail turns amber (03 section 9).

**Hero, reduced motion.** At I0 everything in the table appears in one frame: slab, panel, expanded list, bands, static rings, group bracket at full height. The camera jumps (`setView`) to the incident pose only if floor 9 is off screen. No ripples: the three slot holders show the reduced attention form (6.2).

### 3.5 (e) Exit and exact restore of World View

**Trigger.** "Exit Trip Twin" in the toolbar, or the "World View" breadcrumb segment (06 4.4). Esc never exits (06 4.5). Origin `X0`.

| Time | Frame | Canvas | DOM | Job |
|---|---|---|---|---|
| X0 + 0 | f0 | `tileset.show = true` (or `globe.show = true` when keyless) with the clipping circle already at radius H, so the photoreal stays hidden under the hologram while its tiles start loading. `holdContinuousRender('trip-twin-motion:exit')`. | Exit button press, `dur.micro`. If a reported floor exists: toast "Reported floor kept for this session" (06 4.5), opacity in 160 ms, held 4 s, out 120 ms. | CONFIRM |
| X0 + 0 → 600 | f0–f18 | Clip radius and `u_reveal` contract from H to 0 with `ease.exit` (the entry run backwards at 0.5× its length): the photoreal city returns from the edges inward and the hologram shrinks back into the hotel. The scan front ring is drawn at the radius, α 0.9 → 0 over the last 200 ms. `skyAtmosphere.show = true`, `brightnessShift` −1 → 0 over the same 600 ms. **Twin people pins stay on screen throughout**, so no one disappears while the operator leaves. | HUD and panels: opacity 1 → 0 and translate 8 px toward their docked edge, 240 ms (`dur.medium` × 0.75), `ease.exit`, starting at X0 + 360 so they leave as the city returns. | ORIENT |
| X0 + 600 | f18 | One frame swap: twin pins hidden, World View `people` and `context` sources shown (`show = true`, then `renderPeople()` / `renderContext()`, 03 5.4). Clipping removed. Twin primitives destroyed. `skyBox`, `sun`, `moon`, `fog`, `backgroundColor` restored exactly. | — | P1 |
| X0 + 600 → 600 + 0.75 F′ | — | Camera flies back to the saved World View pose. F′ = `dur.flight(d)` for the return distance; exit multiplier 0.75 (max 1800 ms). `camera.lookAtTransform(Matrix4.IDENTITY)` first, then `flyTo({destination: saved.position, orientation: {direction: saved.direction, up: saved.up}, easingFunction: ease.camera, maximumHeight: …})`. | — | ORIENT |
| on flight complete | — | `camera.setView` with the saved position, direction and up (exact, no drift). If `viewer.trackedEntity` was set before entry and the entity still exists, it is restored now [M-A6]. Visual mode restored: if it was a post-process mode, its `intensity` ramps 0 → 1 over `dur.medium`. `releaseContinuousRender`. | World View's selected record and open panel restored: opacity 0 → 1, `dur.short`. Public layers restored with `manager.restoreEnabledLayerIds` (03 4.7). They load at their own pace and show their own loading states. | ORIENT |

Totals: calm, from a city-scale entry, 600 + 975 ≈ 1.6 s; from the globe overview, 600 + 1800 = 2.4 s. Incident profile: contraction 300 ms, flight at most 600 ms (or a veil cut beyond 50 km), total at most 0.9 s.

**Exactness checklist** (each is a QA assertion; 03 15.1 and 15.2 already test the scene flags):

| Item | Restored to | Check |
|---|---|---|
| Camera position, direction, up | Saved values via `setView` after the flight | Component difference ≤ 1e-6 relative |
| Camera transform | `Matrix4.IDENTITY` (World View default) or the saved transform | Equal |
| `tileset.show`, `globe.show` | Values refreshed by any `gev:map-stack-changed` while open (03 4.7) | Equal to the latest saved |
| `skyAtmosphere.show` and `brightnessShift`, `skyBox`, `sun`, `moon`, `fog.enabled`, `backgroundColor` | Saved | Equal |
| Visual mode and its intensity | Saved | Equal |
| Enabled public layers | Saved id set | Set-equal |
| Selected record, open panel | Saved | Equal |
| Tracked entity | Saved, if it still exists [M-A6] | Equal or "entity gone" logged |
| Clipping collections | None on tileset or globe | `undefined` or empty |
| Twin listeners, primitives, billboards, DOM | Removed | 03 lifecycle test |
| Render governor holds | All `trip-twin-motion:*` owners released | `getRenderGovernorDiagnostics()` shows none |

**Interrupts.** Any input during the exit finishes it at once: contraction to 0, swap, `setView` to the saved pose. Exit during entry starts from the current radius (3.1). The same skip runs on `visibilitychange` to hidden.

**Tile pop risk.** Hidden tiles may have been evicted from Cesium's cache, so the returning photoreal can appear at a lower level of detail for a moment. If spike S-1 shows that this looks broken, the contraction is replaced by a veil cut (`twin-veil` 0 → 1 in 120 ms, swap, 1 → 0 in 120 ms) [M-A2].

---

## 4. Ambient motion: what moves at rest

"At rest" means no operator input for 2 s and no sequence running.

### 4.1 Allowed at rest

| Motion | Job | Parameters | Stop rule | Why it earns its place |
|---|---|---|---|---|
| **Snapshot sweep**: one faint horizontal band rises up the hologram glass, ground to the tallest roof | FRESH | `twin-sweep` (`#80959b`, additive α 0.08), band thickness 3% of the tallest building height (min 2 m), travel `dur.sweep` 1600 ms, `linear`, starts on the frame a snapshot is applied | Never starts if the snapshot is older than 45 s or the poll failed; stops mid-travel if the feed fails. Reduced motion: never | The operator learns without reading that traveler data is still arriving. Duty cycle 1.6 s per 15 s = 11% (MF2). Its absence is backed by text: "Snapshot · 12s ago", amber strip after 45 s |
| **Hotspot ripples** (4.3) | ATTEND | 3 cycles, then static | Section 4.3 | Announces a new or worsened decision item |
| **Echoes** of changed values (5.4) | FRESH, CAUSE | `dur.echo`, one per change | Self-terminating | Shows what changed and where it came from |

### 4.2 Never moves at rest

Camera (no idle orbit, no drift, no "breathing" zoom); hologram glass, edges, grid and roads (no shimmer, scanlines, flicker or glow breathing); the hotel (no glow, no pulse: MF1); paths (no flowing dashes: MF3); zone rings, accuracy rings, floor bands, hazard footprints (no wobble, breathing or spin); safety rings and beacons; HUD (no ticking seconds: the header clock shows HH:MM; ages update as text on the existing 5 s tick with no count-up, no blinking colon, no data-stream decoration); labels (no drift; they reposition only when the camera moves).

### 4.3 Pulse budget and rules

| Rule | Value |
|---|---|
| Maximum simultaneous pulsing elements, whole screen (canvas and DOM together) | **3** |
| Of which in DOM panels | At most 1 |
| Cycles per announcement | 3 (3.6 s), then a static hotspot ring (`twin-attention`, α 0.9, 2 px) |
| Shape | The static ring is drawn first and stays. The ripple is a second ring: scale 1.0 → 1.35, α 0.9 → 0, per cycle, `ease.enter`. The pulse is never the only carrier of the meaning (06 D16) |
| Who gets a slot (priority order) | 1 at or above a reported floor (group bracket first, then a member whose state is worse, e.g. "not descending"); 2 newly not current; 3 unaccompanied or outside group zone at night (02 R4); 4 a new hazard or report within the site radius; 5 a new person located |
| Group rule | When two or more people share a reason, the group marker (bracket, cluster bubble, list header) takes the slot, not each person |
| No slot free within 2 s | No ripple. The item gets its static ring immediately, and the rail "+{n} more need attention → list" chip takes the next free slot for one 3-cycle ripple |
| Re-announce | The same element may ripple again only when its state worsens to a higher priority, and not within 60 s of its last ripple |
| Never pulsed | The hotel, paths, safety resources, zone rings, the reported slab after its one-shot arrival, anything decorative, anything that is not a decision item (01 anti-pattern 24) |
| Flash safety | 0.83 Hz, small area (a ring around a pin), no saturated red; well inside WCAG 2.3.1 (fewer than 3 flashes per second) |

### 4.4 Calm budget (testable)

| Measure | Limit at rest |
|---|---|
| Continuously moving elements | ≤ 1 (the sweep, only while it travels) |
| Pulsing elements | ≤ 3 |
| Camera motion | 0 |
| Share of viewport pixels changing between frames, averaged over 15 s at rest, sweep excluded | < 2% |
| Share including the sweep | < 6% |

---

## 5. Motion that encodes data

Rule: **motion marks a change of state; static form carries the state.** Every row has a static equivalent that works alone, in reduced motion, in a screenshot and on a monochrome wall.

### 5.1 Freshness and age

| Data fact | Motion (only at the moment of change) | Static equivalent (always present) | Job |
|---|---|---|---|
| A snapshot arrived | One sweep (4.1) | Rail "Snapshot · {12s} ago" (06 FRS-06) | FRESH |
| The feed stopped or the snapshot is older than 45 s | The sweep stops | Amber strip "Feed interrupted · snapshot {70s} old" (06 FRS-07); counts read "as of {hh:mm:ss}" | FRESH |
| A person goes Live → Aging | Ring line style morphs solid → dashed, `dur.short`; no ripple (aging alone is not a decision item) | Dashed amber ring, clock glyph, "Aging · {4m} ago" (06 5.1) | FRESH |
| A person goes Aging → Last known (now Not current) | Ring morphs to dotted hollow, photo desaturates, `dur.short`; one ripple if a slot is free (priority 2) | Dotted hollow ring, grey, "Last known · {12m} ago"; row added to the Not current list with a "New" tag for 60 s | FRESH, ATTEND |
| A person becomes current again | Ring morphs back, `dur.short`; their row leaves the Not current list with a `dur.short` fade | Solid ring, "Live · {20s} ago" | FRESH |
| Age increases between snapshots | None. The text changes on the 5 s tick | "{34s} ago" | — |
| Heat detection age | None | Opacity scaled to recency (03 7.5), "Observed {3h} ago (satellite pass {11:20})" (06 HAZ-03) | — |
| A path becomes stale | Line morphs solid → dashed, `dur.short` | "Stale · Recompute" (06 PTH-12) | FRESH |

### 5.2 Uncertainty

Uncertainty is never encoded by motion. Wobble, jitter, shimmer or breathing would read as movement or as "live", and would draw the eye to the least certain data.

| Data fact | Motion | Static equivalent |
|---|---|---|
| Accuracy radius | None at rest. On a new fix the ring snaps to the new radius; the old ring echoes (5.4) | Ring at true scale (06 POS-M1); "±{18} m"; no ring and "Accuracy unknown" when not reported |
| Floor band (range) | None at rest. On a new estimate the bracket snaps; the old bracket echoes | Bracket low–high with a likely tick; "Likely floor {10} ({9}–{11}) · {40s} ago"; dashed when rough (06 FLR-02); hollow when last estimate (FLR-04) |
| Band widening or narrowing | Snap plus echo. The echo shows the old extent, so the direction of change is visible without tweening | Same text; "Rough: floors {5}–{9}" when it crosses into rough |
| Approximate geometry (footprint, height, zone) | None | Dashed line, "approx." (06 PRV-07) |
| Possible area of a not-current person | None. Radius snaps on each 5 s tick | "Possible area, not a prediction" (06 HAZ-13) |

### 5.3 Live vs stopped vs stale

| State | Motion | Static equivalent |
|---|---|---|
| Live | None. Live pins do not blink or breathe; liveness is a fact about the fix, not an animation | Solid ring, full photo, "Live · {34s} ago" |
| Stopped · current | None | Still glyph, "At this location for {3h} · contact {4m} ago" (06 POS-03) |
| Last known (stale) | None at rest; transition per 5.1 | Dotted hollow ring, desaturated photo, "Last known · {2h} ago" |
| Time unknown | None | Ghost pin with "?", no ring, "Capture time unknown" |
| Not located | Not drawn | Rail count and list row "No location reported" |

### 5.4 New vs changed

| Event | Motion | Static equivalent |
|---|---|---|
| **New** item (person located for the first time, hazard, report, geofence crossing) | Fade in `dur.short` at its place; one ripple only if it qualifies for a slot (4.3) | "New" tag in its label and list row for 60 s; a 3 px left marker on the list row for 60 s |
| **Moved** (new fix, new band) | Snap to the new value; hollow echo of the previous value (`twin-echo`), α 0.35 → 0 over `dur.echo`, `ease.exit`. **No connecting line, no trail** (02 privacy: no trails) | Label age resets ("{5s} ago") |
| **Changed** value in a readout (a roster bucket, a partition count, a card field) | Number swaps with a `dur.micro` opacity crossfade; the changed row or field gets an overlay highlight, opacity 0.24 → 0 over `dur.echo` (a pseudo-element, so no paint per frame) | A static delta "+1 at {02:15:20}" or "−1 at {02:15:20}" next to the number for 60 s; the card shows "changed {12s} ago" |
| Removed item | Fade out `dur.short` × 0.75 | Count changes; list row removed with "−1" note |

---

## 6. Reduced motion and vestibular safety

### 6.1 Reduced-motion profile

Reduced motion applies when `prefers-reduced-motion: reduce` matches, or when the in-app setting (6.3) is on. In reduced motion **nothing interpolates on canvas or in DOM**: every change happens in a single frame, and change is shown by the static markers in section 5 ("New", "+1", "changed 12s ago", the hollow echo). This matches the existing global CSS rule in `operations.css` and 03's QA assertion "no transition frames" (03 15.2 step 6). End states are identical to the full-motion end states. Information timing is identical.

| Sequence | Full motion | Reduced motion |
|---|---|---|
| (a) Entry, calm | Flight F, then 1.2 s scan-front dissolve | `camera.setView` to the final pose in one frame; in the same frame tiles and globe hidden, hologram, overlays and static hotspot rings shown. HUD appears in the same frame. No sky ramp. Load steps still show as text while data loads |
| (a) Entry, incident | ≤ 600 ms flight, 400 ms dissolve | As calm reduced |
| (a) Late buildings | 480 ms radial reveal | Buildings appear in one frame; rail line changes to "done" |
| (b) Layer show and hide | Fades, radial delay, path draw-on, bracket extension | Items appear or disappear in one frame. Paths appear complete with chevrons |
| (c) Person focus | Lock-on ring, dim others, camera pan, card slide | Selection ring, dim and card in one frame. Camera: `setView` only if the pin is outside the central 50% of the viewport; otherwise no move |
| (c) Floor-range focus | Side-on camera move, glass cut, ruler FLIP | `setView` to the side-on pose; glass cut and ruler in place in one frame. Esc restores the saved pose in one frame |
| (d) Incident focus | Slab arrival, panel slide, bracket growth, camera move, ripples | All in one frame (3.4 last paragraph). Camera jumps only if floor 9 is off screen |
| (e) Exit | 600 ms contraction, flight back | One frame: tiles shown, twin removed, World View pins shown, `setView` to the saved pose, visual mode at its saved intensity, panel restored |
| Snapshot sweep | One sweep per snapshot | None. Rail "Snapshot · {12s} ago" carries freshness |
| Hotspot ripples | 3 cycles then static | Never. See 6.2 |
| Echoes | 1.2 s fade | Hollow echo shown static for one aging tick (5 s), then removed in one frame |
| Changed-value highlight | 1.2 s overlay fade | Static delta text only ("+1 at 02:15:20", 60 s) |
| Scale change, plan view | `dur.long` camera move (6.4 caps) | `setView` |
| Visual-mode ramp on entry and exit | Intensity ramp | Mode set in one frame |

### 6.2 Reduced attention form (replaces ripples)

Without ripples, attention must still be visible:
- Static hotspot ring plus a second, dashed outer ring (`twin-attention`) at 1.35× radius: the double ring is the "needs attention now" form.
- The reason label is always shown on the scene for slot holders, never hover-only (it counts against 06 D1's label budget first).
- The rail "+n more need attention" chip gets the same double-ring treatment on its left marker.
- New attention items are also announced through the existing `aria-live="polite"` regions (06 4.6), which do not depend on motion.

### 6.3 In-app control

| Item | Specification |
|---|---|
| Location | Trip Twin toolbar menu (exact placement by 04) |
| Label | "Reduce motion (camera jumps, no animated transitions)" |
| States | Off = follow the system setting (default). On = reduced motion in Trip Twin, whatever the system setting |
| Cannot | Force full motion when the system asks for reduced motion (MF7) |
| Applies | Immediately, including mid-sequence: a running sequence jumps to its end state |
| Stored | `localStorage` key `tripTwin.reduceMotion` (a device preference, no personal data) [M-A5] |
| Also | Responds live to system changes through `matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', …)` |
| WCAG | Satisfies 2.3.3 (Animation from Interactions, AAA) and gives the pause mechanism 2.2.2 (Pause, Stop, Hide) needs for the repeating sweep |

### 6.4 Vestibular safety rules (all profiles)

| # | Rule | Value |
|---|---|---|
| V1 | Camera never rolls | Roll is always 0 |
| V2 | Angular speed cap for heading and pitch | 120°/s. A move that would exceed it is lengthened up to `dur.long` × 1.5; if still over, it becomes a cut (`setView`) |
| V3 | Large heading changes | More than 120° is always a cut, never a swing (for example, plan view from a south-facing oblique) |
| V4 | No combined motion | The camera never moves during a dissolve, and a dissolve never starts while the camera moves (3.1). Within one flight: translate and zoom, plus at most one rotation axis |
| V5 | No auto camera motion | No idle orbit, no follow-cam inside the twin (03 H-3 disables follow), no camera shake, no feed-driven moves (P6) |
| V6 | No parallax | HUD layers never move against the scene; DOM panels never translate more than 16 px |
| V7 | No zoom of full-viewport content | Panels never scale; the floor ruler's FLIP scale applies to one element only |
| V8 | Flight arc capped | `maximumHeight` set on every flight, so a short flight never hops up and down |
| V9 | No flashing | Ripples at 0.83 Hz on small areas; the dissolve is one luminance change, not a flash pair; no full-screen luminance flip back and forth |
| V10 | Wall display (future SOC) | The same angular motion covers more of the visual field on a wall. Wall profile: camera moves are cuts with a 120 ms veil; ripples and the sweep remain [M-A7] |

---

## 7. Performance

### 7.1 Budget inside 03's 30 fps

03 section 8 sets the frame budget: sustained 30 fps, p95 frame time ≤ 33 ms on the reference laptop (Apple M1/M2, 1440p, DPR 2, Chrome), ≥ 24 fps on Intel Iris Xe. Motion must fit inside that, with headroom for the dissolve, which is the only time two scenes (photoreal and hologram) render together.

| Item | Reference laptop | Iris Xe class | Notes |
|---|---|---|---|
| Static twin GPU time (03's scene, motion uniforms "off") | ≤ 16 ms | ≤ 28 ms | Leaves headroom for transitions |
| Motion shader terms (reveal, sweep, cut) added to glass and edges | ≤ 1.5 ms | ≤ 3 ms | About 20 ALU per fragment; branch-free (`step`/`smoothstep`) so "off" costs almost nothing |
| Dissolve frames (Google tiles + clip + hologram) | p95 ≤ 33 ms; ≤ 3 of 36 frames over 50 ms | p95 ≤ 45 ms, else cut (7.2) | The dissolve shortens its own visual length if frames drop, because it runs on `performance.now()` |
| Clipping polygon update, CPU per frame during the dissolve | ≤ 2 ms | ≤ 4 ms | If over, step mode: 6 discrete radii [M-A1] |
| Motion `preRender` handler, CPU | ≤ 1 ms | ≤ 2 ms | Uniform writes, ≤ 3 ripple billboards, ≤ 1 echo set |
| Ripples | < 0.2 ms | < 0.3 ms | 3 billboards |
| Post-processing | **0 stages in P0** (0 ms) | 0 | Glow comes from the fresnel term and `PolylineGlow`. Bloom (`PostProcessStageLibrary.createBloomStage`) is rejected for P0 (03 4.5): full-resolution passes at 2880 × 1620 cost several ms and more on a 4K wall. If ever added: half resolution, ≤ 3 ms, off in the reduced-detail tiers |
| DOM animation | 0 layout and 0 paint per animated frame | Same | `transform` and `opacity` only; highlights are pseudo-element overlays |
| Glass panels (`backdrop-filter`) | Static blur ≤ 8 px, never animated | Off (tier L5) | A blur over a 30 fps WebGL canvas is recomputed every canvas frame for the panel's whole area |

Requests and memory: motion adds none. No textures beyond one 64 × 64 ring sprite.

### 7.2 What degrades first on low-end GPUs

One ladder, merged with 03 section 8's geometry ladder. Trigger as in 03: p95 > 50 ms over the first 3 s (measured during the static settle, not during the dissolve), or during a dissolve if 6 consecutive frames exceed 50 ms. Each step is applied, measured for 3 s, and the next step is taken only if still over budget. The HUD shows "Reduced detail for this device" (03).

| Step | Change | Information lost | Owner |
|---|---|---|---|
| L1 | Sweep shader term off. Freshness moves to the rail text only | None (rail text remains) | 05 |
| L2 | Drop edges for non-hotel buildings | None | 03 |
| L3 | Dissolve becomes a cut under a 120 ms veil (no clip polygon, no scan front) | None | 05 |
| L4 | `msaaSamples` 4 → 2 | None | 03 |
| L5 | Panel `backdrop-filter` off; panels use solid `#07212c` at α 0.94 | None | 05/04 |
| L6 | `resolutionScale` 0.75 | Sharpness | 03 |
| L7 | Camera flights capped at 600 ms | None | 05 |
| L8 | Building cap 800 | Far buildings | 03 |
| Never degraded | Readouts; static state encodings (line style, glyphs, labels); static hotspot rings; ripples (3 billboards, cheap and functional); reduced-motion behavior | — | — |

### 7.3 How to measure

| What | How |
|---|---|
| Frame times | Extend 03's `?twinDebug=1` `window.__tripTwinStats` with `motion: { profile, reduced, activeSequence, pulsing, sweepActive, dissolve: { frames, over50ms, p95Ms, durationMs }, flightMs, clipUpdateMs, preRenderMs, tier }`, from the existing `scene.postRender` sampler |
| Sequence timing | `performance.mark('trip-twin:<seq>:start' / ':end')` and `performance.measure` for entry, dissolve, exit, focus and incident. QA asserts each measure ≤ spec × 1.1 |
| Information timing (P1) | Marks `trip-twin:info:roster`, `trip-twin:info:partition` when the readouts hold final values. QA runs the same scenario in full and reduced motion and asserts the info marks are equal within 50 ms. If motion delays information, this fails |
| No interpolation in reduced motion | QA (`page.emulateMediaFeatures([{name:'prefers-reduced-motion', value:'reduce'}])`) samples `__tripTwinStats.motion` and uniform values each frame after a trigger; the frame after the trigger must equal the end state |
| Pulse budget | QA samples `motion.pulsing` every frame through the hero scenario; must never exceed 3 (DOM ≤ 1) |
| Sweep rule | QA freezes the poll clock for 60 s (03 15.2 step 8) and asserts `sweepActive` stays false after 45 s |
| Calm at rest | QA takes screenshots at 2 Hz for 15 s at rest and diffs them (pixelmatch, already a common devDependency pattern [M-A8]); changed-pixel share must meet 4.4 |
| DOM cost | Chrome DevTools: Rendering → Paint flashing and Layer borders during each DOM animation (no green flashes inside animated panels); Performance panel shows no Layout or Paint in animation frames |
| GPU cost | Spector.js capture of one dissolve frame and one rest frame: draw-call delta, shader cost; Chrome Performance "GPU" track on the reference laptop and an Iris Xe machine |
| Low-end ladder | DevTools CPU 4× throttle plus `resolutionScale` forced high to provoke steps; assert the ladder order and the "Reduced detail" chip |

SwiftShader in the existing puppeteer harnesses does not give representative fps (03 8). QA asserts counts, timings measured on the wall clock and orderings; absolute fps is measured by hand on the reference machines.

---

## 8. Implementation notes for the prototype

### 8.1 One motion controller

New file `src/operations/tripTwinMotion.js`, imported by `tripTwin.js` (same lazy chunk, no new hook in Justin's files).

| Responsibility | Detail |
|---|---|
| Tokens | Exports `MOTION` (durations, curves, multipliers, colors) as a frozen object. `tripTwin.css` declares the same values as custom properties. A unit test parses the CSS file text and asserts the values match (one source of truth, checked) |
| Profile | `profile()` returns `calm`, `incident`, `exit` or `reduced`. Reduced = system query or `localStorage['tripTwin.reduceMotion'] === '1'`. Listens to `matchMedia(...).addEventListener('change')` and to the in-app control; on change, any running sequence jumps to its end |
| `dur(token)` | Applies the profile multiplier and floors (2.1) |
| Sequence runner | `run(name, steps, {onSkip})` returns a handle with `skip()` and `cancel()`. One `pointerdown` / `wheel` / `keydown` capture listener on the twin container calls `skip()` on the active sequence. `visibilitychange` to hidden calls `skip()`. Sequences are pure functions of elapsed time, so skip = evaluate at t = end |
| Pulse budget | `requestPulse(id, priority, groupKey)` grants or denies a slot (4.3); tracks DOM vs canvas slots; enforces the 60 s re-announce rule |
| Clock | All canvas animation reads `performance.now()`, never `czm_frameNumber` or Cesium's `clock` (the clock may be paused or scrubbed by the sample clock) |

### 8.2 Easing in JS and in Cesium

A small cubic-bezier solver (Newton–Raphson with bisection fallback, the same algorithm as the CSS spec implementations, about 30 lines) produces `bezier(x1, y1, x2, y2)` → `(t) => y`. A unit test checks it against known CSS values at 11 sample points per curve and asserts every curve stays in [0, 1].

Cesium accepts any function as `easingFunction` (`EasingFunction.Callback`), so the same function goes to flights and to uniform tweens.

### 8.3 Camera flights

```js
// Entry approach (3.1). Values in seconds for Cesium.
camera.lookAtTransform(Cesium.Matrix4.IDENTITY);          // flights run in world frame
const ms = motion.dur(motion.flightMs(distanceM));        // 0 when reduced
const finalOffset = new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 2 * R);
const sphere = new Cesium.BoundingSphere(hotelCenterWC, footprintRadiusM);
if (ms === 0) {
  camera.viewBoundingSphere(sphere, finalOffset);         // reduced: one frame
  camera.lookAtTransform(enu, finalOffset);
} else {
  camera.flyToBoundingSphere(sphere, {
    offset: finalOffset,
    duration: ms / 1000,
    easingFunction: motion.ease.camera,
    maximumHeight: Math.max(startHeightM, endHeightM) * 1.1,
    complete: () => { camera.viewBoundingSphere(sphere, finalOffset); camera.lookAtTransform(enu, finalOffset); },
    cancel: () => { /* skip() already applied the end pose */ },
  });
}
```

- Exit flight: `camera.flyTo({ destination: saved.position, orientation: { direction: saved.direction, up: saved.up }, duration, easingFunction, maximumHeight, complete: () => camera.setView({ destination: saved.position, orientation: { direction: saved.direction, up: saved.up } }) })`.
- Skip: `camera.cancelFlight()`, then apply the end pose with `viewBoundingSphere` / `setView`.
- The 15 m minimum eye height guard from 03 4.7 runs on `camera.changed` and also clamps flight destinations.
- Focus pans (3.3) use `flyToBoundingSphere` with the current range, heading and pitch as the offset, so only the target moves.

### 8.4 Material uniforms driven by time

Uniform names (one set per building, edge and grid material, whatever spike S-1 chooses for the appearance; if S-1 picks a custom `Appearance`, expose the same names):

| Uniform | Type | Meaning | Off value |
|---|---|---|---|
| `u_centerEC` | vec3 | Hotel ground centroid in eye coordinates | — |
| `u_upEC` | vec3 | Local up at the hotel in eye coordinates | — |
| `u_reveal` | float (m) | Reveal front radius; also the scan-front band center | −1 (fully revealed) |
| `u_sweepH` | float (m) | Sweep band height above ground | −1 |
| `u_sweepW` | float (m) | Sweep band thickness | — |
| `u_cutH` | float (m) | Floor-focus cut height; glass α 0 above it | 1e6 |
| `u_layerAlpha` | float | Layer show and hide | 1 |

Precision: compute `u_centerEC` and `u_upEC` on the CPU each frame in double precision (`Cesium.Matrix4.multiplyByPoint(camera.viewMatrix, centerWC, …)` and `multiplyByPointAsVector`), then do all distance math in eye coordinates in the shader. Reconstructing world (ECEF) positions in float32 loses about 0.4 m at Earth radius and makes the 12 m scan band shimmer.

Fragment logic (inside `czm_getMaterial`, sketch):

```glsl
vec3 p = -materialInput.positionToEyeEC;                 // fragment position, eye coords
vec3 rel = p - u_centerEC;
float h = dot(rel, u_upEC);                              // height above hotel ground
float d = length(rel - h * u_upEC);                      // horizontal distance from hotel
float revealed = (u_reveal < 0.0) ? 1.0 : 1.0 - smoothstep(u_reveal - 20.0, u_reveal, d);
float front    = (u_reveal < 0.0) ? 0.0 : 1.0 - smoothstep(0.0, 12.0, abs(d - u_reveal));
float sweep    = (u_sweepH < 0.0) ? 0.0 : 1.0 - smoothstep(0.0, u_sweepW, abs(h - u_sweepH));
float cut      = step(h, u_cutH);                        // 0 above the floor-focus cut
material.alpha = (baseAlpha + rimAlpha * fresnel) * revealed * cut * u_layerAlpha
               + 0.35 * front + 0.08 * sweep * cut;
material.emission += scanfrontColor * front + sweepColor * sweep;
```

All uniforms are written in one `scene.preRender` listener owned by the motion controller. When nothing is animating, the listener writes nothing (values are already at their off states), so a resting twin costs no CPU for motion.

### 8.5 The dissolve clip

- `Cesium.ClippingPolygonCollection.isSupported(scene)` gates the effect (03 [A-4], WebGL 2 in 1.138). If unsupported: L3 veil cut.
- Build a 64-vertex circle at the current radius on the heightfield, as `new Cesium.ClippingPolygon({ positions })` in a `ClippingPolygonCollection` with `inverse: false` (clip inside), assigned to `tileset.clippingPolygons` (and `scene.globe.clippingPolygons` when keyless; 03 degradation row "No Google key" then also gets the scan reveal instead of a cross-fade [M-A3]).
- Per frame: replace the polygon (remove, add) with the new radius. The collection rebuilds its signed-distance texture on change; measure this as `clipUpdateMs` (7.3). If it exceeds 2 ms, switch to step mode: 6 radii (R/8, R/4, R/2, R, R+100, H), each held for one sixth of the dissolve while `u_reveal` still animates smoothly on the hologram [M-A1].
- Remove the collection at the end of the dissolve (`tileset.clippingPolygons = undefined` after `removeAll()`), so steady-state solo has no clipping cost.
- The scan-front ground ring is one `PolylineCollection` circle (64 segments) at `heightAt() + 0.5 m`, rebuilt only when the radius changes by more than 2 m.

### 8.6 Pins, echoes and ripples in Cesium

- Positions: `entity.position = new Cesium.ConstantPositionProperty(cartesian)` or `.setValue(cartesian)` on update. Never a `SampledPositionProperty` (it interpolates, P3).
- Echo: on a position or band change, create a hollow ring (or hollow bracket) at the old value in a small `CustomDataSource` "Trip Twin echoes", fade its color α 0.35 → 0 over `dur.echo` in the motion `preRender`, then remove it. At most one echo per person at a time (a new change replaces the old echo).
- Ripples: one `BillboardCollection` with a 64 × 64 ring sprite and at most 3 billboards. Per frame: `scale = 1 + 0.35 e`, `color.alpha = 0.9 (1 − e)`, where `e = ease.enter(cycleProgress)`. `disableDepthTestDistance: Infinity`, as for pins. Avoid `CallbackProperty` on many entities; it is acceptable only for these at most 3 items.
- The DOM floor ruler start rectangle: `Cesium.SceneTransforms.worldToWindowCoordinates(scene, cornerWC)` for the range's corners, read once at the start of the FLIP.

### 8.7 requestRender interplay

- World View today renders continuously at 30 fps (`viewer.targetFrameRate = 30`, `requestRenderMode` off), and the render governor is not installed in World View (03 section 1). `scene.requestRender()` and `governorRequestRender()` are therefore no-ops today but must still be called, so the twin stays correct if the governor is installed later (03 5.5).
- Hold continuous render for exactly the life of each motion: `holdContinuousRender('trip-twin-motion:entry' | ':exit' | ':focus' | ':incident' | ':sweep' | ':pulse' | ':echo')`, released on settle, on skip, on reduced motion and on `close()`. Owners are distinct strings so one release cannot end another motion's hold.
- After every discrete change that does not animate (reduced motion, data snap with no echo, layer state), call `governorRequestRender('trip-twin')`.
- If `requestRenderMode` is ever enabled: a resting twin with no sweep, ripple or echo renders zero frames; the sweep holds the loop for 1.6 s per snapshot (11% duty); this is the motion system's whole idle cost.
- Tab hidden: `globe.js` already sets `useDefaultRenderLoop = false`; the motion controller skips every running sequence to its end state and drops pending ripples, so there is no catch-up burst on return.

### 8.8 CSS for panels

```css
.operations .trip-twin {
  --twin-dur-micro: 120ms;  --twin-dur-short: 200ms;  --twin-dur-medium: 320ms;
  --twin-dur-long: 480ms;   --twin-dur-echo: 1200ms;  --twin-dur-pulse: 1200ms;
  --twin-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --twin-ease-enter:    cubic-bezier(0, 0, 0.2, 1);
  --twin-ease-exit:     cubic-bezier(0.4, 0, 1, 1);
  --twin-attention: #f59e0b;  --twin-select: #eff7f3;  --twin-veil: #061a23;
}
.trip-twin[data-twin-profile='incident'] {
  --twin-dur-short: 200ms; --twin-dur-medium: 200ms; --twin-dur-long: 288ms;
}
.trip-twin-card {
  transition: opacity var(--twin-dur-medium) var(--twin-ease-enter),
              transform var(--twin-dur-medium) var(--twin-ease-enter);
}
.trip-twin-card[data-state='closed'] { opacity: 0; transform: translateX(16px); }
/* DOM ripple: a pseudo-element, so only transform and opacity animate. */
.trip-twin-attn { position: relative; }
.trip-twin-attn[data-pulse='on']::after {
  content: ''; position: absolute; inset: -4px; border-radius: inherit;
  border: 2px solid var(--twin-attention);
  animation: twin-ripple var(--twin-dur-pulse) var(--twin-ease-enter) 3 both;
}
@keyframes twin-ripple { from { opacity: .9; transform: scale(1); } to { opacity: 0; transform: scale(1.35); } }
/* Changed-value highlight: overlay opacity, never background-color animation. */
.trip-twin-changed::before {
  content: ''; position: absolute; inset: 0; background: var(--twin-attention);
  opacity: 0; animation: twin-changed var(--twin-dur-echo) var(--twin-ease-exit);
}
@keyframes twin-changed { from { opacity: .24; } to { opacity: 0; } }
/* Reduced: system query (existing global rule) and the in-app setting. */
.trip-twin[data-twin-motion='reduced'] *,
.trip-twin[data-twin-motion='reduced'] *::before,
.trip-twin[data-twin-motion='reduced'] *::after { animation: none !important; transition: none !important; }
.trip-twin[data-twin-motion='reduced'] .trip-twin-attn[data-attention='on'] { outline: 2px dashed var(--twin-attention); outline-offset: 4px; }
```

- Sequences that must be skippable (entry HUD, incident panel) use `element.animate(keyframes, { duration, easing, fill: 'both' })` so the runner can call `animation.finish()`.
- The rail list expansion changes height in one step (no `height` or `grid-template-rows` animation); only the rows' opacity and transform animate.
- `will-change: transform, opacity` only on the elements that are about to animate, removed on `animationend`, to avoid holding compositor layers for the whole session.
- The `twin-veil` element sits between the canvas and the HUD (z-index above `#cesium-credits` must not be used; the credits stay visible, 03 10.3).

---

## 9. Motion inventory (complete)

Every motion in Trip Twin, with job, trigger and reduced fallback. A motion not in this table is not allowed.

| # | Motion | Job | Trigger | Duration / curve | Reduced fallback |
|---|---|---|---|---|---|
| 1 | Entry flight | ORIENT | Open Trip Twin | `dur.flight(d)`, `ease.camera` | `setView` |
| 2 | Scan-front dissolve | ORIENT, CAUSE | Flight end and data ready | 1200 / 400 ms, `ease.standard` + `ease.exit` | Cut |
| 3 | Sky darken | ORIENT | Dissolve | 600 ms | Instant |
| 4 | Visual-mode intensity ramp | ORIENT | Entry, exit | `dur.medium` | Instant |
| 5 | HUD enter / leave | ORIENT | Entry, exit | `dur.medium`, enter / exit | Instant |
| 6 | Late-building reveal | FRESH, CAUSE | Overpass data after dissolve | `dur.long`, `ease.standard` | Instant |
| 7 | Layer show / hide | CAUSE | Toggle | `dur.short` to `dur.medium`, radial | Instant |
| 8 | Path draw-on | CAUSE | Path shown or recomputed | `dur.long`, `ease.standard` | Instant, complete |
| 9 | Floor bracket extension, tether draw | CAUSE | Floor layer on, focus | `dur.short` | Instant |
| 10 | Selection lock-on | CONFIRM | Select person or item | `dur.short`, `ease.enter` | Instant ring |
| 11 | Dim others | ORIENT | Person focus | `dur.short` | Instant |
| 12 | Focus pan | ORIENT | Person focus (pin off-center) | `dur.long`, `ease.camera` | `setView` if needed |
| 13 | Floor-focus camera, glass cut, ruler FLIP | ORIENT, CAUSE | Floor focus | `dur.long`, `dur.medium` | `setView`, instant |
| 14 | Reported-slab arrival | CAUSE | Report added | `dur.short` + 600 ms edge settle | Instant |
| 15 | Incident panel open | — (information) | Incident in focus | 200 ms | Instant |
| 16 | At-or-above bracket growth | CAUSE, ATTEND | Report added, membership change | 360 ms, `ease.standard` | Instant |
| 17 | Incident camera | ORIENT | Report added by operator, floor off screen | `dur.long`, `ease.camera` | `setView` if needed |
| 18 | Hotspot ripple | ATTEND | New or worsened decision item | 3 × 1200 ms, `ease.enter`; ≤ 3 | Static double ring |
| 19 | Snapshot sweep | FRESH | Snapshot applied, feed healthy | 1600 ms, linear | None (rail text) |
| 20 | Echo of previous value | FRESH, CAUSE | Position, band or value change | `dur.echo`, `ease.exit` | Static 5 s |
| 21 | Ring line-style morph | FRESH | Time-state change | `dur.short` | Instant |
| 22 | Changed-value highlight | FRESH | Readout value change | `dur.echo` | Static delta text |
| 23 | Number swap | FRESH | Count change | `dur.micro` crossfade | Instant |
| 24 | Toggle, button, row press | CONFIRM | Input | `dur.micro` | Instant |
| 25 | Toast | CONFIRM | Exit with a reported floor, Copy for hotel | 160 in / 4 s / 120 out | Shown 4 s, no fade |
| 26 | Exit contraction and flight back | ORIENT | Exit | 600 ms + 0.75 F′ | Cut, `setView` |
| 27 | Veil cut | ORIENT | Long incident jump, L3, wall profile | 80–120 ms each way | Instant |
| 28 | Scale change, plan view | ORIENT | Operator control | `dur.long`, caps V2–V3 | `setView` |
| 29 | Loading spinner (existing `ops-spin`) | FRESH | Waiting on a request | 1 s linear loop | Static (existing CSS rule) |

---

## 10. Assumptions

| ID | Assumption | How to retire it |
|---|---|---|
| M-A1 | Replacing a `ClippingPolygon` every frame for 36 frames stays under 2 ms CPU and does not stall the GPU; otherwise the 6-step mode is used | Spike S-1 (03), measure `clipUpdateMs` on the reference laptop and Iris Xe |
| M-A2 | Re-showing a hidden Google tileset at exit reloads tiles fast enough that the 600 ms contraction does not look broken | Spike S-1; fall back to the veil cut |
| M-A3 | `globe.clippingPolygons` works the same way on the keyless satellite globe in Cesium 1.138, so the keyless path gets the same scan reveal | Spike; else the veil cut for keyless |
| M-A4 | `skyAtmosphere.brightnessShift` can be animated per frame without shader recompilation | Spike S-1 |
| M-A5 | A device-level `localStorage` preference for reduced motion is acceptable (no personal data, not synced) | Product owner |
| M-A6 | Restoring World View's tracked entity (Follow) after exit is wanted; 03 stops tracking on entry but does not say whether to restore it | Product owner, Justin |
| M-A7 | A future wall display needs a cut-only camera profile; not built in the prototype | Wall pass (03 P2) |
| M-A8 | A screenshot-diff library can be added as a devDependency for the calm-at-rest QA check, or written in about 40 lines over puppeteer PNG buffers | 03 QA owner |
| M-A9 | The stack gutter for floor bands sits on the camera-facing side of the hotel (03 7.2), so floor and incident focus need at most a 90° heading change | 04 screen spec |
| M-A10 | Three simultaneous ripples and the priority order in 4.3 are the right attention budget for an expert operator under stress | Demo A scenario run with 5–8 operators (06 section 7): any operator who misses an at-or-above person or a not-current person within 60 s, or reports the scene as busy, triggers a review |
| M-A11 | The film's floor-explode moment is better served by the schematic ruler than by lifting floors in 3D | Same scenario run; ask whether the ruler reads as "not a floor plan" |
| M-A12 | Durations (1.2 s dissolve, 480 ms camera, 3-cycle ripples, 1.6 s sweep) are starting values; they must be tuned on the reference laptop at 30 fps, not judged in a 60 fps mock | Prototype review by Jesse and Justin against the reference frames |


## 11. Phase 11 amendment (16 Oct 2026): the three tiers and the approved idle drift
Decided by Jesse on 16 Oct 2026; built in `twinMotion.js` and the Instrument skin. This section records the exceptions to §4.2 and §6.4 V5 and binds them.

| Item | Rule |
|---|---|
| Tiers | Every motion belongs to one tier: **Live** (live dot, snapshot sweep), **Event** (count highlight, band entrance), **Cinematic** (fog-in panels, the remote's rail wavefront, idle drift). Each tier has its own switch per wall (remote 06 Layers › Display · Motion) and on the All-in-one (Display › Motion). Reduce motion, system or in-app, turns all three off and cannot be overridden. |
| Idle drift (exception to §4.2 and V5) | Site wall only, Cinematic tier on, after 60 s with no hands on and no pending camera command. Never while a report is open on any trip on watch, while the link is stale, or while the remote is offline. Any input, camera command, site switch, spotlight or report stops it at once and restarts the 60 s clock. Profile: heading = h0 + 10°·(1 − cos 2πt/125 s), peak 0.5°/s, no roll, no pitch change; it returns to the operator's heading. The wall chip reads "· drifting" and the remote's card and preview read "drifting · idle camera". |
| Calm budget while drifting | §4.4 is measured with drift excluded; the sweep and the live dot stay inside the budget. |
| Sweep | DOM band over the 3D view, transform only, α 0.2, 1.6 s linear, once per applied snapshot; never on a stale wall or a wall without 3D. |
| Live dot | 4.6 s breath; stops while the wall is STALE or the remote is offline. |
| Not yet built (declared, next motion phase) | Echo at the old fix, selection reticle, identify pulse, static "+n at hh:mm:ss" deltas, the cross-wall incident cascade. |
