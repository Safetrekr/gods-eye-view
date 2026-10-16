# 04 Trip Twin screen spec

Owner: interface architect. Status: draft for PROJECT-PLAN.md. Date: 2026-10-15.
Skills applied: D26 real-time monitoring UX, D29 exception triage and operator playbooks, E40 visual hierarchy and calm under complexity, E36 notification strategy, B15 trust calibration, B10 explainability, F45 performance-conscious UI, E33 responsive operator layout, E34 accessibility-first design.

Inputs read in full: 00-CONTEXT.md, 01-operator-scenarios.md, 02-layer-catalog.md, 03-architecture.md, 06-layer-taxonomy.md, the film frames in `./reference/`. Code read (read-only) in gods-eye-view `src/operations/`: `main.js`, `globe.js`, `worldControls.js`, `alertsPanel.js`, `participantPins.js`, `operations.css`, `model.js`, `actions.js`.

Authority used in this file:
- **Words**: 06 section 3 is the only vocabulary. Every quoted UI string below comes from it. The few strings 06 does not cover are marked **[vocab add]** for 06 to confirm.
- **What is on screen when**: 01 section 5 (Tier 0 / Tier 1 / Tier 2), as split by 06 section 1.2.
- **What is feasible and the budget**: 03 (Cesium 1.138 `Primitive` batches, one heightfield, 30 fps continuous).
- Conflicts between the files are decided in section 10.1 with the reason.

Assumptions are tagged **[SS-A#]** and listed in section 10.3.

---

## 1. Design thesis

Trip Twin feels like the future because it **removes the city and keeps the truth**. The photoreal world dissolves (1.2 s, skipped during an incident). What remains is a dark field (`#061a23`), a slate-teal glass model of the blocks around the hotel, a measured grid floor, and nothing else until data puts something there. The futurism comes from four things the operator can use. (1) **X-ray glass**: buildings are translucent, so a person or a street behind a tower is never hidden. (2) **The exploded floor ruler**: the hotel's floors are pulled out beside the building onto a lit scale, the honest version of the film's "pull the engine out", so a floor band reads as an estimate on a ruler, not a dot in a room. (3) **Light means time**: glow strength follows data recency, and the one moving element in the scene (a slow scan line climbing the hotel) exists only while the traveler feed is live. When the feed stalls, the scene goes still. (4) **Hotspot rings mean "decide now"**. They are the film's yellow rings, recolored to brand amber and reserved for people and places that need an operator decision. Calm comes from restraint. The scene is monochrome slate. Only five accent meanings exist (people white, attention amber, hazard red, approved-safety green, suggested-path blue), and each appears only where data puts it. **The purpose rule**: an element stays only if it answers at least one of Q1-Q5 and has a stated failure state. If removing it would cost the operator no answer, it is cut (section 4.3), however good it looks. Motion, glow and shape never carry meaning alone. Every meaning is also a word and a line style.

---

## 2. Screen anatomy

### 2.1 Regions (desktop, reference 1920 × 1080; supported down to 1280 × 720)

Trip Twin runs inside Justin's existing `#ops-console`. It keeps his 66 px header and replaces his left sidebar and legend while open (03 H-1, H-5). Nothing outside `#ops-console` changes.

| ID | Region | Position and size (1920 × 1080) | What lives here | Never here |
|---|---|---|---|---|
| R0 | World View header (Justin's, unchanged) | Top, full width, 66 px | Logo, "World View", environment badge (`SIMULATED DATA · SAMPLE TRIP` in sample), sync status, Trips / Alerts / World controls / Sign out. While Trip Twin is open, **World controls** is disabled with the tooltip "Use Layers inside Trip Twin". | Twin controls |
| R1 | Twin bar | Under R0, full width, 44 px | Left: **Exit Trip Twin** (always visible). Then `TRIP TWIN · {hotel name} · {trip title}` and the `SAMPLE` tag. Centre: breadcrumb `World View › {trip title} › {hotel name} › {focus}`. Right: `{02:14} local (CDT)` and the night chip `Night · civil dusk {18:42}`. | Counts, alerts |
| R2 | Status rail | Left, x 16, from 122 px to the bottom (16 px margin), 340 px wide. Same side and similar width as Justin's sidebar, so people look in the same place for "my people". | Tier 0 readouts: roster count block, zone line, Needs attention lists, chaperones, rally chip, hazard summary, Sources. Never scrolls the roster block off screen (it is sticky); lists scroll beneath it. | Anything that requires the hologram to be read |
| R3 | Scene | Between R2 and R4 (or to the right edge when R4 is closed) | The hologram, people, floor ruler, hazards, safety glyphs, paths, edge chips, region banner (top centre), sample watermark | DOM text panels other than chips, banners and label plates |
| R4 | Incident panel | Right, 380 px, from 122 px to the bottom. Opens only when an incident or hazard is in focus (06 1.2 Tier 1) | Official instruction slot, reported incident, priority count, floor partition, promoted Tier 2 items, destinations and shelter card, message status, stand-down line, actions | Positions list (that is R2) |
| R5 | Details card | Right column. With R4 closed it docks at the right (360 px). With R4 open it takes the lower half of the right column, and R4 compresses to its header plus the priority count; at < 1440 px wide the card replaces R4, with a `‹ Incident` tab to go back | Person card, safety resource card, path card, hazard card, floor-range card | Data not tied to the selection |
| R6 | Toolbar | Bottom centre of R3, a single glass bar, 44 px tall | `Building · Neighborhood · City` segmented control, `3D view / Plan view (north up)`, **Layers**, **Legend**, **More**, **Add reported floor**. During sample mode, `Play · Pause · Scrub` sits at its right end. | Sends |
| R7 | Source line | Bottom left of R3, one line, above Cesium credits (credits stay visible, 03 10.3) | `Map data © OpenStreetMap contributors (ODbL)` · `Terrain: Re:Earth (CC BY 4.0)` · `Routing: OSRM / FOSSGIS` (only while paths are drawn) · scale note `Grid: 10 m · bold lines 50 m` | Hidden by any panel. It can never be turned off |
| R8 | Edge chips | Inner edge of R3, up to 6 (06 D1) | `{label} {distance} {bearing} →`, e.g. `Relocation site 4.1 km NE →`, `5 away →` | Items inside the current scale |
| R9 | Popovers | Anchored to R6: Layers (360 px, right of centre), Legend (320 px), More drawer (380 px, slides over R4) | 06 section 2 layer groups; dynamic legend; Tier 2 readouts | Anything Tier 0 |

Z-order (top first): modal dialogs (Send alert, Direct group, Add reported floor) › R9 popovers › R1/R2/R4/R5/R6 › R8 chips and label plates › scene. The sample watermark sits above the scene and below all chrome, at 7% opacity, so it never hides a number.

### 2.2 Wireframe: default view (no incident), Demo A hotel at 21:32, before the alarm

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▣ SafeTrekr │ World View  [SIMULATED DATA · SAMPLE TRIP]                    Sample · 12s ago  [Trips][Alerts][World controls⊘][Sign out] │ R0
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [‹ Exit Trip Twin]  TRIP TWIN · Fairmont Austin · Spring STEM Tour [SAMPLE]   World View › Spring STEM… › Fairmont Austin   21:32 local (CDT) · Night · civil dusk 19:41 │ R1
├────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────┤
│ WHERE ARE MY PEOPLE        │                                                       Relocation site 4.1 km NE →  (R8) │
│ Inside (likely)        19  │            .   .   .   .   .   .   .   .   .   .   .   .   .   .                          │
│ At hotel, undetermined  4  │        .  ┌──┐ .   .  ╔══════╗  .   .  ┌───┐ .   .   .   .   .                          │
│ Outside, nearby         1  │       .   │  │   ┌─┐  ║ ┊sc┊ ║   .    │   │  ▲ Rally point (primary)                     │
│ Away                    1  │      .  ┌─┴┐ │   │ │  ║ ┊an┊ ║ ◉M.R.  └───┘  ║ 13–17 min walk · approved                  │
│ Not current             2  │     .   │  │ │  ┌┘ └┐ ║Fairmont║ ·Last known  ─ ─ ─▶═══ (blue, Suggested path)          │
│ Not located             0  │    .  ┌─┘  └─┘  │   │ ║ Austin ║  1h 28m      .   .   .                                 │
│ of 27 loaded               │   .   │   (glass, slate)   ╚══════╝ ◯ ◯ (accuracy rings, white)                        │
│ ─────────────────────────  │  .  .  .  .  .  .  .  .  .  ( ── group zone ring, teal ── )  .  .  .                   │
│ Outside group zone 1 ·     │   .   .   .   .   .   .   .   .   .   .   .   .  ✚ Hospital  ⛉ Police   .              │
│ Unaccompanied 1 · Zone     │                                                                                          │
│ unknown 0                  │                                                                                          │
│ ─────────────────────────  │                                                                                          │
│ NEEDS ATTENTION (3)        │                                                       5 away →          (R8)            │
│ ◌ M.R. · Last known 1h 28m │                                                                                          │
│   battery 4% · likely dead │                                                                                          │
│   phone · still not current│                                                                                          │
│ ◌ T.C. (C) · Aging · 4m    │                                                                                          │
│ ⟶ J.P. · Outside group zone│                                                                                          │
│   · Unaccompanied · 34s    │                                                                                          │
│ ─────────────────────────  │                                                                                          │
│ CHAPERONES 3 · 1 aging     │                                                                                          │
│ RALLY ▲ primary 13–17 min  │                                                                                          │
│       △ secondary 18–24 min│                                                                                          │
│ HAZARDS  No FIRMS heat     │                                                                                          │
│ detections within 25 km in │                                                                                          │
│ the last 24 h (latest data │                                                                                          │
│ 20:20 UTC). Satellites miss│                                                                                          │
│ fires under cloud…         │                                                                                          │
│ ─────────────────────────  │ Map data © OpenStreetMap contributors (ODbL) · Terrain: Re:Earth (CC BY 4.0) · Grid 10 m │ R7
│ SOURCES  Sample · 12s ago ●│   ┌──────────────────────────────────────────────────────────────────────────────┐     │
│ OSM buildings · from cache │   │ Building │Neighborhood│ City │ 3D ▸Plan │ Layers │ Legend │ More │ Add reported floor │ │ R6
│ Paths · computed 3m ago    │   └──────────────────────────────────────────────────────────────────────────────┘     │
└────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────┘
  R2 (340 px)                  R3 scene (R4 closed, R5 opens here on selection)
```

Notes on the default view:
- R4 is closed: nothing is in focus, so the scene gets the width.
- Floor estimates are off (06 2.2, 1.2). The hotel shows no floor ruler.
- The scan line (`┊scan┊`) climbs the hotel only because the snapshot is live.
- The only amber on screen is the three Needs attention items and their hotspot rings in the scene.

### 2.3 Wireframe: incident in focus, Demo A (01 §8, S2 hotel evacuation), 02:14 local

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▣ SafeTrekr │ World View  [SIMULATED DATA · SAMPLE TRIP]                                  Sample · 9s ago  [Trips][Alerts][…] │ R0
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [‹ Exit Trip Twin] TRIP TWIN · Fairmont Austin · Spring STEM Tour [SAMPLE]  World View › Spring STEM… › Fairmont Austin  02:14 local (CDT) · Night │ R1
├────────────────────────────┬──────────────────────────────────────────────────┬───────────────────────────────────────┤
│ WHERE ARE MY PEOPLE        │ FLOOR ESTIMATES · phone barometer · not verified │ INCIDENT · Hotel evacuation [vocab add]│
│ Inside (likely)         3  │      US numbering · lobby = 1                    │ OFFICIAL                              │
│ At hotel, undetermined  5  │   12 ┤                                           │ No official instruction on file.      │
│ Outside, nearby        16  │   11 ┤ ┬        ┌────────────┐                    │ Check local authorities.              │
│ Away                    0  │   10 ┤ ┼◉M.R.   │            │                    │ ───────────────────────────────────── │
│ Not current             2  │ ▓▓ 9 ┤▓┴▓┬▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓│▓ ◀ Reported: smoke ·│ Reported: smoke · floor 9 · hotel desk│
│ Not located             1  │    8 ┤   ┼ A.K. │  (hotel,   │      floor 9        │ · 02:12 · not verified  [Edit][Remove]│
│ of 27 loaded               │    7 ┤   ┴ ↓    │  neutral   │   (red hatched slab)│ ───────────────────────────────────── │
│ ─────────────────────────  │  ...                                              │ At or above reported floor 9: 2       │
│ Outside group zone 0 ·     │    4 ┤      ┬   │  glass)    │                    │ ◉ M.R. · Likely floor 10 (9–11) ·     │
│ Unaccompanied 0 · Zone     │    3 ┤      ┼ L.B│           │                    │   4m ago · band unchanged 8 min       │
│ unknown 3                  │    2 ┤      ┴   │            │                    │ ◉ A.K. · Likely floor 9 (8–10) ·      │
│ ─────────────────────────  │    1 ┤──────────┴────────────┴── street ───────── │   40s ago · descending                │
│ NEEDS ATTENTION (6)        │                 ◯◯◯ ◯ (5 rings straddle edge)    │ [Copy for hotel / responders]         │
│ ◉ M.R. · At or above       │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │ Above 0 · At or near 2 · Below 3 ·    │
│   reported floor 9         │   ⊚ Hotel assembly point [vocab add]  ●●●●●●●●   │ Last est. only 1 · Floor unknown 2 ·  │
│ ◉ A.K. · At or above       │   · from hotel card 18:05   (16 · outside,      │ Not shared 0 · No floor (not at       │
│   reported floor 9         │                               nearby)            │ hotel) 19 · of 27 loaded              │
│ ◌ S.D. · Stopped · current │   ════▶ Suggested path (unverified) · primary    │ ───────────────────────────────────── │
│   lobby · Last est. only   │        to Rally point (primary) 850 m            │ HOTEL CARD (from chaperone, 18:05)    │
│ ◌ T.C. (C) · Aging · 4m    │                                                  │ Group floors 8, 9, 11 · Interior      │
│ ◌ R.O. · Last known 34m    │                                                  │ unknown · Evacuation plan: photo ▸    │
│   600 m away · battery 6%  │                                                  │ ───────────────────────────────────── │
│ ◌ E.W. · No location       │                                                  │ IF THE GROUP MUST MOVE                 │
│   reported                 │                                                  │ Rally point (primary) · 850 m · walk  │
│ ─────────────────────────  │                                                  │ 13–17 min (group pace) · Suggested    │
│ CHAPERONES 3 · 2 outside,  │                                                  │ arrive-by: 36 min (12 prepare + 17    │
│ nearby · 1 aging           │                                                  │ walk + 7 buffer)                      │
│ ─────────────────────────  │                                                  │ OSM street path · not checked for…    │
│ SOURCES Sample · 9s ago  ● │ Map data © OpenStreetMap… · Grid 10 m            │ ───────────────────────────────────── │
│ Floor est. · sample traces │ ┌────────────────────────────────────────────┐   │ Last message: none sent               │
│ FIRMS · key needed         │ │ Building│Neighb.│City│3D│Layers│Legend│More│…│   │ Re-entry and stand-down: hotel or     │
│                            │ └────────────────────────────────────────────┘   │ authorities only                      │
│                            │                                                  │ [Send alert ▸] [Direct group here ▸]  │
└────────────────────────────┴──────────────────────────────────────────────────┴───────────────────────────────────────┘
```

What changed on entering incident focus (section 6.6 has the rules):
- R4 opened. The official instruction slot sits first, above anything SafeTrekr computes (01 doctrine 1).
- Floor estimates turned on (06 C3). The exploded floor ruler slid out of the hotel's camera-facing corner.
- The reported floor slab is the only red on the screen. People's brackets that cross it are the at-or-above answer, readable without a number.
- Context buildings dimmed from α 0.12 to 0.06. Nothing was hidden or switched off.
- The scale stayed Neighborhood. The camera reframed only because the operator had not moved it in the previous 10 s (6.6).

### 2.4 Future SOC wall display (not built in the prototype, 06 Q13; layout reserved)

| Topic | Wall rule | Why |
|---|---|---|
| Role of the wall | A **read-only mirror** of one operator console. All input stays on the console. | A wall has no hover and no private keyboard. Control lives where accountability lives. |
| Layout at 3840 × 2160 | Three columns: rail 22%, scene 52%, incident panel 26%. The roster block becomes one line across the top of the scene (06's single-line format) at 40 px type. | Readable from 4-6 m. The one-line format suits a wide display. |
| Type scale | All type × 2 against desktop (minimum 24 px; counts 56 px; ages 28 px mono) [SS-A1] | Viewing distance |
| Privacy | Initials and role only. No full names. Floor estimates forced off unless an incident is open (06 C12, 01 [A9]). No battery level. | Shoulder-surfing, minors |
| Hover-only content | None. Every fact a desktop shows on hover is either promoted to a label or dropped from the wall. | No pointer on a wall |
| Motion | Same as desktop. The scan line and the hotspot acquire pulse are the only motion. | Calm room |
| Performance | `resolutionScale` 0.75 at 4K, edges off on non-hotel buildings, label budget per 06 D1 × 1.5 (03 R-14 perf pass required) | 30 fps at 4K is unproven |
| Collaboration (from the film's "Situation handling") | Future: named responders attached to an incident, shown in R4. Out of scope; no data source today. | Recorded so the region is reserved, not built |

---

## 3. The five-second read

The order is designed so that the operator learns **who to ask about** before looking at any pin (01 2.2). Each step answers one of the five questions, and each step is a readout first and a drawing second (06 1.1), so the read still works with the hologram rotated or cluttered.

### 3.1 Default view (no incident)

| Eye hits | Element | Where | Visual weight that makes it first | Question |
|---|---|---|---|---|
| 1st | Roster count block: `Inside (likely)` / `At hotel, undetermined` / `Outside, nearby` / `Away` / `Not current` / `Not located` / `of {N} loaded` | R2 top, sticky | Largest numbers on screen (Intel One Mono 22 px, tabular), top-left reading start | Q1 Where are my people? |
| 2nd | Amber: the Needs attention count and list, mirrored by hotspot rings in the scene | R2 under the roster; scene | The only amber on a slate screen. Rings sit on the exact items | Q1 (who to ask about) and Q5 (how old) |
| 3rd | The hotel and the green safety glyphs with walk times, plus the blue suggested path to Rally point (primary) | Scene centre; R2 rally chip | The brightest structure (subject edge `#e3e7e9`) and the only green | Q3 Where is safety? Q4 How do they get there? |
| 4th | Hazard summary: either the nearest hazard card or the bounded empty statement (HAZ-07) | R2 | Red only if a hazard exists; otherwise muted text that states its blind spot | Q2 What is the threat, and where? |
| 5th | Sources: `Sample · {12s} ago`, per-layer time states, `source_issues` | R2 bottom | Quiet when healthy. When degraded, the whole line turns amber and moves to the top of R2 (section 7) | Q5 How fresh and trustworthy is this? |

### 3.2 Incident in focus (Demo A, S2)

| Eye hits | Element | Where | Question |
|---|---|---|---|
| 1st | The reported floor slab (red, hatched) on the hotel and on the floor ruler, with the label `Reported: smoke · floor 9 · hotel desk · 02:12 · not verified` | Scene centre; R4 | Q2. The incident is stated with its source, time and "not verified". |
| 2nd | `At or above reported floor 9: 2` with the two rows, each with band and age | R4, top block under Official | Q1. This is the priority list to pass to the hotel and the fire service. |
| 3rd | Roster count block, with `At hotel, undetermined 5` in plain sight (not hidden inside Outside) | R2 | Q1. "Undetermined" is never read as "out". |
| 4th | Needs attention list (not current, last estimate only, no location) | R2 | Q1, Q5 |
| 5th | Official instruction slot, Hotel assembly point, and "If the group must move" card with arrive-by arithmetic | R4; scene | Q3, Q4. Holding at the hotel assembly point is the default; the path card exists for later. |
| Always | Every label carries its age. A label without an age is a defect (06 D11). | Everywhere | Q5 |

Rule: the official slot is first in R4's DOM and reading order. When empty, it is one muted line, so it does not steal the first glance. When filled (HAZ-12), it becomes the loudest element in R4: full-width, `#eff7f3` on `#07212c`, with the authority and the time.

---

## 4. Element inventory

### 4.1 Readouts and chrome

Data sources cite 02. "Snapshot" = the Core staff operations snapshot (`demoTripTwin` fixture in the prototype, same shape). "Client" = computed in gods-eye-view (03).

| # | Element | Region | Question | Data source (02) | States | Interaction | Purpose test passed (why it earns its place) |
|---|---|---|---|---|---|---|---|
| E1 | Exit Trip Twin | R1 | — | — | Enabled always | Click or breadcrumb `World View` → exit and exact restore (6.8) | The operator must always see the way back. It is the "stop" of this view. |
| E2 | `TRIP TWIN · {hotel name} · {trip title}` + `SAMPLE` | R1 | Q5 | `places[kind=lodging].name`, `trips[].title` | Normal; `SAMPLE` in sample mode | Hover shows full text when truncated | Prevents acting on the wrong trip or on fixture data |
| E3 | Breadcrumb | R1 | — | Focus state | Up to 4 segments; focus segment `aria-current="location"` | Segments clickable per 06 4.4 | Tells the operator what the panels are filtered to |
| E4 | Local time and night chip | R1 | Q2 (night raises exposure) | Client (sun altitude, `trips.timezone`) | Day / `Night · civil dusk {18:42}` | None | 01 rank 10, Tier 0. Night changes walk pace and arrive-by |
| E5 | Roster count block | R2 | Q1 | Snapshot `participants` + client hotel verdict (06 3.2, 2× rule) | Normal; `(incomplete)` suffix when `source_issues` touch participants; `—` for Inside (likely) when hotel location approximate (HTL-06); "as of {02:13:40}" when snapshot stale | Click a bucket → filters the scene to that bucket (others dim, still counted) and lists them in R2 | 01 rank 1-2, the P0 answer. Buckets always sum to "of N loaded" |
| E6 | Zone line `Outside group zone {n} · Unaccompanied {n} · Zone unknown {n}` | R2 | Q1 | Snapshot `group_zone_state`, `group_zone_ambiguous`, `group_zones` (Core-computed only) | Normal; all people move to Zone unknown when zones are overdue (ZON-08) | Click a count → list | 01 rank 4, Tier 0 |
| E7 | Needs attention list | R2 | Q1, Q5 | Union of: Not current (oldest first, with battery), Not located, Outside group zone, Unaccompanied, At or above reported floor, Last est. only | Row = reason + age; new rows carry a `new` tag for 60 s | Click row → person focus (6.4). `[` `]` steps through rows | Who to ask about, in order. Mirrors every hotspot ring so the canvas is never the only path |
| E8 | Chaperones line | R2 | Q1 | Snapshot participants with `role=chaperone` | `{3} · {2} outside, nearby · {1} aging` | Expand → each chaperone with verdict and age | 01 rank 4: which adult is with which cluster |
| E9 | Rally chip | R2 | Q3, Q4 | `safety_points` (`rally_primary`, `rally_secondary`) + OSRM walk time | `▲ primary {6}–{9} min`; `No approved rally point (primary) on file for this hotel` (SAF-25 pattern) | Click → safety resource card and path | 01 rank 9 part, Tier 0 |
| E10 | Hazard summary | R2 | Q2 | FIRMS records, reported incidents, USGS (rail chip only) | Nearest hazard headline (HAZ-02 / HAZ-08 / HAZ-10); empty statement (HAZ-07); `Unavailable — {reason}` (FRS-04) | Click → hazard card, camera frames hotel + hazard | Q2 must have an answer even when it is "nothing observed, and here is the blind spot" |
| E11 | Sources section | R2 bottom; promoted to R2 top when degraded | Q5 | Snapshot `generated_at`, poll success, `source_issues`; feed stats; OSM, path and terrain fetch times | Per line: `Live`, `Updated {3h} ago`, `Stale · last update {14:20}`, `Unavailable — {reason}`, `Key needed`, `{Layer} hidden` (FRS-01 to 10) | Click a line → explanation and Retry where available | 02 2.4: absence is never an all-clear. Every visible layer states its age |
| E12 | Live dot next to `Sample · {12s} ago` | R2 Sources | Q5 | Snapshot receipt time | Filled `#eff7f3` while ≤ 45 s; hollow amber when > 45 s | None | Same meaning as the scan line, for reduced motion and for screen readers |
| E13 | Incident panel header `INCIDENT · {type}` | R4 | Q2 | Fixture incident type (prototype) | Open / compressed (with R5 open) | Collapse to header; cannot be dismissed while a reported incident exists | Holds Tier 1 together |
| E14 | Official instruction slot | R4 first | Q2, Q3 | HUMAN (fixture in prototype) | Empty HAZ-11; filled HAZ-12 | Prototype: fixture only [SS-A2] | 01 rank 5. Must exist even when empty (01 §5) |
| E15 | Reported incident card | R4 | Q2 | Operator input (session only, 02 incident floor marker) | FLR-10; edit history line `Changed floor 9 → 10 · J.T. · 02:20` | Edit / Remove (6.7) | Input to R15 and the floor partition |
| E16 | Priority count `At or above reported floor {9}: {n}` + rows | R4 | Q1 | Client R15 over `floor_estimate` (03 6.4) and hotel verdict | Rows show FLR-01..03 string, age, and "descending" / "band unchanged {8} min" | Row → person focus; Copy for hotel / responders | The answer the fire service needs (01 S2) |
| E17 | Floor partition line FLR-12 | R4 | Q1 | Same | All buckets visible even at 0 | Click a bucket → floor-range focus or list | Never collapses unknown into Below (02 2.4 rule 6) |
| E18 | Hotel card block (promoted for hotel evacuation) | R4 | Q3 | Fixture hotel card (01 1.2); `Interior unknown` (SIT-08) when absent | Present (with provenance `from chaperone, {18:05}`); absent: "Interior unknown · Hotel card not provided" | Evacuation plan photo opens in R5 | 01 rank 15, promoted in S2 |
| E19 | "If the group must move" destination card(s) | R4 | Q3, Q4 | `safety_points` + OSRM (02 1c) | PTH-04, PTH-13, PTH-14, PTH-03 caption, PTH-15 when a hazard layer is off | Change destination (`Show paths to…`), `Draft note from path`, `Direct group here` | 01 ranks 7, 9, 12 |
| E20 | Shelter in place card PTH-17 | R4 | Q3 | Static option text | Shown beside paths; first card for Civil unrest and active-threat types | None (informational) | 01 R7: an option, never hidden behind routes |
| E21 | Information steps checklist [vocab add] | R4 | Q1-Q5 | Static per incident type, from 01 (e.g. S2: "Call chaperones for headcount", "Pass at-or-above list to hotel desk", "Confirm hotel assembly point", "Check official instruction") | Unticked / ticked (session only, with time and initials) | Tick | D29 playbook. 01 AP16 allows information steps and forbids verdicts. Gives the operator a sequence under stress without telling them to evacuate |
| E22 | Message status | R4 | Q1, Q5 | Snapshot `alerts[]` (`acknowledged_count`, push counts) | `Last message: none sent`; MSG-01, MSG-02, MSG-03 as three separate counts | Click → alert detail in Justin's Alerts panel | 01 rank 3. Never an all-clear tick |
| E23 | Stand-down line MSG-06 | R4 bottom | — | Static | Always | None | 01 doctrine 1. Replaces the button that must never exist |
| E24 | Send alert / Direct group here | R4 actions; safety and path cards | — | `capabilities.send_alert`, `capabilities.direct_group` | Enabled; disabled with `View-only role` (MSG-07) | 2-step dialog (6.7) | The two real levers (01 §0) |
| E25 | Copy for hotel / responders | R4, person card, floor-range card | Q1 | Same data as the rows | Enabled for every role | Copies plain text (6.7) | The main real-world lever is the phone (01 §0). This makes the relay exact and dated |
| E26 | Person card | R5 | Q1, Q5 | Participant fields (02 1d), verdicts, `floor_estimate`, last 3 `geofence_events` | Per 06 3.1 states; floor states FLR-01..07 | Show 2× accuracy, Possible area, Copy, Open Trip Twin entry when coming from World View | Drill-down with full provenance |
| E27 | Safety resource card | R5 | Q3, Q4 | `safety_points` fields (02 1b) | SAF-20..29 qualifiers | `Show paths to…`, `Direct group here` (gated; disabled for drafts with SAF-21) | Drill into a place of safety |
| E28 | Path card | R5 / R4 | Q4 | OSRM + hazard check (02 R2, R3) | PTH-01..18 | Recompute, Draft note from path | Distance, range, closest approach, chokepoints, age |
| E29 | Hazard card | R5 / R4 | Q2, Q5 | FIRMS / reported / USGS | HAZ-02..10, caveat word (C0-C3) | Toggle low-confidence detections | Source, observation time, distance, bearing |
| E30 | Region banner | R3 top centre | Q2 | City/country-level intel (Demo B advisory) | `{text} · Location approximate (city)` (HAZ-09) | Dismiss to R2 hazard list (not deleted) | 01 AP14: region intel never pinned |
| E31 | Edge chips | R8 | Q1, Q3 | Any item beyond the current scale | `{label} {distance} {bearing} →` | Click → scale that contains it, or `Show in World View` | Off-screen people and places are never silently missing |
| E32 | Toolbar | R6 | — | — | Scale pressed state follows the camera | Section 6.2 | Movement and layer control in one place |
| E33 | Layers popover | R9 | — | 06 section 2 | Rows with feed badges (`Stale`, `Key needed`) | Toggle; locked rows show a lock and "Locked in Trip Twin" | Lets the operator declutter without losing readouts (06 C7) |
| E34 | Legend | R9 | Q5 | Dynamic, 06 5.2 | Opens once on first entry per session | `L` | Explains every drawn meaning in 06 words |
| E35 | More drawer | R9 | Q3, Q5 | Tier 2 items (06 1.2) | Lists | Open from R6 | Tier 2 stays one action away |
| E36 | Source line R7 | R3 bottom left | Q5 | Licences (03 10.3) | Always | Link to OSM copyright | ODbL and CC BY obligations |
| E37 | Sample watermark | Full frame | Q5 | Sample mode | `SAMPLE DATA · fictional people and events` | None | Fixture never mistaken for real |
| E38 | `Reduced detail for this device` chip | R6 left | Q5 | Perf auto-degrade (03 8) | Shown only when degraded | Click → what was reduced | The operator knows the scene was simplified, not the data |

### 4.2 Scene elements

| # | Element | Question | Data source (02) | States | Interaction | Purpose test passed |
|---|---|---|---|---|---|---|
| S1 | Context building glass | Q4 orientation; Q1 (see through) | OSM via `/api/overpass` (02 1a) | Mapped (`measured`, `levels`); approximate (`default` height) | Hover: `Height {52} m (mapped)` / `Height ~{46} m (est. from {14} levels)` / `Height unknown (shape only)` (SIT-05..07). Not clickable otherwise | Translucency means no person, path or street is hidden behind a building. Blocks the operator sees are the blocks a path goes around |
| S2 | Building edges | Q4 | Same | Solid (mapped); none on approximate roofs | None | Edges give shape at 1 px where glass alone is invisible |
| S3 | Hotel (subject) | Q1 base, Q3 | Hotel point + matched OSM footprint (02 R12; 03 4.3) | `Building matched` (solid edge); `Matched by proximity`; `Hotel location approximate` (dashed 30 m cylinder) | Click → hotel card (R5). Hover → match basis and `Interior unknown` | Every inside/outside verdict and every floor band is relative to it |
| S4 | Scan line (on hotel only) | Q5 | Snapshot receipt time | Climbing (snapshot ≤ 45 s); absent otherwise; absent under reduced motion | None | The one moving element. It means "traveler feed is live". When it stops, the feed stopped |
| S5 | Grid floor | Q4 (distance) | Client heightfield (03 4.4) | Normal; fades to field at R + 100 m (edge of fetched data) | None | Scale reading: "the rally point is 3 bold squares away". The fade marks where mapped data ends |
| S6 | Streets | Q4 | OSM `highway=*` (03 4.1) | Normal; a street named in a path note or chokepoint gets a label (06 D7) | None | Paths and chokepoints only make sense against streets |
| S7 | Person fix dot + accuracy ring (true position, ground) | Q1, Q5 | `coordinates`, `accuracy_m`, state (02 2.3) | Ring style per state (5.4); no ring + `Accuracy unknown` when null; ring capped at 500 m display with `≥ 500 m` | Click → person focus | The ring is the honesty: it shows how wide "here" is |
| S8 | Person photo pin (Justin's `drawPin`, T/C badge) | Q1 | `avatar_url` (allowlisted), `role`, `name` | Ring color = time state only (5.4); hollow desaturated for Last known; ghost `?` for Time unknown; not drawn for Not located | Click, hover; displaced with a leader line when crowded (5.4) | Identity at a glance; role stays legible on the badge |
| S9 | Hotspot ring | Q1, Q2 | Any attention reason (06 5.1 list) | Acquire pulse once when first raised, then static; removed when the reason clears | Click → that item | 01 AP24: reserved for "decide now". Max 5 labeled (06 D3) |
| S10 | Cluster bubble | Q1 | Pins closer than 24 px | `{6}` or `6 · 1 not current` with hotspot | Click → zoom one scale step or list | Prevents pin soup while never hiding a not-current person (06 D5) |
| S11 | Floor ruler + approximate floor lines (hotel only) | Q1 | `building:levels` / `places[].levels_above_ground` / default 3.3 m (03 7.2) | Shown with Floor estimates on; caption `Floor estimates · phone barometer · not verified`; `Approx. floor heights` (SIT-09); `Floor numbering not verified` when unset | Click a range → floor-range focus | Gives floor bands a scale outside the building, so no band sits "in a room" |
| S12 | Person floor bracket | Q1 | `floor_estimate` (03 6.4) | FLR-01 solid bracket with likely tick; FLR-02 dashed, no tick; FLR-03 aging (amber dashed); FLR-04 hollow grey dotted; FLR-05/06 no bracket (listed) | Click → person focus with tether | The at-or-above answer, drawn as a range |
| S13 | Reported floor slab | Q2 | Operator input | Hatched red slab across footprint, ruler and lanes; label FLR-10 | Click → reported incident card | Turns "fire floor 9" into a visible line the brackets either cross or don't |
| S14 | Group zone rings | Q1 | `group_zones` (02 1d) | Current solid; `Update overdue` dashed + amber label; `Approximate boundary` dashed | Click → zone explanation | Who is outside the group's reach |
| S15 | Trip boundary | Q1, Q3 | `geofences` | Solid thin | Click → name and type | Context for crossings |
| S16 | Safety resource glyph + ground ring + beacon | Q3 | `safety_points` | Approved (filled green); draft (grey hollow dashed); review > 12 mo (amber `Reviewed {14 mo} ago` on label); primary double ring | Click → safety resource card | SafeTrekr's vetted places, findable behind buildings via the beacon |
| S17 | Hotel assembly point [vocab add] | Q3 | Hotel card (fixture in Demo A) | Present with provenance; absent → no glyph, R4 says "Hotel assembly point unknown" | Click → card with source and date | S2 default destination (01) |
| S18 | Suggested path, primary and alternate | Q4 | OSRM (02 1c) | Primary solid + chevrons; Alternate long-dash; Stale dashed 50% + `Stale · Recompute`; `Path unavailable` dashed straight line | Click → path card | 01 rank 7 |
| S19 | Path segment near hazard / inside buffer | Q2, Q4 | Client hazard check | Amber segment with caution ticks; grey cross-hatched `Passes within buffer` | Click → path card | Shows exactly where the route is exposed |
| S20 | Chokepoint glyph | Q4 | OSM bridge/tunnel/steps/gate or shared segment | `Chokepoint: {bridge name}` (PTH-08) | Click → path card | 01 doctrine 5: shared chokepoint = one option |
| S21 | Satellite heat detection footprints | Q2 | FIRMS (02 1e) with `scan`/`track` | Recent (≤ 6 h) / Stale (6-24 h, dashed); low-confidence hidden by default | Click → hazard card | Observation sized to its pixel, never a point or a front |
| S22 | Reported area (crowd report) | Q2 | Fixture HUMAN report | Dashed red edge sized to stated uncertainty; diamond `!` | Click → hazard card | 01 S3: an uncertain area with time and source |
| S23 | Possible-area ring | Q1 | Client, 01 2.3 rule | Shown for a focused not-current person, and auto for Missing person type | Toggle in person card | 01 S7. Labeled HAZ-13 |
| S24 | 2× accuracy ring (selected person only) | Q1, Q5 | Client | Dotted; label `2× accuracy · used for inside/outside` | Toggle in person card | Explains why a verdict is "undetermined" (B10) |
| S25 | Selected-person tether | Q1 | Selection | Dashed line from bracket to fix dot | Appears on selection only | Links the floor estimate to the person without drawing 20 tethers |
| S26 | Geofence crossing tick (layer off by default) | Q1 | `geofence_events` | ZON-11 | Click → record | Last-known trail, Tier 2 (promoted for Missing person) |
| S27 | Mapped entrance (layer off by default) | Q4 | OSM `entrance=*` | SIT-13 | Hover | Path start honesty |
| S28 | Edge-of-data fade | Q5 | Fetch radius | Grid and glass fade at R | None | Says "data ends here", so empty ground beyond is not read as "nothing there" |

### 4.3 Cut (fails the purpose test, or harms a decision)

| Cut element | Why it is tempting | Why it is cut |
|---|---|---|
| Height-ramp brightness on buildings (03 4.5 shader option) | Reads as volume, very "hologram" | Answers no question that edges and fresnel do not already answer. Costs shader complexity. |
| Bloom post-process (03: not in P0) | Signature glow | Full-screen cost at 4K; glow behind labels breaks contrast. Glow comes from line glow on the hotel edges only. |
| Distance rings 250 m / 500 m / 1 km (06 5.4, Q9) | HUD look | 01 AP23. The grid (50 m bold lines) and every path readout already give distance with a decision attached. **Recommendation: remove the row.** |
| Rotating reticles, crosshairs, decorative counters ("297", "034") from the film | Instantly sci-fi | Answer nothing. Compete with real numbers for the eye. |
| "NOMINAL" or any green status word | Film HUD | 06 3.11: absence is never an all-clear |
| Suggested course of action / "Evacuate" button | Film's alert card | 01 AP16. Replaced by Information steps (E21) |
| Animated walkers, pin interpolation, trails | Looks like live tracking | 01 AP2, 02 2.3 |
| Fire spread, crowd flow, risk heatmap | Futuristic | 01 AP8, AP9; 02 C4 |
| Interior floor plates, glowing exits or stairwells | Film x-ray | 01 AP6; SIT-08 |
| Full-footprint floor slab per person (02/06 band placement) | Immersive | Overlaps unreadably with many people and implies a whole floor is known. Replaced by the floor ruler (10.1 C3). |
| Distance-to-everything labels on all POIs | Thorough | 01 AP10; label budget 06 D1 |
| Aircraft, ships, satellites, CCTV mosaic, visual modes (FLIR etc.) | Already built | 01 AP11, AP12; 06 C9, C11 |
| Justin's traveler/chaperone role filters inside the Twin | Familiar | Readouts count everyone; a hidden role would make the counts disagree with the scene (06 2.2) |
| Photoreal "context ring" outside the disc (03 P1 option) | Landmarks | Not cut, **deferred**: off in the prototype; labeled Google if ever enabled |
| Eye tracking, gesture control, drone feeds (film) | Futuristic | No hardware or data source. Not on the roadmap for this phase. |

---

## 5. Hologram visual spec

### 5.1 Base tokens (existing brand, not changed)

Field `#061a23`, card `#07212c`, border `#1e404f`, muted `#2a4a59`, ring `#365462`, secondary `#123646`. Green ramp `#edf6f0 #c9e4d1 #81bf95 #4ba467 #2f7e48`. Slate-teal ramp `#b8c3c7 #80959b #415e6b #2a4a59 #123646`. Destructive (dark) `#ee7789`. Warning `#f59e0b`. Info (dark) `#3b82f6`. Type: Inter (text), Intel One Mono (counts, ages, distances, floor numbers; `font-variant-numeric: tabular-nums`) [SS-A3]. Justin's neutral `#9aa8ac` and pin text `#eff7f3` are reused.

### 5.2 New hologram tokens (proposed additions, all derived)

| Token | Value | Derivation | Meaning (one only) |
|---|---|---|---|
| `--tt-field` | `#061a23` | = background | Scene background in solo |
| `--tt-glass` | `#415e6b` α 0.12 | slate-teal 3 | Context building fill |
| `--tt-glass-approx` | `#415e6b` α 0.06 | same, half alpha | Building height not mapped |
| `--tt-glass-dim` | `#415e6b` α 0.06 | same | Context buildings while an incident is in focus |
| `--tt-rim` | `#80959b`, rim alpha +0.30, fresnel power 2.5 | slate-teal 2 | Glass silhouette (shape only) |
| `--tt-edge` | `#80959b` α 0.40, 1 px | slate-teal 2 | Mapped building edges |
| `--tt-subject-glass` | `#b8c3c7` α 0.14, rim +0.20 | slate-teal 1 | The hotel |
| `--tt-subject-edge` | `#e3e7e9`, 2.5 px polyline, `PolylineGlow` glowPower 0.18 | `#b8c3c7` mixed 60% toward white | Hotel edges. Dashed 12/8 px when approximate |
| `--tt-grid-minor` | `#1e404f` α 0.55, 1 px, every 10 m | border | Scale |
| `--tt-grid-major` | `#365462` α 0.90, 1 px, every 50 m | ring | Scale |
| `--tt-street` | `#415e6b` α 0.90, 1.5 px, +0.3 m | slate-teal 3 | Streets |
| `--tt-scan` | `#80959b` α 0.10, 2 m tall band, climbs hotel in 6 s | slate-teal 2 | "Traveler feed is live" |
| `--tt-person` | `#eff7f3` | Justin's pin text | A person with a current fix |
| `--tt-attention` | `#f59e0b` | warning | Needs an operator decision now; also "aging/degraded" |
| `--tt-neutral` | `#9aa8ac` | Justin's unknown | Not current, draft, not vetted, no data |
| `--tt-hazard` | `#ee7789` | destructive (dark) | Hazard observed or reported (geometry) |
| `--tt-hazard-text` | `#f299a6` | `#ee7789` mixed 25% toward white | Hazard words on label plates (6.8:1 on a plate even over pure white) |
| `--tt-safe` | `#4ba467` fill, `#edf6f0` glyph stroke | brand primary | SafeTrekr-approved place of safety or service |
| `--tt-safe-text` | `#81bf95` | green 3 | Labels for approved places; muster "present" |
| `--tt-path` | `#3b82f6` | info (dark) | Suggested path (lines only) |
| `--tt-path-text` | `#93bafa` | `#3b82f6` mixed 45% toward white | Path words on label plates |
| `--tt-zone` | `#80c3c9` | Justin's boundary teal, kept for cross-view consistency | Group zone and trip boundaries |
| `--tt-plate` | `#061a23` α 0.92, border `#1e404f` 1 px, radius 3 px, padding 3/6 px | field | Backing for every scene label. Guarantees text contrast (5.8) |
| `--tt-halo` | `#061a23` 2 px outline | field | Around every glyph, dot and pin. Guarantees glyph contrast against glass |

### 5.3 Structure

| Element | Fill | Edge / line | Style rules |
|---|---|---|---|
| Context buildings (mapped) | `--tt-glass` + `--tt-rim` | `--tt-edge` on all edges | Solid. Height from tag or levels (03 4.3) |
| Context buildings (height not mapped) | `--tt-glass-approx` | No roof edge; vertical edges `#80959b` α 0.25 | Reads as fainter, never as a guessed tower |
| Hotel, matched | `--tt-subject-glass` | `--tt-subject-edge` roof ring and vertical corners | Brightest structure. **Not green**: the hotel is not a "safe zone" (01 AP22), and in S2 it is the hazard site |
| Hotel, approximate | Same glass on a 30 m cylinder | Dashed 12/8 px | Label `Hotel location approximate` (SIT-04). Containment off |
| Hotel in floor-range focus | Range: glass α 0.22; above range: edges only | — | Caption `Floors above: outline only` [vocab add] (06 Q4), so outline is not read as "empty" |
| Grid floor | Disc to R + 100 m | `--tt-grid-minor` / `--tt-grid-major` | Linear fade to `--tt-field` over the last 100 m |
| Streets | — | `--tt-street` | No labels except named-in-path (06 D7) |
| Scan line | `--tt-scan` | — | Hotel only. Stops when snapshot > 45 s, on reduced motion, and when the tab is hidden |

### 5.4 People (positions overlay, P0)

Pins reuse Justin's `drawPin` canvas from `participantPins.js` (photo, T/C badge, dark outline). Only the ring color passed in changes, from a Trip Twin palette (section 10.1 C1). Pins render at 40 × 48 px on desktop (canvas 96 × 116 scaled), `disableDepthTestDistance: Infinity`.

| State (06 3.1) | Pin ring | Photo | Fix dot | Accuracy ring (ground, true scale) | Label (plate, 06 D4) |
|---|---|---|---|---|---|
| Live | `--tt-person` solid | Full | 5 px `#eff7f3` + halo | Fill `#eff7f3` α 0.08; edge α 0.55, 1.5 px solid | `M.R. · Live · 34s` |
| Stopped · current | `--tt-person` solid + still glyph (two short vertical bars) in the badge corner | Full | Same | Same | `M.R. · Stopped · current` |
| Aging | `--tt-attention` dashed (4/3) | Full | `#f59e0b` | Edge `#f59e0b` α 0.60, dashed 8/6 px, fill α 0.05 | `M.R. · Aging · 4m` |
| Last known | `--tt-neutral` dotted, hollow | Desaturated 70%, α 0.6 | Hollow ring 6 px | Edge `#9aa8ac` α 0.45, dotted 2/4 px, fill α 0.03 | `M.R. · Last known 1h 28m` |
| Time unknown | Ghost: `--tt-neutral` α 0.5 outline, `?` instead of photo | None | None | None | `M.R. · Capture time unknown` |
| Not located | Not drawn | — | — | — | Listed in R2 only |
| Accuracy unknown (modifier) | Unchanged | — | — | No ring. Label adds `Accuracy unknown` | — |
| Approx. ±{180} m (modifier) | Unchanged | — | — | Ring at true scale, dashed | Verdicts become undetermined |

Rules:
- **Red is never drawn on a person. Green is never drawn on a person.** Role is the T/C badge, never a color.
- **True position is the dot and ring.** When pins overlap (more than 4 current pins inside the hotel footprint, or any two closer than 24 px), the photo pin is displaced outward along a fan around the footprint, joined to its dot by a 1 px `#eff7f3` α 0.4 leader line (03 7.1). The dot never moves.
- **Hotspot ring** (needs attention): `--tt-attention`, 2 px solid circle, 10 px outside the pin's outer edge, screen-space. Acquire pulse: one 600 ms scale 1.6 → 1.0 and α 0 → 1 when the reason first appears, then static (05 owns easing). Reduced motion: no pulse; the ring and the `new` tag in R2 carry the change.
- **2× accuracy ring** (selected person, toggle): `#eff7f3` α 0.35, dotted 1/3 px, label `2× accuracy · used for inside/outside` [vocab add].
- **Possible-area ring** (01 2.3): `--tt-neutral` α 0.6, dashed 4/8 px, no fill. Radius = 2 × `accuracy_m` + age × 85 m/min (walking). If it exceeds 5 km (City scale), it is not drawn as a closed ring: the label reads `Possible area, not a prediction · beyond 5 km (fix {1h 28m} old)` [SS-A4].
- No interpolation between fixes. On each snapshot, pins snap. Ages tick every 5 s (03 7.1).

### 5.5 Floors (attribute of People)

The **exploded floor ruler** (resolves 02/03/06, see 10.1 C3):

| Part | Spec |
|---|---|
| Anchor | A vertical line beside the hotel's camera-facing corner, 12 m outside the footprint, from ground to roof. It switches corner when the camera heading passes 90° from it, with 20° hysteresis, so it never flips back and forth during an orbit. |
| Ruler line and ticks | `#e3e7e9` α 0.6, 1 px. One tick per floor at `ground + level × floor_h` (03 7.2). Labels: every floor in floor-range focus or Building scale; every 5th floor otherwise. Intel One Mono 11 px on plates. |
| Header plate | `Floor estimates · phone barometer · not verified` [from 03 7.2 legend; 06 to confirm as vocab], then the convention line `US numbering · lobby = 1` or `Levels above lobby · Floor numbering not verified` (FLR-01u). |
| Approximate floor lines on the hotel | `#b8c3c7` α 0.22, 1 px, every floor, hotel only, only while Floor estimates is on (06 C4). Tag `Approx. floor heights` (SIT-09). |
| Lanes | Person brackets sit in lanes to the right of the ruler, 14 px apart in screen space, sorted by likely floor (highest left). Max 12 lanes; more → `+{n} → list` chip. |
| Bracket FLR-01 | 2 px `#eff7f3` vertical bar from `level_low` to `level_high`, 6 px caps, 8 px tick at `level_likely`, fill `#eff7f3` α 0.10 behind the bar. Initials on a plate at the top. |
| Bracket FLR-02 Rough | Dashed 4/3, no likely tick, fill α 0.06 |
| Bracket FLR-03 Aging | `#f59e0b` dashed |
| Bracket FLR-04 Last est. | `#9aa8ac` dotted, hollow, fill none. FLR-04b adds a small pause glyph |
| Moving vertically (03 status) | Down/up chevron at the tick; label adds `descending` / `ascending` [vocab add] |
| Band unchanged ≥ 8 min during an incident | Hotspot ring on the bracket; R4 row adds `band unchanged {8} min` [vocab add] (01 2.6: priority flag) |
| Floor unknown / Not shared | No bracket. Listed under the ruler as `Floor unknown {2} · Not shared {0}` with click-through to the list. Never omitted. |
| Reported floor slab | Spans the footprint and continues across the ruler and all lanes at that floor: fill `#ee7789` α 0.28, 45° hatch `#ee7789` α 0.70 every 6 px, top and bottom edges 2 px solid `#ee7789`. Label plate at the ruler: FLR-10 in `--tt-hazard-text`. |
| Selection tether | Dashed 4/4 `#eff7f3` α 0.5 from the selected bracket's likely tick down to the person's fix dot. Only one at a time. |

Visual read: a bracket that touches or crosses the red band is "At or near"; wholly above is "Above". The R4 partition states the same numbers in words.

### 5.6 Hazards

| Element | Fill | Edge | Glyph | Label |
|---|---|---|---|---|
| Heat detection, ≤ 6 h | `#ee7789` α 0.30, square sized to `scan` × `track` km | 1.5 px solid α 0.9 | Small square with 4 corner ticks at centre | HAZ-02 headline on the nearest cluster only; HAZ-03 in the card |
| Heat detection, 6-24 h (Stale) | α 0.14 | Dashed 6/4 | Same, hollow | `Stale · last update {time}` |
| Low-confidence detection (toggle) | α 0.10 | Dotted | Same | HAZ-05 |
| Reported area (crowd, active threat) | `#ee7789` α 0.08, circle at stated uncertainty radius | Dashed 10/6 α 0.85 | Diamond with `!`, 18 px, at the report point | HAZ-08 |
| Reported floor | See 5.5 | | | FLR-10 |
| Off-screen hazard | — | — | Edge chip | `Heat detections 6.2 km NE →` |

No pulsing on hazards. No glow halo. Radius always has a stated basis (01 AP7).

### 5.7 Safety, paths, zones

| Element | Spec |
|---|---|
| Safety glyph | 22 px disc `#4ba467`, glyph stroke `#edf6f0` 1.5 px, halo. Shapes per 06 3.6 (flag, house, roof, cross, shield, ladder, capsule, flag-on-disc, dot-in-circle). |
| Safety ground ring | `#4ba467` α 0.70, 1.5 px, radius 12 m. Primary: second ring at 16 m. |
| Beacon | `#81bf95` α 0.50, 1 px vertical line to +25 m, so the glyph is findable behind buildings in oblique view. |
| Draft / not vetted | Glyph hollow `#9aa8ac`, ring dashed 6/4, label SAF-21 / SAF-28 |
| Hotel assembly point [vocab add] | Same green glyph family, shape: ring of 6 dots; provenance line `from hotel card {18:05}` |
| Path, primary | `#3b82f6` 4 px, `PolylineGlow` glowPower 0.15; chevrons `#93bafa` every 40 m pointing to the destination; +1.0 m above heightfield |
| Path, alternate | `#3b82f6` 2.5 px, long dash 16/10, α 0.85, chevrons every 60 m |
| Path segment within the hazard proximity distance | That segment `#f59e0b` with perpendicular caution ticks every 20 m |
| Path inside a buffer (not a candidate) | `#9aa8ac` α 0.5, 2.5 px, cross-hatch ticks, no glow, label PTH-06 |
| Stale path | Same colors at α 0.5, dashed, label PTH-12 |
| Path unavailable | Straight dashed `#9aa8ac` line, label PTH-18 |
| Path label (plate, `--tt-path-text`) | At the destination end: PTH-04 on one line, PTH-05 on the second (06 D9) |
| Chokepoint | Amber "pinch" glyph (two inward chevrons), 16 px, label PTH-08 |
| Group zone | `#80c3c9` α 0.70, 1.5 px ring on the ground, fill α 0.04; overdue: dashed 8/6 + amber label `Update overdue`; degraded: dashed 4/4 + label `Approximate boundary` |
| Trip boundary | `#80c3c9` α 0.45, 1 px solid |

### 5.8 Measured contrast on the field (computed 2026-10-15, WCAG 2.x formula)

| Foreground | On field `#061a23` | On glass + full rim (`#1f3741`) | On hotel glass + rim (`#58686e`, worst case) | On `--tt-plate` over pure white (`#1a2c35`) | Use |
|---|---|---|---|---|---|
| `#eff7f3` person / text | 16.3 | 11.5 | 5.3 | 13.2 | Text and lines |
| `#f59e0b` attention | 8.3 | 5.8 | 2.7 | 6.7 | Text and lines |
| `#ee7789` hazard | 6.5 | 4.5 | 2.1 | 5.3 | Geometry only |
| `#f299a6` hazard text | 8.4 | 5.9 | 2.8 | 6.8 | Text on plates |
| `#4ba467` safe fill | 5.8 | 4.1 | 1.9 | 4.7 | Glyph fill (with halo) |
| `#81bf95` safe text | 8.3 | 5.8 | 2.7 | 6.8 | Text |
| `#3b82f6` path line | 4.8 | 3.4 | 1.6 | 4.3 | Lines only (≥ 3:1 off the hotel) |
| `#93bafa` path text | 9.0 | 6.3 | 2.9 | 7.3 | Text |
| `#9aa8ac` neutral | 7.3 | 5.1 | 2.4 | 5.9 | Text and lines |
| `#80c3c9` zone | 9.0 | 6.3 | 2.9 | 7.3 | Lines |
| `#80959b` edge | 5.7 | 4.0 | 1.9 | — | Building edges |
| `#e3e7e9` hotel edge | 14.3 | 10.0 | 4.7 | — | Hotel edges |
| `#365462` grid major | 2.2 | — | — | — | Supplementary only (scale is also stated in text in R7) |

Consequences, built into the spec:
1. **Every scene label sits on `--tt-plate` (α 0.92).** Over the brightest possible background (pure white), every text token stays at 5.8:1 or better. The two tokens below 4.5:1 there (green fill `#4ba467` 4.7:1 and path line `#3b82f6` 4.3:1) are never used for text. This holds no matter what the glow does behind it.
2. **Every glyph, dot and pin has a 2 px `--tt-halo`.** The halo is `#061a23`, so the glyph's contrast against its own halo is the field value (≥ 4.8:1), regardless of glass behind.
3. Over the hotel glass at grazing angles, nothing relies on bare lines: people sit on the ground (outside the glass in plan), brackets sit on the ruler outside the footprint, and the reported slab has a hatch plus solid edges.
4. Amber `#f59e0b` and hazard `#ee7789` differ by only 1.28:1 in luminance; green and amber by 1.44:1. They are indistinguishable for many color-blind operators. **Shape carries the difference**: attention is always a ring around something; hazards are squares, diamonds and hatched slabs; safety is a filled category glyph on a disc. See section 8.3.

Measurement plan on the rendered scene: section 8.4.

### 5.9 Render cost per element (F45; against 03 section 8)

| Element | Implementation | Cost note |
|---|---|---|
| Buildings, edges, hotel, grid, streets | 03 Primitive batches | ≤ 15 draw calls total |
| Pins, dots, glyphs | One `BillboardCollection` | Pin canvases cached by (person, state) in Justin's pin cache |
| Labels | One `LabelCollection`, plates as billboards | ≤ 12 persistent labels at Neighborhood (06 D1) |
| Accuracy and zone rings | Ground polylines on the heightfield | Rebuilt only on snapshot diff, never per frame |
| Scan line, hotspot pulse, path chevron flow | Shader time uniforms | The only per-frame work. All stop under reduced motion and when the snapshot is stale |
| Floor ruler and brackets | Polylines + labels | Rebuilt on snapshot or on corner switch |
| R2/R4 DOM | Updated on the 5 s age tick, diffed by row | No layout thrash during orbit |
| Budget | 30 fps sustained; p95 ≤ 33 ms on the reference laptop (03) | Auto-degrade order per 03 section 8. Never degraded: people, rings, labels, hazards, reported slab, readouts |

---

## 6. Interaction spec

### 6.1 Entry

| Entry | Control (06 1.3 labels) | Pre-condition | Result |
|---|---|---|---|
| E1 | Lodging card in World View → **Open Trip Twin** | `VITE_TRIP_TWIN=1`, lodging with valid coordinates (03 H-4) | Opens on that lodging |
| E2 | Person card → **Open Trip Twin at {hotel name}** | Person's trip has a lodging | Opens the lodging nearest the person; that person is pre-focused |
| E3 | Alert card near a lodging → **Open Trip Twin** | Hazard proximity alert | Opens with that hazard in focus (R4 open) |
| E4 | Sample: "Explore a sample trip" **(Justin)** → E1; or `?demo=twin&city=austin|dc|london` (03 H-6) | DEV | Opens the sample, watermark on |
| E5 | World controls row | — | **Recommendation:** the row (03 H-7) is a button labeled **Open Trip Twin**, not a checkbox, because Trip Twin is a mode, not a layer (06 1.1). See 10.1 C10. |

Entry sequence (the operator sees, in order):
1. 0 ms: R1 and R2 appear immediately from the snapshot already in memory. The roster block shows people counts with `Inside (likely)` and `At hotel, undetermined` as `pending outline` until the footprint arrives. Nothing is ever shown as 0 while pending.
2. In parallel: Overpass and terrain requests (03 3.3). Progress text in R3 centre: `Loading OpenStreetMap buildings…` → `Building the hologram…`.
3. When geometry is ready: the reveal. No incident: a 1.2 s clip-disc reveal (03 4.7). Any click or key skips it. Incident open, or `prefers-reduced-motion`: instant cut (≤ 150 ms fade). Motion details belong to 05.
4. The camera settles on the Neighborhood preset, the hotel centred.
5. The legend opens once in the session and closes on the first interaction (06 5.2).

### 6.2 Camera: orbit, zoom and presets

| Control | Mouse / touch | Keyboard | Behavior |
|---|---|---|---|
| Orbit | Left-drag | `←` `→` rotate 15° | Around the hotel (ENU frame, 03 4.7) |
| Tilt | Middle-drag or Ctrl + drag | `↑` `↓` 10° | Pitch clamped −15° to −90°; eye ≥ ground + 15 m |
| Zoom | Wheel / pinch | `+` `−` | Range 120 m to 12 km |
| Building preset | Toolbar | `1` | Hotel + 150 m; range ~350 m; pitch −35°; floor ruler labels every floor |
| Neighborhood preset (default) | Toolbar | `2` | 500 m; range ~1.3 km; pitch −45° |
| City preset | Toolbar | `3` | 5 km; range ~9 km; pitch −70°; beyond 400 m only flat glyphs on grid, no invented buildings (06 4.2) |
| Plan view (north up) | Toolbar `3D view / Plan view (north up)` | `P` | Pitch −90°, heading 0°, scale bar shown; same layers (06 C8). Answers 01 AP17 |
| North up | — | `N` | Heading 0° in either view |
| Reset | — | `Home` | Neighborhood preset |

Preset transitions take ≤ 600 ms (0 under reduced motion). The pressed segment follows the free camera with thresholds at range 700 m and 4 km [SS-A5]. Justin's digit keys for visual modes are suspended while Trip Twin is open (06 F5); digits mean presets only here.

### 6.3 Layers panel

- Opens from **Layers** (R6). Five groups in 06 order: People, Hazards, Safety, Paths, Site. Rows and defaults exactly per 06 2.2, with one change: **Distance rings removed** (4.3).
- Locked rows (`Travelers & chaperones`, `Hotel`) show a lock and `Locked in Trip Twin` [vocab add].
- Each row carries Justin's feed badge where relevant (`Stale`, `Key needed`, `Unavailable`).
- Turning a layer off never changes a readout. R2 Sources adds `{Layer} hidden` (FRS-10). Turning off any Hazards layer adds PTH-15 to every path card (06 C5).
- Rows shown disabled in the prototype: `Public cameras`, `Unvetted OSM services`, `Driving paths`, `Live traffic`, each with `Not in prototype`.

### 6.4 Drill into a person

Trigger: click a pin, a fix dot, a bracket, a row in R2 or R4.
1. Camera pans to centre the person at the current scale. No forced zoom.
2. Other people dim to α 0.5 but stay drawn and counted.
3. The 2× accuracy ring and (if not current) the possible-area ring become available as toggles; the tether appears if a bracket exists.
4. R5 person card, top to bottom: name and role; state chip and readout (06 3.1); `±{n} m` with hover "About 2 in 3 chance the phone is inside this ring"; hotel verdict long form (06 3.2) with a **Why?** link; group zone (06 3.3); floor (FLR string or `Floor unknown — {reason}` plus "Ask the chaperone or check the hotel's room list."); `Battery {6}% · discharging`; last 3 crossings (ZON-11); nearest current chaperone and distance; actions **Copy for hotel / responders**, **Show in World View** when beyond City scale.
5. **Why?** (B10) opens an inline explanation with the rule and the inputs, for example: "At hotel · inside or outside undetermined. The 2× accuracy circle (2 × 45 m) crosses the hotel outline. Fix 34s ago. Hotel outline: OSM way 134786106, contains hotel point. Computed in this browser. Not an alert." [SS-A6]
6. Breadcrumb gains `{initials} ({role})`. `[` `]` move to the previous/next person in the list the operator came from. `Esc` closes the card, then clears the focus.

### 6.5 Drill into a floor band, and into a safety point

**Floor-range focus** (click a ruler range, a bracket, the reported slab, or a partition bucket):
- The hotel above the range turns to edges only with `Floors above: outline only`; the range glass rises to α 0.22; ruler labels show every floor in the range.
- R5 floor-range card: people whose band intersects the range, grouped `Above` / `At or near` / `Below` relative to the reported floor, plus `Floor unknown` and `Not shared` always listed (06 4.3). `Interior unknown` shown at the top. **Copy for hotel / responders** copies the whole group.
- Breadcrumb `Floors {9}–{11}`. A person can be focused from inside it (one nesting level only).

**Safety point** (click a glyph, ring, rally chip or edge chip):
- Glyph enlarges 1.25×, others dim; R5 safety resource card: category label (06 3.6), name, `Approved` / `Draft, not approved`, `Reviewed {3 mo} ago`, `Hours: "{raw text}" · not verified`, `ER status not verified` for hospitals, visibility tags.
- **Show paths to…** draws primary + alternate (max two destinations at once, 06 2.4) and opens the path card.
- **Direct group here** (gated; disabled for drafts with SAF-21, for internal points, and for view-only roles).

### 6.6 Incident focus mode

| Aspect | Rule |
|---|---|
| Triggers | A reported incident exists; or a hazard proximity judgment is active (02 R1, R6, R8); or the operator opens a hazard card; or the fixture sets an incident type (prototype). |
| R4 | Opens with the order: Official slot → Reported incident → Priority count → Floor partition → promoted Tier 2 items (06 1.2 scenario promotion) → Information steps → destinations and Shelter in place → Message status → stand-down line → actions. |
| Scene | Context glass dims to `--tt-glass-dim`. Hazard, hotel, attention people, destination and path stay full strength. Nothing is hidden. Floor estimates turn on (06 C3). |
| Camera | Reframes to fit hotel + hazard only if the operator has not touched the camera in the last 10 s; otherwise a `Frame incident` button appears in R6 [SS-A7]. Never yanks the view mid-orbit. |
| Transition | Instant during an incident (01 AP1). |
| Exit from focus | Removing the last reported incident and dismissing the hazard card closes R4. Layer toggles stay as the operator left them. |
| Notifications inside the Twin (E36) | No toasts. Changes are batched on the 5 s tick. New attention → hotspot acquire pulse + `new` tag in R2 + one polite live-region sentence. No sound. No `assertive` announcements (06 4.6). A new reported incident or a new hazard within 3 km opens R4 if closed. |

### 6.7 Actions and their governance

The Twin suggests information steps and drafts text. **It never sends, never declares, and has no "Evacuate", "All clear" or "Stand down" control** (06 1.3). Autonomy level is fixed at "suggest".

| Action | Who | Reversible? | Confirmation | What is shown before confirming (blast radius) | Record |
|---|---|---|---|---|---|
| Add / edit / remove reported floor | All Trip Twin roles, including view-only [SS-A8] | Yes (session only) | Single step | — | Session list in the card: `Added floor 9 · J.T. · 02:13`, `Changed 9 → 10 · J.T. · 02:20` |
| Tick an information step | All | Yes | None | — | Session only, with time and initials |
| Show paths to… / Recompute | All | Yes | None | — | Path age (PTH-11) |
| Copy for hotel / responders | All | n/a (clipboard) | Preview in a popover with **Copy** | The exact text | None |
| Draft note from path | org_admin, HQ | Yes | — | Prefills the Direct group note | — |
| **Send alert** (existing `actions.js`) | org_admin, HQ. `security_officer`: shown **disabled** with `View-only role` | **No.** A push cannot be recalled. | **Two steps**: compose → preview → **Send** | Audience and loaded count (`Chaperones · 3 loaded`), severity, the full text, "This sends a push notification. It cannot be recalled." | Core alert record; R4 Message status |
| **Direct group here** (existing) | Same | **No** | **Two steps**, plus an "I verified …" tick when the suggestion rests on a C3 judgment (02 A13) | Destination (approved only), arrive-by (prefilled with PTH-13, not the default 15), PTH-14 warning if lower, audience and loaded count, note text | Same |

Prefills (all editable): in Hotel evacuation, audience defaults to **Chaperones** (01 S2: do not broadcast to all mid-headcount). In Civil unrest and active-threat types, Direct group is visually de-emphasized (secondary button style, below Shelter in place) and never auto-suggested (01 S6).

**Copy for hotel / responders** text format (desktop console shows full names; wall never offers copy):
```
Fairmont Austin · reported smoke floor 9 (hotel desk, 02:12, not verified) · as of 02:14 CDT
At or above floor 9 (estimates from phone barometer, not verified):
- Maya Ruiz: likely floor 10 (9–11), reading 4m old, band unchanged 8 min
- Aron Kim: likely floor 9 (8–10), reading 40s old, descending
Floor unknown: 2 (Leo Brandt: phone has no pressure sensor; Ivy Stone: no ground reference)
Not current: 2 · No location reported: 1
SafeTrekr Trip Twin. Positions are phone fixes, not confirmation of anyone's location.
```
(Names are fictional sample names.)

### 6.8 Exit and exact restore

| Way out | Behavior |
|---|---|
| **Exit Trip Twin** (R1) or breadcrumb `World View` | Exits |
| Breadcrumb `{trip title}` | Exits to World View filtered to that trip |
| `Esc` | Unwinds one level only: close popover → close card → clear person focus → clear floor focus → nothing. **Never exits** (06 4.5). |
| Scope change, sign-out, account switch, `lockView` | Twin closes synchronously before new data renders (03 H-5) |

Restore exactly (03 4.7 + 06 4.5): Google tileset `show`, `globe.show`, sky, fog, background, camera transform and view, the visual mode active before entry, the enabled public layers (`restoreEnabledLayerIds`), the selected record, which of Justin's panels was open (Trips sidebar, Alerts, detail), and the legend. If the operator changed the basemap while inside, exit lands on that basemap (03 4.7). Kept for the session: layer toggles, reported incidents (exit shows `Reported floor kept for this session` [vocab add, from 06 4.5]), path destinations per site, plan/3D. Cleared: focus, camera and scale.

---

## 7. States

Every state answers "what can the operator still rely on" and never reads as an all-clear. "Never" column = what must not happen.

| State | Trigger (03 9, 02 2) | What the operator sees | Never |
|---|---|---|---|
| Loading, normal | Open, Overpass + terrain in flight | R1, R2 live from snapshot at once. `Inside (likely)` and `At hotel, undetermined` show `pending outline`. Scene: grid, hotel point marker, people dots and rings already placed on a provisional flat plane, then lifted onto the heightfield. Progress text in R3. | A 0 in a pending bucket; a blank screen |
| Overpass slow | No response after 8 s | `OpenStreetMap is slow · still trying ({12}s)` in R3 and Sources | A spinner with no words |
| Overpass rate-limited | 429 / 503 Retry-After | `OpenStreetMap busy, retrying in {5} s` (03 9); one retry | Silent retry loops |
| Overpass failed (R-01) | All mirrors fail, or 25 s timeout | **Minimal twin**: grid, hotel as 30 m dashed cylinder (`Hotel location approximate`), people, zones, safety glyphs, paths. Sources: `Buildings unavailable since {14:20}` (SIT-11) with **Retry**. Roster: `Inside (likely) —` and HTL-06 explanation; people near the hotel fall to `At hotel, undetermined`. | An empty scene that reads "no buildings here" |
| OSM from stale cache | `X-Overpass-Cache: STALE` | Sources: `OSM buildings · from cache` | — |
| No OSM buildings in area | Overpass returns none | Grid only; `No OSM buildings mapped here` (SIT-10) | Invented blocks |
| Empty: no people located | Every participant Not located | Roster block all zeros except `Not located {n} · of {n} loaded`; R2 note "No location reported for anyone on this trip" | "All in" or hiding the block |
| Empty: no hazards | No detections, no reports | HAZ-07 wording with source, window and blind spot | "No threats", "Clear", green |
| Empty: no approved safety point | Coverage gap (02 R7) | SAF-25 chips per missing category in R2 and R4 | "None nearby" |
| Snapshot stale | Last poll > 45 s, or poll failing | Sources line moves to the top of R2 in amber: `Traveler data delayed {1m 10s}` (POS-M5) or `Feed interrupted · snapshot {70s} old`. Scan line stops. Live dot goes hollow amber. Counts read `as of {02:13:40}`. All pins drop one state (02 2.3). Zone line becomes Zone unknown (ZON-08). | Counts that look current |
| Partial data | `source_issues` present | Same text as Justin's sidebar (FRS-08) in Sources; affected counts suffixed `(incomplete)` | Counts without the suffix |
| Paths failed | OSRM `{ok:false}` / timeout | Dashed straight line, PTH-18; straight-line distance labeled "straight line" | "No path exists" |
| Terrain failed | Geoid fallback | Sources: `Ground elevation approximate` | — |
| No Google key | Keyless globe | Same Twin. Reveal is a cross-fade from satellite imagery. No visible difference in the steady state. | — |
| Floor unknown | `floor_estimate.status = unknown` | No bracket; `Floor unknown — {reason}` in person card; counted in partition and in the ruler footer | Default to ground or lobby; blank |
| Floor not shared | Consent off (mocked) | `Floor not shared`, its own bucket | Merging with unknown |
| Floor numbering not set | City B/C | `Levels above lobby · Floor numbering not verified`; **Add reported floor** asks "Lobby is floor 1 / G / 0?" before accepting (06 Q11) | Converting by assumption |
| Hotel approximate | `selectHotelFootprint` fallback | Dashed cylinder, HTL-06, floor confidence capped at Rough | "Inside" verdicts |
| Low-end GPU | p95 > 50 ms for 3 s | 03 ladder; chip `Reduced detail for this device` (E38) listing what was reduced | Dropping people, rings, labels or hazards |
| WebGL 2 unavailable | `webgl2 === false` | Cross-fade instead of clip reveal | — |
| Reduced motion | `prefers-reduced-motion` | Instant cut; no scan line (live dot carries it); no hotspot pulse (`new` tag carries it); path chevrons static; camera jumps | Any meaning lost |
| Tab hidden | `visibilitychange` | Loop and poller pause (existing); on return, ages jump to the truth and Sources shows the real snapshot age | Stale data displayed as fresh after return |
| Sample mode | DEMO | Watermark, header badge, `SAMPLE` in R1, Sources `Sample · {12s} ago` | Any sample element without a label |
| Window < 1280 px wide | Resize | Scene switches to Plan view; R4 and R5 become a full-height drawer over the scene; R2 stays. Below 1024 px: R2 only, with "Trip Twin needs a wider window. Counts above are current." [SS-A9] | Hiding the counts |

---

## 8. Accessibility (WCAG 2.2 AA floor)

### 8.1 Keyboard

| Key | Action | Notes |
|---|---|---|
| `Tab` / `Shift+Tab` | Order: R1 → R2 → R4 → R6 → scene (single focus stop) → R5 (06 4.6) | Visible focus ring `#9fddb6` 2 px, offset 3 px (Justin's) |
| Skip links | "Skip to status", "Skip to incident" | First focusable elements |
| `Esc` | Unwind one level, never exit | |
| `1` `2` `3` / `P` / `N` / `Home` | Presets, plan view, north up, reset | Only inside Trip Twin; Justin's visual-mode digits suspended |
| Arrows, `+` `−` | Orbit, tilt, zoom when the scene has focus | |
| `L` | Legend | |
| `[` `]` | Previous / next person in the current list | 06 IA-A4 |
| `A` | Next item that needs attention (cycles the Needs attention list) [SS-A10] | Gets a keyboard user to the urgent item in one key |
| All single-letter keys | Disabled while focus is in a text field | WCAG 2.1.4 |

### 8.2 Screen reader

- Landmarks per 06 4.6. The canvas is one focusable element with `role="application"` and an `aria-describedby` summary that updates on the 5 s tick: "Trip Twin, Fairmont Austin. Reported smoke floor 9. 2 at or above. Roster: Inside (likely) 3, At hotel, undetermined 5…".
- **No answer lives only in the canvas.** Every drawn item has a list row (R2, R4, More drawer, Layers) with the same text as its label, e.g. "M.R., traveler, last known 1 hour 28 minutes ago, accuracy plus or minus 40 metres, battery 4 percent" (06 4.6).
- Live regions: the roster block and floor partition are `aria-live="polite"`, at most once every 30 s and on any change to an attention bucket (06 IA-A6). Sentences are composed, not dumped: "1 new person needs attention: T.C., chaperone, aging, 4 minutes."
- Ages announce in words ("4 minutes"), not "4m".
- Dialogs (Send alert, Direct group, Add reported floor) trap focus and return it to the opener.

### 8.3 Color-blind safety (never color alone)

| Meaning | Color | Second channel (shape / line) | Third channel (word) |
|---|---|---|---|
| Person current / aging / last known / time unknown | white / amber / grey / grey | Solid / dashed / dotted + hollow photo / ghost `?` | `Live`, `Aging`, `Last known`, `Capture time unknown` |
| Needs attention | amber | Ring around the item | The reason in the label and R2 |
| Hazard | red | Square pixel, diamond `!`, hatched slab | `Satellite heat detections`, `Reported: …` |
| Approved safety | green | Filled category glyph on a disc | Category label + `Approved` |
| Draft / not vetted | grey | Hollow, dashed | `Draft, not approved` |
| Path primary / alternate | blue | Solid with chevrons / long dash | `Primary` / `Alternate` |
| Path near hazard / inside buffer | amber / grey | Caution ticks / cross-hatch | PTH-05 / PTH-06 |
| Floor band ±1 / rough / aging / last est. | white / white / amber / grey | Solid with tick / dashed no tick / dashed / dotted hollow | FLR strings |
| Approximate geometry | any | Dashed outline | `approx.` |

Test: Chrome DevTools vision deficiency emulation (deuteranopia, protanopia, tritanopia, achromatopsia) on the three Demo storyboards' key frames. Pass = a test reader can name every state from the frame without the color.

### 8.4 Measured-contrast plan on the glowing scene

Section 5.8 proves a floor by construction (plates at α 0.92, halos). This plan verifies it on real renders, because glow, translucency and order-independent transparency can stack in ways a formula misses.

1. **Frames**: 3 cities × {overview, 45° orbit, hotel close-up with floor ruler, plan view} × {no incident, Demo A incident} = 24 frames, from `scripts/qa-trip-twin.mjs` (03 15.2) at DPR 1 and 2.
2. **Sampling**: for every label plate, glyph and line, read the rendered foreground pixels and the background ring 4 px around them (`page.screenshot` + bounding boxes from `__tripTwinStats` debug export of screen-space positions) [SS-A11].
3. **Metric**: WCAG relative-luminance ratio of the foreground against the **brightest** background pixel in the ring (worst case, not the average).
4. **Pass**: text ≥ 4.5:1; glyphs, lines, focus rings and state rings ≥ 3:1 (WCAG 1.4.11). The grid is exempt only because R7 states the scale in text.
5. **Fail handling**: raise plate α or halo width for that element class; never lighten the hazard red into pink-white or darken the glass so far that the hologram disappears.
6. **Regression**: the check runs in QA on every PR that touches `tripTwinScene.js` or the palette, alongside 03's palette unit test (contrast ≥ 3:1 on `#061a23`).
7. **Text size**: scene labels ≥ 12 px desktop (ages and counts in Intel One Mono 12-13 px); R2 counts 22 px; minimum target size 24 × 24 px for every control (WCAG 2.5.8).

---

## 9. Prototype demo walkthrough (01 §8)

All three run on `?demo=twin&city=austin` (Fairmont Austin, OSM way 134786106, 37 levels, US numbering set by hand) with the sample clock. Counts below assume the fixture follows 01 §8 exactly [SS-A12]. **Pass** for every demo: a test operator reaches the listed decisions from the screen alone, within the time, without asking "where is that from?" or "how old is that?" (01 §8). The facilitator records time-to-decision per step and any question asked.

### 9.1 Demo A (hero): S2 hotel evacuation, 02:10 local. Pass bar ≤ 60 s

Fixture state at 02:14: 24 travelers + 3 chaperones loaded. Reported note injected at 02:12 (HUMAN, fixture, A21).

| Step | Operator does | Screen shows | Operator should conclude |
|---|---|---|---|
| 0 | Clicks **Explore Trip Twin sample** → lodging card **Open Trip Twin** | Incident open, so instant cut. R4 open. Floor estimates on. Red hatched slab at floor 9. Watermark. | "Something is reported at floor 9, not verified, 2 minutes ago." |
| 1 (≈ 5 s) | Reads R2 | `Inside (likely) 3 · At hotel, undetermined 5 · Outside, nearby 16 · Away 0 · Not current 2 · Not located 1 · of 27 loaded` | Decision 1: "Up to 8 may still be in the building plus 3 not current. Undetermined is not out." |
| 2 (≈ 15 s) | Reads R4 priority block; eyes go to brackets crossing the red band | `At or above reported floor 9: 2`: `M.R. · Likely floor 10 (9–11) · 4m ago · band unchanged 8 min` (hotspot) and `A.K. · Likely floor 9 (8–10) · 40s ago · descending` | Decision 2: "M.R. first: likely 10, could be 9 to 11, not moving. Pass to the hotel." |
| 3 | Clicks **Copy for hotel / responders** → **Copy** | Preview text (6.7); copied | Relay is exact, dated, banded |
| 4 (≈ 30 s) | Reads Needs attention | `S.D. · Stopped · current · lobby · Last est. only`; `T.C. (C) · Aging · 4m`; `R.O. · Last known 34m · 600 m away · battery 6%`; `E.W. · No location reported` | Decision 3: "R.O. is at a bar, not in the building; E.W. never reported: neither is 'inside'. S.D. not moving in the lobby: ask the chaperone." |
| 5 | Clicks R.O. | Person focus: possible-area ring, last known pin hollow grey at the bar, `Last known · 34m ago` | Not current is a separate problem from the fire |
| 6 (≈ 45 s) | Reads Hotel card + "If the group must move" | `Hotel assembly point · from hotel card 18:05` across the street with 16 white pins around it; path card `Rally point (primary) · 850 m · walk 13–17 min (group pace) · Suggested arrive-by: 36 min (12 prepare + 17 walk + 7 buffer)` | Decision 4: "Hold at the hotel assembly point. If we move, about 36 min, not the default 15." |
| 7 | Opens **Direct group here** to check, then cancels | Arrive-by prefilled 36; audience prefilled Chaperones; preview shows "cannot be recalled" | Decision 5: the tool offers no stand-down; R4 says `Re-entry and stand-down: hotel or authorities only` |
| 8 | Toggles Floor focus on the 9-11 range | `Floors above: outline only`; floor-range card lists both people plus `Floor unknown 2` (`L.B.: phone has no pressure sensor`, `I.S.: no ground reference since this phone entered the hotel`) | Unknowns are listed, never dropped |

Fail signals: the operator counts "At hotel, undetermined" as out; asks "is M.R. on 10?"; looks for an all-clear or evacuate button; does not find the age of the floor reading.

### 9.2 Demo B: S3 unrest on Congress Avenue, 17:30 Saturday. Pass bar ≤ 90 s

| Step | Operator does | Screen shows | Operator should conclude |
|---|---|---|---|
| 0 | Opens the sample with `&scenario=b` [SS-A13] | Region banner: `Demonstrations expected in Austin · Location approximate (city)` (not pinned). Two red dashed report areas (500 m) with diamonds: `Reported: march forming at Capitol south steps · {source} · 17:20 · location ± 500 m · not verified` and `Reported: crowd moving south on Congress at 6th · … · 17:28 …`. R4 type Civil unrest [vocab add]: **Shelter in place** card first. | "Two reports, uncertain areas, one city-level advisory." |
| 1 (≈ 10 s) | Reads zone line and Needs attention | `Outside group zone 2 · Unaccompanied 2 · Zone unknown 1`; rows: two travelers `Outside group zone · Unaccompanied · Live · 30s · ±10 m · 250 m from report`; `Aging · 7m` traveler; one `Zone unknown · location not current` / `Unknown · boundary update overdue` per fixture | Decision 1: "3 without a confirmed chaperone; 1 not current." |
| 2 | Clicks the aging traveler | Amber dashed ring; possible-area ring crosses Congress; R5 path section: `From last known position, 7 min old` and no path drawn | No route is drawn from an old fix |
| 3 (≈ 40 s) | Clicks the unaccompanied pair's cluster → **Show paths to…** Hotel [SS-A14] | Direct path greyed `Passes within buffer`; alternate east then south, `Closest approach to hazard: 420 m`, chokepoint none | Decision 2: "Pair can return by the alternate; the aging traveler and anyone whose way back crosses the march shelter where they are." |
| 4 (≈ 60 s) | Clicks **Draft note from path** | Note prefilled: "Go east on 5th, avoid Congress Avenue and the Capitol." | Decision 3: draft text exists |
| 5 | Opens **Direct group here** | Audience choices: All / Travelers / Chaperones only. Note: "Direct group cannot target only these 6 travelers." [vocab add] | Decision 4: lever gap seen (01 S3) |

Fail signals: reads the crowd area as a precise polygon; picks the greyed path; assumes the aging traveler's path is current.

### 9.3 Demo C: S7 missing traveler, 22:40. Pass bar ≤ 60 s

| Step | Operator does | Screen shows | Operator should conclude |
|---|---|---|---|
| 0 | Opens `&scenario=c` | R4 type Missing person: last-known trail and possible-area ring promoted. Edge chip `1 away →` (or the person in view at City scale). | — |
| 1 (≈ 10 s) | Reads Needs attention top row | `N.F. · Last known 1h 28m · battery 4% · discharging · likely dead phone · still not current` | Decision 1: "Likely dead phone, still unaccounted for." |
| 2 | Clicks the row | Camera pans across the river. Hollow grey pin; ±40 m dotted ring; label `Possible area, not a prediction · beyond 5 km (fix 1h 28m old)`; crossing `Exit recorded 19:05` (ZON-11) | No trajectory, no probable cloud |
| 3 (≈ 25 s) | Reads person card "Last co-located" [vocab add] | `With J.O. until 20:50 · J.O. now Stopped · current at hotel` | Decision 2: "Ask J.O. first." |
| 4 (≈ 40 s) | **Show paths to…** from the nearest chaperone (lobby, current) to the last known point | Path crosses the river bridge: `Chokepoint: South Congress Avenue Bridge`; `2.1 km · walk 32–42 min (group pace) · drive 6 min (no traffic data)`; nearest police glyph with drive time (OSM, `OSM · not vetted by SafeTrekr` if not in the approved set) | Decision 3: "Send the chaperone via the bridge, or by car." |
| 5 (≈ 55 s) | Reads R4 timing block | `Time since last fix: 1h 28m · Curfew passed 40m ago · Escalation policy: not in World View, check the organization's policy` [vocab add] | Decision 4: names the escalation step and time; the screen does not invent a threshold |

Fail signals: treats the last fix as live; asks where the person "probably" is; looks for a policy deadline the system does not have.

### 9.4 Second and third cities (pass bar, 01 §8, 03 15.2)

| City | What it must show honestly |
|---|---|
| Washington DC (Hilton Capitol Hill, `height` tagged) | `Height {50.75} m (mapped)` path; floor bands with measured floor height |
| London (Park Plaza Waterloo, no height or levels) | Hotel and many neighbours at `Height unknown (shape only)` styling; `Levels above lobby · Floor numbering not verified`; **Add reported floor** asks the lobby convention; floor confidence capped at Rough |
| Coastal city (01 §8, for S5) | Not in the prototype build; listed as an open question (10.2 Q6) |

---

## 10. Conflicts resolved, open questions, assumptions

### 10.1 Conflicts resolved

| # | Conflict | Sources | Decision | Why |
|---|---|---|---|---|
| C1 | **Person colors.** Keep Justin's World View colors (traveler green, chaperone blue, aging amber, stale red) vs ring color = freshness only, role by T/C badge, never red | 03 4.5 / 7.1 vs 06 F6 | **06 F6.** Inside Trip Twin the pin ring shows time state only: current `#eff7f3`, aging `#f59e0b` dashed, last known `#9aa8ac` dotted hollow. Role is the existing T/C badge. Red and green are never drawn on a person. World View keeps Justin's colors; the Twin reuses his `drawPin` and pin cache unchanged and only passes a different ring color. | (1) 00-CONTEXT: one color, one meaning; green means ours/safe and red means hazard. A green traveler reads as "safe", which Justin's own copy says a fresh fix does not establish. (2) A red person in S2 reads as the hazard. (3) Green vs red role/state coding is the classic color-blind trap. (4) The T/C badge already exists for exactly this ("Role stays legible even when the outer ring shows an aged location", `participantPins.js`). Cost: one ring-color map; operators moving between views see the same pin shape and badge. Raise with Justin whether World View should follow. |
| C2 | Hotel tint: green "ours" glass vs neutral subject | 03 4.5 `twin-ours` vs 01 AP22, 06 5.1 | Neutral bright slate (`#b8c3c7` glass, `#e3e7e9` edges) | The hotel is not verified safe; in S2 it is the incident site. Green stays reserved for approved safety places. |
| C3 | Floor band placement: slab across the footprint with tether vs vertical gutter beside the building | 02 1d, 06 5.1 vs 03 7.2 | **03's gutter**, specified as the exploded floor ruler (5.5); 06 strings kept; tether only for the selected person | Twenty overlapping slabs are unreadable; a full-footprint slab implies the whole floor is known; brackets on a ruler read as an estimate on a scale. The reported floor stays a full-footprint slab because it is a statement about the floor. |
| C4 | Inside/outside: 1× accuracy and "Fix inside hotel footprint · Inside / Outside / Uncertain" vs 2× and 06's five buckets | 03 7.1 vs 01 2.4, 06 F2, 3.2 | 06 labels and the 2× rule; 03's `hotelContainment` uses 2 × `accuracy_m` | 06 is the vocabulary authority; life-safety rule from 01. 1× stays only for Core's group zone, shown unchanged. |
| C5 | Floor confidence words and unknown codes: 03 `high/medium`, `anchor_too_old`, `sample_too_old`, `too_uncertain`, `consent_off` vs 02/06 | 03 6.4 vs 02 2.5, 06 3.4 | Display uses 06 strings. Mapping: `high` → FLR-01, `medium` → FLR-02 Rough, `anchor_too_old` → `anchor_expired`, `too_uncertain` → `band_too_wide`, `sample_too_old` → FLR-04 Last est., `consent_off` → FLR-06 Floor not shared | One vocabulary on screen; the wire codes can stay 03's (07 owns the contract). |
| C6 | Transition length: 1.2 s vs ~1 s cap and instant during an incident | 03 4.7, 8 vs 01 AP1, A19 | 1.2 s with no incident, skippable by any input; instant (≤ 150 ms fade) when an incident is open; 0 under reduced motion | Both rules met; the cinematic moment never costs time in an emergency. |
| C7 | Floor estimates default: off per session (privacy) vs on when an incident is in focus | 03 10.2, 11.5 vs 06 2.2, C3 | Off by default on the desktop console; turned on automatically when an incident is in focus; forced off on a wall unless an incident is open | The privacy intent (no casual floor display) and the incident need both hold. |
| C8 | Send buttons for view-only roles: hidden vs shown disabled | Justin `actions.js` (hidden) vs 06 1.1 (disabled with reason) | Inside Trip Twin: shown disabled with `View-only role` | A security officer needs to know the lever exists and that someone else must pull it. World View behavior unchanged. |
| C9 | Distance rings: P1 layer vs anti-pattern | 02 1a, 06 2.2 vs 01 AP23 | Removed from the prototype (answers 06 Q9) | No decision attached; the grid and path readouts carry distance. |
| C10 | World controls entry: checkbox row "Trip Twin (hotel hologram)" vs actions are not layers | 03 H-7 vs 06 1.1 | A button **Open Trip Twin** in that block | A mode is not a layer; a checkbox implies it can sit underneath other layers. |
| C11 | Scale extents: 400 m fetch radius vs 500 m Neighborhood | 03 4.1 vs 06 4.2 | Buildings fetched to 400 m (03, measured and budgeted); Neighborhood frames 500 m; grid fades at R + 100 m; beyond that glyphs only | Keeps 03's budget and 06's framing; the fade states where data ends. |
| C12 | Roster as a single line vs fitting 340 px | 06 3.2, Q1 | Desktop rail: stacked rows (label left, count right) with `of N loaded`; the single-line string is used for the wall, copy text and screen readers | One line does not fit at 1280 px; stacked numbers are faster to scan. Same words, same order. |
| C13 | Crowded pins in the footprint: fan around perimeter (03) vs cluster bubbles (06 D5) | 03 7.1 vs 06 D5 | Both: true fix dot and ring never move; photo pins fan out with leader lines; bubbles only when pins still collide at < 24 px | Honest position plus legible identity. |

### 10.2 Open questions for Jesse

| # | Question | My recommendation |
|---|---|---|
| Q1 | Approve C1 (no green/red on people inside the Twin), and should World View adopt it later? | Yes in the Twin now; propose to Justin for World View separately. |
| Q2 | Approve the exploded floor ruler (C3) as the signature visual instead of slabs on the building? | Yes. It is the most "sci-fi" element and the most honest. |
| Q3 | Is the Information steps checklist (E21) welcome, or does any checklist feel like the tool telling operators what to do? | Keep, information steps only, never verdicts. |
| Q4 | Operator-facing name "Trip Twin" vs "3D site view" (06 Q7)? | Keep "Trip Twin" in the prototype; test the label in the five-second test. |
| Q5 | Should view-only roles be allowed to add a reported floor (session-only)? [SS-A8] | Yes. It sends nothing and helps them brief others. |
| Q6 | Coastal city for S5 (01 §8): build in this phase or defer? | Defer; keep DC and London as cities 2 and 3 (03 measured coverage). |
| Q7 | Wall display in the prototype at all (06 Q13)? | Spec only (2.4); build after the 4K perf pass (03 R-14). |
| Q8 | Is Intel One Mono acceptable in gods-eye-view (new font asset), or use system mono? | Use it; fallback `ui-monospace` with tabular numbers [SS-A3]. |
| Q9 | Approve the 06 vocabulary additions marked [vocab add] (Hotel assembly point, Civil unrest, Hotel evacuation, Information steps, descending/ascending, band unchanged, Floors above: outline only, Locked in Trip Twin, 2× accuracy label, Last co-located, escalation-policy line, Reported floor kept for this session, lever-gap note)? | Yes; route to 06 owner. |

### 10.3 Assumptions

| ID | Assumption | Verify with |
|---|---|---|
| SS-A1 | Wall type scale ×2 with 24 px minimum is legible at 4-6 m | Wall mock-up test |
| SS-A2 | The prototype has no UI to enter official instructions; the slot is filled only by fixture | 01 A21, product owner |
| SS-A3 | Inter and Intel One Mono can be bundled in gods-eye-view (licences: OFL) | Justin, licence check |
| SS-A4 | Possible-area ring capped at City scale (5 km); beyond that the label carries it | Operator test in Demo C |
| SS-A5 | Scale segment thresholds at 700 m and 4 km camera range | Prototype tuning |
| SS-A6 | Showing the OSM way id and rule in "Why?" is useful, not noise | Label comprehension test (06 §7) |
| SS-A7 | 10 s of camera inactivity is the right guard before an automatic reframe | Operator test |
| SS-A8 | View-only roles may create session-only reported incidents | Product owner, Core access rules |
| SS-A9 | 1280 px is the minimum for the full Twin; 1024 px shows counts only | Operator hardware survey |
| SS-A10 | `A` is free in World View key handling | Justin |
| SS-A11 | `__tripTwinStats` can export screen-space boxes for labels and glyphs in DEV for contrast sampling | 03 architect |
| SS-A12 | Demo counts in section 9 follow 01 §8 fixture text; the fixture author keeps them in sync (02 6 and 03 6.1 describe different 14/23-person casts) | Fixture review; 02 analyst, 03 architect |
| SS-A13 | Demos B and C are selected by a `scenario` query parameter on the same sample trip | 03 H-6 |
| SS-A14 | The hotel is offered as a path destination for "return to hotel" even when it is not an approved Direct group destination (01 A12); Direct group still refuses it | Product owner |

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: screen_spec (run supervision surface, exception surface, multi-surface matrix, trust affordances)
agents_covered: 0 (no autonomous agent; the Twin is fixed at "suggest", never acts)
capabilities_mapped: 7 actions with role, reversibility, confirmation and record (section 6.7)
autonomy_tiers_defined: 1 (suggest only, by design)
exceptions_categorized: 24 states (section 7)
reversibility_documented: true
multi_surface_covered: true (desktop console; SOC wall reserved as read-only mirror; mobile and wearable out of scope this phase)
kill_switch_specified: true (Exit Trip Twin always visible; Esc unwinds; exact restore)
audit_log_surface_designed: partial (session edit history for reported incidents and information steps; sends recorded by Core)
wcag_level: aa
metrics_leading: 0 (demo pass bars in section 9 stand in; product metrics belong to PROJECT-PLAN)
metrics_lagging: 0
kill_criteria_defined: 3 (demo fail signals per scenario)
confidence: 0.78
source_artifacts: [plans/trip-twin/00-CONTEXT.md, 01-operator-scenarios.md, 02-layer-catalog.md, 03-architecture.md, 06-layer-taxonomy.md, 07-production-delta.md (skim), reference/sheet_01-03.jpg, reference/full_s_01,02,05.jpg, gods-eye-view/src/operations/{main,globe,worldControls,alertsPanel,participantPins,model,actions}.js, operations.css]
-->
