# Phase 12 fix list: "See it coming", revision 2

**Source:** the risk, protective, UI, supervision and IA reviews in this folder, plus Jesse's note on 16 Oct 2026: "the 3d does not look great, it's just blocks". The QA review (03-qa.md) was still running on the first build when this revision was committed. Its findings land as a follow-up.

## The 3D storm (Jesse)
- **Contour shells replace the columns.** Each rain area is traced at 30, 40, 50 and 60 dBZ, then smoothed into an organic outline. The shells nest like a terraced cloud.
- **Real height.** US shell height comes from NEXRAD echo tops (IEM `eet`), drawn at 1/8 scale. Where echo tops are missing, height follows intensity, and the note says so.
- **Rain curtains** hang under the 50 dBZ shells, with a streak texture.
- **A heavier track.** The arrow is 9 px amber under attention. It ends at the closest approach, with +15 min ticks, and the 1.5 km arrival ring labels "core over the hotel in 15–30 min".

## Method (risk review)
| Fix | Status |
|---|---|
| Exact palette decode (index × 0.5 − 32.5 dBZ); echo under 20 dBZ dropped | Done (`twinRadarPalette.js`) |
| Motion only from echo of 35 dBZ or more; unmeasured motion stated | Done |
| Cores of 4 km² or more, present in both frames | Done |
| Every core pixel projected, so a squall line is not treated as a circle | Done |
| The worst core leads, not the earliest speck | Done |
| Times counted from now and shown as a range; "within 6 mi" leads | Done (recounted every 20 s) |
| Europe: position only, no arrival time | Done |

## Surfaces (UI, supervision, IA, protective)
| Fix | Status |
|---|---|
| Big lead figure, claim, detail on the wall strip, the S4 band and the remote | Done |
| The strip no longer covers the S3, S4, S5 or S6 panels | Done |
| Walls show the strip only, never the chip | Done |
| Walls never show "Back to now"; S3 and S6 carry no timeline | Done |
| Lens line "VIEWING +30 MIN · 21:44 CDT · …" with a claim computed on the viewed grid, rounded to 5 min on every surface | Done |
| One OFFICIAL list on every surface (S3, S4, S5, rail, remote), with zone and age on every time | Done |
| Simulated alert shown as "SIMULATED (demo)", dashed and grey, never official amber | Done |
| S4 order: OFFICIAL, STORM APPROACH, OUTDOORS NOW, SENSED, AT THE HOTEL | Done |
| OUTDOORS NOW: people outside nearby with their walk time, while a core is near or arriving | Done |
| Kicker "STORM APPROACH · RADAR TRACK" (· SIMULATED in the demo) | Done |
| Lens buttons with units; the "−30 min min" toast fixed | Done |
| Layer rows "Storm shells (3D)" and "Rain map (flat)" | Done |
| Frame the storm: looks across the track, lands in the free area between panels | Done |
| Lightning: 15-min density stated with fetch age; trend only on changes of 8 km or more | Done |
| S6 strip names the trip | Done |

## Demo storm (supervision)
| Fix | Status |
|---|---|
| Drawn on top of real radar; the real line is shown under it | Done |
| Ends itself after 45 min; Return all ends it | Done (tested) |
| Starting it asks for confirmation | Done (tested) |
| Every wall badges "LIVE · DEMO STORM" | Done |
| Remote pill "SIM IN ~15", "IN ~15 MIN", "WITHIN 6 MI", "OVERHEAD", matching the big figure | Done |

## Severity colours (Jesse, after revision 2)
Shells are grey for light and heavy rain, amber for very heavy cores (50 dBZ) and hazard red for intense cores (60 dBZ, hail likely). Alert areas became a faint amber line so the cores read first. A four-step key sits above the compass, and the inspect card names the colour. Commit c355549.

## QA review (03-qa.md, tested on f54e35b)
| Defect | Status |
|---|---|
| D1 P0 demo strikes reported as real lightning, held 30 min | Fixed: SIMULATED in the rail and chip; the hold clears when the demo stops (checked headless) |
| D2 P1 dense real frames thrown away as "no data" | Fixed: only a flat fill counts as no data |
| D3 P1 starting the demo reset the lens on every wall | Fixed: walls keep the session lens; only the All-in-one checkbox starts at now |
| D4 P1 S4 hid the simulated warning | Fixed in revision 2 (one official list) |
| D5 P1 Europe projection anchored to a 65-min-old frame | Fixed: Europe is position only, no projection; "no frame for this time yet" for the gap |
| D6 approach line missing in the All-in-one when nothing approaches | Fixed: the claim leads the Storm shells note |
| D7 motion from bird echo | Fixed in revision 2 (35 dBZ and above only) |
| D8 units change lagged | Fixed |
| D9 card always in km | Fixed in revision 2 |
| D10 "reaches the hotel in now" | Fixed in revision 2 (ranges) |
| D11 far direct track read "passing 0.0 mi" | Fixed: "on a track toward the hotel, more than 2 h away"; closest approach now from the core edge (test added) |
| D12 cores cut by the box edge | Open (P2) |
| D13 state carried across a site switch | Fixed |
| D14 fetching after Exit | Fixed |
| D15 abort listener leak | Fixed |
| D16 failures cached; unbounded caches | Fixed: failures retried, one bounded cache |
| D17 lightning age was the fetch time | Fixed in revision 2 (says "fetched") |
| D18 lens words differ between walls and remote | Fixed: one rule on both |
| D19 no motion read as "beyond 60 min" | Fixed: "No motion measured · no projection ahead" |
| D20 "GMT+1" instead of "BST" | Fixed |
| D21 ticks not pickable | Fixed (ticks open the track card) |
| D22 region chosen by time zone | Open (latent with three cities) |
| D23 entity rebuild each pass | Mostly fixed in revision 2 (rebuild only on change) |

## Not done in this revision
- The rally point note "open ground · not a lightning shelter" during lightning. It needs a change in the safety-places card and is carried to the next pass.

## Verification
- Unit tests: 143 of 143 pass across all Trip Twin tests, including a new session test for the demo storm.
- Build passes. Headless run: All-in-one (arriving, near, framed, +30 lens, real radar), six walls at 2560×1440 and the iPad remote, with no console errors.
- Shots: `after/`.
