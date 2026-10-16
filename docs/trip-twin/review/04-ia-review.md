# 04 IA review: Trip Twin prototype against 06 layer taxonomy

Owner: information architect. Status: review before the cleanup pass. Read-only review; no code changed.
Skills applied: INA-012 information hierarchy, INA-003 dashboard IA, INA-016 navigation model, INA-013 menu architecture, INA-039 labeling, INA-010 contextual navigation, INA-049 IA heuristic evaluation.

Inputs: shots 01–08 (`review/shots/`), `06-layer-taxonomy.md` (§1–§5), `04-screen-spec.md` (§2 regions, §4 elements, §6.3, §8.1), `ROUND-2.md` (§1 cutaway, §1b per-floor roster, §2 weather, §4 keyboard), code `twin.html`, `tripTwin/twinHud.js`, `tripTwin/page.js` (plus `twinSafety.js` and `twinSelect.js` for glyph and glow labels).

Founder goal used as the test for every recommendation: **"Don't overwhelm the user. They see what they need and can get to more if they want."** In IA terms: Tier 0 is always visible, everything else is one action away, and nothing a demo operator never uses is on screen.

Assumptions are tagged **[RV-A#]** and listed in section 8.

---

## 0. Summary

The prototype gets the most important thing right. The roster block, zone line, Needs attention list, reported-incident panel and person card use 06 §3 words almost exactly, and the five-second read works in shots 01 and 04.

Where it drifts is in **controls**. 06 had one place for layer toggles (a Layers panel with five groups). The prototype has none. Its toggles are spread across four places, and the operator controls are mixed with prototype controls:

| Where | What is there today | What kind of control it is |
|---|---|---|
| Toolbar (`#tt-toolbar`) | Building · Neighborhood · City, Ground, Selection glow, Scenario, City | 1 navigation, 1 display setting, 1 design knob, 2 prototype controls |
| Rail, Floors block | "Floor estimates (phone barometer, not verified)" checkbox | Layer toggle |
| Rail, PATHS block (below the fold) | "Suggested walking paths" checkbox + path cards | Layer toggle + readout (duplicated in R4) |
| Rail, HAZARDS block (below the fold) | "Add simulated heat detections (prototype)" checkbox | Prototype control |
| Rail, REPORT block (below the fold, calm mode) | Floor input + "Add reported floor" | Operator input |

There is no Layers panel, no legend, no More drawer, no sample watermark element, and no official-instruction slot. Two of the rail checkboxes also throw an error when clicked (G-01).

The fix is not to add more. It is to **move** controls into four containers with clear jobs: toolbar (navigate and act), Layers (what is drawn, with the legend built in), Display (how it is drawn), and Prototype controls (hidden, for demos). Section 2 specifies all four. Section 3 rebuilds the rail so that it holds readouts only.

Round-2 items are placed now (section 2.6). **Weather goes in Hazards as a collapsed "Weather" sub-group, not a sixth group.** **The building cutaway is part of the hotel card, not a layer.** It opens when the operator selects the hotel (click the hotel, click the hotel name in the header, or press `H`).

---

## 1. Gap analysis: prototype against 06

Severity: **High** = breaks a 06 rule or the founder goal, **Med** = drift that will confuse operators, **Low** = polish.

### 1.1 Control architecture (06 §1.1 types, §2 Layers panel, 04 R6/R9)

| ID | 06/04 says | Prototype does (evidence) | Severity |
|---|---|---|---|
| G-01 | Toggles work | `createHud(root, { onSelectPerson, onReportFloor, onToggleFloors })` in `twinHud.js:48–51` does not destructure `onTogglePaths` or `onToggleSimFires`, but lines 192 and 230 call them. `page.js:75–76` passes them in. Clicking "Suggested walking paths" or "Add simulated heat detections" throws a `ReferenceError`. | High (bug) |
| G-02 | One **Layers** panel, five groups (People, Hazards, Safety, Paths, Site), opened from the toolbar (06 §2.1, 04 E33) | No Layers panel. Three layer toggles exist, each in a different place: floor estimates (rail), paths (rail, below the fold), simulated fires (rail, below the fold). Group zone, safety resources, surrounding buildings and heat detections cannot be toggled at all. | High |
| G-03 | Prototype-only controls are separate from operator controls (06 §1.3 "Sample clock … hidden outside sample mode") | Scenario and City selects sit in the operator toolbar (shots 01–08). "Add simulated heat detections (prototype)" sits in the rail. The scenario name ("Evening at the hotel", "Hotel fire alarm (Demo A)") is printed in the rail head. | High |
| G-04 | Selection styling is not an operator choice (no 06 entry) | "Selection glow: Aura + light pool" select in the toolbar (`GLOW_STYLES`, 5 options). It is a design A/B knob and does not change any operator decision. | High (clutter) |
| G-05 | **Add reported floor** is a toolbar action (04 R6) | In calm mode it is a form at the bottom of the rail, below the fold at 1600×900 and unreachable without scrolling. In incident mode it is in R4. | Med |
| G-06 | **Legend** button, dynamic legend (06 §5.2, 04 E34) | No legend anywhere. The grammar (solid/dashed/hollow, amber ring = needs attention, red slab = reported floor) is never explained on screen. | High |
| G-07 | **More** drawer holds Tier 2 (06 §1.2: emergency numbers, hospitals, muster, elevation) | Not built. The edge chips ("Hospital 1.7 km N →") are the only Tier 2 access. | Med |
| G-08 | Ground grid, contours and units are display settings | They are behind a "Ground" toolbar button. The popover is good (shot 03) but opens over the hotel and covers people pins. Units apply only to the grid. Rail distances and path cards stay metric. | Med |
| G-09 | Plan view (north up) / 3D (06 §1.3, C8) | Not built. No control. | Low (scope) |
| G-10 | `Esc` unwinds one level: popover → card → focus (04 §6.8) | `page.js:324` Esc only calls `twin.select(null)`. It does not close the Ground popover. | Low |

### 1.2 Hierarchy and defaults (06 §1.2 tiers, §2.2 defaults, §2.4 entry)

| ID | 06 says | Prototype does | Severity |
|---|---|---|---|
| G-11 | Floor estimates are **off** in calm mode and turn on with an incident (06 §2.2 row 1.2, §2.4) | On in the baseline (shots 01–03). The floor ruler, bracket labels and the caption "Floor estimates · phone barometer · not verified" are drawn on a calm evening. | High |
| G-12 | The floor partition is relative to a **reported** floor (06 FLR-12) | Calm rail shows "Above 0 · At or near 0 · Below 0 · Last est. only 0 · Floor unknown 9 …" when there is no reported floor (shot 01). Above/below what? The line has no meaning. | High |
| G-13 | R5 opens only on selection. Nothing is selected on entry (06 §2.4) | The "GROUP HOTEL" card is open at entry in every shot. The hotel is shown as selected (glow). | Med |
| G-14 | One readout lives in one place (06 §1.1 rule; 04 R2 vs R4) | Duplicates in incident mode (shot 04): "At or above reported floor 9: 2" appears in both the rail and R4. The roster line appears as stacked rows in the rail and again as a one-liner in R4. The path card is in the rail (below the fold) and again in R4. | Med |
| G-15 | Official instruction slot is first in R4, even when empty (06 Tier 1, HAZ-11; 04 E14) | Missing. R4 opens on "REPORTED INCIDENT · NOT VERIFIED". | High (doctrine) |
| G-16 | R4 also holds message status, stand-down line MSG-06, information steps (04 E21–E23) | Missing (prototype scope). Note only. | Low |
| G-17 | Sample watermark is a mandatory element (06 §1.1, PRV-08) | `#tt-watermark` is styled in `tripTwin.css:89` but there is no element in `twin.html`. No `SAMPLE` tag in R1. Only "(sample)" in the rail title and "(sample time)" on the clock. | High |
| G-18 | Hidden information is never hidden by chrome (04 §2.1 z-order) | The toolbar overlaps the rail at 1600 px (x 333–371) and covers the last Needs attention rows. At 1280×720 (shot 08) the toolbar covers rows 3+, and the hotel card covers the "Floor / Change reported floor / Clear reported floor" controls in R4. Scene labels show through the 0.9-alpha rail ("SIMULATED heat detection · 1h…" in shot 07, "point (primary)" in shot 01). | High |
| G-19 | Edge chips are for items **beyond** the current scale (06 §4.2) | At City scale (shot 07) "SIMULATED Heat detection 0.7 km SW →" is still a chip while the detection is drawn in view. | Low |
| G-20 | Max 6 edge chips (06 D1) | Five or six chips stacked at the top left of the scene. They also cover scene labels: "ustin Fire Station Number 1" and "nt (secondary)" are clipped in shots 02/03. | Med |

### 1.3 Labels that drifted from 06 §3

| ID | Where | Prototype string | 06 term | Fix |
|---|---|---|---|---|
| L-01 | Rail hazards (`twinHud.js` statusText) | "Satellite heat detections · NASA FIRMS · **live**" | FRS-01: "Live" is **never used for FIRMS** | "Satellite heat detections · NASA FIRMS · updated {3h} ago (satellite pass {11:20})" |
| L-02 | Path card, shot 07 | "Passes within 320 m of a satellite heat detection (SW)" | PTH-05 "Closest approach to hazard: {420} m". PTH-06 reserves "Passes within buffer" for a greyed, rejected path | "Closest approach to hazard: 320 m (SW)". Two meanings of "passes within" would collide |
| L-03 | Path card | (caption missing) | PTH-03 permanent caption | Add "OSM street path · not checked for closures, crowds, lighting, crime or damage" |
| L-04 | Hotel card | "GROUP HOTEL" kicker; "OpenStreetMap way/134786106" | SIT-01 hotel name; SIT-02 "Building matched"; SIT-08 "Interior unknown" | Kicker "Hotel". Lines "Building matched · OSM", "Height ~122 m (est. from 37 levels)" (SIT-06), "Interior unknown". The raw OSM id goes to a hover or the Prototype drawer |
| L-05 | Hotel card | "Height ~122 m · from 37 levels (mapped)" | SIT-06 "Height ~{46} m (est. from {14} levels)" | Use SIT-06. "(mapped)" claims a measured height |
| L-06 | Rail head | "GROUP STATUS" / "Spring choir tour (sample)" / "Hotel fire alarm (Demo A) · 02:14 local" | 04 R1/R2: trip title in the header, local time with zone and night chip | See section 3. The scenario name leaves the operator UI |
| L-07 | Clock (R1) | "21:32 local (sample time)" | 06 §4.4: "02:14 local (CDT)" + "Night · civil dusk 18:42" | "21:32 local (CDT) · Night", plus the `SAMPLE` tag beside the title |
| L-08 | Breadcrumb | "World View › Sample trip › Fairmont Austin" (plain spans) | 06 §4.4: `World View › {trip title} › {hotel} › {focus}`, segments clickable, focus segment `aria-current` | Use the trip title. Add the focus segment ("M.R. (traveler)", "Floor 9"). Make segments links |
| L-09 | Edge chips | "4 beyond this view →" | 06 §4.2 pattern `{label} {distance} {bearing} →`; "5 away →" | "4 people beyond this view →" (the bare count does not say *what*). Neutral outline, not green: green on a people chip breaks 06 §5.1 |
| L-10 | Simulated chip and labels | "SIMULATED Heat detection", "SIMULATED heat detection · 24m ago" | D15 sentence case; PRV-08 | "Simulated heat detection (prototype) · 24m ago". Only shown when the Prototype drawer turns it on |
| L-11 | Needs attention rows | "R.O. Rory Owen" | D4: initials are the scene-label device; full names in panels | "Rory Owen" (row), reason on line 2. Drop the duplicated initials |
| L-12 | Safety glyphs (`twinSafety.js` GLYPH) | Letter codes R1, R2, GS, RL, H, P, F, Rx, E, **C**, S | 06 §3.6 / §5.1: category **shapes** (flag, house, cross, shield …). "C" is already the chaperone badge. "GS" has no vocabulary entry | Shapes per SAF-01..12. If letters stay for the prototype, change consulate "C" to "Co" and safe house "GS" to "SH", and list every code in the Layers key |
| L-13 | Scene labels | "Fire station / Austin Fire Station Number 1" stacked on "Rally point (secondary) · Draft · not approved" | D8: labels may not overlap; a label that cannot be placed drops to hover | Collision pass. The draft rally point is priority 5 in D2 and keeps its label. The fire station drops to hover |
| L-14 | Person card | "Battery 62% · unplugged" | POS-M4 "Battery {6}% · discharging" | "discharging" |
| L-15 | Person card, not current | "Last known position: inside hotel (likely)" | HTL-05 "Last known inside (likely) · {5m} ago" | Use HTL-05 with the age |
| L-16 | Rail sources | "Traveler data · sample feed · updated 12s ago" | FRS-06 "Sample · {12s} ago" | FRS-06 |
| L-17 | Rail floor toggle | "Floor estimates (phone barometer, not verified)" | Layer label "Floor estimates". The caveat is the scene caption (04 S11) | The row label in Layers is "Floor estimates". The caveat stays in the caption and the key |
| L-18 | Ground popover | Units "Meters / Feet / Yards" | D13 metric; Q12 open | "Metric · US (ft, mi)". Yards is not an operator unit (section 2.4) |

What is already right, and should not be touched: the roster buckets and "of 27 loaded", the zone line, Needs attention reasons ("At or above reported floor 9", "Did not answer a location check · Updated 51m ago", "Capture time unknown", "Last est. only"), "REPORTED INCIDENT · NOT VERIFIED", "Reported: smoke · floor 9 · hotel desk · 02:12 · not verified", "Rally point (primary) · 640 m · walk 10–13 min (group pace)", "Suggested path (unverified)", the arrive-by arithmetic, the Shelter-in-place card, the person card's main lines, and the source line R7.

### 1.4 Heuristic score (INA-049, 1 = poor, 5 = strong)

| Heuristic | Score | Note |
|---|---|---|
| Findability of Tier 0 | 4 | Roster and attention are top-left and large |
| Findability of controls | 1 | No Layers. Toggles are scattered, two are below the fold, two are broken |
| Predictability (one thing, one place) | 2 | Duplicated readouts. Prototype and operator controls mixed |
| Labeling consistency with 06 | 4 | Strong, apart from L-01, L-02 and L-04 |
| Progressive disclosure | 2 | Calm view shows floor ruler and partition. Rail scrolls to reach controls |
| Wayfinding (where am I) | 2 | Breadcrumb has no focus segment and no links |
| Accessibility structure | 2 | Landmarks partly there. No legend. Esc incomplete. Scene labels bleed through the rail |

---

## 2. One control architecture

Four containers, each with one job. **Nothing appears in two containers** except where a cross-reference row is noted.

| Container | Job | Opened by | Who sees it |
|---|---|---|---|
| **Toolbar** (R6) | Navigate and act | Always visible | All roles |
| **Layers** (R9 popover) | What is drawn, and what it means (the legend is built in) | Toolbar **Layers**, key `L` | All roles |
| **Display** (R9 popover) | How it is drawn (ground, units, view mode) | Toolbar **Display**, key `G` cycles ground directly | All roles |
| **Local info** (R9 drawer) | Tier 2 readouts (06 §1.2): numbers, hospitals, muster, elevation, weather now | Toolbar **Local info**, key `M` | All roles |
| **Prototype controls** (drawer) | Scenario, city, simulation, design knobs | Key `` ` `` (backtick), or the `Prototype` pill in R1 | Sample / dev mode only. Absent in production builds |

### 2.1 Toolbar (R6): five items

Order left to right. Bottom centre of R3 (centred between R2 and R4, never overlapping either; see P0-09).

| # | Label (exact) | Type | Key | Notes |
|---|---|---|---|---|
| 1 | `Building` · `Neighborhood` · `City` | Segmented control (counts as one item) | `1` `2` `3` | Built. Pressed state follows the camera (06 §4.2) |
| 2 | `Layers` | Popover button, `aria-expanded` | `L` | Shows a small dot until opened once in the session (replaces 06's "legend opens once on first entry"; see 2.5) |
| 3 | `Add reported floor` → after one exists: `Reported floor 9` | Action (opens the floor dialog) / then focuses R4 | `R` | Moved from the rail bottom (G-05). Label switches so the operator sees there is an active report |
| 4 | `Local info` | Drawer button | `M` | Replaces 04's "More". "More" has no information scent. "Local info" says what is inside [RV-A1] |
| 5 | `Display` | Popover button | `G` cycles ground without opening | Replaces the "Ground" button |

Removed from the toolbar: `Selection glow`, `Scenario`, `City` (→ Prototype controls). `Plan view` (→ Display, because it is a view mode and the toolbar must fit 1280 px). `Ground` (→ Display).

Width check at 1280 × 720 with R4 open: the scene is about 1280 − 372 − 356 ≈ 550 px. The items measure about 210 + 70 + 140 + 84 + 72 ≈ 576 px, so it does not quite fit. Below 1440 px wide, `Local info` and `Display` collapse to icon buttons with the same `aria-label` and a tooltip. The segmented control and `Add reported floor` never collapse.

**Frame selection** has no toolbar button. Its visible control is a **Zoom to** button in every R5 card header (the card is where a selection exists). Double-click and `F` / `Z` also frame.

### 2.2 Layers popover (R9): five groups, legend built in

Anchored above the **Layers** button, 360 px wide, max height 70% of the viewport, scrolls inside. It opens with **all five groups collapsed** to a single header line each. The header shows what is drawn now, so the closed panel already works as a summary:

```
People     3 of 3 on · key ▸
Hazards    2 on · 1 reported incident · key ▸
Safety     on · 7 categories · key ▸
Paths      on · to Rally point (primary) · key ▸
Site       2 of 3 on · key ▸
───────────────────────────────────────────
Solid = current or mapped · Dashed = aging or approximate · Hollow = not current or not vetted
Positions are phone fixes, not confirmation that someone is safe.
Paths are OSM street paths, not checked for hazards or closures.
```

Expanding a group shows its rows. Under each row that is **on**, the panel shows that row's key: the swatches and words for the meanings currently drawn (section 4). **The layer row is its own legend entry.** Rows that are off show no key.

Rows and defaults. Labels are exact 06 §2.2 strings unless marked *change*. "Incident" = an incident or hazard is in focus (06 Tier 1).

| Group | Row label (exact) | Calm default | Incident default | Built in prototype | Notes |
|---|---|---|---|---|---|
| **People** | Travelers & chaperones | On · locked | On · locked | Yes | Lock icon + "Locked in Trip Twin" |
| | Floor estimates | **Off** | **On** (auto, 06 C3) | Yes | Fixes G-11. Sub-line when on: "Phone barometer · not verified" |
| | Group zone & trip boundaries | On | On | Yes (rings drawn) | |
| | Geofence crossings | Off | Off | No → row hidden | |
| **Hazards** | Reported incidents | On when one exists | On | Yes | Hidden → rail Sources "Reported incidents hidden (1)" (FRS-10) |
| | Satellite heat detections | On | On | Yes | Sub-toggle **Include low-confidence detections**: Off |
| | Earthquakes | Off | Off | No → row hidden | Rail chip still shows events in 02 R8 range when built |
| | **Weather ▸** (sub-group, collapsed) | see 2.6 | see 2.6 | No (round 2) | Header line: "Weather · {n} on" |
| **Safety** | Safety resources | On | On | Yes | "Categories ▸" collapsed, all 7 On: Rally points · Safe houses & relocation · Shelters · Medical · Police & fire · Embassies & consulates · Other |
| **Paths** | Suggested walking paths | On, to Rally point (primary) | On | Yes | `Show paths to… ▾` destination picker in the row (max 2 destinations, 06 §2.4) |
| | Mapped entrances | Off | Off | No → row hidden | |
| **Site** | Hotel | On · locked | On · locked | Yes | |
| | Surrounding buildings | On | On (dimmed, 04 §6.6) | Yes | |
| | Venues & itinerary stops | Off | Off | No → row hidden | |
| | *Cross-reference row* "Ground grid and contours → Display" | — | — | — | A link, not a toggle. The grid is drawn, so some operators will look for it here (tree-test task T6) |

*Change from 06 §2.2:* rows for layers that are not built (Geofence crossings, Earthquakes, Public cameras, Unvetted OSM services, Driving paths, Live traffic, Mapped entrances, Venues) are **hidden**, not shown disabled. Five disabled "Not in prototype" rows are noise for an operator. The Prototype drawer has a "Show unbuilt layers" switch for design reviews. *Distance rings* stays removed (04 §4.3).

Visible rows in the prototype: People 3, Hazards 2 + Weather header, Safety 1, Paths 1, Site 2 = **10 rows**, each group at 1–3 rows, inside 7±2.

Turning a layer off never changes a readout (06 C7). Turning off any Hazards row adds PTH-15 to path cards (06 C5).

### 2.3 Local info drawer (R9, 380 px, slides over R4): Tier 2 readouts

Exact section headers, in this order (06 §1.2 Tier 2, 01 ranks 13–22):

| Section header | Content | Prototype |
|---|---|---|
| Emergency numbers | Police, fire, ambulance, embassy line | Fixture |
| Hospitals | Emergency-capable hospitals, drive time, "ER status not verified" (SAF-27) | Fixture + OSRM |
| Headcount | Muster counts MSG-04 when a muster exists; otherwise "No muster recorded" | Fixture |
| Weather now | "{18} °C · {light rain} · {source} · {12m} ago". Official weather alerts are **not** here: they go to the Official slot (HAZ-12) | Round 2 |
| Elevation | Hotel elevation, coast distance, high-ground direction | Computed |

Scenario promotion (06 §1.2) still moves items from here into R4 automatically (for example, Hospitals in a Medical incident). The drawer keeps them too, because it is the predictable place.

### 2.4 Display popover (R9, 320 px)

| Row label (exact) | Control | Default | Notes |
|---|---|---|---|
| View | Segmented `3D` · `Plan (north up)` | 3D | Key `P`. Shown disabled "Not in prototype" until built. This is the only disabled row, kept because `P` is in the key map |
| Ground | Segmented `Grid` · `Contours` · `Both` · `Off` | Grid | Key `G` cycles these without opening the popover |
| Grid spacing | Select, `Auto` first | Auto (50 m at Neighborhood) | Under "Ground details ▸", collapsed |
| Contour interval | Select, `Auto` first | Auto (2 m) | Under "Ground details ▸", collapsed |
| Units | Segmented `Metric` · `US (ft, mi)` | Metric | *Change:* applies to every distance (rail, cards, paths, grid), not only the grid (06 D13, Q12) [RV-A2]. Yards removed |
| (readout) | "Ground in this view: −12 m to +10 m vs hotel street level" | — | Keep; it is useful and honest |
| Keyboard shortcuts | Link | — | Opens the `?` overlay (the visible control for the key map) |

Selection glow is **not** here. It does not change any operator decision, so it goes to Prototype controls until Jesse picks one style. If Jesse wants operators to choose, it returns here as **Selection highlight**.

### 2.5 Prototype controls (hidden drawer)

Opened by `` ` `` (backtick), or by the `Prototype` pill at the right end of R1. Both exist only in sample/dev mode (`?dev=1` or sample snapshot). It is a left-sliding drawer over the rail with the title **Prototype controls · not shown to operators**.

| Row label (exact) | Control | Source today |
|---|---|---|
| Scenario | `Evening at the hotel` · `Hotel fire alarm (Demo A)` | `#tt-scenario` |
| City | `Austin` · `Washington DC` · `London` | `#tt-city` |
| Simulated heat detections | Switch | Rail checkbox / `?fire=1` |
| Selection glow | `Aura + light pool` · `Aura` · `Soft rim` · `Light pool` · `Aura + beacon` | `#tt-glow` |
| OSM source | `Live` · `Recorded` | `osmMode` param |
| Freeze feed | Switch | `?freeze` param |
| Sample clock | `Play` · `Pause` · scrub | 04 R6 (not built) |
| Show unbuilt layers | Switch | New (2.2) |
| Show OSM ids | Switch (adds "OpenStreetMap way/…" to cards) | Hotel card line today |

Operator UI after the move: the rail head no longer prints the scenario name. R1 shows `SAMPLE` beside the hotel name, and the full-frame watermark "SAMPLE DATA · fictional people and events" is present (G-17).

### 2.6 Round-2 placement decisions

**Weather: a sub-group of Hazards, not a sixth group.**

Why:
1. 06 groups follow the operator's five questions. Weather answers Q2, "what conditions threaten the group, and where?", so it belongs with Hazards. A sixth group would give cloud cover the same rank as People.
2. Five groups was the tree-tested structure (06 §7). A sixth top-level item adds a choice to every Layers visit, for data that changes a decision only sometimes.
3. The decision-relevant weather fact (lightning near an outdoor assembly point) reaches the operator through the rail Hazards line anyway. Operators do not need to open Layers to learn about it.

Rows inside **Hazards › Weather ▸** (collapsed by default). The labels are new vocabulary for 06 §3.8 (IDs WX-01..05):

| ID | Row label (exact) | Default | Scene label / readout | Color rule |
|---|---|---|---|---|
| WX-01 | Lightning strikes | **Auto-on** when a strike is within 10 km of the hotel or a rally point in the last 30 min; else Off [RV-A3] | "Lightning · 6.2 km W · 4m ago · {source}" (nearest only, one label) | Hazard red bolt glyph with age. It is an observed hazard |
| WX-02 | Precipitation (radar) | Off | Card: "Precipitation · radar · {source} · {8m} ago" | Neutral slate/white ramp at low alpha. **Never blue**, because blue means paths only (06 §5.1) |
| WX-03 | Rain & snow totals (24 h) | Off | Card: "Rain & snow totals · last 24 h · {source}" | Neutral ramp, numeric labels on hover only |
| WX-04 | Cloud cover | Off | Card: "Cloud cover · {source} · {time}" | Neutral white at low alpha |
| WX-05 | (readout, not a row) | — | Rail Hazards line only when decision-relevant: "Lightning within 10 km · 4m ago". When cloud covered the area at the last satellite pass, HAZ-07 adds "Cloud over the area at the last satellite pass" | — |

Forbidden in weather copy: "storm warning", "severe", "Watch / Warning / Advisory / Alert" for our data (06 F4), "clear skies", "safe to go outside". Official weather alerts go to the Official slot as "Official: {text} · {authority} · {time}" (HAZ-12). Label density: weather adds at most **one** persistent label (the nearest lightning strike). Everything else stays in hover and cards (06 D1/D2).

**Building cutaway (ROUND-2 §1): part of the hotel card, not a layer.**

Why: by 06 §1.1 types, the cutaway is a **readout plus navigation** (it lists floors and jumps the camera). It is not a spatial overlay. Readouts never live in Layers, and readouts never depend on a layer being on (06 C7), so the cutaway shows even when Floor estimates is off.

- **Where:** top block of the hotel card (R5), above "Building matched / Height / Interior unknown", as Jesse asked. Header row: `Floors ▾` (collapse chevron, remembered for the session). Expanded by default.
- **Opens when:** the hotel is selected. There are three visible ways: click the hotel, click the hotel name in R1, or click "Hotel" in a Needs attention or R4 line. The key is `H`. Nothing is selected on entry (fixes G-13).
- **Incident mode:** R4 compresses to its header + priority count when R5 opens (04 §2.1). Below 1440 px R5 replaces R4 with a `‹ Incident` tab. The cutaway therefore never competes with R4 for height.
- **Floor states** (no green, per 06 F6 / ROUND-2 §1 "To decide"):

| State | Fill / outline | Label on the floor row |
|---|---|---|
| Likely occupied | Near-white `#eff7f3` low alpha | "{n} likely" (counted on each person's likeliest floor; band span drawn as a faint bracket) |
| Group floor, no one detected | Amber outline | "Group floor · no one detected" |
| Reported floor | Red hatch (same as scene slab) | "Reported: smoke · not verified" |
| Lobby | Neutral | "Lobby (floor 1)" |
| Footer (always) | — | "Floor unknown {2} · Not shared {0} · Last est. only {1}". Never omitted |

- **Click a floor** → floor-range focus (06 §4.3): camera frames that floor, breadcrumb gains `Floor 9`, R5 shows the **per-floor roster (ROUND-2 §1b)** with three section headers:
  - `Likely here now ({n})`: band intersects the floor (estimate ±1)
  - `Assigned here ({n})`: from a rooming list. Prototype: "No rooming list on file · group floors from hotel card"
  - `Assigned here, not detected here ({n})`: each row with its reason ("Floor unknown — phone has no pressure sensor", "Last known 34m ago"). Never "missing", never "empty".
  - Max 5 rows per section, then "Show all {n}". `Copy for hotel / responders` at the bottom.

---

## 3. Rail information architecture (R2)

The rail holds **readouts only**. No checkboxes, no forms. Section headers reuse the Layers group words (People, Hazards, Safety), so the rail and the Layers panel teach one model.

### 3.1 Calm mode (no incident in focus)

| Order | Section header (exact) | Content | Default state | Max rows before "Show all {n}" |
|---|---|---|---|---|
| 0 | (no header) | Trip title (14 px semibold). Line 2: "21:32 local (CDT) · Night" | Always | — |
| 1 | People | Roster block (6 buckets + "of {N} loaded"), **sticky**. Then zone line. Then chaperones line "Chaperones 3 · 1 aging · 1 away ▸" | Roster always expanded. Chaperones line collapsed (expands to one row per chaperone) | Roster: all 6, never truncated. Chaperones: 3 |
| 2 | Needs attention · {n} | Rows: name (line 1), reason + age (line 2), amber left rule | Expanded | **5** (3 when viewport height < 800 px) |
| 3 | Safety | "Rally point (primary) · 640 m · walk 10–13 min" (one line, click → safety card + path). Secondary rally point and coverage gaps behind "▸" | Collapsed to the primary line | 1 visible, expands to 4 |
| 4 | Hazards | One line: the nearest hazard headline (HAZ-02 / HAZ-08), or the short empty state "No FIRMS heat detections within 25 km · last 24 h ▸" (the blind-spot sentence of HAZ-07 is in the expansion). Weather line only per WX-05 | Collapsed to 1–2 lines | 3 when expanded |
| 5 | Sources | One line: "Sources · traveler data 12s ago ▸". Expands to per-source lines and "{Layer} hidden" lines | **Collapsed.** Auto-expands, turns amber and moves to the top of the rail when degraded (04 §7) | All when expanded |

Removed from the calm rail: the Floor estimates checkbox (→ Layers › People), the floor partition (meaningless without a reported floor; the cutaway footer carries unknown/not-shared counts), the PATHS checkbox and path cards (→ Layers › Paths; the path card opens in R5 from the Safety line), the simulated heat detections checkbox (→ Prototype controls), the REPORT form (→ toolbar `Add reported floor`), and "GROUP STATUS" and the scenario line.

### 3.2 Incident mode (reported incident or hazard in focus)

| Order | Section header (exact) | Change from calm |
|---|---|---|
| 0 | (no header) | Same |
| 1 | People | Roster sticky. Zone line and chaperones line condensed to one line each, collapsed |
| 2 | Needs attention · {n} | "At or above reported floor" reasons sort first (06 D3 order). Max 5 rows |
| 3 | Hazards | Expanded by default. Line 1 "Reported: smoke · floor 9 · 02:12 · not verified" (click → R4). Line 2 nearest heat detection or WX-05 |
| 4 | Sources | Collapsed |
| — | Safety | **Leaves the rail.** It lives in R4 "If the group must move" |

**Not in the rail during an incident** (single home in R4, fixes G-14): the priority count "At or above reported floor 9: 2", the floor partition, the hotel card block, path cards, and the roster one-liner.

R4 order (04 §6.6, with the prototype's gaps marked): **Official** (missing, P0) → Reported incident with `Change reported floor` / `Clear reported floor` → priority count + rows (rows missing today) → floor partition → Hotel card (promoted) → If the group must move (path + Shelter in place) → message status / stand-down line (not built). Sections after the partition collapse to their header lines when R5 is open.

### 3.3 Sizing rules

- The rail never scrolls the roster block off screen (sticky). Lists scroll beneath it.
- The rail background is opaque (alpha 1.0, or a blur plus alpha ≥ 0.96), so scene labels never show through (G-18).
- At 1280 × 720: roster rows at 24 px (counts stay 22 px mono), Needs attention max 3, and every section below it collapsed.

---

## 4. Legend

**What it shows** (dynamic, 06 §5.2): only the meanings currently drawn, grouped under the layer that draws them. It uses 06 §3 words only.

| Under | Key lines (shown only if that meaning is on screen) |
|---|---|
| People › Travelers & chaperones | Solid ring = current · Dashed amber ring = aging · Dotted hollow ring = last known · "?" = capture time unknown · Amber outer ring = needs attention · T = traveler, C = chaperone · Ring size = phone accuracy (about 2 in 3 chance inside) |
| People › Floor estimates | Bracket = likely floor range · Tick = likeliest floor · Hollow bracket = last estimate · Caption: phone barometer · not verified |
| People › Group zone | Teal ground ring = group zone · Dashed = update overdue or approximate |
| Hazards › Reported incidents | Red hatched slab = reported floor (not verified) · Dashed red area = reported area, sized to stated uncertainty |
| Hazards › Satellite heat detections | Red square = satellite pixel footprint, not a fire perimeter · Dashed = 6–24 h old |
| Hazards › Weather | Red bolt = lightning strike with age · Grey wash = precipitation / cloud (no blue) |
| Safety › Safety resources | Filled green glyph = approved · Hollow grey dashed = draft, not approved · one line per category glyph drawn |
| Paths › Suggested walking paths | Blue solid with chevrons = primary · Blue long dash = alternate · Amber segment = near a hazard · Grey hatched = passes within buffer |
| Site | Bright outline = hotel · Glass = surrounding buildings (OSM) · Dashed outline = approximate |
| Footer (always) | Grammar line + the two caveats (2.2) |

**Where it opens:** inside the Layers popover, under each row that is on, and in the footer. There is no separate Legend button. *Change from 06 §5.2 and 04 E34:* one container instead of two (Layers + Legend). It saves a toolbar slot and teaches "this toggle draws this mark". `L` therefore opens Layers, which matches ROUND-2 §4.

**First run:** the panel does **not** auto-open (*change from 06 §5.2*, for the founder goal). The Layers button carries a dot until first opened in the session. The two whole-view caveats are always one action away (L) and also appear in the Copy text.

---

## 5. Keyboard map

Built from ROUND-2 §4, reconciled with 06 §4.6 and 04 §8.1. Rules:
- No key fires while focus is in an input, select or textarea (already true: `page.js:323`).
- No browser-reserved combinations.
- Justin's global digit visual-mode keys are suspended inside Trip Twin (06 F5).
- Every key has a visible control (last column).

| Key | Action | Visible control | Status |
|---|---|---|---|
| `F` / `Z` | Frame selection. With no selection, frame the hotel | `Zoom to` in the R5 card header | Built (selection only) |
| Double-click | Frame the clicked item | — | Proposed |
| `Esc` | Unwind one level: close popover/drawer → close card → clear person focus → clear floor focus → nothing. **Never exits** | Close buttons; breadcrumb | Built partly (G-10) |
| `1` `2` `3` | Building / Neighborhood / City | Toolbar segmented control | Built |
| `L` | Open / close **Layers** (with key) | Toolbar `Layers` | *Change:* 06 had `L` = legend; now the legend is inside Layers, so the meaning is preserved |
| `G` | Cycle ground: Grid → Contours → Both → Off. Announces the new state in the polite live region and updates the R7 scale note | Display › Ground | ROUND-2 |
| `A` | Select the first Needs attention item (person focus + card) | Click a Needs attention row | ROUND-2 |
| `[` `]` | Previous / next person in the current list (Needs attention, floor roster, at-or-above rows) | `‹` `›` in the person card header | ROUND-2 / 06 |
| `H` | Select the hotel: hotel card with **Floors cutaway** | Click the hotel, or the hotel name in R1 | New (round 2) |
| `↑` `↓` / `Enter` | Inside the cutaway: move between floors / focus that floor (per-floor roster) | Click a floor row | New (round 2) |
| `R` | Open **Add reported floor** (or focus the reported incident in R4 when one exists) | Toolbar `Add reported floor` | New [RV-A4] |
| `M` | Open / close **Local info** | Toolbar `Local info` | New [RV-A4] |
| `P` | Plan (north up) / 3D | Display › View | 06; disabled until built |
| `N` / `Home` | North up / reset to the Neighborhood preset | — (Home also = Neighborhood button) | 04 §8.1 |
| `?` | Keyboard shortcut overlay | Display › Keyboard shortcuts | ROUND-2 |
| `` ` `` | Prototype controls drawer (sample/dev only) | `Prototype` pill in R1 | New |
| Mouse | Left-drag orbit, right-drag zoom, middle-drag pan, wheel zoom (Cesium defaults) | — | ROUND-2 |

Not bound: `S`, `W`, `D` (no WASD flight; operators are not piloting), `Space` (reserved for the sample clock Play/Pause inside the Prototype drawer only).

---

## 6. Ranked change list

**P0: do in the cleanup pass (founder goal, honesty, or broken)**

| # | Change (one sentence) | Affected element |
|---|---|---|
| P0-01 | Destructure `onTogglePaths` and `onToggleSimFires` in `createHud` so the two checkboxes stop throwing (moot once they move, but fix if they stay for one build). | `twinHud.js:48–51` |
| P0-02 | Move Scenario, City, Selection glow and Simulated heat detections into a hidden **Prototype controls** drawer (`` ` `` / `Prototype` pill) and delete them from the toolbar and rail. | `#tt-toolbar`, rail HAZARDS block, new drawer |
| P0-03 | Add a **Layers** popover with the five groups and the rows/defaults in 2.2, and remove the Floor estimates and Suggested walking paths checkboxes from the rail. | New `#tt-layers`, `twinHud.js` floors/paths blocks |
| P0-04 | Default Floor estimates to Off in calm mode, auto-on with a reported incident, and hide the floor partition when there is no reported floor. | `onToggleFloors` default, rail Floors block |
| P0-05 | Remove the scenario name from the rail head, add the `SAMPLE` tag to R1, and render the `#tt-watermark` element that the CSS already styles. | Rail head, `#tt-bar`, `twin.html` |
| P0-06 | Replace "NASA FIRMS · live" with "updated {3h} ago (satellite pass {hh:mm})", because FRS-01 forbids "live" for FIRMS. | `twinHud.js` `statusText` |
| P0-07 | Change the path hazard line to "Closest approach to hazard: {320} m (SW)" and add the PTH-03 caption to every path card. | `pathCardText` (`tripTwin.js` / `twinPaths.js`), R4 path card |
| P0-08 | Add the Official instruction slot as the first block of R4 with HAZ-11 when empty. | R4 `.tt-incident` |
| P0-09 | Centre the toolbar between R2 and R4 so it never covers the rail, and make the rail opaque so scene labels never show through. | `tripTwin.css` `.tt-toolbar`, `.tt-rail` |
| P0-10 | Give each incident readout one home: priority count, partition and path card in R4 only; remove the R4 roster one-liner and the rail PATHS block. | `twinHud.js` rail Floors/PATHS, R4 roster line |

**P1: next pass (findability and label drift)**

| # | Change (one sentence) | Affected element |
|---|---|---|
| P1-01 | Move `Add reported floor` from the rail bottom to the toolbar, relabelled `Reported floor {n}` once one exists. | Toolbar, rail REPORT block |
| P1-02 | Replace the "Ground" button with a **Display** popover (View, Ground, Ground details, Units, Keyboard shortcuts). | `#tt-ground-btn`, `#tt-ground` |
| P1-03 | Build the dynamic key inside the Layers popover per section 4 (no separate legend button). | Layers popover |
| P1-04 | Restructure the rail to the section order and collapse defaults in 3.1/3.2, with headers People · Needs attention · Safety · Hazards · Sources. | `twinHud.js` `render` |
| P1-05 | Cap Needs attention at 5 rows (3 below 800 px tall) with "Show all {n}", and drop the duplicated initials from row names. | `.tt-needs-list`, `REASON` rows |
| P1-06 | Open nothing on entry: the hotel card appears only when the hotel is selected. | `onSelect` initial state, `#tt-card` |
| P1-07 | Relabel the hotel card: kicker "Hotel", "Building matched · OSM", SIT-06 height, "Interior unknown", with the OSM id moved to the Prototype drawer. | `page.js:95–118` |
| P1-08 | Use the trip title in the breadcrumb, add the focus segment, and make segments links per 06 §4.4. | `.tt-crumbs` |
| P1-09 | Add time zone and night chip to the clock ("21:32 local (CDT) · Night"). | `#tt-clock` |
| P1-10 | Relabel the people chip "{n} people beyond this view →" in a neutral outline, cap chips at 4 + overflow, and drop chips for items already in view. | `#tt-chips`, `info.chips` |
| P1-11 | Replace letter glyph codes with SAF category shapes (or at least remove the "C" and "GS" collisions) and run a label-collision pass on scene labels. | `twinSafety.js` `GLYPH`, label placement |
| P1-12 | Make `Esc` close an open popover before clearing the selection. | `page.js:322–329` |
| P1-13 | Bind `L`, `G`, `A`, `[` `]`, `H`, `?` and give each its visible control per section 5. | `page.js` keydown, card headers |
| P1-14 | Fix small label drifts L-14, L-15, L-16 ("discharging", HTL-05 with age, FRS-06). | Person card, Sources |

**P2: round 2 and polish**

| # | Change (one sentence) | Affected element |
|---|---|---|
| P2-01 | Build the Floors cutaway at the top of the hotel card with the four floor states and the unknown/not-shared footer. | Hotel card (R5) |
| P2-02 | Build the per-floor roster (Likely here now / Assigned here / Assigned here, not detected here) as the floor-range card. | R5 floor-range card |
| P2-03 | Add Hazards › Weather sub-group (WX-01..05) with lightning auto-on within 10 km and no blue precipitation. | Layers › Hazards, rail Hazards line |
| P2-04 | Build the Local info drawer (Emergency numbers, Hospitals, Headcount, Weather now, Elevation). | New drawer, toolbar `Local info` |
| P2-05 | Make the Units setting apply to every distance in the UI, with Metric and US only. | `twinUnits.js`, all formatters |
| P2-06 | Collapse `Local info` and `Display` to icon buttons below 1440 px wide. | Toolbar CSS |
| P2-07 | Add Plan view (north up), then enable Display › View and `P`. | Display popover |
| P2-08 | Add the 06 vocabulary entries this review introduces (WX-01..05, "Locked in Trip Twin", "{n} people beyond this view", cutaway floor-state labels, "Local info", "Display") to 06 §3. | `06-layer-taxonomy.md` |

---

## 7. Findability check and validation

**3-action check after the changes** (from the Trip Twin default view):

| Goal | Path | Actions |
|---|---|---|
| Turn floor estimates on | `L` → People ▸ → Floor estimates | 3 (2 by key) |
| Show lightning | `L` → Hazards ▸ → Weather ▸ → Lightning strikes | 3 + toggle. Auto-on when relevant, so usually 0 |
| See who is on floor 9 | Click hotel (or `H`) → floor 9 in cutaway | 2 |
| Change grid to feet | Display → Units: US | 2 |
| Find the nearest hospital | Local info → Hospitals | 2 (or the edge chip, 1) |
| Switch demo scenario | `` ` `` → Scenario | 2 (prototype only) |
| Jump to the most urgent person | `A`, or click the first Needs attention row | 1 |

**Tree test additions** to 06 §7 (≥ 70% direct success, median < 30 s, 10–15 operators):

| Task | Correct answer |
|---|---|
| T1 "Show where lightning has struck nearby." | Layers › Hazards › Weather › Lightning strikes |
| T2 "See which students are likely on floor 9." | Hotel card › Floors › 9 |
| T3 "Show distances in feet." | Display › Units |
| T4 "Find the embassy's phone number." | Local info › Emergency numbers |
| T5 "Hide the surrounding buildings." | Layers › Site › Surrounding buildings |
| T6 "Turn off the ground grid." | Display › Ground (watch how many try Layers first; the cross-reference row should catch them) |

Label check: "Local info" vs "More" and "Display" vs "View options". Run a 5-participant first-click test on both pairs before the names are final [RV-A1].

---

## 8. Assumptions

| ID | Assumption | Verify with |
|---|---|---|
| RV-A1 | "Local info" and "Display" beat "More" and "View options" on information scent | First-click test, 5 operators |
| RV-A2 | Operators want one global unit setting, not grid-only units (06 Q12 still open) | Jesse / product owner |
| RV-A3 | 10 km / 30 min is the right lightning auto-on threshold for outdoor assembly decisions | Protective-agent SME (01 owner) |
| RV-A4 | `R`, `M`, `H` and backtick are free in Justin's World View key handler and are suspended or unused outside the Twin | Justin |
| RV-A5 | Hiding unbuilt layer rows (rather than showing them disabled) is acceptable for the prototype; production shows rows only for layers that exist | Product owner |
| RV-A6 | The cutaway counts each person on their likeliest floor (middle of the band). The per-floor roster "Likely here now" uses band intersection, so its totals can exceed the cutaway count; the roster header says "estimate ±1 floor" | 03 architect, Jesse |
| RV-A7 | Selection glow is a design-review knob, not an operator setting | Jesse |

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: navigation_model
pages_mapped: 1 view (Trip Twin) · 5 containers (toolbar, Layers, Display, Local info, Prototype controls) · rail in 2 modes · hotel card with cutaway · floor-range card
nav_items: toolbar 5 · Layers 10 visible rows in 5 groups (+4 weather rows round 2) · Display 6 rows · Local info 5 sections · Prototype 9 rows · 17 key bindings
roles_covered: [org_admin, hq_staff, security_officer (view-only), sample/dev mode]
facets_defined: 7 safety categories (unchanged) + 4 weather rows
accessibility_verified: false (key map and visible-control mapping specified; not tested)
validation_plan_included: true
three_click_verified: true (on paper, section 7)
confidence: 0.8
source_artifacts: [review/shots/01-08, 06-layer-taxonomy.md, 04-screen-spec.md §2 §4 §6.3 §8.1, ROUND-2.md, gods-eye-view/twin.html, src/operations/tripTwin/{twinHud,page,twinSafety,twinSelect}.js, tripTwin.css]
-->
