# Phase 11 audit: every surface before the polish pass
Captured 16 Oct 2026 from `7822a99` at the real monitor sizes: Mac Studio walls 2560×1440 (5K LG at 2×), MacBook 1728×1117, iPad remote 1180×820, laptop remote 1440×900. Shots in `before/`. Zero console errors on every page.

## What is strong
- **All-in-one** is dense and competent at both sizes: rail, floors ladder, chips, source line. The incident state reads at once.
- **Wall header grammar** is consistent: kicker, trip · site, LIVE / TODAY'S PLAN badge, the remote chip, SAMPLE mark.
- **Remote** has the Serras structure (target picker, preview, content, STATIONS rail) and the confirm/undo bar.
- **Wording and colour rules** hold everywhere checked.

## Findings, by surface
### Walls (2560×1440)
| # | Wall | Finding |
|---|---|---|
| W1 | S1 Site | Hologram is small in the centre; left two thirds of the wall is empty city wireframe. A stray amber pin (RO) sits in the bottom-left corner with no label. |
| W2 | S2 People | The top-down map shows the hotel outline and no people pins at city scale; the wall's own job (where everyone is now) is answered only by the rail numbers. Right half empty. |
| W3 | S3 Incident & attention | Duplicates S1's floors ladder; idle state is two flat panels with 40 % of the wall empty. No "what changed in the last 10 min". |
| W4 | S4 Weather & alerts | The map is a small island; the right panel is four lines of text and then nothing. Timeline at the bottom is 11 px. No radar/cloud presence at rest. |
| W5 | S5 Day plan | Checklist fills a third of its panel; no schedule timeline, no sunset arc, no saved paths shown on the map. |
| W6 | S6 Trips on watch | Three cards in the top 40 %; the rest empty. Tiles do not carry local clock, phase, or a mini-map. |
| W7 | All walls | Numerals are 28–34 px; headcounts should be the largest thing on S2/S3. Panels are flat (no glass, no depth). Nothing moves, so "LIVE" is a label, not a state. |
| W8 | All walls | Text at the wall scale is correct for 1920×1080 but reads small on 2560×1440 at 3 m. |

### Remote (iPad 1180×820, laptop 1440×900)
| # | Finding |
|---|---|
| R1 | Panels are flat and all the same weight; the rail's middle is an empty well when a station has no context list (Screens, Incident, Layers). |
| R2 | Preview is the only image on the page and sits at 16:9 in a 260 px column; the station content column dominates. |
| R3 | Mono kickers at 9–10 px are below comfortable iPad reading size. Target chips are 44 px (good) but the rail tiles' labels are 10 px. |
| R4 | No motion on station switch beyond a 0.3 s cross-blur; the rail does not stagger in; the confirm bar appears without an entrance. |
| R5 | "Screens" station: six thumbnails read as a grid of screenshots without the wall's role colour or status at a glance. |

### Entry and launch (1728×1117)
| # | Finding |
|---|---|
| E1 | The chooser is a settings dialog over a blurred twin. It should read as the start of a session. |
| E2 | The launch card is dense text: three numbered steps, two URLs, a QR, six buttons and four notes. |
| E3 | The LAN warning (amber) is correct but is the loudest element on the card. |

### All-in-one (2560×1440 and 1728×1117)
| # | Finding |
|---|---|
| A1 | At 2560 the rail and right column are the same width as at 1728, so the centre is a large field around a small hologram. A scale step for ≥ 2300 px is missing. |
| A2 | Popovers (Layers, Display) are plain lists; Display has one motion switch ("Reduce motion"). |

## Decisions this audit feeds
1. Brand direction (artifact "Trip Twin Brand Directions", Jesse's call).
2. Three-tier motion system with switches: Live · Event · Cinematic; Reduce motion overrides all.
3. Wall type scale for 2560×1440 at 3 m (table in the artifact).
4. Content fixes per wall (W1–W6) are independent of the brand direction and start first.
