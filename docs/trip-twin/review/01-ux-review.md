# Trip Twin prototype: UX review 01 (before the cleanup pass)

Date: 2026-10-15. Reviewer: factory UX designer. Read-only review: no code was changed.
Inputs: screenshots `review/shots/01`–`08`; `PROJECT-PLAN.md` (Update box), `04-screen-spec.md` §2–4, `01-operator-scenarios.md` §2, §5–7, `06-layer-taxonomy.md` §1, §3; `ROUND-2.md`; code `twin.html`, `twinHud.js`, `page.js`, `tripTwin.css` (plus `tripTwin.js`, `twinPeople.js`, `twinPaths.js` to confirm behavior).

Shot key: **01** calm default (Neighborhood) · **02** calm Building · **03** Ground popover · **04** Demo A default · **05** Demo A Building · **06** Demo A person selected (M.R.) · **07** Demo A City with simulated heat detections · **08** Demo A at 1280 × 720.

Markers: `ASSUMPTION` = my inference, with how to check. `DECIDE` = needs Jesse.

## Verdict in four lines

1. The hologram, the roster block and the floor ruler work. The look is right and the words are mostly exact.
2. The chrome around them is a prototype bench, not an operator screen. Three of the five items in the five-second read are below the fold or missing, the incident panel gives a count but not the names, and the right column overlaps itself.
3. Fixing this is mostly **moving and deleting**, not building. About 40% of the visible chrome is duplicated, belongs to development, or belongs one click deeper.
4. The model in §2 gives each phase-2 feature (cutaway, floor list, weather, keyboard map) a fixed slot, so phase 2 adds content without moving anything.

---

## 0. Experience goals (B1) used to rank everything below

| # | Goal | Pass test | Today |
|---|---|---|---|
| G1 | The five-second read needs no clicks and no scrolling at 1280 × 720 | Roster, Needs attention, rally line, hazard statement and traveler-data age are all visible on first paint at 1280 × 720 | Fail. Rally line, hazards and sources are below the rail fold in every shot (01–08). The traveler-data age appears nowhere above the fold |
| G2 | In an incident, the operator sees who is at or above the reported floor, with band and age, without clicking | Rows `M.R. · Likely floor 10 (9–11) · 40s ago` are visible in R4 | Fail. R4 shows `2` only (04, 05). The names are in the rail without band or age. Getting the band takes one click per person (06) |
| G3 | The operator can pass the priority list to the hotel in one action | One **Copy for hotel / responders** click | Fail. The control is not built, so the operator transcribes by hand |
| G4 | Each fact appears once per mode. The scene mirrors the readouts but does not repeat them as text | No text duplicates on screen | Fail. Four duplicates in incident mode (problem 3) |
| G5 | Operator screenshots never show prototype controls | Toolbar holds operator controls only | Fail. Scenario, City and Selection glow sit in the toolbar (01–08) |
| G6 | Any person can be found in ≤ 1 click plus typing | A search field or bucket list exists | Fail. There is no list and no search (flow 3) |

---

## 1. Top 10 problems, ranked by cost to the five-second read and decision speed

| Rank | Problem | Evidence | Why it costs time or truth | Fix (detail in §2) |
|---|---|---|---|---|
| **1** | **The incident panel gives the count but not the people.** `At or above reported floor 9: 2` has no rows, no band, no age, no movement and no Copy. The number also wraps onto its own line, apart from its label | 04, 05, 06, 07, 08 (wrap visible in 04, 05, 07) | This is beat 2 of Demo A, the answer the fire service needs. Today it takes 2 clicks (one per person), a camera flight per click, and reading a card in the opposite corner (06). The ±1 band and the "band unchanged 8 min" flag never appear together | R4 priority block: count on one line, then one row per person `{initials} · Likely floor {10} ({9}–{11}) · {40s} ago · {descending / band unchanged 8 min}`, then **Copy for hotel / responders** (04 E16, E25). `white-space: nowrap` on the count |
| **2** | **The rail is one long scroll, so Tier 0 falls below the fold.** The rally line, hazard statement and sources are never visible. The roster is not sticky, so it scrolls away when the operator scrolls to them. The toolbar covers the bottom attention rows | 01–08 (rail cut at "E.W. West" in 01, 04; at "A.K." in 08). `tripTwin.css` `.tt-rail { overflow-y:auto }` scrolls the whole rail | Q2 (threat) and Q5 (freshness) have no answer at a glance. Absence on screen reads as "nothing to report", which breaks 02 §2.4 ("absence is never an all-clear") | Fixed-height rail with one scroll region (the attention list). Pin a footer with the rally line and hazard line. Move traveler-data age to R1 (§2.1) |
| **3** | **Duplicates and dead text.** *Calm:* partition line `Above 0 · At or near 0 · Below 0 …` with no reported floor; floor checkbox; scenario and clock repeated in the rail head and R1; trip name differs (`Sample trip` in breadcrumb, `Spring choir tour (sample)` in rail). *Incident:* priority count shown in rail and R4; roster as a sentence in R4; "not verified" twice in R4's first two lines; REPORT form in R4 body | Calm 01, 02, 03. Incident 04–08 | Each duplicate is another place the eye must check and match. The calm partition line is about 60 characters of zeros relative to no floor, sitting where the eye goes third | Delete per the "Removed" column of §2.2 |
| **4** | **The right column has no layout contract.** The building card is open by default and drops below R4 in incident mode (04, 05, 07). At 1280 × 720 it covers R4's shelter card and floor form (08). The person card replaces the hotel card in the far bottom-right corner, about 1,200 px from the row clicked (06). The card has no close control | 01–08 (overlap in 08). `.tt-card` and `.tt-incident` are both `position:fixed` with no shared container; R4 has no `max-height` | Text the operator needs (Shelter in place, the reported-floor controls) is hidden behind building trivia (OSM way id) at the minimum supported size | One right-column flex stack with R4 above R5 and its own scroll. Below 1440 px wide, R5 replaces R4 behind a `‹ Incident` tab (04 R5 rule). Building card is not auto-opened |
| **5** | **The toolbar is mostly prototype controls, and the operator controls are missing.** Selection glow, Scenario and City take more than half its width. Layers, Legend, 3D/Plan view, More and Add reported floor do not exist. At 1280 it overlaps the rail and R4 | 01–08; overlap in 08 (bar spans x 175–1105). `twin.html` toolbar | It invites the operator to change things that are not decisions, and hides the ones that are (Plan view, anti-pattern 17). Overlap hides attention rows | Toolbar = `Building · Neighborhood · City` · `3D view / Plan view (north up)` · `Layers` · `More` · `Add reported floor`. Center it inside R3, not the viewport. Prototype controls go to a drawer (§4) |
| **6** | **The floor answer is hard to read in 3D.** Pins float at their floor height inside the glass. In perspective, M.R. (likely 10) and T.C. sit level with ruler marks 20–25 (05). Ruler bracket labels collide with ruler numbers and each other (`M.R.`, `K.V.`, `J.O.`, `A.K.` on top of `10`, `5` in 01, 02, 05, 08). At the default Neighborhood scale, the reported-floor slab cannot be seen (04, 08), yet 04 §3.2 makes the slab the first thing the eye hits in an incident. Framing a person (06) zooms so far in that the ruler and the building edges leave the frame and the slab fills the view | 01, 02, 04, 05, 06, 08. `twinPeople.js` 96–101 place the pin at `zLikely` | The fastest wrong reading a tired operator can make is the floor. The ruler is the signature visual (DJ-03), but here it reads as a label pile | On incident entry, frame at Building scale if the camera was untouched for 10 s. Draw brackets only for priority, attention and selected people (≤ 5 lanes); others get a tick. Move the caption plate to the foot of the ruler. Floor the framing distance so the whole ruler stays in view. Add cluster bubbles at Neighborhood and City scale (06 D5) |
| **7** | **Edge chips mislead and do nothing.** `{n} beyond this view` counts people beyond the mapped radius, not the viewport, so it is the same at all three scales (01, 02, 07). It includes not-current people, and it matches no roster bucket (04: `1 beyond this view` while `Away 0`). Chips are `div`s, so they cannot be clicked or focused. The fire-station and secondary-rally labels collide with the chips (02, 03) | 01–08. `tripTwin.js` 586–588; `page.js` chip builder | Answers no question as worded, and claims something about "this view" that is false | People chip = `{n} away →` (current Away only, 06 R8), as a `<button>`. Clicking it lists the Away bucket in the rail. Not-current people beyond the area already appear in Needs attention. Place chips so they avoid scene labels |
| **8** | **No way to find a person who is not in Needs attention.** There is no roster list, no clickable buckets (spec E5) and no search | All shots | Flow 3 (§3) is unbounded. It fails outright for people outside the mapped area or inside a pin cluster | `Find a person` field under the roster (`/` focuses it). Buckets are buttons that list their people in place of the attention list, with `‹ Needs attention` to return |
| **9** | **Honesty-critical slots are missing:** the official-instruction slot (HAZ-11), the stand-down line (MSG-06), the path caveat (PTH-03), path age (PTH-11), message status (MSG-01–03) and the sample watermark (E37) | 04–08; `grep` finds none in `src/operations/tripTwin/` | Without the official slot, SafeTrekr's "If the group must move" card is the only instruction-shaped text in R4. That is the authority confusion 01 doctrine 1 forbids. See §5 | Add all six. They cost one muted line each when empty |
| **10** | **Scene text bleeds through the panels, and City scale draws hazards loose.** Scene labels show through the 0.90-alpha rail: `Rally point (primary)` under R.O. and E.W. rows (04), `SIMULATED heat detection · 1h 12m ago` under T.C. and S.D. rows (07). At City scale the simulated footprints float on the empty field outside the data disc, one under the rail (07) | 04, 07 | Ghost text under decision text fails contrast (WCAG 1.4.3) and reads as a second list. A footprint off the hologram looks like it has no ground position | Panels opaque (`rgba(7,33,44,0.97)` + `backdrop-filter: blur(8px)`). Clip scene labels to R3. Clamp drawn footprints to the grid extent; beyond it, show an edge chip |

**Defects found in passing** (functional, not ranked, fix before any demo):

- ~~`twinHud.js` `createHud` destructured only three callbacks but called `onTogglePaths` and `onToggleSimFires` (ReferenceError on toggle).~~ **Fixed on disk during this review**: both are now destructured with no-op defaults. Recheck that the toggles work in the browser.
- Hotel auto-selection on arrival (`tripTwin.js` 448) opens the building card and applies the selection glow. The subject treatment (brightest edges, 04 §5) should mark the hotel; selection glow should mean "the operator chose this".
- Battery string comes straight from the fixture (`unplugged`, 06). Map it to POS-M4.

---

## 2. Progressive-disclosure model

Principle: **readout first, drawing second (06 §1.1); one place per fact; Tier 0 on screen, Tier 1 opens itself, Tier 2 sits behind one click.** Jesse's decision that people stand on their estimated floors by default (`tripTwin.js` 169, "Jesse: people on their estimated floors by default") is kept. It overrides 04 §2.2 ("Floor estimates are off"). What changes is that floor text (partition, priority) appears only when it has a reference floor.

### 2.1 Layout contract (fixes problems 2, 4, 5, 10)

| Region | Position and size | Rule |
|---|---|---|
| R1 bar | Top, 44 px | Left to right: `Exit Trip Twin` · `TRIP TWIN · Fairmont Austin · Spring choir tour` `[SAMPLE]` · breadcrumb (segments are links) · right: `{02:14} local (CDT) · Night · civil dusk {19:41}` · **traveler-data status** `Sample · {12s} ago ●` (button → Sources popover) · `?` (Keyboard shortcuts) · `Prototype ▾` (dashed, §4). The trip name is one string everywhere |
| R2 rail | Left 12 px, 340 px wide, from under R1 to above the source line. Fixed height, no outer scroll | Fixed head, sticky roster, **one** scroll region (the list), pinned footer. Opaque |
| R3 scene | Between R2 and the right column | Toolbar, chips, banner and watermark are positioned inside R3, never against the viewport |
| Right column | Right 16 px, 380 px at ≥ 1600 wide, 340 px below that. One flex column, `max-height` = R3 height, scrolls on its own | Stack order: R4 (incident) then R5 (card). Nothing in it is `position:fixed` on its own, so nothing overlaps. With R5 open at ≥ 1440 wide, R4 compresses to header + priority block. **Below 1440 wide, R5 replaces R4 and a `‹ Incident` tab returns to it** (04 R5) |
| R6 toolbar | Bottom-centre of R3, 44 px | Five groups max (§2.5). Must fit 560 px (R3 width at 1280 with R4 open) |
| R7 source line | Bottom, 24 px | Unchanged, plus watermark state. Never covered |

**Rail vertical budget at 1280 × 720** (628 px usable): head 24 · roster 198 · group lines 44 · Find field 40 · attention header 20 · footer 68 · gaps 60 = **454 fixed → 174 px list ≈ 5 compact rows (36 px)**. When the viewport is shorter than 820 px, the roster block switches to two columns (3 rows + `of N loaded`, labels unchanged). That saves about 70 px, so all 6 Demo A attention rows fit with no scroll. Compact row = `{initials} {name}` / `{reason} · {age}`.

### 2.2 Element by element

"One click" names the control and where it lives. "Removed" means deleted from that place. If the content survives, the arrow says where it goes.

| Element | CALM: visible by default | INCIDENT: visible by default | One click away (where) | Two clicks away | Removed / moved |
|---|---|---|---|---|---|
| **Roster count block** (E5) | Yes. R2 top, sticky, exact 06 §3.2 labels, `of N loaded`. Not current and Not located in amber + `warn` glyph | Yes, unchanged | Click a bucket → people in that bucket replace the attention list in R2 (`‹ Needs attention` returns). Other pins dim | Click a person in that list → R5 person card | R4's one-line roster sentence (04–08) → deleted (duplicate) |
| **Zone line** (E6) | Yes. One line `Outside group zone {1} · Unaccompanied {1} · Zone unknown {5}`. Each count is a button | Yes | Count → that list in R2 | Person → R5 | — |
| **Chaperones line** (E8) | Yes. One line, `Chaperones 3 · 1 aging · …` + `›` | Yes | `›` expands chaperone rows inline (initials, verdict, age) | Row → R5 | — |
| **Find a person** (new, flow 3) | Yes. 32 px field under the group lines, placeholder `Find a person`, `/` focuses | Yes | Type → results appear in the list region; Enter or click → frame + R5 | — | — |
| **Needs attention** (E7) | Yes. Count in header, compact rows, the rail's only scroll | Yes. At-or-above rows first (already sorted) | Row → frame + R5 person card. `[` `]` step through rows | — | — |
| **Rally line** (E9) | Yes. Rail footer: `Rally point (primary) · walk {10}–{13} min ›` | Moves to R4 "If the group must move". The rail footer keeps the hazard line only | `›` → R5 path card (PTH-01, 03, 04, 11, alternate) | Path card → `Direct group here` dialog | Rail PATHS section with checkbox and full cards → deleted. Toggle → Layers |
| **Paths in scene** (S18) | Primary path drawn | Drawn; alternate drawn if it exists | Click path → R5 path card | — | — |
| **Hazard line** (E10) | Yes. Rail footer, max 2 lines: nearest hazard headline (HAZ-02 / HAZ-08 / HAZ-10), or HAZ-07 short form `No FIRMS heat detections within 25 km · last 24 h · data {20:20 UTC}` + `› blind spots`. The full HAZ-07 sentence is in the card | Same line. Reported incident is in R4, not repeated here | Line → R5 hazard card (full HAZ-07 text with "Satellites miss fires…", HAZ-03 age, caveat level) | Hazard card → low-confidence toggle | Rail HAZARDS block with simulated-fire checkbox → checkbox to Prototype drawer (§4) |
| **Sources** (E11) | **R1 status** `Sample · {12s} ago ●` only | Same | Click → Sources popover: per-layer FRS states (traveler data, OSM buildings, paths, floor estimates, FIRMS, terrain, weather in phase 2) | Line → explanation + Retry | Rail SOURCES block → deleted. When degraded: amber R1 status **plus** one amber banner at the top of R2 (`Traveler data delayed {1m 10s}`, POS-M5), per 04 §3.1 |
| **Floor estimates** (people on floors, ruler, brackets) | On (Jesse). Ruler with ≤ 5 bracket lanes (attention + selected); other people get a tick. Caption one line at ruler foot: `Floor estimates · phone barometer · not verified · US numbering · lobby = 1` | On. Lanes: at-or-above people first, then attention, then selected (≤ 5) | Layers → `Floor estimates` toggle | — | Rail checkbox → Layers. Floating caption plate over the hotel roof (01, 02, 04, 08) → ruler foot |
| **Floor partition** FLR-12 (E17) | **Not shown.** There is no reference floor, so every bucket is meaningless | R4, under the priority rows. Each bucket is a button | Bucket → list in R2 (same mechanism as roster buckets) | — | Rail partition line (01–08) → deleted. Rail priority count (04–08) → deleted (R4 owns it) |
| **Reported floor** input (E15) | Toolbar `Add reported floor` → dialog: floor, what (smoke/fire/other), source (hotel desk/…), time defaults to now. `Session only · not sent to anyone` | R4 header `Edit` · `Remove` (each opens the same dialog / a confirm). The toolbar button is hidden | — | — | Rail REPORT form (calm) and R4 inline input + `Change reported floor` + `Clear reported floor` → deleted |
| **Reported-floor slab** (S13) | — | Yes. On entry, auto-frame at Building scale if the camera was untouched for 10 s (04 §6.6) | Click slab → R5 floor card (phase 2, 1b); until then → R4 scrolls to priority | — | — |
| **Incident panel R4** (E13–E24) | Closed | Open. Order: (1) header `INCIDENT · Hotel evacuation` + Edit/Remove; (2) official slot HAZ-11, one muted line; (3) `Reported: smoke · floor 9 · hotel desk · 02:12 · not verified`; (4) priority count + rows + **Copy for hotel / responders**; (5) partition line; (6) hotel card block (promoted, see below); (7) "If the group must move": one line per destination `Rally point (primary) · 640 m · walk 10–13 min ›` + one line `Shelter in place · an option, not a verdict ›`; (8) sticky footer: `Last message: none sent` · `Re-entry and stand-down: hotel or authorities only` · `Send alert` `Direct group here` | Destination `›` expands arrive-by arithmetic (PTH-13), caveat (PTH-03), age (PTH-11) inline | `Direct group here` → 2-step dialog | `REPORTED INCIDENT · NOT VERIFIED` kicker → deleted (line 3 says "not verified"). Roster sentence → deleted |
| **Hotel card** (chaperone check-in, E18) | Not shown (Tier 2) | R4 block (promoted for hotel evacuation): `Group floors 8, 9, 11 · chaperones on 8, 11` · `Hotel assembly point · across the street` · `Needs stair help: {A.K.}` · `Hotel card from chaperone, 18:05` | Calm: R5 hotel view (click hotel) shows it under the cutaway | — | `Needs stair help: 1` → name the person (initials). A count cannot be acted on |
| **Building card** (`GROUP HOTEL`, height, OSM id) | **Not auto-opened.** The hotel keeps its subject treatment | Not auto-opened | Click hotel in scene, or hotel name in R1 → R5 hotel view: phase-2 cutaway on top, then one line `Height ~122 m (est. from 37 levels) · Building matched` | Hover the line → `OpenStreetMap way/134786106` | OSM way id as a visible line → hover / Sources. Rename the kicker `HOTEL` to avoid a clash with "Hotel card" |
| **Person card** (E26) | On selection, R5 (right column, top when R4 is closed) with a close `×` | R5 under compressed R4 (≥ 1440 wide), or replacing R4 with `‹ Incident` (< 1440) | Card actions: `Copy`, `Show 2× accuracy`, `Possible area` | `Show recent crossings` (geofence events) | — |
| **Edge chips** (E31) | `<button>`s, max 6: `{n} away →`, then safety places beyond scale (`Relocation site 4.1 km S →`). Recomputed per scale | Same + hazard chips | Chip → scale that contains it, or the Away list for people | `Show in World View` (integration) | `{n} beyond this view` → `{n} away →` (current Away only) |
| **Legend** (E34) | Inside **Layers** popover: every layer row shows its swatch / line style and one-line meaning (06 §5.2) | Same | `Layers` (L) | — | Separate Legend button and first-entry auto-open → merged into Layers (`DECIDE`: changes 04 E34 / 06 §4.6, where Legend is `L`) |
| **Ground options** (03) | — | — | Inside Layers → `Ground` section: Show (grid / contours / both / none), Units, Grid spacing, Contour interval, relief note | — | Toolbar `Ground` button + popover → Layers. `G` cycles Show |
| **Region banner** (E30) | Only when region-level intel exists | Same | Dismiss → hazard line | — | — |
| **Sample watermark** (E37) | Yes, 7% opacity: `SAMPLE DATA · fictional people and events` | Yes | — | — | Missing today. Add it |
| **More drawer** (E35) | — | — | Toolbar `More`: emergency numbers, police, embassy, hospitals with drive time, elevation, Keyboard shortcuts | Item → R5 card | — |
| **Prototype controls** | Hidden behind `Prototype ▾` in R1 (§4) | Same | Drawer | — | Toolbar Selection glow, Scenario, City; rail simulated-fire checkbox → drawer |

### 2.3 What the calm → incident switch does, and nothing else

1. R4 opens, with the official slot first.
2. Partition and priority appear in R4. The rail does not grow.
3. Ruler lanes re-prioritize: at-or-above people first.
4. The camera frames Building scale only if the operator has not moved it in 10 s.
5. Context glass dims (α 0.12 → 0.06).
6. The rally line moves from the rail footer into R4 "If the group must move".
7. The toolbar's `Add reported floor` hides; Edit and Remove live in the R4 header.

The rail's roster, group lines, Find and Needs attention do not move. The operator's eye positions survive the switch.

### 2.4 Phase-2 slots (ROUND-2): where each lives and what it displaces

| Feature | Lives in | Opened by | Displaces | Budget and rules |
|---|---|---|---|---|
| **1. Building cutaway mini-map** | R5 **hotel view**, top of the card, above the building facts line (Jesse's placement) | Click hotel in scene; hotel name in R1; `H` (`ASSUMPTION`: new key, unused in Round-2's map) | Today's building card body shrinks to one facts line under the cutaway. In incident mode at ≥ 1440 wide, R4 compresses to header + priority (spec behavior). Below 1440, R5 replaces R4 behind `‹ Incident`. **R4 content is never pushed out** | One row per floor, 8 px minimum, label every 5th floor plus every floor that is assigned, likely occupied or reported. 37 floors ≈ 300 px, max 50% of the column. Encodings, no green and no red for status: `{2} likely here` white count; assigned, no one detected = amber dashed outline + `no one detected`; reported floor = the same red hatch as the slab; selected floor = focus ring. Never "empty", never "missing". `DECIDE`: this replaces Jesse's green/red ask with 06 F6 colors; offer the alternative in a demo. Role `listbox`; ↑/↓ moves, Enter opens the floor |
| **1b. Floor list** | R5 **floor view**, replacing the hotel view with breadcrumb `Fairmont Austin › Floor 9` and `‹` back | Calm: hotel → floor (2 clicks). Incident: click slab, R4 reported line, or a partition bucket (1 click). Scene: click a ruler floor number | Nothing new: it reuses R5 | Three stacked sections (340 px is too narrow for columns): `Likely here now {n}` (ships first, from bands); `Assigned here {n}`; `Assigned here, not detected here {n}` with the reason per person (`Floor unknown — phone has no pressure sensor`, `Last known · 34m ago`). Until a rooming list exists, the last two show `Rooming list not on file` (PRV-06), never blank. `Copy for hotel / responders` at the foot |
| **2. 3D weather** | **Layers popover**, new group `Weather` after Hazards: `Cloud cover` · `Rain` · `Accumulation` · `Lightning`, all off by default, each row with source and age badge | Layers | **Nothing by default.** When on, at most one line in the rail hazard footer, and only on a decision trigger (lightning within {10} km of the hotel or the suggested path in the last {15} min, `ASSUMPTION`: thresholds TBD with risk analyst). In incident mode, one qualifier line in the "If the group must move" destination row (`Rain {4} mm/h · {10m} ago · walk time not adjusted`) | Static, time-stamped geometry (radar frame time on the label). No particles by default: the scan line stays the only ambient motion (04 §1). Lightning = static strike glyphs with age; at most one acquire pulse when a strike falls inside the decision radius, which earns an amber hotspot. Weather layers appear in the Sources popover. Weather is rank 18 (Tier 2) in 01 §5, so it never takes rail space unless triggered |
| **4. Keyboard map** | `?` button in R1 (right). Also a link in More | `?` or click | Nothing | Modal dialog, grouped. **View:** `1` `2` `3` scales · `P` 3D/Plan · `F`/`Z` frame selection · `G` cycle ground. **Lists:** `[` `]` previous/next attention · `A` first attention item · `/` Find a person · `H` hotel view. **Panels:** `L` Layers & legend · `?` this help · `Esc` closes the top popover, then clears selection, never exits. Every key has a visible control. Keys never fire inside inputs (already true in `page.js`). **WCAG 2.1.4:** single-key shortcuts need an off switch, so put `Single-key shortcuts: on/off` in this dialog. Merging Legend into Layers removes the `L` conflict with 06 §4.6 |

### 2.5 Final toolbar and bar

- **R6 toolbar:** `[Building | Neighborhood | City]` · `[3D view | Plan view (north up)]` · `Layers` · `More` · `Add reported floor`. That is five groups, under 600 px, and 460 px with the last item hidden in incident mode. In sample mode only, `Play · Pause · Scrub` moves to the Prototype drawer, not the toolbar.
- **R1:** adds the traveler-data status, the night chip, `?` and `Prototype ▾`. It drops nothing the operator uses.

---

## 3. Operator task flows (J1), before vs after

Clicks = pointer actions. Scrolls and drags are counted separately. Pain severity 1 (minor) to 5 (blocks the decision).

### Flow 1: "Is everyone OK tonight?" (calm, 21:32, shot 01)

The screen never answers "OK" (06 §3.11). It answers **who needs attention, how old is the data, is anything reported nearby, where would they go.**

| Step | Before | Pain | After |
|---|---|---|---|
| Read the roster | Visible (0) | 1: zero-count partition text competes | Visible (0) |
| Read who needs attention | 5 of 6 rows visible; row 6 under the toolbar → 1 scroll | 3 | All 6 visible at 1600 × 900; at 720 high with the 2-column roster (0) |
| How old is the traveler data? | Not on screen; scroll the rail to SOURCES; roster scrolls away → 1 scroll | 4: Q5 unanswered | R1 `Sample · 12s ago ●` (0) |
| Anything reported nearby? | Scroll to HAZARDS → 1 scroll | 4: absence reads as clear | Rail footer hazard line (0) |
| Where would they go? | Scroll to PATHS (0–1 scroll) | 3 | Rail footer rally line (0) |
| Check one attention person | Click row (1); card top-right replaces the building card | 2 | Click row (1); card in right column with `×` |
| **Total** | **1 click + 3 scrolls**, roster lost while scrolling | | **1 click, 0 scrolls** (0 clicks for the five-second read itself) |

### Flow 2: "Fire reported on floor 9: who is at risk and where do they go?" (Demo A, 04–06, 08)

The UI says "at or above reported floor 9", never "at risk" (FLR-11 forbids it).

| Step | Before | Pain | After |
|---|---|---|---|
| See the reported floor | Neighborhood default: slab not visible (04). Click `Building` (1) | 4 | Auto-framed at Building scale on entry (0) |
| Who is at or above, with band and age | R4 shows `2` only. Names in rail without band. Click M.R. row (1) → close-up flight, card bottom-right (06); click A.K. row (1) | 5: core answer split across 3 places | R4 rows with band, age and movement (0) |
| Relay to hotel / fire service | No Copy; transcribe two cards by hand | 5: error-prone at 02:14 | `Copy for hotel / responders` (1) |
| Who else might be inside (undetermined, not current) | Rail roster + attention (0) | 2 | Same (0); partition buckets in R4 clickable |
| Where do they go | R4 assembly point, rally, shelter visible at 1600 (0). At 1280 the building card covers them; dismiss with `Esc` (keyboard only, 1) | 4 at 1280 | Visible, no overlap (0) |
| Who needs stair help | `Needs stair help: 1`, no name, not resolvable | 4 | `Needs stair help: A.K.` (0) |
| Is there an official instruction | No slot | 4: authority unclear | Official slot first in R4 (0) |
| If the floor was not preloaded | Scroll rail to REPORT, type, submit (1 scroll + 1 click) | 3 | Toolbar `Add reported floor` → dialog → submit (2) |
| **Total (preloaded)** | **3 clicks at 1600, 4 at 1280, + hand transcription; 2 questions unanswerable** | | **1 click (Copy); 0 unanswerable** |

### Flow 3: "Find one person" (e.g. L.B., not in Needs attention)

| Step | Before | Pain | After |
|---|---|---|---|
| Locate them | No list or search. Scan pins by initials. At Neighborhood they overlap (01, 04) → click `Building` (1), orbit (1–2 drags), click candidate pins (1–3) | 5: unbounded | `/` or click `Find a person` (1), type `leo`, Enter (0–1) |
| If they are outside the mapped area or Not located | Impossible: the chip is not clickable and they are not drawn | 5 | Result opens the R5 card with `Away · 2.1 km SW of hotel` or `No location reported`; no camera move for unlocated people |
| Read their state | Card bottom-right | 2 | Card in right column |
| **Total** | **2–5 clicks + 1–2 drags; fails for unplaced people** | | **1–2 actions + typing; never fails** |

---

## 4. Prototype-only controls

**Rule:** nothing that changes the world (scenario, city, simulated data, feed timing) or the look (glow style) sits in operator chrome.

| Control | Today | Move to |
|---|---|---|
| Scenario (Evening / Demo A) | Toolbar select (reloads page) | Prototype drawer |
| City (Austin / DC / London) | Toolbar select | Prototype drawer |
| Selection glow (`Aura + light pool` …) | Toolbar select | Prototype drawer, section `Look` |
| Add simulated heat detections | Rail HAZARDS checkbox | Prototype drawer, section `Simulated data` |
| Feed freeze (`?freeze`), OSM live/recorded (`?osm=live`) | URL only | Prototype drawer (keep the URL params) |
| Sample clock Play · Pause · Scrub (04 R6) | Not built | Prototype drawer, not the toolbar |
| Scenario label + sample time in rail head | Rail | Deleted. R1 clock keeps `(sample time)` |

**Drawer spec:**
- Trigger: `Prototype ▾` in R1, right of `?`. Dashed 1 px border in `--tt-text-dim`, 11 px mono. That matches the existing `.tt-sample` style, so it reads as non-product.
- Opens a 320 px popover anchored top-right, titled `Prototype controls · not part of Trip Twin`.
- Hidden entirely with `?present=1` for demos and recordings.
- Any non-default setting adds a dashed tag beside `SAMPLE` in R1 (e.g. `Simulated heat detections`), so every screenshot discloses it.
- Keyboard: no shortcut, to avoid accidental scenario reloads.

---

## 5. Honesty and vocabulary violations

| # | What | Where | Rule broken | Fix |
|---|---|---|---|---|
| H1 | Path card says `Passes within 320 m of a satellite heat detection (SW)` when the detection is **simulated** | 07 R4; `twinPaths.js` 175 | Never present simulated data as real (PRV-08); PTH-05 wording | `Closest approach to hazard: 320 m · SIMULATED heat detection` (or plain PTH-05 for real data) |
| H2 | Official-instruction slot missing, so SafeTrekr's move card is the only instruction-shaped content | 04–08 | 01 doctrine 1, rank 5; HAZ-11 must exist when empty | Add HAZ-11 line first in R4 |
| H3 | Stand-down line missing | 04–08 | MSG-06, 04 E23 | Add to R4 footer |
| H4 | Path cards lack the permanent caveat and age | 04–08; `pathCardText` | PTH-03, PTH-11, 01 §6.2 "never imply a route is safe or clear" | Add both lines to every path card and to the expanded R4 destination row |
| H5 | Calm screen shows no hazard statement and no data age above the fold | 01–03 | 02 §2.4 / 06 §3.11: absence is never an all-clear | Rail footer hazard line; R1 data status |
| H6 | `{n} beyond this view` counts the mapped radius, not the view, and includes not-current people | 01–08; `tripTwin.js` 586 | States a false fact about "this view", and implies a current location for Last-known people | `{n} away →` (current Away only) |
| H7 | Pins drawn at the likely floor inside the glass, with the accuracy disc lying on that floor | 02, 05, 06; `twinPeople.js` 96–101, 154 | 01 anti-pattern 4 ("never a dot on a floor slab"): reads as a spot in a room | Kept per Jesse, but make the band the dominant mark: range bar 3 → 4 px solid, pin head 0.5 → 0.4 scale anchored at the likely tick, disc dropped to street level (true fix position) when floors are on. `DECIDE` if Jesse prefers pins at street level with brackets only |
| H8 | Building card `Height ~122 m · from 37 levels (mapped)` mixes "est." and "mapped" | 01–05, 07, 08; `page.js` building card | SIT-06 `Height ~{122} m (est. from {37} levels)` | Use SIT-06 exactly |
| H9 | `Battery 62% · unplugged` | 06; fixture default `unplugged` | POS-M4 `Battery {62}% · discharging` | Map battery state words |
| H10 | `Needs stair help: 1` | 04–08 | Not a vocabulary word, and not actionable as a count | `Needs stair help: {initials}` |
| H11 | `Hotel's assembly point (across the street)` | 04–08 fixture | 04 S17 / 06 vocab add `Hotel assembly point` | `Hotel assembly point · across the street · from hotel card` |
| H12 | `REPORTED INCIDENT · NOT VERIFIED` kicker + `… · not verified` line | 04–08 | Not wrong, redundant. 04 E13 header is `INCIDENT · {type}` | `INCIDENT · Hotel evacuation`; keep FLR-10 line as is |
| H13 | `Rally point (secondary) · Draft · not approved` | 01, 02 scene label | SAF-21 `Draft, not approved` | Exact string |
| H14 | `SIMULATED Heat detection 0.7 km SW →` | 07 chip | HAZ-01 casing/wording | `SIMULATED heat detection · 0.7 km SW →` |
| H15 | No sample watermark | 01–08 | E37 mandatory | Add it |
| H16 | Trip named `Sample trip` in breadcrumb and footer, `Spring choir tour (sample)` in rail | 01–08 | E2: prevents acting on the wrong trip | One title string everywhere + `SAMPLE` tag |
| H17 | Calm partition `Above 0 · At or near 0 · Below 0` with no reported floor | 01–03 | FLR-12 is defined relative to a reported floor; with none, "Below 0" is noise that looks like a fact | Show the partition only when a reported floor exists |

Words checked and correct: roster labels and `of 27 loaded`, zone line, POS strings (`Last known · 2h ago`, `Did not answer a location check · Updated 51m ago`, `Capture time unknown`, `No location reported`), FLR-01 card string, FLR-10, FLR-11, PTH-01, PTH-04, PTH-13, PTH-17, `Heat detections are not fire perimeters.`. No forbidden word (safe, all clear, evacuate, missing, exact, room) was found in UI copy.

---

## 6. Inclusive interaction notes (F3)

- **Edge chips and scene items** have no keyboard path. Chips must be buttons. Every pin must be reachable through the rail (Find, buckets, attention), which this model provides.
- **Focus order:** R1 → rail (roster buckets → group lines → Find → attention list → footer) → R6 → R4 → R5. `Esc` order: popover → selection. It never exits Trip Twin.
- **Live regions:** the roster block's `aria-label` changes on every 15 s feed and is re-rendered wholesale (`twinHud.js` render). Announce only count changes, throttled to once per 30 s, via one polite region. Never re-announce the whole rail.
- **Type size:** decision text is 11 px in places (`.tt-need-why`, `.tt-small`). Set a 12 px floor for anything an operator acts on, especially at 02:00.
- **Color alone:** the amber Not current and Not located counts need a glyph or underline as well (04 §8.3).
- **Contrast:** fix the bleed-through (problem 10) before measuring. Opaque panels make 04 §5.8's measured ratios hold.
- **Reduced motion:** the camera flight on attention-row click (06) is long. Under `prefers-reduced-motion`, cut instead of fly.

---

## 7. Assumptions and decisions for Jesse

- `ASSUMPTION` A1: screenshots reflect defaults plus URL params (`scenario`, `fire=1` for 07). Floors-on in 01 is Jesse's default (`tripTwin.js` 169), not a stale localStorage value.
- `ASSUMPTION` A2: 1280 × 720 is the minimum (04 §2.1). The rail budget in §2.1 is computed for it.
- `ASSUMPTION` A3: weather trigger thresholds ({10} km, {15} min) are placeholders for the risk analyst.
- `DECIDE` D1: merge Legend into Layers (frees `L`, drops a toolbar button). This changes 04 E34 and 06 §4.6.
- `DECIDE` D2: cutaway colors. White counts, amber "assigned, no one detected", red hatch only for the reported floor, versus Jesse's green/red (ROUND-2 §1).
- `DECIDE` D3: pins on floors (Jesse's default, with H7 changes) versus pins at street level with the ruler as the only floor mark (DJ-03 purist).
- `DECIDE` D4: the hotel gets subject treatment on arrival but is not "selected" (no auto card). This changes the current harness behavior.

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: accessibility_audit
skills_used: [B1 experience goals, J1 journey mapping, I3 heuristic evaluation, C2 interaction patterns, I2 information architecture, F3 inclusive interaction design]
tokens_defined: 0
components_specified: 14
accessibility_verified: false
responsive_breakpoints: [1280x720, 1440, 1600x900, 1920x1080]
confidence: 0.85
open_questions: [D1 legend merged into Layers, D2 cutaway colors, D3 pins on floors vs street level, D4 hotel not auto-selected, A3 weather thresholds]
source_artifacts: [review/shots/01-08, PROJECT-PLAN.md, ROUND-2.md, 04-screen-spec.md, 01-operator-scenarios.md, 06-layer-taxonomy.md, twin.html, twinHud.js, page.js, tripTwin.css, tripTwin.js, twinPeople.js, twinPaths.js]
-->
