# Phase 11 fix list: polish pass (Instrument, motion tiers, walls, remote)
Merged from 01-ux, 02-ui, 03-supervision, 04-ia, 05-motion and 06-brand on 16 Oct 2026: 123 findings, merged into 28 fixes. Decisions where the reviews differed are first.

## Decisions
- **Idle drift stays.** UX and the motion review asked for it to go (P6 "the operator owns the camera"). Jesse approved drift on 16 Oct as a Cinematic-tier behaviour with a switch. Decision: it stays, with the supervision and motion limits added (D1–D3 below), and 05 §4.2/§6.4 are amended to record the approved exception.
- **Motion group position.** IA: under 06 Layers but at the bottom as `Display · Motion`, not between Scale and the layers. Decision: moved to the bottom; labels only promise what exists.
- **"No incident" has one name.** The HUD's "No incident reported" wins; the S3 board and the remote say the same, and name the trip.
- **S3's left column.** It repeated S2's rail. Decision: S3 left = the top line plus Needs attention only; the people counts live on S2 (and in the S3 board's one count strip).
- **The light is one value**: `#eef5f3`. `#eff7f3` and `#e3e7e9` leave the CSS and the engine.

## Must fix (P0)
| # | Fix | Sources |
|---|---|---|
| F1 | **Banned phrase.** "0 (not an all-clear)" becomes "none in the last pass · newest {age} ago · FIRMS". | IA P0, UX P0-3 |
| F2 | **Drift is bounded.** A `stopDrift()` runs synchronously before every site switch, frame, scale, spotlight and report; the 60 s idle clock restarts on each. Drift also stops while the link is stale, the remote is offline, or a report is open on any trip on watch. Drift eases: heading = h0 + 10°·(1 − cos 2πt/125 s), peak 0.5°/s, so it starts from rest and returns to the operator's heading; roll and pitch untouched. The chip says "· drifting"; the remote's card and preview say "drifting · idle camera". | MOT P0-2, SUP P1-2/3/4, UX P0-1 |
| F3 | **Incident band motion.** Enters at 320 ms on the enter curve, opacity and translateY only, never a transform that could fight the band's layout. | MOT P0-1 |
| F4 | **Red at rest.** "Add reported floor" on the All-in-one dock is steel until a floor is reported, then red. | BRAND P0, UI P2 |
| F5 | **Rosters never cut mid-line.** Wall rails fade at the bottom edge; the incident card's name list is capped at six on a wall with "+N more on the roster". The official slot and the path stay above the fold on the incident board. | UI P0-1, UX P0-2 |
| F6 | **S4 compass caption** clears the timeline panel. | UI P0-2 |
| F7 | **Preview strip.** The remote draws the role and badge in a strip above the snapshot, not over the wall's own header; the placeholder keeps the overlay. | UI P0-3, SUP P1-5, BRAND P1-11 |
| F8 | **Empty glass.** S3 board gains PEOPLE BY SITE and a count strip; S5 gains a right panel with the day's schedule and sunset; S6 tiles carry a 2×2 count grid under the clock. | UI P0-4, UX W4/W5/W6 |

## Walls (P1)
| # | Fix | Sources |
|---|---|---|
| F9 | S3 left column is Needs attention only (no duplicate people counts); the group list is no longer cut after two people. | IA P1, UX P1 |
| F10 | "No incident reported · {trip}" everywhere; the board's open state reads "INCIDENT REPORTED · NOT VERIFIED". | IA P1 |
| F11 | Inter never above 28 px after the wall scale: wall lines, toplines and roster labels use `calc(28px / var(--wall-scale))`; card names and toplines move to Manrope 300. | BRAND P1-5/6, UI P1 |
| F12 | The dot grid is a fixed overlay above the canvas and below the panels, so it shows on every wall, not only where the canvas is inset. | BRAND P1-4, UI P1 |
| F13 | The live dot stops while the wall is STALE or the remote is offline (`tt-stale`). | MOT P1, SUP P1-3 |
| F14 | ~~The sweep animates `transform` only, peaks at α 0.2, and never runs on walls without 3D.~~ Superseded: Jesse removed the sweep on 16 Oct ("get rid of the horizontal line moving up the screen"). | MOT P1 |
| F15 | PEOPLE kicker carries "as of {sample clock}"; the S3 change log says its clock basis ("sample clock · data every 5 s"). | IA P0-2, SUP P1-15 |
| F16 | Old ramp out of the scene: pins fill with the card colour and ring with the light; grid minor and context lines use `#415e6b`; dim text `#7f949b`. | BRAND P1-7/8/9 |
| F17 | S6 clocks say which city they are local to; the incident line carries its age. | IA P1, UX P1 |

## Remote (P1)
| # | Fix | Sources |
|---|---|---|
| F18 | Motion group at the bottom of 06 Layers as `Display · Motion`; labels: Live "live dot, the snapshot sweep", Event "count highlights, a band entering", Cinematic "fog-in panels, idle drift on Site: stops on any touch, never during an incident". | IA P1, MOT P1 |
| F19 | The rail's middle holds the target's card when a station has no list: role, mode, pinned, motion tiers, link age, what the wall is doing (hands-on, drifting). | UX P1, SUP P1-7, UI P1 |
| F20 | View-only: write controls dim and the header says "View only"; "In control · this iPad" when it is you. | UX P1, SUP P1-9/10 |
| F21 | Station switch shows the new content at once (no fog-out before content); the fog-in stays. | MOT P1 |
| F22 | Header reads trip · org · site, matching the walls; target chips carry their role under the number. | IA P1 |
| F23 | The remote names an incident on any trip on watch: the Incident tile gets its pill and the Trip rows a "reported" tag when another trip has a report. | SUP P1-1, UX P1 |

## Entry (P1)
| # | Fix | Sources |
|---|---|---|
| F24 | The entry veil is the field colour at 94 % with saturate(0), so the card never opens over an olive globe. | BRAND P1-2, UI P1 |
| F25 | The launch card shows which slots are already held (from presence) and marks the setup token as single-session. | SUP P1-11, P2 |

## Docs
| # | Fix |
|---|---|
| F26 | 05-motion-language §4.2 and §6.4 record the approved idle drift and its limits; §9 inventory lists the three tiers. |
| F27 | 06 §18 role names updated (People, Day plan); §19 already records Instrument. |
| F28 | The brand page rules (06-brand "Rules for the brand page") copied into 06 §19.5. |

## Deferred (recorded, not built this phase)
- Echo at the old fix, selection reticle, identify pulse, static "+n at hh:mm:ss" deltas (MOT P1): canvas work for the motion phase that follows.
- Cross-wall incident cascade timed to the report's server time (MOT signature moment).
- The SafeTrekr mark placed as an asset on the entry card (BRAND P1-3): the app's wordmark files are PNGs with an .svg extension and need re-export first.
- Scene labels scaled by the wall scale (BRAND P1-10, UI P1): Cesium label sizing per role.
- A shared feed clock across walls so sweeps and dots are in phase (MOT P1); phase 10 already deferred the clock push.
- Reduce motion per wall from the remote (MOT P2); session log of tier changes, drift start and stop, hands-on, tokens (SUP P1-14): with the audit log in 07.
- Remote wavefront only when the rail opens (MOT P1): kept on station change for now.
- S5 tick boxes and the green approved row (UI P1): the checks are the operator's on the All-in-one; the wall shows review state only.
- Sample NWS advisory expiring before the sample clock (IA P1): fixture data.


## Status (16 Oct 2026, after implementation)
Built: F1–F24 as listed, with these notes:
- **F2:** drift stops synchronously before site switches, frames, scale changes, spotlights and reports, and while the link is stale, the remote is offline, or a report is open on any trip on watch; eased profile as specified.
- **F8:** S3 board gained the count strip and PEOPLE BY SITE; S5 gained the right panel (schedule, sunset, official); S6 tiles carry the three-count grid. The tiles still leave room between the counts and "Next", which is where phase and official alerts go when the data exists.
- **F17:** the S6 clock says LOCAL; the hotel is named on the line above (the city name is the hotel's in the sample data). The incident line's age is on the tile's data line.
- **F25:** not built this phase (held slots on the launch card): the launcher already shows "open on another computer" once a screen joins.
- **F26–F28:** written (05 §11, 06 §19.5–19.6).

Deferred items stand as listed above.

**Verification**
- 134 Trip Twin and relay unit tests pass (two new: the per-screen motion field with pins and field-level undo; tier classes with Reduce winning; the fire-summary wording test updated).
- After-shots in `after/` at 2560×1440 (walls), 1728×1117 and 2560×1440 (All-in-one), 1180×820 and 1440×900 (remote): zero console errors on all pages.
- Headless check of the All-in-one: tiers Live and Event on, Cinematic off, Reduce off; the sweep element present; roster numerals in Manrope.
- Not captured in stills: the confirm/undo bar, hands-on, drift start and stop. Checked by code path and the phase 10 undo run; a scripted run of target → action → confirm → undo on the iPad size is the first item of the next phase's verification.
