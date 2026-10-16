# Trip Twin cleanup pass — merged fix list (from reviews 01–04)

Goal (Jesse): don't overwhelm; show what the operator needs, everything else one click away; keep room for phase 2 (cutaway, floor roster, weather, keyboard map).

## Kept as Jesse decided (reviewers flagged; Jesse's call stands)
- People sit on their estimated floors by default (01 D3 keeps it; 04 IA wanted floors off in calm). The floor *partition* line only appears once a floor is reported.
- The hotel is auto-selected with the aura + light pool glow on arrival (01 D4 suggested not).
- Cutaway colours (green/red vs white/amber) are deferred to phase 2 planning.

## Building now
1. **Modes + one top line** (03): MONITORING / WATCH / INCIDENT computed by `deriveMode()`; DEGRADED overlay. One sentence top line per mode; INCIDENT adds "No official instruction on file · Headcount: not reported".
2. **Needs attention grouped by reason** (03): incident groups = at or above floor (uncapped) → may still be in the building → not current → alone/outside zone → not located; calm caps at 5 with "Show all".
3. **Layout** (02): border-box; 12 px gutter; 40 px top bar; rail 320 (280 < 1440); right column 344 (304 < 1440) as ONE stack (incident, then card) so nothing overlaps; toolbar/chips/popovers live in the 3D safe area; credits inside the 22 px source line; opaque glass panels (no scene labels showing through).
4. **Controls** (04): toolbar = Building · Neighborhood · City │ Layers │ Display │ Add reported floor. Layers = the five groups with keys (legend merged in). Display = ground/units/shortcuts. Prototype drawer (` key or top-bar pill) = scenario, city, glow, simulated heat detections, OSM ids.
5. **Incident panel** (01, 03): names + floor bands for "at or above", "Copy for responders", official-instruction slot, both path cards, shelter-in-place, hotel card collapsed, "Why these numbers?" disclosure (partition + arrive-by arithmetic). No duplicates in the rail.
6. **Safe actions** (03): report input never re-rendered while typing; dismissing a desk report is two-step with a reason and Undo; no key sends or dismisses.
7. **Find a person** (01): search over all loaded people, Enter selects and frames.
8. **Honesty/vocabulary** (01, 04): FIRMS shows "updated {age} ago" not "live"; simulated detections say SIMULATED in path text; path caveat "Not checked for closures, crowds or lighting"; a path within 1 km of a heat detection is flagged "within buffer — check before use" and the alternate is listed first if clear; "outside the mapped area" not "beyond this view"; "from 37 mapped levels"; battery "not charging"; OSM ids only in the prototype drawer; person card no longer re-announces every 5 s.
9. **Type/colour** (02): Inter + Intel One Mono loaded; mono only for numbers and kickers; focus ring not green; native checkboxes/inputs restyled; shelter card neutral; ruler roof plate removed (its caveat moves to the status line).
10. **Keyboard** (04, ROUND-2 §4): F/Z frame · 1 2 3 scales · L layers · D display · G ground cycle · [ ] attention · A first exception · ? help · ` prototype · Esc closes popovers first, never exits.

## Deferred
- Camera framing to the safe area via frustum offset (02 A-2) — after phase 2 layout settles.
- Self-hosted fonts (02 A-1) — Google Fonts link for the prototype.
- Real broadcast / direct-group levers (stubs only, labelled "Prototype · not sent").
