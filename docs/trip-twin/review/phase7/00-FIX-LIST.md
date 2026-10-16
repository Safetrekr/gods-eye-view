# Phase 7 fix list — streets, walkways and the Ways out view
(merged from 01-ux, 02-ui, 03-supervision, 04-ia; 16 Oct 2026; 40 findings → 14 fixes)

## The view never hides what matters
| # | Fix | Sources |
|---|---|---|
| M1 | **Ways out adds and emphasises, never hides:** it never touches Floor estimates (the reported-floor band stays), never a Hazards layer (lightning, heat, weather), never the weather time. It turns on Streets, Walkways, Surrounding buildings, Safety resources, Suggested and Saved paths and Avoid-areas, and steps the scene back (surrounding buildings faint, hotel glass to edges). | SUP F1/F2, IA L3, UX P0-1, UI P1-3 |
| M2 | **No mode chip suffix** (a red "INCIDENT · WAYS OUT VIEW" reads as an order). An in-map tag instead: "Ways out view · streets and walkways from OpenStreetMap (recorded {date}), not checked for closures, locked gates or private access · W or Esc returns"; in an incident it adds "Inside the building: follow hotel staff and the posted evacuation plan." | IA L1, SUP F5, UX P1-7 |
| M3 | **Restore only what the operator did not touch;** turning off Streets, Walkways or Surrounding buildings ends the view and keeps the rest. Layers shows a VIEWS row "Ways out (W)". | SUP F7, IA L4, UX P2-10 |
| M4 | **Esc ends Ways out last** (after popovers, editor, cards, path, floor focus, selection). Switching site keeps the view; the incident panel's move line offers "Ways out (W)"; an incident arriving re-applies the always-on set. | SUP F3/F9/F10 |

## Streets tell the truth about walking
| # | Fix | Sources |
|---|---|---|
| M5 | **Not walkable is drawn as such:** motorways/trunk, foot=no, access=private|no → a dim "no walking" class, labelled "· no walking"; tunnels, indoor and underground ways are not drawn at street level (said in the legend); bridges drawn as streets. | UX P0-2, SUP F4 |
| M6 | **Sidewalks are not separate lines** when Streets is on (`footway=sidewalk` hidden; crossings kept short); walkways solid (dashes mean uncertain or planned), dimmer and thinner than minor streets. | UX P1-4, UI P0-1/P2-10, IA L6 |
| M7 | **Paths stay on top:** blue paths get a dark casing so they read over streets. | UI P0-2 |
| M8 | **Doors:** mapped entrances drawn as door glyphs by kind (main larger), the hotel's labelled with their nearest street; the hotel card says "Mapped entrances: N (OpenStreetMap, unverified) · fire exits are not mapped" or "No entrances mapped". Never "exit". | UX P0-3, SUP F6, IA L5, UI P2-8 |
| M9 | **Steps marked** with a stairs glyph at each flight; legend "Steps". | UX P1-6, UI P2-8 |

## Look and words
| # | Fix | Sources |
|---|---|---|
| M10 | **Labels:** streets the hotel faces first; none within 60 m of the hotel; at most 12; short forms (St, Ave, Blvd, NW…); through the declutter. | UI P1-6, UX P1-5 |
| M11 | **City scale:** walkways, steps and doors fade beyond 1.5 km camera distance, alleys beyond 2 km; service roads ≥ 3:1. | UI P1-4/P1-5 |
| M12 | **Legend wording:** "Alley or service road", "Mapped entrance (OSM, unverified)", Streets note with the closure caveat, "closures, locked gates or private access", no style notes in brackets; swatches show width. | IA L8, UI P1-5 |
| M13 | **Toolbar:** Layers · Ways out · Display; pressed state with a leading square; W in the title; "Report floor" below 1440 px; the site name never truncated by the mode chip. | IA L4, UI P2-9, UI P1-7 |
| M14 | **Help:** W under L, the Esc ladder as built, "suggested and saved paths". | IA L9/L6 |

## Deferred
- Operator-entered doors and paths that start at a chosen door (UX P0-3 second half) — next round with "select any path".
- Step-free path planning (Valhalla wheelchair profile) and "step-free: not known" in path cards (UX P1-6).
- Re-capturing fixtures with `highway=path` and `indoor` / `layer` tags (UX P1-4, SUP F4) — current fixtures do not carry `path`; tunnels are recognised.
- People collapsed into one group chip in Ways out (UX P0-1) — people stay drawn (supervision: keep).
- A ring marking where mapped streets end (SUP F5) — phase 8 wider area.

## Status (16 Oct 2026, after implementation)
M1–M14 implemented. The view now turns on streets, walkways, buildings, places, suggested and saved paths and avoid-areas, fades surrounding buildings and the hotel glass, and never touches floors, hazards, weather or the weather time; leaving restores only untouched layers; turning off streets, walkways or buildings ends it with "Back to my layers". No mode-chip suffix; an in-map tag carries the OSM caveat, door count and, in an incident, "Inside the building: follow hotel staff and the posted evacuation plan."

Verification: 91 Trip Twin unit tests (new: road classes incl. no walking / tunnels / sidewalks, short names, hotel-first labels never on the hotel, door labels never "exit"); full suite 3097 tests, 3094 pass, 3 known failures (not Trip Twin); build OK; boundaries OK; QA PASS on all 9 sites; after-shots in `after/` at both sizes with zero console errors; browser checks: the reported-floor band stays in Ways out during an incident, Esc ends the view only after cards and selection.
