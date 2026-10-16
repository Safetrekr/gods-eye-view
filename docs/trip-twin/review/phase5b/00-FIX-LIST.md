# Phase 5b fix list — units, framing, labels, Go to floor, incident switch, selected-place glow
(merged from 01-ux, 02-ui, 03-supervision, 04-ia; 16 Oct 2026; 40 findings → 14 fixes)

Built in 5b (Jesse): Display › Units changes every distance on screen; grid spacing and contour interval under Layers › Site; framing in the panel-free area; 3D label declutter; Go to floor; a question before leaving the site of a live incident; the selected place glows on the map (halo, larger glyph, glowing beacon and ring, bright label, chip lit).

| # | Fix | Sources |
|---|---|---|
| K1 | **No unit leaks:** the path reason, the Layers legend and the heat edge chip, and the Advance path line, are built at render time. Sensor resolutions (375 m pixel, 8 km grid cell) stay as published and Display says so. | UI P0-1, UX P1-3, SUP F1, IA F1 |
| K2 | **Framing counts the left rail** (fixed panels were skipped); zoom-out cap 2.4× so 1280 fits. | UX P0-1, UI P1-4, SUP F7 |
| K3 | **Floor-tied labels never slide:** person initials and the Floor N tag are fixed; place glyphs and the side panels are obstacles; labels slide sideways into the free area; a label with no free slot is hidden instead of overprinting. | UX P0-2, P2-9; UI P1-3; SUP F6; IA F9 |
| K4 | **The incident question can't be bypassed:** applies in Live and Advance; entering Advance and Exit Trip Twin ask too; Esc and 15 s without an answer mean Stay; focus returns; non-modal alertdialog; "Stay at {site}"; shown at the top centre (clear of the compass). | SUP F4/F5, UX P1-5/P2-8/P2-10, IA F6, UI P1-2 |
| K5 | **Go to floor in the incident panel** too; whole floors only; out of range in amber with aria-invalid: "Floor 52 is outside this building's floors (1–37)". | UX P1-6/P2-7, SUP F8/F9, IA F4/F5, UI P2-6 |
| K6 | **Feet and miles read true:** US trips default to feet/miles (like °F); feet up to 1,500 ft with thousands separators; rule distances to two decimals under a mile (0.62 mi); picker distances say "straight line". | UX P1-4, SUP F3, IA F7 |
| K7 | **Copied text read aloud:** "22 min ago", not "22m ago". | SUP F2 |
| K8 | **Display holds both units:** Distances and Temperature (°F/°C); note says what follows the setting and that it's saved in this browser. | IA F3, SUP F10 |
| K9 | **Ground range under Layers › Site › Elevation contours** with a true minus and "relative to". One "Units: … · change in Display (D)" link instead of repeated notes. | IA F2/F8, UI P2-8 |
| K10 | **Ruler:** the reported floor's tag is incident red; 5-step tags next to it are dropped. Hotel floor stack axis numbers never overprint (12 px rule). | UI P1-5/P2-7 |
| K11 | **Initials** "AK" on the ruler, as on the pins; rally label "· not approved". | UI P2-9, IA F9 |
| K12 | **Card titles stay visible** while a long card scrolls (sticky head). | UI P2-10 |
| K13 | **Help overlay** says where G/E options live, what F frames, and Go to floor under H. | IA F10 |
| K14 | **Selected place glows** (Jesse): screen-sized halo behind the glyph, glyph drawn last and larger, glowing beacon and ring, bright label, lit chip. | Jesse |

## Deferred
- Leader lines for moved labels (UX/IA) — labels that would move far are hidden instead; leader lines with the SOC label pass.
- Help overlay regrouped into View / Find / Panels / Edit (IA F10) — wording updated only.
- `frameWholeTrip()` honouring the in-app Reduce motion setting (IA F3 aside).
- Ruler tags hidden when a marker covers them (UI P1-5 third bullet).

## Status (16 Oct 2026, after implementation)
K1–K14 implemented. Floor-tied labels (initials) slide sideways only rather than staying fixed (after-shot 08 showed fixed initials colliding); the Floor N tag stays fixed.

Verification: 78 Trip Twin unit tests (new: unit formats incl. 0.62 mi and 1,310 ft, spoken ages, declutter sideways/hidden); full suite 3084 tests, 3080 pass, 3 known failures (CCTV temp path, FIRMS cache, root config — not Trip Twin); build OK; boundaries OK; QA PASS on all 9 sites; after-shots in `after/` at 1600×900 and 1280×720 with zero console errors; browser checks: Esc answers Stay and keeps the site, V during an incident asks and stays in Live, Go to floor from the incident panel opens the floor card, selected place glows.
