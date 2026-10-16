# Phase 6 fix list — weather in 3D and the timeline
(merged from 01-ux, 02-ui, 03-supervision, 04-ia; 16 Oct 2026; 40 findings → 16 fixes)

## Honesty first
| # | Fix | Sources |
|---|---|---|
| L1 | **US past radar loads:** IEM nests the latest time under `meta.valid` (was NaN → no past frames, blank track, false "not in yet"); every parsed time guarded. | SUP F2, UX 3, UI P0-2, IA K5 |
| L2 | **Where rain falls has five states:** covered · clear · widespread (saturated frame) · frame loading · frame missing. No particles while loading or missing — the row says so; widespread = whole site. Radar showing rain overrides a dry forecast ("type not forecast"). | SUP F1/F7 |
| L3 | **Simulated weather is simulated everywhere:** chip "all values simulated"; rain/snow one choice; SIMULATED reaches exposure / pace / brief lines; the timeline shows a disabled SIMULATED note; a scrubbed time is cleared when simulation starts. | UX P0-2, SUP F8, IA K3 |
| L4 | **Two clocks named:** top bar "sample clock" (fictional, tooltip); every weather time carries its zone and day; ticks show the day at midnight. | UX P0-1, SUP F5, IA K6 |
| L5 | **Rows follow the timeline:** the map row names the frame shown (or "loading / missing / no rain or snow in this frame"); lightning is drawn for now only (the lightning check stays live, said in the row); totals say "last 24 h to now · not on the timeline"; model run time in captions and rows. | IA K1, SUP F9 |
| L6 | **Snap back to now** on any new incident (here or elsewhere) or lightning watch, with the notice. | SUP F3 |
| L7 | **Travelers dimmed** while the weather shows another time; caption "people and incidents are shown now". | UX 7, SUP F6, IA K7 |

## Words and states
| # | Fix | Sources |
|---|---|---|
| L8 | **Row names:** Lightning · Rain & snow map · Rain & snow at the site (3D) · Clouds & haze at the site (3D) · Rain & snow totals, last 24 h. | IA K2 |
| L9 | **Chip token = time position:** Now / +3 h / −1 h / SIM (Advance: Day N hh:mm); past never shows a forecast value; mode chip "· WEATHER +3 h"; banner "WEATHER AT 13:00 CDT (+3 h) · forecast — not live". | IA K4/K7, UX 10 |
| L10 | **Advance:** an event beyond the forecast says so on the chip ("beyond the forecast range") instead of "loading". | IA K10, SUP F10, UX 10 |
| L11 | **Keys and help:** T focuses the timeline; Esc from the slider returns to now; Play does not re-announce every frame; help lists T, ← →, Esc and when the timeline shows. | UX 6, SUP F4, IA K8 |

## Look
| # | Fix | Sources |
|---|---|---|
| L12 | **Particles thin with distance** (screen-size flakes covered the site at City scale); flakes softer, `--tt-text-2` at 0.6, 3–7 px; rain the same token. | UI P0-1/P2-10, UX 9 |
| L13 | **Track readable:** segments drawn as solid (observed) / striped (model map) / outlined (site forecast) with ≥ 3:1 edges; NOW mark; 6 × 24 thumb with a ring; 24 h ahead so the past 2 h is legible; ticks never within 40 px of NOW. | UI P1-3/P1-5, UX 5 |
| L14 | **Timeline placement:** clear of the compass caption; Back to now on the caption row; only the "not live" lead is amber. | UI P1-4/P2-9 |
| L15 | **Clouds and haze:** clouds outside a 45° cone over the site, ≤ 10, dimmer; haze a soft ground glow with no edge. | UI P1-6/P1-7, UX 9 |
| L16 | **Weather chip:** compact at 1280 (source in the tooltip); the chip opens Layers › Weather. | UI P1-8, UX 8, IA K9 |

## Deferred
- Piecewise time scale for the track (UI P1-5) — 24 h range used instead.
- Timeline collapse-to-pill (IA K9).
- Weather point following the Advance event's venue rather than the site on screen (UX open question) — the site on screen is used; Advance switching site moves it.
- Particles cut per pixel on coarse model grids (SUP F9) — the row names the grid ("DWD ICON-EU ~7 km").

## Status (16 Oct 2026, after implementation)
L1–L16 implemented. Notes: the track keeps a linear scale with 24 h ahead (piecewise scale deferred); a widespread (saturated) frame fills the whole site and the row says "widespread on the map"; past times show map frames only (no forecast values, no clouds); lightning is drawn for now only.

Verification: 85 Trip Twin unit tests (new: MET steps, precipitation type and intensity, timeline kinds, honest row texts, frame URLs incl. IEM `meta.valid`); full suite 3091 tests, 3087 pass, 3 known failures (not Trip Twin); build OK; boundaries OK; QA PASS on all 9 sites; after-shots in `after/` at 1600×900 and 1280×720 with zero console errors; browser checks: Esc from the slider returns to now, T focuses the timeline, simulated snow and rain particles render, Reduce motion draws them still, US past radar / HRRR model map / London DWD map frames load.
