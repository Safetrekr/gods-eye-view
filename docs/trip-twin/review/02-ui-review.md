# 02 Trip Twin: UI review (visual layer)

Reviewer: factory-ui-designer · 2026-10-15 · Read-only review of the working prototype before the cleanup pass. Includes the round-2 additions listed in `ROUND-2.md` (building cutaway mini-map, per-floor roster, 3D weather and its readout, keyboard help overlay).

Inputs read: shots `01`–`08`; reference frames `sheet_01`, `full_s_02`, `full_s_04`; `04-screen-spec.md` §1, §2, §5.1–5.2 and §5.8; `00-CONTEXT.md` "COLOR AND BRAND"; `ROUND-2.md`; `twin.html`; `tripTwin.css`; `twinHud.js`; `page.js`; and the label code in `twinPins.js`, `twinPeople.js` and `twinSafety.js`.

Assumption tags are written as **[A-n]** and collected in §7.

---

## 0. Verdict in one paragraph

The hologram is already the best thing on screen. In 01, 02 and 05 the glass, the lit hotel edges and the floor ruler look like the reference film. The chrome around it looks like a generic dark admin dashboard. It has boxy rounded panels, native selects and checkboxes, a toolbar of seven mixed controls, and the same facts printed two or three times. It also breaks at the minimum size (08): the panels collide, the toolbar covers the rail and the map credits, and the hologram gets 41% of the width.

The fix is mostly subtraction plus one structural change. Put the right-hand panels into one flex column so they cannot overlap. Constrain the toolbar and the chips to the scene's safe area. Move demo and dev controls out of the operator toolbar. Cut the duplicates. Then add a small set of "instrument" details (hairlines, corner ticks, mono readouts), each tied to a meaning. That covers Jesse's "see what they need, get to more" and leaves room for round 2.

---

## 1. Ranked visual problems

Severity: **S1** = hides or blocks an operator action or a required notice. **S2** = harms the five-second read. **S3** = polish and consistency.

Measured geometry note: every panel uses `content-box`. The real widths are the rail at 330 + 28 + 2 = **360 px** (x 12–372), the incident panel at 340 + 28 + 2 = **370 px**, and the card at **330 px**. The toolbar is about **930 px** wide and centred on the viewport (`left: 50%`). It does not know the panels exist.

| # | Sev | Problem | Where (screenshot, coordinates approximate) | Cause in code |
|---|---|---|---|---|
| 1 | S1 | **The building card covers the incident panel's actions.** At 1280 × 720 the "GROUP HOTEL · Fairmont Austin" card sits on top of the reported-floor input, **Change reported floor**, **Clear reported floor** and "Session only · not sent to anyone". They are unreadable and can't be clicked. | 08: card x 934–1264, y 532–634, over the incident panel's lower third | `.tt-card` is fixed at `bottom: 86px` whenever an incident is open (`tripTwin.css` 459–463). `.tt-incident` has no `max-height` and no overflow (434–448). Two independently fixed boxes in one column. |
| 2 | S1 | **The toolbar overlaps the rail, the right column and the map credits.** At 1600 its left end (x≈335) covers the last Needs-attention row ("E.W. Eli West / No location reported" is clipped in 01–07). At 1280 it starts at x≈175: it covers A.K.'s reason line, runs into the right column, and hides the Cesium ion logo and most of "Powered by Esri". Attribution must stay visible (spec R7, 03 §10.3). | 01–07 bottom-left; 08 bottom (credits clipped at x 1100–1180) | `.tt-toolbar { left: 50%; transform: translateX(-50%) }` (177–190). `#cesium-credits` is at `bottom: 30px` (38–54), the same band as the toolbar. |
| 3 | S1 | **The panels take the scene.** With the incident panel open, the hologram gets x 372–1214 = **842 px (53%)** at 1600 and x 372–894 = **522 px (41%)** at 1280. At 1280 the hotel, ruler and labels squeeze into a strip (08). | 04–08 | Content-box widths (above). Spec widths (R2 340, R4 380) were written for 1920 and are not scaled down. |
| 4 | S1 | **The rail is about three viewports tall and the roster scrolls away.** Below Needs attention the rail also holds PATHS, HAZARDS, the simulated-heat toggle, SOURCES and REPORT. None of these appear in any screenshot, because they are below the fold and behind the toolbar. Spec R2 says the roster block "never scrolls off screen". Here the whole rail scrolls as one. | 01–08 (rail cut at y≈865) | `.tt-rail { overflow-y: auto }` with everything in one flow (`twinHud.js` 78–243). |
| 5 | S2 | **The key number is orphaned.** "At or above reported floor 9:" wraps, and the count **2** sits alone on line 2 in the incident panel. It is the most important digit on screen during Demo A. | 04–08 right panel, y 150–185 | One 18 px mono string in a 340 px box (`.tt-priority.big`; `twinHud.js` 291–297). |
| 6 | S2 | **The same facts appear two or three times.** The priority count shows in the rail (y≈478) and in the incident hero. The roster sentence repeats inside the incident panel ("Inside (likely) 3 · At hotel, undetermined 5 · …"), on top of the rail's roster block. The clock is in R1 and again in the rail header ("Hotel fire alarm (Demo A) · 02:14 local"). The hotel name is in the title and again in the breadcrumb. "Not verified" appears in the kicker and again in the title. | 04–08 | `twinHud.js` 134–150, 280–316; `twin.html` 15–22 |
| 7 | S2 | **Scene labels collide with the chrome and with each other.** (a) The chip column covers the "Austin Fire Station Number 1" plate (02, 05, 08 show "ustin Fire Station…", "ht (secondary)"). (b) The fire-station and secondary-rally labels stack into a three-line block (01, 04). (c) The "Floor estimates · phone barometer · not verified" plate sits on the hotel roof over the people pins (01 and 04 hide the AK/NP pins; 08). (d) The initials beside the ruler collide with the floor numbers ("10 M.R.", "10A.K.↓", "5 N.P.", "1 P.N." in 04 and 08; "E.S./M.R./K.Y./J.O./A.K." in 01). (e) People pins pile up at Neighborhood and City scale (01: AK/ES/GR/JO/KW; 04; 07: JP stack). | 01, 02, 04, 05, 07, 08 | Chips fixed at `left: 388px` regardless of scene content. The floor plate is at roof height + 10 m (`twinPeople.js` 258–270). Bracket labels share `RULER_LABEL_RANGE` with the numerals, with lanes 3.2 m apart. No pin clustering. |
| 8 | S2 | **The toolbar mixes operator controls with demo and developer controls.** "Selection glow / Aura + light pool" is a tuning knob and its label wraps onto two lines. "Scenario" and "City" are demo switches. "Ground" sits apart from any Layers menu. That makes seven controls and about 930 px. | 01–08 bottom | `twin.html` 34–71 |
| 9 | S2 | **Text ghosts through panels.** Panels are 90–94% opaque with no blur, so canvas labels show through. "…point (primary)" is under the E.W. row (01). "SIMULATED heat detection · 1h 1m ago" is under T.C./S.D. (07). "MULATED heat detection · 2h 30m ago" is behind the rail's bottom-left (07). This reads as a rendering bug. | 01, 07 | `.tt-rail` background is α 0.90 (313), with no `backdrop-filter`. Camera framing ignores the panels. |
| 10 | S2 | **Color meanings are broken by chrome.** (a) The focus ring `#9fddb6` is mint green, and green is reserved for approved safety places. (b) Native checkboxes render in the OS accent blue (01–08, x≈37 y≈469), and blue means suggested path. (c) The "Shelter in place" option uses the blue path card (04–08), but it is not a path. (d) Hazard and path hexes are hard-coded in selectors (`#f299a6`, `#3b82f6`, `#93bafa`, `#2f7e48`) instead of tokens. | 01–08 | `tripTwin.css` 14, 457, 477, 491, 500, 503–504; `twinHud.js` 325–331 |
| 11 | S2 | **Control boundaries fail WCAG 1.4.11.** Input and select borders `#1e404f` on `#07212c` measure **1.5:1** (need 3:1). The "Floor" input is identifiable only by that border. Cesium credits run at `opacity: 0.75`. | 04–08 incident form | `.tt-report input`, `.tt-select select`, `.tt-row select`, `#cesium-credits` |
| 12 | S2 | **Mono is used for sentences, and brand fonts are not loaded.** The zone line, chaperone line, floor partition and card "Height ~122 m · from 37 levels (mapped)" are full mono sentences. They wrap badly ("Zone / unknown 5", 01) and read like a log. No `@font-face` or import exists for Inter or Intel One Mono, so the UI falls back to system fonts [A-1]. Scene labels hard-code `ui-monospace, Menlo`. | 01–08 rail y 377–535; card | `twinHud.js` 118–119, 151; `twinPeople.js` 245, 261; `twinPins.js` 87 |
| 13 | S3 | **Section headers come in three styles.** Rail kickers are Inter 11 px at 0.14 em ("GROUP STATUS", 01). Card and popover kickers are mono 10 px 600 at 0.12 em ("GROUP HOTEL", 01; "Ground", 03). | 01, 03 | `.tt-kicker` vs `.tt-card-kind` / `.tt-pop-title` |
| 14 | S3 | **Spacing and radii drift.** Tops are 56 (rail, chips, incident) vs 60 (card). In 01 the hotel card's top edge is 4 px lower than the rail's. Radii: panels 6, controls 4, chips 12, plates 3. Need rows are six full-bordered boxes of equal weight, which is visual noise. | 01, 04 | 235, 305–320, 389–403, 473–480 |
| 15 | S3 | **The card moves and carries developer data.** The hotel card is top-right without an incident (01–03) and bottom-right with one (04–08). It shows "OpenStreetMap way/134786106", which answers no operator question. There is no close control (Esc only). | 01–08 | `page.js` 98–118; CSS 459–463 |
| 16 | S3 | **Close-up and selection don't read well.** At Building scale (06) the reported-floor slab's fill washes about 40% of the screen pink. The selected person (Maya Ruiz) is only distinguishable by a 3 px white ring, the same weight as the amber attention rings, with nothing linking the card to the pin. | 06 | Slab fill alpha (`twinPeople.js`); selection ring `twinPins.js` 91–97 |
| 17 | S3 | **States are missing.** `.tt-btn` has no `:hover`, `:active` or `:disabled` styles. Chips have no hover or focus style. Scale buttons show state only by background (`.on`), with no `aria-pressed`. Button height is about 26 px. | all | 144–161, 473–488 |
| 18 | S3 | **Type is too small in places.** The pin role badge "T" renders at about 7–8 px on screen, and it marks the default case (traveler), so it is noise. The footer is mono 11 px. The credits are 10 px at 0.75 opacity. | 01, 02, 05 | `twinPins.js` 81–88 |
| 19 | S3 | **City scale is framed on the viewport, not the safe area.** The hologram is about 330 px across in a 1600 px screen. The second heat polygon renders under the rail (07). | 07 | Camera framing (no viewport offset) |

What already works and should be kept: the large right-aligned mono counts in the roster; the amber left tick on Needs-attention rows (shape plus color); the label plates at α 0.92 (scene text contrast holds); the lit hotel edges with the glass context; the incident panel's hazard top line; hazard chips that start with "SIMULATED" in text; and the dashed "draft" chip style.

---

## 2. Layout spec

### 2.1 Layout rules (both sizes)

1. **One gutter:** `G = 12 px` between every panel and every viewport edge.
2. **Fixed bands:** R1 bar **40 px**, top. R7 source line **22 px**, bottom. The Cesium credits move **into** the R7 band, right-aligned, so no panel can ever cover them.
3. **Three columns, never overlapping:** rail (R2) on the left, scene (R3) in the middle, right column (R-col) on the right. The R-col is **one flex column** that holds, top to bottom: incident (R4), selection module (hotel with cutaway, or person, or path card), and floor roster (round 2). Children stack. They never get their own `position: fixed`.
4. **Scene furniture lives inside the safe area.** The toolbar (R6), chips (R8), floor-estimate banner, status toast and popovers (R9) are positioned against the safe area, not the viewport.
5. **The hologram's guaranteed share.** Camera framing (fly-to, presets, incident reframe) targets the **safe area** rectangle, not the viewport. [A-2: implement with a `PerspectiveFrustum` `xOffset`/`yOffset`, or by framing the bounding sphere and then panning by half the column-width difference. Verify in Cesium.]
   - Both columns open: the safe area is at least **55% of width at 1600** and at least **50% at 1280**.
   - R-col closed: at least **75% of width**.
   - Height: at least **68%** at 720, at least **75%** at 900.
6. **Width modes:** **≥ 1440** is wide: the R-col stacks incident and selection. **< 1440** is compact: the R-col shows **one tab at a time** (`Incident · Hotel · Floor/Person`). The spec's < 1440 rule (§2.1 R5) is kept and extended to round 2.
7. **Production offset [A-3]:** inside Justin's `#ops-console` the 66 px R0 header sits above R1. Add 66 px to every `top` value. At 720 tall that leaves 568 px for the rail (3 attention rows visible, not 4). The tables below are for the standalone `twin.html`.

### 2.2 1600 × 900

| Region | x | y | w × h | Behaviour |
|---|---|---|---|---|
| R1 bar | 0 | 0 | 1600 × 40 | Exit · `TRIP TWIN` kicker · hotel name · breadcrumb (trip only, no repeated hotel) · weather readout (≤ 280 px) · clock · `Demo ▾` (prototype only) |
| R2 rail | 12 | 52 | **320 × 814** | Fixed head and roster. Needs list scrolls internally. One "More" disclosure at the bottom. No other content |
| R-col | 1244 | 52 | **344 × 814** | Flex column, gap 12 (see 2.4) |
| Safe area (R-col open) | 344–1232 | 118–790 | **888 × 672** (55.5% × 75%) | Camera frames the subject here |
| Safe area (R-col closed) | 344–1588 | 118–790 | 1244 × 672 (77.8%) | |
| R8 chips | 344–1232 | 52 | ≤ 2 rows, max 54 px | Horizontal wrap row. Overflow becomes the "+n beyond view" chip |
| Floor-estimate banner | centred in safe area | bottom 86 | ≤ 640 × 24 | Only while floor estimates are on (replaces the roof plate) |
| R6 toolbar | centred in 344–1232 | bottom 34 | ~620 × 40 | `Building · Neighborhood · City │ Layers · Legend │ Add reported floor │ ?` |
| R9 popovers | anchored to their toolbar button, clamped to the safe area | above toolbar + 8 | Layers 320, Legend 300; max-h = toolbar top − 64 | Layers holds Ground, Floor estimates, Paths, Heat detections, Weather (round 2) |
| Keyboard help (round 2) | centred on safe area | — | **560 × ≤ 600**, 2 columns | `?` key or toolbar `?` |
| Status toast | centred on safe area | 52 (over the chips row) | ≤ 480 × 32 | Transient |
| R7 + credits | 0 | 878 | 1600 × 22 | Text left, credits right (≤ 300 px) |

### 2.3 1280 × 720 (minimum)

| Region | x | y | w × h | What collapses |
|---|---|---|---|---|
| R1 bar | 0 | 0 | 1280 × 40 | Breadcrumb hidden. Weather readout shows **1 item + "+n"** (≤ 160 px). Clock drops "(sample time)" for a `SAMPLE` tag |
| R2 rail | 12 | 52 | **280 × 634** | Same blocks. Needs list shows 4 rows + "+n more" (scrolls). Zone and chaperone lines become one line each with ellipsis, full text in the disclosure |
| R-col | 964 | 52 | **304 × 634** | **Tabbed**: 32 px tab strip + 590 px panel, one panel visible. The incident tab keeps a 2 px hazard top line and the priority number in the tab label (`Incident · 2`), so the incident is never out of sight |
| Safe area (R-col open) | 304–952 | 118–610 | **648 × 492** (50.6% × 68%) | |
| Safe area (R-col closed) | 304–1268 | 118–610 | 964 × 492 (75.3%) | |
| R8 chips | 304–952 | 52 | ≤ 2 rows | Text shortens to `{glyph} {distance} {bearing}`, with the label on hover and in the aria-label |
| R6 toolbar | centred in 304–952 | bottom 34 | ~580 × 40 | "Add reported floor" becomes "Report floor" |
| Layers popover | anchored, clamped | above toolbar | 300 × ≤ 520 | Scrolls |
| Keyboard help | centred | — | **520 × ≤ 600** | 2 columns of 250 |
| R7 + credits | 0 | 698 | 1280 × 22 | Source text in sans 11 px. "Grid: 50 m · bold lines 250 m" moves into a scale bar in the scene (bottom-left of safe area), so the line fits beside the credits |

### 2.4 R-col contents (z-safe stacking), including round 2

All heights are max values. Every child has `min-height: 0; overflow-y: auto`, so the column can only shrink its children. It can never overlap them.

**Wide (≥ 1440), 814 px tall:**

| State | Stack (top → bottom) |
|---|---|
| Nothing selected, no incident | R-col empty and hidden. The safe area extends to the right edge |
| Hotel selected (round 2) | **Hotel module**: header 44 (kicker + name + ×) · **cutaway strip ≤ 240** · facts ≤ 96. Then **Floor roster** (after a floor click) `flex: 1`, min 200, scrolls |
| Person or path selected | Card, ≤ 360, scrolls |
| Incident only | Incident full height, scrolls internally. Actions footer is sticky at the panel bottom |
| Incident + any selection | **Incident collapses to its summary**: kicker, one-line title, hero readout. That is ≤ 136 px with a `Show incident ▾` toggle (spec §2.1 R5 rule). The selection stack goes below. Example for Demo A: summary 136 + 12 + hotel module (header 44 + cutaway 200) 244 + 12 + floor roster 410 = 814 |

**Compact (< 1440), 634 px tall:** tabs 32, then one of:

- **Incident:** full, scrolls, sticky actions footer.
- **Hotel:** header 44, then a 220 px row with the **cutaway as a left strip (80 px)** beside the facts. This keeps the "cutaway with the card" relationship and saves about 200 px of height. Jesse asked for the cutaway *above* the card; at 1600 it is above, at 1280 it sits beside **[A-4]**. Then the floor roster `flex: 1` (≈ 326), scrolls.
- **Person:** card, scrolls.

**Cutaway strip spec (round 2):**
- Floors stack vertically, one bar per floor. Bar height = `clamp(3px, (stripH − (n−1)·1px) / n, 8px)`. For 37 floors in 240 px that is 5 px bars with 1 px gaps (221 px).
- Above 60 floors, use focus + context: floors with people, assignments or a report get 8 px; the others get 2 px.
- Floor numbers are mono 10 px at every 5th floor and at every flagged floor, in a 22 px gutter on the left.
- Hit target: the full strip width. Hover shows a plate: "Floor 9 · 2 likely here · 4 assigned". Keyboard: ↑/↓ moves the floor focus, Enter frames that floor. This meets WCAG 2.5.8 through the equivalent keyboard and list controls, because 5 px rows are below 24 px.
- Encoding (no green or red on people, see §4 and §6): see §4 item 8.

**Floor roster (round 2):** three collapsible groups, in this order:

1. "Likely here now" (count): ships first, needs only floor bands.
2. "Assigned here, not detected here" (count), with the reason per row ("Floor unknown · no pressure sensor", "Last known 34m ago").
3. "Assigned here" (count).

Rows use the list-row component (§3.3). Never use the word "missing".

### 2.5 Z-order (one scale, top first)

| z | Layer |
|---|---|
| 50 | Modal dialogs (Send alert, Direct group, Add reported floor) |
| 40 | Keyboard help overlay (focus-trapped, Esc closes) |
| 35 | Status toast |
| 30 | R9 popovers (Layers, Legend, Demo) |
| 25 | Cesium credits (inside the R7 band, so nothing reaches them) |
| 20 | R1 bar, R2 rail, R-col, R6 toolbar, R7 band |
| 15 | Loading veil (covers the scene, not the chrome) |
| 10 | R8 chips, floor-estimate banner, scale bar |
| 1 | Sample watermark (7% opacity, below all chrome; it is 2 today) |
| 0 | Cesium canvas (label plates live here) |

Rule: **no two elements in the same z band may share screen area.** The layout in 2.2 and 2.3 guarantees that for bands 10 and 20. Popovers are clamped to the safe area, so they cover only the scene, never a panel.

### 2.6 Wireframes

```
1600 × 900, Demo A, incident + hotel selected + floor 9 clicked (round 2)
0  12            332 344                                         1232 1244            1588
┌───────────────────────────────────────────────────────────────────────────────────────┐ 0
│[Exit] TRIP TWIN Fairmont Austin  World View › Spring choir tour   ☂ RAIN 2.1 mm/h · ⚡ 14 km SW   02:14 CDT [Demo▾] │
├───────────────────────────────────────────────────────────────────────────────────────┤ 40
│┌RAIL 320────────┐ [Hospital 1.7 km N→][Police 660 m NE→][Embassy…→][Relocation…→][1 away→] ┌R-COL 344────────┐│ 52
││GROUP STATUS    │                                                         │▔▔▔▔▔ hazard ▔▔▔▔ ││
││Spring choir…   │                                                         │REPORTED · NOT VERIFIED│
││Inside (likely) 3│                                                        │Smoke · floor 9   ││
││At hotel, und.  5│              SAFE AREA 888 × 672                       │2  at or above 9  ││ ≤136
││Outside, nearby16│              hotel framed at centre                    │   Show incident ▾││
││Away            0│                                                        ├──────────────────┤│
││Not current     2│                                                        │GROUP HOTEL  ×    ││
││Not located     1│                                                        │Fairmont Austin   ││
││of 27 loaded     │                                                        │▏37 ▭▭▭▭          ││
││─────────────────│                                                        │▏   ▭▭▭▭ cutaway  ││ ≤240
││NEEDS ATTENTION 06                                                        │▏ 9 ▨▨▨▨ ◀ report ││
││▍MR Maya Ruiz 4m │                                                        │▏ 1 ▭▭▭▭          ││
││▍  At or above 9 │                                                        ├──────────────────┤│
││▍AK Aron Kim  40s│                                                        │FLOOR 9           ││
││ … scrolls …     │   [FLOOR ESTIMATES · PHONE BAROMETER · NOT VERIFIED]   │Likely here now 2 ││ flex
││─────────────────│        [Bldg|Nbhd|City │Layers│Legend│Add reported floor│?] │Assigned, not det.││
││More ▸ zone · chaperones · sources                                        │ …scrolls…        ││ 866
│└────────────────┘                                                         └──────────────────┘│
├───────────────────────────────────────────────────────────────────────────────────────┤ 878
│Sample · fictional people · © OpenStreetMap contributors (ODbL) · Terrain Re:Earth…   [Cesium ion][Esri]│ 900
```

```
1280 × 720, Demo A, incident open, hotel tab selected
0 12          292 304                               952 964            1268
┌───────────────────────────────────────────────────────────────────────┐ 0
│[Exit] TRIP TWIN Fairmont Austin        ⚡ 14 km SW +2   02:14 CDT SAMPLE │
├───────────────────────────────────────────────────────────────────────┤ 40
│┌RAIL 280──────┐ [✚1.7 km N→][⛉660 m NE→][+3]     ┌R-COL 304───────┐│ 52
││roster 6 rows  │                                  │[Incident·2][Hotel][Floor 9]│ 32 tabs
││NEEDS ATTN 06  │      SAFE AREA 648 × 492         │GROUP HOTEL  ×  ││
││ 4 rows        │                                  │┌80┐ facts      ││ 220
││ +2 more       │                                  ││▭▭│ Group floors││
││More ▸         │   [Bldg|Nbhd|City│Layers│Legend│Report floor│?]  │└──┘ 8, 9, 11   ││
│└───────────────┘                                  │floor roster…   ││ 646
├───────────────────────────────────────────────────────────────────────┤ 698
│Sample · © OpenStreetMap contributors (ODbL) · Terrain…   [Cesium][Esri]│ 720
```

### 2.7 Rail contents after the cut ("see what they need, get to more")

Visible by default:

1. Head: `GROUP STATUS` kicker + trip title. The scenario and clock lines are removed because R1 already shows the clock.
2. Roster block (6 count rows + "of 27 loaded").
3. Needs attention (scrolls).

Collapsed into one `More ▸` disclosure at the bottom of the rail, each as a one-line summary that expands inline:

- **Zone**: "1 outside · 1 unaccompanied".
- **Chaperones**: "3 · 1 aging".
- **Floors** (only while estimates are on, no incident): "15 estimated · 9 unknown".
- **Sources**: degraded = amber summary line, promoted to always-visible while degraded.

Moved out of the rail:

| Item | New home |
|---|---|
| Floor-estimate toggle, paths toggle, simulated-heat toggle, Ground | Layers popover |
| Hazard summary | One rail line only when a hazard is in range ("Heat detections · 2 within 5 km ▸"). Otherwise silent; the "none within 25 km" text moves to Layers → Heat detections |
| Report floor | Toolbar ("Add reported floor") when no incident; R4 footer ("Edit floor", "Clear") during an incident |
| Floor partition and "At or above reported floor 9" | R4 only, during an incident |

---

## 3. Type, spacing and component spec

### 3.1 Type scale (root 16 px; Inter = `--tt-font`, Intel One Mono = `--tt-mono`)

| Token | Size / line | rem | Family · weight | Use |
|---|---|---|---|---|
| `--tt-t-hero` | 32 / 32 | 2.0 | Mono 500, tabular | One hero readout per panel: the priority count; the roster total on a future SOC wall |
| `--tt-t-count` | 20 / 24 | 1.25 | Mono 600, tabular | Roster counts, section counts |
| `--tt-t-title` | 15 / 20 | 0.9375 | Inter 600 | Card name, incident title, hotel name in R1 |
| `--tt-t-body` | 13 / 18 | 0.8125 | Inter 400; 600 for names | Row labels, sentences |
| `--tt-t-meta` | 12 / 16 | 0.75 | Inter 400, `--tt-text-dim` | Reasons, secondary lines, select text |
| `--tt-t-num` | 12 / 16 | 0.75 | Mono 400, tabular | Ages, distances, floors, times inside sentences or right-aligned values |
| `--tt-t-kicker` | 11 / 14 | 0.6875 | Mono 500, uppercase, letter-spacing 0.12em, `--tt-text-dim` | **All** section headers (rail, card, popover, R1 "TRIP TWIN") |
| `--tt-t-micro` | 11 / 14 | 0.6875 | Inter 400 | R7 source line, chip text in compact mode. **Floor: no UI text below 11 px** (Cesium credit text excepted) |

**Mono vs sans rule:** mono only for numerals with units (counts, ages, distances, times, floors, coordinates) and for kickers. Sentences are always Inter, even when they contain numbers. Example: "Height **~122 m** · from **37** levels (mapped)" is an Inter sentence with mono spans.

Scene label plates (canvas) follow the same rule:
- Ruler numerals: `500 11px "Intel One Mono"`.
- Initials and place labels: `600 11px Inter`.

Load the fonts. Today there is no `@font-face` [A-1]. Self-host Inter (400/500/600) and Intel One Mono (400/500/600) as woff2 under `public/fonts/`, with `font-display: swap`, and call `document.fonts.ready` before the first Cesium label is created so canvas labels get the brand face.

### 3.2 Spacing and shape

- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 px (`--tt-s-1` … `--tt-s-6`).
  - Panel padding is 12 vertical, 14 horizontal.
  - Between sections: 16. Inside a section: 8. Inside a row: 4.
  - Gutter G is 12.
- **Radii:** panels **4**, controls, chips and plates **3**. The 12 px pill and 6 px panel radii go; the angular shape matches the film and the 3 px scene plates.
- **Lines:** 1 px hairline `--tt-border #1e404f` for structure. Control boundaries use `--tt-edge-ctl #80959b`, which measures **5.3:1** on `#07212c`, against 1.5:1 for `#1e404f`.
- **Target size:** controls are **32 px** tall (WCAG 2.5.8 floor is 24); list rows are 44 px.

### 3.3 Components

| Component | Spec |
|---|---|
| **Rail section header** | Height 24, `display:flex; justify-content:space-between; align-items:baseline`. Left: kicker (`--tt-t-kicker`). Right: zero-padded count in mono 11/14 600 `--tt-text` ("06"). 1 px `--tt-border` hairline below, 8 px gap to content. Sections are 16 px apart. |
| **Count row** | Height 28, grid `1fr auto`. Label `--tt-t-body` `--tt-text`; count `--tt-t-count` right-aligned, `min-width: 3ch`. Count is **zero**: count and label take `--tt-text-dim`, so non-zero rows stand out. **Warn** bucket non-zero (Not current, Not located): amber count plus a 2 × 12 px amber tick at the row's left edge (shape as well as color). The block has hairlines top and bottom and no box. "of 27 loaded" is `--tt-t-num` dim, 4 px below. |
| **List row (needs attention)** | `<button>`, min-height 44, padding 6 10 6 12, no box. Left 3 px `--tt-attention` bar, 1 px `--tt-border` bottom hairline, transparent background. Line 1: 22 px initials disc (1.5 px `--tt-text-2` ring, mono 10/600; it matches the pin, so the eye links row and pin) + name Inter 13/600 + right-aligned age `--tt-t-num` dim ("34m"). Line 2: reason `--tt-t-meta`, clamped to 2 lines. Hover: bg `rgba(42,74,89,.45)`. Focus-visible: 2 px `--tt-focus` inset outline. Selected: bg `--tt-secondary #123646` plus a white 1 px outline. Drop the duplicated "R.O. Rory Owen" text; the disc carries the initials. |
| **Path card** | Container: bg `rgba(18,54,70,.45)`, left 2 px `--tt-path #3b82f6`, radius 0 3 3 0, padding 8 10. Kicker "SUGGESTED · UNVERIFIED". Title Inter 13/600 `--tt-path-text #93bafa` ("Rally point (primary)"). Readout row in mono 12: `640 m · 10–13 min`. Then "Arrive-by **32 min**" with the breakdown "12 prepare + 13 walk + 7 buffer" in `--tt-t-meta`. Warnings ("Passes within 320 m of a satellite heat detection") on their own line in `--tt-hazard-text`, prefixed with a ◆ glyph. **Option cards that are not paths** (Shelter in place) use the same shape with a `--tt-edge-ctl` left bar, never blue. |
| **Chip (R8)** | `<button>`, height 24, padding 0 10, radius 3, bg `rgba(6,26,35,.92)`, 1 px border in the meaning color at full strength. Text Inter 12/500 in the meaning's text token; distance and bearing in mono. Leading 12 px category glyph, trailing "→". Meanings: approved safety `--tt-safe-text #81bf95` / border `#2f7e48`; draft `--tt-text-dim` dashed; people `--tt-text` / `--tt-ring`; hazard `--tt-hazard-text` / `--tt-hazard`. Hover bg `rgba(42,74,89,.6)`; focus ring as buttons. |
| **Toolbar button** | Height 32, padding 0 12, radius 3, Inter 12/500. Default: transparent bg, `--tt-text-2 #b8c3c7` text, no border inside the bar (the bar has the frame). Hover: bg `rgba(42,74,89,.5)`, text `--tt-text`. Active (pressed): bg `--tt-muted`. **On** (`aria-pressed=true`): bg `--tt-secondary`, text `--tt-text`, plus an **inset 2 px bottom bar `--tt-text`** (shape, not only fill). Disabled: opacity .45, `cursor:not-allowed`. Focus-visible: 2 px `--tt-focus` outline, offset 2. The scale buttons form one segmented group: 1 px `--tt-border` outer frame and 1 px internal dividers. |
| **Toggle** | Replaces native checkboxes (which render OS blue). `role="switch"`, row height 32, label Inter 13 left, track at right 28 × 16, radius 8. Off: transparent track, 1 px `--tt-edge-ctl` border, 10 px thumb `--tt-edge-ctl`. On: track `--tt-text-2` fill, thumb `--tt-field`. **Never green or blue.** Sub-label (source honesty, e.g. "phone barometer · not verified") goes beneath in `--tt-t-meta`. Interim fix: `accent-color: #b8c3c7`. |
| **Card (R5 / hotel / person)** | Panel shell (§4 frame), padding 12 14. Header: kicker + close × (24 × 24 button, top-right). Title `--tt-t-title`. Facts as a definition grid `auto 1fr`: label `--tt-t-meta`, value `--tt-t-num` or `--tt-t-body`, row gap 4, **max 5 rows**. Anything else (OSM id, provenance) goes behind a `Details ▸` disclosure. |

---

## 4. "Sci-fi but purposeful" polish (low cost, SafeTrekr tokens only)

Taken from the film frames: thin hairline frames with **corner brackets**; one or two **large thin numerals** as anchors ("096", "93", "48"); labels tied to objects by **leader lines**; big negative space around one centred object; almost no filled boxes. Each idea below states its purpose. If the purpose doesn't hold, drop the idea.

1. **Corner-tick frames on live panels.** 8 px L-ticks in `--tt-edge-ctl` at the four corners of the rail, the R-col panels and the toolbar. The panel body is a hairline `--tt-border`, so the ticks give the shape. *Purpose:* ticks mean "bound to live data". When the traveler feed is stale (`ctx.delayed`), the ticks turn `--tt-attention` and dash. This is the "light means time" rule (spec §1) carried into the chrome. Cost: pure CSS gradients (§5).
2. **Glass panels that stop ghosting.** `rgba(7,33,44,.86)` plus `backdrop-filter: blur(10px) saturate(1.1)`. *Purpose:* the scene behind stays legible as context, while canvas labels can no longer read through (problem 9). The dark tint keeps every text pair at or above 6.8:1. [A-5: measure FPS; if it drops below 30 on target hardware, fall back to α .94 with no blur.]
3. **One hero numeral per panel, in mono.** In R4: **`2`** at 32 px with "at or above reported floor 9" beside it, never wrapping. In the rail, the roster counts stay at 20 px. *Purpose:* the film's anchoring numerals, used only for the number the operator must act on.
4. **Count-change pulse.** When a roster or priority count changes, the number gets a 1 px outline that fades over 600 ms. *Purpose:* draws the eye to change, without color. `prefers-reduced-motion`: no animation, and the count's underline stays for 10 s instead.
5. **Selection reticle and leader.** The selected pin, floor or building gets four corner brackets (`--tt-text`, 2 px, 10 px legs; a canvas billboard). A hairline leader runs from the reticle to the R-col card's left edge (one SVG line in a `pointer-events:none` overlay, updated on `postRender`). *Purpose:* answers "which thing is this card about?" Today that is guessable only from a ring of the same weight as the attention rings (06).
6. **Feed-age hairline under R1.** A 1 px line across the bottom of the bar. Its length drains from full (fresh) to empty at the stale threshold, then it turns amber and the label reads "Stale · 6 m". *Purpose:* data freshness at a glance (Q-"how current is this?"). It replaces a text-only age.
7. **Directional edge chips.** Chips sit on the safe-area edge that matches their bearing (N on top, E right, etc.), each with a chevron pointing off-screen. This is the costlier option, but it fixes problem 7a for good. *Purpose:* direction without reading. Interim: the horizontal chips row (§5).
8. **Cutaway strip as an instrument (round 2).** Hairline floor bars, mono floor ticks every 5, and a "◀ 9" pointer at the reported floor. Encoding by shape and token, with no green and no red on people:
   - **Likely occupied:** solid `--tt-text` at 60%.
   - **Assigned, not detected:** amber `--tt-attention` hollow bar with a dashed outline. It means "needs an operator decision", the amber meaning.
   - **Assigned and detected:** solid white plus a 2 px white tick at the right end (assignment confirmed).
   - **Reported floor:** `--tt-hazard` hatched bar. The hazard color applies to the floor geometry, not the people.
   - **Group floors from the hotel card:** a 2 px `--tt-edge-ctl` bracket on the left gutter.

   A one-line legend sits under the strip. This answers Jesse's "green if kids are on them, red if they are supposed to be but are not" while keeping his own color rule; see §6 C1.
9. **Scale bar and north tick** at the safe area's bottom-left: a 1 px bar with mono "50 m" and a small N arrow. *Purpose:* reading distance. It frees R7 from the grid sentence at 1280.
10. **Weather readout (round 2) as a mono strip in R1.** Show only non-zero, decision-relevant items, in this order: lightning distance (nearest strike to the hotel or rally point, `--tt-hazard-text` when ≤ threshold), precipitation rate, gusts. 3D weather defaults off.
    - Cloud layer at α ≤ 0.15, above the hotel roof, so it never covers people.
    - Lightning flash ≤ 200 ms, **≤ 1 flash per second**, and smaller than 10% of the viewport. This meets WCAG 2.3.1 (three flashes).
    - With reduced motion: a static strike glyph and a timestamp.
    - A strike within threshold of an assembly point adds a hazard chip ("Lightning 6 km SW →").
11. **Keyboard help overlay (round 2).** A panel shell with corner ticks, 2 columns, `kbd` caps in mono 11/500 with a 1 px `--tt-edge-ctl` border and a 2 px bottom border (a key-cap shape). Grouped as View · Selection · Layers · People. *Purpose:* discoverability of `F`, `[`/`]`, `G`, `L`. The visible toolbar `?` button meets the "every shortcut has a visible control" rule.
12. **Kicker counts zero-padded** ("NEEDS ATTENTION 06"). *Purpose:* fixed-width counts don't jitter as they change. It gives the "01 COLLABORATION" look, with a count instead of decoration.

Things **not** to add: animated scan grids on panels, glitch effects, decorative rotating rings, or color glows on chrome. None of them answers a question, and they would compete with the one motion the spec allows (the scan line means "feed live").

---

## 5. Exact CSS changes for the top fixes (`src/operations/tripTwin/tripTwin.css`)

Apply in this order. Line numbers refer to the current file. Two small DOM changes are needed (marked **DOM**); everything else is CSS.

### 5.1 Tokens and layout variables: extend `:root` (lines 2–20)

```css
:root {
  /* existing tokens unchanged, except: */
  --tt-focus: #eff7f3;            /* was #9fddb6 (green family; green is reserved) */
  /* added, all from 04 §5.1–5.2 */
  --tt-secondary: #123646;
  --tt-text-2: #b8c3c7;
  --tt-edge-ctl: #80959b;         /* control boundary, 5.3:1 on #07212c */
  --tt-hazard-text: #f299a6;
  --tt-path: #3b82f6;
  --tt-path-text: #93bafa;
  --tt-safe-edge: #2f7e48;
  --tt-panel: rgba(7, 33, 44, 0.86);
  /* layout */
  --tt-g: 12px;
  --tt-bar-h: 40px;
  --tt-foot-h: 22px;
  --tt-tool-h: 40px;
  --tt-rail-w: 320px;
  --tt-rcol-w: 344px;
  --tt-top: calc(var(--tt-bar-h) + var(--tt-g));      /* 52 */
  --tt-bottom: calc(var(--tt-foot-h) + var(--tt-g));  /* 34 */
  --tt-safe-l: calc(var(--tt-g) * 2 + var(--tt-rail-w));
  --tt-safe-r: calc(var(--tt-g) * 2 + var(--tt-rcol-w));
  /* z scale (04 §2.1 order) */
  --tt-z-mark: 1; --tt-z-sceneui: 10; --tt-z-veil: 15; --tt-z-panel: 20;
  --tt-z-credits: 25; --tt-z-pop: 30; --tt-z-toast: 35; --tt-z-help: 40; --tt-z-modal: 50;
}
@media (max-width: 1439px) {
  :root { --tt-rail-w: 280px; --tt-rcol-w: 304px; }
}
/* R-col closed: the safe area runs to the right edge */
body:not(:has(.tt-incident:not([hidden]))):not(:has(.tt-card:not([hidden]))) {
  --tt-safe-r: var(--tt-g);
}
.tt-bar, .tt-rail, .tt-rcol, .tt-incident, .tt-card, .tt-toolbar,
.tt-pop, .tt-chips, .tt-chip, .tt-sources, .tt-need, .tt-btn {
  box-sizing: border-box;
}
```

### 5.2 Right column: stop the overlap (fixes 1, 15)

**DOM:** wrap the two right-hand panels in one container.
- `twin.html`: add `<div id="tt-rcol" class="tt-rcol"></div>` and move `<aside id="tt-card">` inside it.
- `twinHud.js` `createHud`: `document.getElementById('tt-rcol').prepend(incident)` instead of `root.append(incident)`.

The round-2 cutaway and floor roster go between them, in that order.

Replace `.tt-card` (232–242), `.tt-incident` (434–448) and the `:has` rule (459–463):

```css
.tt-rcol {
  position: fixed;
  top: var(--tt-top);
  right: var(--tt-g);
  bottom: var(--tt-bottom);
  width: var(--tt-rcol-w);
  display: flex;
  flex-direction: column;
  gap: var(--tt-g);
  z-index: var(--tt-z-panel);
  pointer-events: none;            /* empty column never blocks the scene */
}
.tt-rcol > * {
  pointer-events: auto;
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.tt-card {
  position: static;
  width: auto;
  padding: 12px 14px;
  background: var(--tt-panel);
  border: 1px solid var(--tt-border);
  border-radius: 4px;
}
.tt-incident {
  position: static;
  width: auto;
  padding: 12px 14px;
  background: var(--tt-panel);
  border: 1px solid var(--tt-border);
  border-top: 2px solid var(--tt-hazard);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* Incident + selection: incident collapses to its summary (04 §2.1 R5) */
.tt-rcol:has(> .tt-card:not([hidden])) > .tt-incident {
  flex: none;
  max-height: 136px;
}
.tt-rcol:has(> .tt-card:not([hidden])) > .tt-incident
  > :not(.tt-kicker:first-child, .tt-incident-title, .tt-priority) {
  display: none;
}
.tt-rcol:has(> .tt-card:not([hidden])) > .tt-incident > .tt-incident-title {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
```

At < 1440 the tabbed mode needs a 32 px tab strip and a `data-tab` attribute (JS). CSS: `.tt-rcol[data-tab='incident'] > :not(.tt-rcol-tabs, .tt-incident) { display: none }`, and the same for `hotel` and `person`. Until the tabs exist, the collapse rule above already prevents overlap at 1280.

### 5.3 Rail: width, glass, internal scroll (fixes 3, 4, 9, 14)

Replace `.tt-rail` (305–320) and add:

```css
.tt-rail {
  left: var(--tt-g);
  top: var(--tt-top);
  bottom: var(--tt-bottom);
  width: var(--tt-rail-w);
  padding: 12px 14px;
  background: var(--tt-panel);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
  backdrop-filter: blur(10px) saturate(1.1);
  border: 1px solid var(--tt-border);
  border-radius: 4px;
  z-index: var(--tt-z-panel);
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;                /* was auto: the roster must never scroll away */
}
.tt-rail > * { flex: none; }
.tt-rail > .tt-needs {
  flex: 1 1 0;
  min-height: 96px;
  display: flex;
  flex-direction: column;
}
.tt-needs-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  gap: 0;
  margin-top: 8px;
}
```

Interim, until PATHS, HAZARDS, SOURCES and REPORT move to Layers and R4 (§2.7): wrap them in `<details class="tt-rail-more"><summary>More</summary>…</details>` (**DOM**, in `twinHud.js` 186–276), and add `.tt-rail-more { max-height: 40%; overflow-y: auto }`. The same blur and background go on `.tt-card`, `.tt-incident`, `.tt-toolbar`, `.tt-pop` and `.tt-bar` (replace the `rgba(7,33,44,.94)` and `blur(6px)` values at 112–115, 186, 238, 268, 440).

### 5.4 Toolbar, chips, popover, credits, footer (fixes 2, 7a, 8, 11)

Replace `.tt-toolbar` (177–190):

```css
.tt-toolbar {
  left: var(--tt-safe-l);
  right: var(--tt-safe-r);
  bottom: var(--tt-bottom);
  width: max-content;
  max-width: calc(100vw - var(--tt-safe-l) - var(--tt-safe-r));
  margin-inline: auto;             /* centres inside the safe area */
  transform: none;
  height: var(--tt-tool-h);
  padding: 4px;
  gap: 4px;
  flex-wrap: nowrap;
  background: var(--tt-panel);
  backdrop-filter: blur(10px) saturate(1.1);
  border-radius: 4px;
  z-index: var(--tt-z-panel);
}
.tt-select { white-space: nowrap; }  /* interim: stops "Selection / glow" wrapping */
```

Then move `#tt-glow`, `#tt-scenario` and `#tt-city` (**DOM**, `twin.html` 52–70) into a `Demo ▾` popover opened from R1. Fold `Ground` into a `Layers` popover. Until then, add `@media (max-width: 1439px) { .tt-toolbar .tt-select { display: none } }` so 1280 cannot overflow.

Replace `.tt-chips` (464–472) and `.tt-chip` (473–480):

```css
.tt-chips {
  left: var(--tt-safe-l);
  right: var(--tt-safe-r);
  top: var(--tt-top);
  flex-direction: row;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px;
  max-height: 54px;                /* 2 rows; overflow becomes the "+n" chip in JS */
  overflow: hidden;
  pointer-events: none;
  z-index: var(--tt-z-sceneui);
}
.tt-chip {
  pointer-events: auto;
  height: 24px;
  padding: 0 10px;
  font: 500 12px/22px var(--tt-font);
  color: var(--tt-green-text);
  background: rgba(6, 26, 35, 0.92);
  border: 1px solid var(--tt-safe-edge);
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}
.tt-chip:hover { background: rgba(42, 74, 89, 0.6); }
.tt-chip:focus-visible { outline: 2px solid var(--tt-focus); outline-offset: 2px; }
.tt-chip.hazard { color: var(--tt-hazard-text); border-color: var(--tt-hazard); } /* line 502 */
```

Ground and Layers popover, `.tt-pop` (261–272): keep `bottom: calc(var(--tt-bottom) + var(--tt-tool-h) + 8px)` (= 82) and set `z-index: var(--tt-z-pop); max-height: calc(100vh - var(--tt-top) - var(--tt-bottom) - var(--tt-tool-h) - 24px); overflow-y: auto; border-radius: 4px;`. Replace `left: 50%` with the safe-area centre: `left: calc((var(--tt-safe-l) + 100vw - var(--tt-safe-r)) / 2)`, keeping `translateX(-50%)`.

Credits into the footer band (38–54, 71–73, 211–226):

```css
#cesium-credits {
  right: var(--tt-g);
  bottom: 0;
  height: var(--tt-foot-h);
  max-width: 300px;
  z-index: var(--tt-z-credits);
  opacity: 1;                      /* was .75; attribution stays at full contrast */
  color: var(--tt-text-dim);
}
#cesium-credits img { max-height: 14px; }
.tt-sources {
  height: var(--tt-foot-h);
  padding: 0 calc(var(--tt-g) + 312px) 0 var(--tt-g);   /* leaves room for credits */
  gap: 14px;
  font: 400 11px/var(--tt-foot-h) var(--tt-font);         /* sans: shorter line */
  white-space: nowrap;
  overflow: hidden;
  z-index: var(--tt-z-panel);
}
.tt-sources span { flex: none; }
```

Remove the `mono` class from `<footer id="tt-sources">` (`twin.html` 107). Move the grid sentence into the scene scale bar (§4 item 9).

### 5.5 Bar (fix 6)

At 102–143:
- `.tt-bar { height: var(--tt-bar-h); gap: 12px; z-index: var(--tt-z-panel); }`
- `.tt-clock { font: 400 12px/1 var(--tt-mono); }`
- `@media (max-width: 1439px) { .tt-crumbs { display: none; } }`
- In `twin.html` 20–21, drop the trailing `› <span id="tt-crumb-hotel">` (the hotel name already sits in the title).

### 5.6 Type unification (fixes 12, 13)

```css
.tt-kicker, .tt-card-kind, .tt-pop-title {          /* 123–127, 246–251, 276–281 */
  font: 500 11px/14px var(--tt-mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--tt-text-dim);
  margin: 0;
}
.tt-card-name { font: 600 15px/20px var(--tt-font); margin: 2px 0 8px; }  /* 252 */
.tt-card-line { font: 400 12px/16px var(--tt-font); }                     /* 257 */
.tt-line { font-size: 12px; line-height: 16px; }                          /* 354 */
.tt-rail-trip { font: 600 15px/20px var(--tt-font); margin-top: 4px; }   /* 321 */
```

Then remove `mono` from sentence elements:
- `twinHud.js` 118 (zone line), 119 (chaperone line), 151 (partition text), 216 (FIRMS status line), 242 (source lines).
- `page.js` 105 and 113 (card height and id).

Wrap only the numeric spans in `<span class="mono">`.

### 5.7 Roster, need rows, hero readout (fixes 5, 14)

```css
.tt-roster { border: 0; border-block: 1px solid var(--tt-border); border-radius: 0; padding: 4px 0; } /* 331 */
.tt-roster-row { height: 28px; align-items: center; font: 400 13px/18px var(--tt-font); padding: 0; } /* 336 */
.tt-roster-row .tt-count {
  font: 600 20px/24px var(--tt-mono);
  font-variant-numeric: tabular-nums;
  min-width: 3ch;
  text-align: right;
}
.tt-roster-row.zero, .tt-roster-row.zero .tt-count { color: var(--tt-text-dim); } /* JS adds .zero */
.tt-roster-row.warn:not(.zero) { box-shadow: inset 2px 0 0 var(--tt-attention); padding-left: 8px; }

.tt-need {                                            /* 389–403 */
  min-height: 44px;
  padding: 6px 10px 6px 12px;
  border: 0;
  border-left: 3px solid var(--tt-attention);
  border-bottom: 1px solid var(--tt-border);
  border-radius: 0;
}
.tt-need:hover { background: rgba(42, 74, 89, 0.45); }   /* 404–408 split */
.tt-need:focus-visible { outline: 2px solid var(--tt-focus); outline-offset: -2px; }
.tt-need-who { font: 600 13px/18px var(--tt-font); }
.tt-need-why {
  font: 400 12px/16px var(--tt-font);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Hero readout (370–380). DOM: render
   <div class="tt-priority big"><span class="tt-hero-num">2</span>
   <span class="tt-hero-label">at or above reported floor 9</span></div> */
.tt-priority.big {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  column-gap: 12px;
  padding-left: 10px;
  border-left: 2px solid var(--tt-hazard);
}
.tt-hero-num { font: 500 32px/32px var(--tt-mono); font-variant-numeric: tabular-nums; color: var(--tt-text); }
.tt-hero-label { font: 400 13px/18px var(--tt-font); color: var(--tt-text-2); }
```

Remove the rail copy of the priority line (`twinHud.js` 134–150) and the roster sentence inside R4 (316). Both are duplicates.

### 5.8 Buttons, inputs, toggles, color meanings (fixes 10, 11, 17)

```css
.tt-btn {                                             /* 144–161 */
  height: 32px;
  padding: 0 12px;
  font: 500 12px/1 var(--tt-font);
  color: var(--tt-text-2);
  background: transparent;
  border: 1px solid var(--tt-border);
  border-radius: 3px;
  transition: background-color var(--tt-dur-short) var(--tt-ease-standard),
              color var(--tt-dur-short) var(--tt-ease-standard);
}
.tt-btn:hover { background: rgba(42, 74, 89, 0.5); color: var(--tt-text); }
.tt-btn:active { background: var(--tt-muted); }
.tt-btn.on, .tt-btn[aria-pressed='true'] {
  color: var(--tt-text);
  background: var(--tt-secondary);
  border-color: var(--tt-edge-ctl);
  box-shadow: inset 0 -2px 0 var(--tt-text);
}
.tt-btn:disabled, .tt-btn[aria-disabled='true'] { opacity: 0.45; cursor: not-allowed; }
#tt-exit { border-color: var(--tt-edge-ctl); color: var(--tt-text); }
.tt-toolbar .tt-btn { border-color: transparent; }
.tt-btn:focus-visible, select:focus-visible, input:focus-visible,
summary:focus-visible, .tt-chip:focus-visible {
  outline: 2px solid var(--tt-focus);
  outline-offset: 2px;
}
.tt-select select, .tt-row select, .tt-report input {  /* 204–210, 291–298, 425–432 */
  height: 32px;
  border: 1px solid var(--tt-edge-ctl);                /* 5.3:1, was 1.5:1 */
  border-radius: 3px;
  background: var(--tt-card);
  color: var(--tt-text);
  font: 400 12px/1 var(--tt-font);
}
.tt-report input::placeholder { color: var(--tt-text-dim); }
.tt-body input[type='checkbox'] {                      /* interim until the switch */
  accent-color: var(--tt-text-2);
  width: 16px;
  height: 16px;
}
.tt-path-card {                                        /* 489–496 */
  border: 0;
  border-left: 2px solid var(--tt-path);
  border-radius: 0 3px 3px 0;
  background: rgba(18, 54, 70, 0.45);
  padding: 8px 10px;
  margin-top: 0;
  font: 400 12px/16px var(--tt-font);
}
.tt-path-title { font: 600 13px/18px var(--tt-font); color: var(--tt-path-text); } /* 497–501 */
.tt-kicker.hazard { color: var(--tt-hazard-text); }    /* 456–458 */
```

Give the shelter card `class="tt-path-card tt-option"` (**DOM**, `twinHud.js` 325–331) and add `.tt-path-card.tt-option { border-left-color: var(--tt-edge-ctl); }`.

### 5.9 Z-index pass

| Element | Line | New value |
|---|---|---|
| `#tt-watermark` | 100 | `var(--tt-z-mark)` |
| `#tt-veil` | 80 | `var(--tt-z-veil)` |
| `.tt-status` | 171; also replaces the `z-index: 6` at 87 | `var(--tt-z-toast)`; `top: var(--tt-top)`; `left: calc((var(--tt-safe-l) + 100vw - var(--tt-safe-r)) / 2)` |
| `.tt-pop` | — | `var(--tt-z-pop)` |
| `.tt-bar`, `.tt-sources`, `.tt-rail`, `.tt-rcol`, `.tt-toolbar` | — | `var(--tt-z-panel)` |

### 5.10 Panel frame with corner ticks (polish item 1)

```css
.tt-rail, .tt-card, .tt-incident, .tt-toolbar, .tt-pop {
  --tick: var(--tt-edge-ctl);
  background-image:
    linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick)),
    linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick)),
    linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick)),
    linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick));
  background-size: 8px 1px, 1px 8px, 8px 1px, 1px 8px, 8px 1px, 1px 8px, 8px 1px, 1px 8px;
  background-position: 0 0, 0 0, 100% 0, 100% 0, 0 100%, 0 100%, 100% 100%, 100% 100%;
  background-repeat: no-repeat;
  background-color: var(--tt-panel);
  background-origin: border-box;
}
body[data-feed='stale'] :is(.tt-rail, .tt-card, .tt-incident) { --tick: var(--tt-attention); }
```

`page.js` sets `document.body.dataset.feed = ctx.delayed ? 'stale' : 'live'`. Note: this rule sets `background-color`, so drop the `background:` shorthands in 5.2–5.4 and keep `background-color: var(--tt-panel)` only.

### 5.11 Scene-label values (JS, not CSS; listed so the cleanup does them together)

| Fix | File:line | Change |
|---|---|---|
| Ruler initials clash with numerals | `twinPeople.js` 329–336 | Bracket-label `distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 600)` (Building scale only) [A-6]. Keep numerals at `RULER_LABEL_RANGE`. Add `pixelOffset: new Cesium.Cartesian2(6, 0)` and `horizontalOrigin: LEFT` |
| Roof plate covers pins | `twinPeople.js` 258–270 | Remove the entity. Render the DOM banner `.tt-scene-banner` (z 10, bottom `calc(var(--tt-bottom) + var(--tt-tool-h) + 8px)`, centred in the safe area, kicker type) |
| Fonts on plates | `twinPeople.js` 245, 261, 329; `twinSafety.js` 119; `twinFires.js` 145; `twinPins.js` 70, 87 | `'500 11px "Intel One Mono", ui-monospace, monospace'` for numerals; `'600 11px Inter, ui-sans-serif, sans-serif'` for names and places |
| "T" badge noise | `twinPins.js` 80–88 | Draw the role badge only for chaperones ("C") |
| Pin pile-ups | people data source | `EntityCluster` with `pixelRange: 24`, `minimumClusterSize: 3`. The cluster disc shows the count in mono, with an amber ring if any member is in Needs attention |
| Stacked place labels (fire station + R2) | `twinSafety.js` 118–131 | One line at Neighborhood ("Fire station · Draft"), full text at < 600 m. Add `pixelOffset` stagger (0, −22 / 0, −40) when two places are within 30 m |
| Slab wash at close range (06) | reported-slab material | Fill alpha ≤ 0.10, keep the hatch and solid edges, and add `translucencyByDistance` so the fill fades below 150 m [A-6] |

---

## 6. Conflicts to flag

- **C1. Cutaway colors vs Jesse's rule.** ROUND-2 says "green if kids are on them, red if they are supposed to be but are not". That conflicts with "green only for approved safety places; never red or green on people" (00-CONTEXT, 06 F6 / DJ-02). Recommendation: the encoding in §4 item 8 (white = likely occupied, amber hollow = assigned not detected, hazard hatch = reported floor only). Jesse should confirm.
- **C2. The spec gives green to a people state.** 04 §5.2 lists `--tt-safe-text` for "muster 'present'". Muster status is about people, so it should be white with a check glyph, not green. Recommend amending §5.2.
- **C3. Sizes vs spec.** The spec's R1 is 44 px, R2 340, R4 380 (at 1920). This review uses 40 / 320 / 344 at 1600 and 40 / 280 / 304 below 1440, so the hologram keeps at least 50% of the width at 1280. That is a deliberate deviation; please amend 04 §2.1.
- **C4. Spec R6 lists 3D/Plan, Layers, Legend, More and Add reported floor.** This review keeps Layers, Legend, Add reported floor and `?` in the bar, folds Plan view and More into Layers, and adds a prototype-only `Demo ▾` in R1. The bar fits 580–620 px, under the 648 px safe width at 1280.

---

## 7. Assumptions

- **[A-1]** Fonts. There is no `@font-face` or font import for Inter or Intel One Mono in `twin.html`, `tripTwin.css` or `page.js`. The screenshots show system fallbacks (SF / Menlo-like glyphs). Verify in DevTools (Computed → Rendered fonts).
- **[A-2]** Cesium has no built-in viewport padding. An off-centre frustum (`PerspectiveFrustum.xOffset`) or a post-framing pan is assumed workable. Verify that picking still works with the offset.
- **[A-3]** The screenshots are the standalone `twin.html` with no R0 header. In production, add 66 px to all tops.
- **[A-4]** The side-by-side cutaway at < 1440 is a proposal against Jesse's literal "above the card"; above-the-card is kept at ≥ 1440.
- **[A-5]** `backdrop-filter` over a continuously rendering WebGL canvas has a GPU cost. Measure; fall back to α 0.94 with no blur if FPS drops below 30.
- **[A-6]** The 600 m and 150 m distance thresholds are estimates from the shot framings (Building ≈ 300–500 m camera range; Neighborhood > 700 m). Tune on the real camera presets.
- **[A-7]** Toolbar widths (~580–620 px) are estimated from Inter 12 px glyph widths in the screenshots, not measured.
- **[A-8]** Contrast values not already in 04 §5.8 were computed with the WCAG 2.x formula: `#9aa8ac` on `#07212c` = 6.8:1; `#1e404f` on `#07212c` = 1.5:1; `#365462` = 2.1:1; `#80959b` = 5.3:1; `#b8c3c7` = 9.2:1; `#f59e0b` = 7.8:1. These are on the opaque card colour; translucent panels over bright glass will measure slightly lower, which is a reason for the 0.86 tint + blur rather than less.
