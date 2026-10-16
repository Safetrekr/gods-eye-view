# Phase 9 fix list — select any drawn path, see its details, edit a copy
(merged from 01-ux, 02-ui, 03-supervision, 04-ia; 16 Oct 2026; 39 findings → 19 fixes)

## Decisions where the reviews differed
- **The verb.** Jesse asked to "manually edit" a selected path. IA objected that "Edit this path" promises the line on the map changes, when the action makes a new path (06 §11 lists it under Never say). UX proposed "Editing a copy". **Chosen:** the button is **"Edit a copy of this path"**. It keeps Jesse's verb and says plainly that the suggestion stays as it is. The editor opens on the clicked line itself (no re-plan until something changes), so "copy" is literally true. Editor kicker: `NEW PATH · COPY OF THE SUGGESTED PATH (MAIN) · NOT SAVED`. Chip and banner: `PLANNING PATH` for a new path; `EDITING PATH` only for a saved path.
- **Rank words.** UI wanted `SUGGESTED PATH · UNVERIFIED` / `ALTERNATE PATH · …`; IA wanted Main / Alternate, with "primary" kept for rally points. **Chosen:** IA's rule. Paths rank **Main / Alternate**; "primary" is only for rally points; "Suggested" is the type. Kickers are kept short so they fit on one line: `SUGGESTED · MAIN · UNVERIFIED`, `SUGGESTED · ALTERNATE · UNVERIFIED`, and `SUGGESTED PATH · UNVERIFIED` when only one path is drawn.
- **The original while editing.** In the build the rally path disappeared but a card route stayed drawn (supervision F4). **Chosen:** every drawn suggestion steps back while a copy is edited, and the original shows as a faint dashed ghost. The pill hides until the editor closes.

## The card tells the truth about the line it describes
| # | Fix | Sources |
|---|---|---|
| O1 | **Each drawn set has an identity.** A card belongs to one set (`setId`). When the set is replaced, removed, hidden, or the site changes, the card closes with a notice ("That path was replaced — card closed") and the glow clears. Opening a path card releases any card plan still in flight. Esc closes the path card before Advance's path. Copy never runs against a missing path. | SUP 2, SUP 10 |
| O2 | **A traveler's position shows its age, live.** The set keeps the fix time as data. The card, pill, map label and editor show "position at 21:31 · 4 min old", re-rendered each tick. A position that is not current gets the line "Last known position, 2 h old — the traveler may not be here". The stale check ("Emi has moved since this path was planned · Re-plan from now") runs on every roster update while the path card is open. | SUP 1 |
| O3 | **Copy copies the selected path.** The Alternate card copies the alternate, with a first line naming it, and the rally path gets Copy too. The Advance hotel path clears the card-path state. | SUP 3, UX 10, IA E |
| O4 | **One set of checks.** The card runs the same `pathChecks` as the editor and saved card: avoid-area entered or at an end, heat within 1 km, **heat feed unavailable**, does not reach the end, much longer than the straight line, and after dark (Live: the sample clock now; Advance: that day's schedule). Pace and shared-start notes are kept. Checks recompute when heat detections refresh. | SUP 6 |
| O5 | **True ends.** The set carries the real start and end (hotel, rally point, place, traveler), not the router's snapped ends, so "does not reach the destination" can fire on the card and in the editor. | SUP 5 |

## Selecting and reading a path
| # | Fix | Sources |
|---|---|---|
| O6 | **Selected look.** The glow sits *under* the dark casing. The blue line keeps its colour and gets slightly thicker, and the alternate stays dashed. | UI P0-1 |
| O7 | **Paths look clickable.** A pointer cursor appears over any path or card target. Each path has an invisible 22 px pick line, and hovering lightens its casing. | UX 2, UI 2 |
| O8 | **Card details.** The card uses the phase 5 result block with the mode first: `Walk · 0.4 mi · 10–13 min · group pace`. Then, in order: start (with its age for a traveler), "Via {streets}", checks ("none raised — not a verification"), the main-vs-alternate difference, the full PTH-03 caveat, and one source line: `Planned {HH:MM} · OSRM (OpenStreetMap data)`. Long titles clamp to 2 lines. | UX 4, UI 4, IA H |
| O9 | **One name per path.** The kicker follows the rank decision above. The breadcrumb reads `› Suggested path · main`. Incident-panel titles read `Main path to Rally point (primary)` / `Alternate path to Rally point (primary)` and open the card. The rally destination string is `Rally point (primary)`. | IA B, UI 5, IA D |
| O10 | **One action set.** Row 1: **Edit a copy of this path** (primary) · Frame path. Row 2 (links): Copy path summary · Remove path (card routes only; the rally path gets the foot line `Shown while a primary rally point is set · hide in Layers › Paths › Suggested paths`). The pill hides while its card is open or a copy is being edited, and uses the full labels `Frame path · Copy path summary · Remove path`. The saved card's primary button is **Edit saved path**. | UI 3/6, IA E, UX 10, SUP 7 |
| O11 | **Layers › Paths index.** It follows the three path toggles as its own sub-section under the sub-kicker `SUGGESTED · DRAWN NOW · n`. Rows read `Main · Fairmont Austin → Rally point (primary) · walk 0.4 mi`, with a swatch (dashed for the alternate), `aria-current` and "· selected" on the open row, and focus moving to the card. Opening a path from the list frames it. Saved paths and avoid-areas get separate summaries (`SAVED ON THIS TRIP · n`, `AVOID-AREAS · n`). Empty state: `No suggested path drawn · open a person, place or site card to find one`. | IA D, UI 7, UX 3, SUP 9 |
| O12 | **The parent card is kept.** A path opened from a person or place card is its child: the breadcrumb reads `{site} › {Emi S.} › Suggested path`, the card shows a back link `‹ Emi S.`, and Esc returns to the parent card with the path still drawn. The focus segment of the breadcrumb never truncates. | IA C, SUP 7 |

## Editing a copy
| # | Fix | Sources |
|---|---|---|
| O13 | **Opens on the same line.** The editor shows the clicked geometry as its result and does not re-plan until the operator changes something. The original stays as a dashed ghost. After a re-plan the editor says "Re-planned: 1.5 mi (the suggested path was 1.2 mi) · its line is shown dashed", with **Match the suggested path**. (Built before the review; kept.) | UX 1, SUP 4 |
| O14 | **Provenance.** A saved copy records `origin` (suggested · main/alternate · OSRM · distance · planned time), and the saved card says "Started from the suggested path (main) · OSRM · 1.2 mi". The default name adds "· via {street}" so it never repeats the suggestion's name. | UX 5, SUP 4, IA G |
| O15 | **Live only, said early.** The set stores `fromPerson` when it is planned (fail closed), not a pattern match on a label. The card's button reads **Edit a copy (live only)**, with the line "Starts at a traveler's position: a copy can't be saved". The editor kicker reads `NEW PATH · LIVE ONLY · CANNOT BE SAVED`; Name, Day, Event, Notes and Save are hidden; one start label is shown. | UX 6, SUP 8, IA F, UX 7 |
| O16 | **Seeded waypoints.** Kicker: `WAYPOINTS · n OF 10 · placed at the suggested path's turns`. Rows add the distance from the start. A path over 500 m never seeds zero points (its midpoint at least). | UX 8, UI 9, IA G |
| O17 | **Standing rally path edits apply to any day.** (Built before the review; kept.) | UX 9 |
| O19 | **A saved path fades the suggestion** (Jesse, 16 Oct 2026: "just faded"). When a saved path on the map has the same start and end (within 60 m), the drawn suggestion is drawn at 40% and stays clickable. Its card says "Drawn faded: the saved path “…” has the same start and end", and its Layers row adds "· faded (saved path)". | UX 5 |
| O18 | **Help and tests.** The help "Click a path" row names the keyboard route (Layers (L) › Paths › Suggested · drawn now) and the new verb. Tests cover seeding (midpoint rule), live-only fail-closed, the summary of the selected path, and banned words. | IA I |

## Deferred
- "Plan from the hotel instead" on a live-only card (UX 6). It needs a second editor entry with a site origin; next round.
- Hover tooltip on paths, "Suggested path · 0.4 mi · click for details" (UX 2). The cursor and casing change ship now.
- One engine for suggested paths and the editor (Valhalla geometry through the proxy) (UX open question).
- Breadcrumb truncation order at every width (IA C, first half). Only the never-truncate-the-focus rule ships now.

## Status (16 Oct 2026, after implementation)
O1–O19 implemented.
- Every drawn suggested path can be clicked: on the map, with a pointer cursor, a lighter casing on hover and a 22 px pick line; from Layers › Paths › SUGGESTED · DRAWN NOW; and from the incident panel's path titles. Each opens one path card: mode-first metric, start with its live age, Via streets, the same checks as the editor (heat feed unavailable and after dark now included), the Main/Alternate difference, full PTH-03, planned time and engine.
- A card belongs to one drawn set and closes with a notice when that set is replaced or removed.
- "Edit a copy of this path" opens the editor on the line itself. The suggestion steps back to a dashed ghost and re-planning waits for a change. A path from a traveler is live only, with no save fields.
- A saved copy records where it started, and a saved path with the same ends fades the suggestion (Jesse: "just faded").
- Jesse's follow-up, same day: the building selection glow is now three wall-only shells at one height (it read as steps) and about half as bright.
- The Trip Twin page uses the SafeTrekr favicon set from safetrekr-app-v2 (`public/trip-twin/`).
- Bug found while verifying: Cesium adds data sources in a microtask, so a draw and dispose in the same tick left drawings behind. Disposal now waits for the add (paths, path ends, heat detections).

Verification: 103 Trip Twin unit tests (new: midpoint seeding, Via streets, along-distance, Main/Alternate titles, copied text with the full caveat, faded-ends match). Full suite: 3108 tests, 3104 pass, the same 3 known failures. Build and boundaries OK. QA PASS on all 9 sites. After-shots in `after/` at both sizes (shots 01–07, including the saved copy with the faded suggestion) with zero console errors. Browser checks:
- turning Suggested paths off closes the card with its notice
- Alternate Copy copies the alternate with its own flags
- Esc from a path opened via Emi's card returns to her card
- discarding a copy returns to the path card
- no leftover drawings
