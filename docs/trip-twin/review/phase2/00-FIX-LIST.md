# Phase 2 fix list (merged from 01-ux, 02-ui, 03-supervision, 04-ia)

Reviewed 15 Oct 2026 against shots in `shots/` (14 states × 1600×900 and 1280×720). 59 findings → 24 fixes below. Where reviewers overlapped, the fix names all sources. Decisions already recorded (colours, no red/green on people, floor estimates on by default, 10 km lightning radius as approved) are not reopened; open questions go to Jesse at the end.

## Correctness (do first)

| # | Fix | Sources |
|---|---|---|
| F1 | **"At or above" includes every way someone can be up there.** Group = (a) current estimate at/above · (b) last estimate whose range reaches the reported floor (stopped / not-current phones; FLR-11, `lastAtOrAbove` was computed but unused) · (c) at the hotel (or last seen at the hotel) with no floor estimate and assigned at/above. Hero = whole group with a breakdown line (`2 by phone estimate · 1 by room list · 1 by last estimate`). Top line `3 may be at or above (2 by phone estimate, 1 by room list)`. "assigned at or above" when the assigned floor equals the reported one. | SUP P0-1, SUP P1 hero, UX 13 |
| F2 | **London / unverified numbering: no false zero.** When the building's floor numbering is not mapped, no at-or-above count; hero reads `Floor estimates can't be matched to the hotel's floor 9 here (floor numbering not mapped)` and everyone at the hotel is listed under "May still be in the building". Top line matches. | UX P0-1, SUP P1 |
| F3 | **"Detected" means any current range covers the floor.** Cutaway and floor card use ranges, not only the likeliest floor. Bars: white fill = most likely here; faint white = possibly here (range only); amber outline = assigned here, at the hotel, floor not known. People seen outside the hotel never turn a floor amber. Bar text names each count (`1 likely · 1 possible · 1 floor not known`). | IA P0-1, UX P0-2, UX 3, SUP P1 amber, IA 8 |
| F4 | **Floor card sections:** Most likely here · Possibly here (estimate range includes floor N) · Last estimate includes floor N (not current) · Assigned here, floor not known · Assigned here, estimate on another floor · Assigned here, not at the hotel now (collapsed). "(±1)" dropped. | IA P0-1, UX P0-2 |
| F5 | **Copy texts can't be misread as "floor clear":** absolute `as of HH:MM`, scope line `Whole group (27): …`, `Not a headcount — N people at the hotel have no floor estimate and could be on any floor.` Floor copy only offered during an incident (A-2: no calm bed-check export). | SUP P1 copy, SUP P1 timestamps, SUP P2 A-2, IA 7 |

## Layout and wayfinding

| # | Fix | Sources |
|---|---|---|
| F6 | Footer: text spans shrink with ellipsis, credits slot never shrinks; per-layer weather credits while a layer is on. | UI P0-1 |
| F7 | Floor focus during an incident: compact cutaway moves to the top of the floor card; floor card takes the space (no 58 % cap without an incident); Copy buttons sit directly under the counts in both panels. | UI P1-2, UX 4 |
| F8 | Cutaway legibility: occupied fill capped `min(0.28, 0.14 + 0.05n)`; bars 16 px full / 14 px compact, 11 px text; reported floor = solid pink tint under text, hatch only in a 28 px end cap; compact quiet floors as one block; top floor always numbered; selected ≠ keyboard focus. | UI P1-3, P1-4, P2-11, P2-12 |
| F9 | Wayfinding: one trail `World View › Trip › Fairmont Austin › Floor 8 › Name` (hotel segment is the button, phase 3 site switcher later); person opened from a floor card gets `‹ Floor 8`, Esc steps person → floor → hotel; Esc / back restore the camera from before floor focus; ↑/↓ step floors whenever a floor is focused, `[ ]` always mean attention items; "floor 9" in the incident title opens the floor card; docked cutaway gets a heading `Floors — select one to see who may be on it`. | IA 4, 5, 6, UX 7, 8, SUP P2 |
| F10 | Incident panel order: title → hero + breakdown → names → Copy → weather lines → floors. Official block holds `No official instruction about this incident on file` and the area weather alert (`Official · NWS: Wind Advisory · area weather alert · until Fri 19:00`); solid rule, not dashed (dashed = draft). NWS items called "alerts", not "warnings". | IA P0-2, UI P2-9, P2-10, SUP P2 |

## 3D

| # | Fix | Sources |
|---|---|---|
| F11 | Floor slab coloured by floor state (white / amber / pink) with 3 px edge rings 0.6 m outside the footprint; label on the side away from the ruler; flatter camera (−8°); people not on that floor's lists dimmed while a floor is focused. | UI P1-5, UX 6 |

## Weather

| # | Fix | Sources |
|---|---|---|
| F12 | Lightning rule honest: fetch the lightning image over ±(10 km + one grid cell); call it "lightning detected (8 km grid)", never "strikes"; 30-min hold after the last detection with its time; feed failure while people are outdoors says `Lightning data unavailable — outdoor check not running`. Row renamed "Lightning". | SUP P1 lightning, IA 3 |
| F13 | SIMULATED everywhere: chip (`SIM` badge, not credited to MET Norway), path-card rain allowance, copy text, 3D label at the box edge. | SUP P1 sim, UX 9, IA 10 |
| F14 | Live vs sample: chip reads `Live · 82 °F · clear · forecast 20:00 · MET Norway` in three spans; only the condition truncates. | SUP P1 live, UI P1-8, IA 10, UX 11 |
| F15 | Precip / totals render as data: upsample, 3 grey classes, dashed box edge with label, no-data / full-cover tiles dropped; rows "Precipitation now", "Rain & snow totals (24 h)", "Cloud cover (forecast)". | UI P1-6, UX 10, SUP P2, IA 3 |
| F16 | Lightning and cloud in frame: 10 km watch ring (pink dashed) around the gathering point when Lightning is on; cloud rings at 1.5 × site radius. | UI P1-7 |
| F17 | Exposure text tells the truth about its clock: `16 people outside — about 25 min since the report · feels like …`. (MET Norway does publish apparent temperature — `apparent_air_temperature` is in the recorded response — so that part of SUP's finding is not a defect.) | SUP P1 exposure |
| F18 | "the hotel assembly point"; chip and incident distances from the same reference. | IA 3, UX 12 |

## Copy, vocabulary, help

| # | Fix | Sources |
|---|---|---|
| F19 | Floor card kicker states relation (`ABOVE REPORTED FLOOR 9` / `REPORTED FLOOR · NOT VERIFIED` / `BELOW REPORTED FLOOR 9` / `FLOOR · ESTIMATES`). | IA 11 |
| F20 | Help uses "Floors" and "floor card"; cutaway hint `Select a floor to see who may be on it`. | IA 11 |
| F21 | Footer line under cutaway: `Whole group (27): floor unknown 2 · not shared 0 · last estimate only 1`. | IA 7, UX 5 |
| F22 | 06 vocabulary: add phase-2 terms and banned words. | IA 9 |
| F23 | Layers › Site grid / elevation rows get key lines pointing to Display settings; contour contrast raised. | IA 12, UI P2-15 |
| F24 | Layers popover scrolls with a visible cue at 1280. | UX 14 |

## Deferred (recorded, not built in this pass)
- Scene label collisions (fire station vs rally point; initials vs ruler) — UI P2-14, phase-1 territory, next cleanup.
- "Go to floor" field — UI P2-12.
- Phase-3 seams (place id on floor focus, weather per site, "the hotel" strings) — IA 13; done when sites land.
- Tree-test tasks T7–T12 — IA 14; with the next usability round.
- Hazards in the incident top line — SUP P2; the incident panel carries them.

## Questions for Jesse
1. Lightning radius: approved 10 km; supervision review recommends 16 km (10 mi, NWS guidance). Keep 10 km?
2. Optional "How does this hotel number floors?" prompt when numbering is not mapped (UX 1) — add in phase 3 with sites?

## Status (15 Oct 2026, after implementation)
F1–F24 implemented, except as noted:
- F7 adjusted after re-check: in the floor card the compact Floors sit **under** the roster (at the top they pushed the list below the fold at 1280).
- F11: hotel glass is not dimmed (needs a twinScene material change); people not on the focused floor's lists are dimmed instead.
- F15: no class edges drawn; 3 grey classes + upsampling + no-data drop + dashed box edge with source label.
- The 1600 "before" shots in `shots/` were overwritten by a re-capture; the 1280 "before" set is intact. All "after" captures are in `after/`.

Verification: 38 Trip Twin unit tests pass (new: stopped-phone at-or-above, London no-false-zero, floor sections, lightning grid-cell wording + 30-min hold, SIM chip); full suite 3044 tests, 3040 pass, 3 fail — the 2 known failures in Justin's code plus `devCctv.test.mjs` (macOS `/var` vs `/private/var` temp path; not Trip Twin); twin build OK; boundaries OK; QA PASS in Austin, DC, London; zero console errors across 28 after-shots; no tracked file modified.
