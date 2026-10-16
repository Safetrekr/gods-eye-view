# Phase 9 supervision review: selecting and editing drawn paths

This is a review only; no code was changed. It asks four questions about the path card and the editor in a live supervision view. Is it honest about which line is which? Do its checks match the checks on saved paths? Does selecting a path change anything live? What happens to an open card when the state underneath it changes?

Shots: `shots/1600-01..06` and `1600-text.json`. Code: `gods-eye-view/src/operations/tripTwin/`.

**What holds:**
- Esc deselects a path before it removes it (`page.js:4362` comes before `4369`).
- A path that starts at a traveler's position opens live-only. Save is disabled and the editor label is anonymized (05).
- "Copy path summary" uses first name plus last initial (`shortName`, `twinRoutes.js`).
- The glow clearly separates main from alternate (02, 06).
- An incident arriving does not change the selection, the card or the pill. Nothing in the mode-change block (`page.js:760-783`) touches `selection`, so selecting a path never changes the incident, the timeline or the mode chip. One live side effect does exist (finding 7).

**What `01-ux.md` already covers:** the router difference (its finding 1). This review adds only the supervision angle. One correction to it: the original line does not always vanish. A rally path is hidden while editing (`setPickHandler` sets `editingPath`). A card route stays drawn, still unlabeled, and its pill still offers Copy and Remove for the old line (05). See finding 4.

---

## P0

### 1. A path from a traveler can show an old position as if it were fresh
- **Evidence:**
  - **The card hides the position's age.** Its title strips everything in brackets from the start label (`page.js:2545`, `replace(/ \(.*\)$/, '')`). So "Emi Sato (position at 21:31 · 59s old)" or "(last known position, 2h old)" becomes plain "Emi Sato → Ascension Dell Seton…" (04). The pill does the same (`page.js:1531`).
  - **The stale check stops.** `checkStale()` ("Emi has moved since this path was planned") runs only from `setRouteTarget` on a person-card refresh (`page.js:1372`). Selecting the path calls `twin.select(null)` (`page.js:2491`), so the person card is gone and the check never runs again.
  - **The only age left on screen is frozen.** The map label "Start · Emi Sato (position at 21:31 · 59s old)" is built once in `showRoute` (`tripTwin.js:1292`). It is redrawn with the same text on every `setPathSelected`, so it still says "59s old" twenty minutes later.
  - **The editor shows no age at all.** It says "From a traveler's position" (05). Its start is the snapped first point of the old line (`g[0]`), with no "as of" time.
- **Risk:** This is the highest-stakes use of the feature: a hospital run from a traveler's position. An operator can send a chaperone or car to a position that is two hours old while every visible cue says it is current. That is the "trust me" failure the live view exists to prevent.
- **Spec:**
  1. Keep the position's age as structured data, not as a string to strip. Store `fix: {atMs, current}` with the drawn route set (`routeSet.fix`). Render the age live on every surface that names the start:
     - the card's lead line: "From Emi S.'s position at 21:31 · 4 min old" (amber when not current, matching the roster's aging colors)
     - the pill
     - the map label: re-render it on each roster tick, not only at `showRoute`
     - the editor's start row: "Start: a traveler's position at 21:31 · 4 min old · live-only"
  2. Run `checkStale` against `routeSet.fix` whenever a roster update arrives, whatever card is open. If the traveler has moved more than 50 m or there is a newer fix, show a warning flag on the card and in the editor: "Emi has moved since this path was planned · Re-plan from now". Re-plan runs the same route request from the new fix. Never re-plan silently.
  3. If the position is older than the "not current" threshold, put a warning line above the metric: "Last known position, 2 h old — the traveler may not be here".

## P1

### 2. The card can outlive its path, and the glow can move to a different path
- **Evidence:**
  - Nothing that removes or replaces a drawn path closes a suggested-path card:
    - `removePath()` (`page.js:1388`) runs from pill Remove, the route section's Clear, and inside `clearRoute()` on a site or mode switch.
    - `runRoute` finishes and calls `showRoute` (`page.js:1496`).
    - The Advance "path from the hotel" calls `showRoute` (`page.js:1800`).
    - `selectSuggestedPath` does not call `releaseCard()` (`page.js:2489-2492`), unlike `selectSaved` (`page.js:2559`). So a route that is still loading from the person card keeps running and replaces the drawn set under the open card.
  - `selectedPathKind` is a kind ('primary' or 'alternate'), not an identity. It survives `showRoute` (`tripTwin.js:1285`), so a new set draws with the same kind glowing. The old card ("Fairmont Austin → Rally point (primary)") stays open while a hospital route glows white.
  - In Advance, the Esc ladder clears `adv.pathFor` before the suggested-path selection (`page.js:4355` before `4362`). Esc removes the line and leaves its card open.
  - With the card open, "Copy path summary" reads `drawn.model` when clicked (`page.js:2526`). After Remove, `drawn` is null, so the click throws and the button never says "Copy failed".
  - "Edit this path" keeps `g` in a closure. After a site switch, it could open the editor on the previous city's geometry, since `page.switchSite` does not close the card. Verify whether the twin's re-open deselects.
- **Risk:** The card's text, the glow and the map disagree. The operator reads 0.4 mi to the rally point and sees a different line lit. The supervision view no longer matches what is on the map.
- **Spec:**
  1. Give every drawn set an identity: `routeSet.id` (uuid) when it is created in `showRoute` or `planOnce`. Selection becomes `{kind: 'suggested', setId, pathKind}`, and `setPathSelected(setId, pathKind)` glows only if `setId` matches the current set.
  2. Add a twin event, `onDrawnPathsChange(setId | null)`. If the open card's `setId` no longer matches, close the card, clear the glow and clear the breadcrumb. Show one notice: "That path was replaced — card closed" (or "removed"). Do not keep showing a card for a line that is gone.
  3. `selectSuggestedPath` calls `releaseCard()` first, so an in-flight route is aborted, the same as `selectSaved`.
  4. Esc ladder: when a suggested-path selection is open, check it before `adv.pathFor`.
  5. Copy is disabled unless the card's `setId` equals `drawn.setId`. It never dereferences a null.

### 3. "Copy path summary" on the Alternate card copies the Main path
- **Evidence:** The card copies `copyPathSummary(drawn.model, drawn.ep)` (`page.js:2526`). `copyPathSummary` always uses `model.cards[0]` (`page.js:1584`), which is the primary path. The card heading says ALTERNATE; the clipboard text gives the main path's distance, time and flags. Separately, the Advance path from the hotel never clears `drawn` (`page.js:1800`), unlike `runRoute` (`page.js:1494`). So `drawn` can describe a different route than the one drawn (verify on the Advance place-card path).
- **Risk:** The text sent to chaperones describes a path the operator did not select. This is the same honesty failure as finding 2, and it reaches outside the product.
- **Spec:** Copy uses the selected path's own card: `routeCards([p], …)[0]`, already computed as `c` in `selectSuggestedPath`. Its endpoints come from `routeSet.ep`. The first line names the variant: "Alternate path — suggested, unverified". `pathFromHotel` sets `drawn = null`, matching `runRoute`.

### 4. While editing, the old line, the pill and the new line all compete, with no comparison
- **Evidence:** Shot 05 shows four things at once:
  - the pill: "Path: Emi Sato → … Drive **1.2 mi** · 3–5 min", with Copy and Remove
  - the old route, still drawn, labeled "Start · Emi Sato (…)"
  - the new start label, "Start · a traveler's position"
  - the editor, saying **1.5 mi**, Valhalla, 0 waypoints

  Pill Copy now copies the 1.2 mi path while the operator edits a 1.5 mi one. For a rally path (03), the original is hidden instead (`tripTwin.js:1440`), so the two sources behave in opposite ways. The editor reads "No checks raised" with no line about where it started.
- **Risk:** Two numbers for "the" path and no statement of which is which. If the operator acts on the pill, they act on the line they are not editing.
- **Spec (adds to `01-ux.md` finding 1):**
  1. When the editor is seeded from a drawn path, that line becomes a ghost in both cases (rally and card route): 40% dashed, one label "Original suggestion · OSRM · 1.2 mi". The rally path no longer disappears.
  2. While editing, the pill reads "Original suggestion (being edited)", Copy is disabled, and Remove is hidden. Remove returns when the editor closes.
  3. The editor result block always shows a provenance line: "Edited from the suggested path (OSRM, 1.2 mi, planned 21:31) → this path: Valhalla, 1.5 mi (+0.3 mi; largest gap 180 m)". Show the gap figure in amber above 25 m or above 5% length change.
  4. A saved path records `origin: {kind: 'suggested', engine, distanceM, plannedAt}`. The saved card shows "Edited from a suggested path", so a reviewer knows how the path started.

### 5. The editor starts at the snapped ends, which disables its "does not reach" check
- **Evidence:** The editor gets `from: g[0], to: g[g.length - 1]` (`page.js:2506-2508`). These are where the router snapped the old line, not the hotel, rally point, hospital or traveler. `pathChecks` measures `reach` against `ctx.points[0]` and `[last]` (`twinCustomPaths.js:225-238`). So it compares the new line against the old line's own snapped ends, and "Ends 140 m from the destination — the network does not reach it" can never fire. The traveler's start is also frozen at the old snapped point (see finding 1).
- **Risk:** If the network stops short of the hospital entrance or rally point, every check passes and the path saves (rally case) as if it reached.
- **Spec:**
  - Carry the true ends with the drawn set: `routeSet.ends = {from, to}`, taken from `routeEndpoints()`, or the hotel point and rally `coordinates` for the rally path.
  - Seed the editor with `points: [ends.from, ...seedWaypoints(g), ends.to]`.
  - Run the same reach check on the suggested-path card (finding 6).

### 6. The suggested-path card runs fewer checks than the editor and the saved-path card, and never updates
- **Evidence:** The card's checks come from `routeCards` (`twinRoutes.js:110`). The saved card and the editor use `pathChecks` (`twinCustomPaths.js:174`). Several checks are missing from the card:

| Check | Suggested-path card | Editor / saved card |
|---|---|---|
| Enters an avoid-area | yes | yes |
| An end inside an avoid-area | no | yes (`avoid_endpoint`) |
| Heat within 1 km | yes | yes |
| **Heat feed unavailable** | **no: silence reads as "no heat"** | yes (`heat_unknown`) |
| Does not reach the end | no | yes, but disabled when seeded (finding 5) |
| Much longer than the straight line | no | yes (`long`) |
| After dark | no; only the general note "not checked for … lighting" | schedule-based `isDark(day)`. The live clock is not used, so at 21:32 the editor still says "No checks raised" (03, 05) |
| Position age (traveler path) | removed (finding 1) | none |
| Rain pace | yes | no |

  The card's checks are computed once, when it opens. `refreshFires` recomputes `p.hazard` on the drawn path (`tripTwin.js:1025`, `1076`), but the open card never changes. A new heat detection can turn the line's warning on while the card still has no flag.
- **Risk:** The same line gets fewer warnings on the card than in the editor. A missing feed reads the same as "checked, nothing found", and the editor's "No checks raised" appears after 21:00 local.
- **Spec:**
  1. One checks function, `pathChecks`, serves all three surfaces. Add `pace` and `sharedStartM` to it, and drop the `routeCards` warning list.
  2. In Live mode, the dark check uses the sample clock: "After dark now (21:32) — lighting not checked". `isDark(day)` stays for Advance.
  3. When fires are not `live`, `stale` or `simulated`, the card shows the info line "Heat detections unavailable — not checked".
  4. The card recomputes its checks whenever `redrawPaths` or `refreshFires` runs, and any flag that changes gets a 2 s highlight.

## P2

### 7. Selecting a path quietly closes the traveler you were looking at, and the pill repeats the card
- **Evidence:**
  - `selectSuggestedPath` calls `twin.select(null)` (`page.js:2491`), which clears `selectedPersonId` and closes the person card. During an incident, clicking the hospital line drops the injured traveler's card, along with its floor return and stale checks.
  - `renderPill()` is not called afterwards. In 04 the pill ("Path: Emi Sato → … Copy · Remove") and the card ("Copy path summary") describe the same line with two copy buttons, which breaks the J6 rule "pill shows only when its card is not open".
- **Spec:**
  - The path card gets a back link, "‹ Emi Sato", that brings the person card back (as the floor card's `floorReturn` does).
  - Call `renderPill()` after selecting. The pill hides when the suggested-path card for `drawn.setId` is open.

### 8. The privacy gate is a pattern match on a label, and the live-only editor still shows save fields
- **Evidence:**
  - `fromPerson = /position/.test(set.fromLabel)` (`page.js:2497`) decides whether a traveler's location can be saved. If a label changes, or a person route has no fix and so lacks the word "position", the path becomes savable, with the traveler's full name as `fromLabel` and their coordinates as the start point.
  - The live-only editor (05) shows Day = "Day 1", For event, Notes and a disabled Save. All of them suggest it can be saved.
- **Spec:**
  - Store `routeSet.fromPerson: boolean` when the route is planned, from `routeTarget.kind` or `originKey === 'person'`. Fail closed: any person-derived endpoint means live-only.
  - For a live-only path, hide Day, Event, Notes and Save. Show a single "Live only · not saved · clears when you close this" line next to the result, plus Discard.

### 9. The selected path's row in the list is not marked, and keyboard focus is dropped
- **Evidence:** The "On the map now" rows (`page.js:3237-3257`) have no `aria-current` or "selected" text. After a row is clicked, `closePops()` runs and the card opens, but focus does not move to it. The selection is shown only by the glow on the map and the breadcrumb (WCAG 2.4.3 focus order, 4.1.2 name, role, value).
- **Spec:**
  - The selected row gets `aria-current="true"` and the suffix "· selected".
  - Opening a card from the list moves focus to the card heading. Esc returns focus to the row, matching the popover rule J7.
  - Add a polite live-region message: "Alternate path selected, 590 m".

### 10. On a site switch or a re-plan, the card does not say what happened
- **Evidence:** `page.switchSite` calls `clearRoute()` (`page.js:1071`), but `selection.kind === 'suggested'` is never reset there. On each site open the rally path is planned once, and its `paths` are nulled on teardown (`tripTwin.js:1109`, `1162`). Nothing tells an open card that its line is gone.
- **Spec:** This is covered by finding 2's `onDrawnPathsChange`. In addition, `switchSite` sets `selection = null` and hides the card before `twin.switchSite`. When the standing rally path is re-planned while selected, the card closes and the notice reads "Rally path re-planned — select it again". The card is never silently updated with the new numbers.

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: supervision_review
agents_covered: 0
capabilities_mapped: 5
autonomy_tiers_defined: 0
exceptions_categorized: 10
reversibility_documented: false
multi_surface_covered: false
kill_switch_specified: false
audit_log_surface_designed: false
wcag_level: aa
metrics_leading: 0
metrics_lagging: 0
kill_criteria_defined: 0
confidence: 0.82
source_artifacts: [page.js, tripTwin.js, twinCustomPaths.js, twinPathEditor.js, twinRoutes.js, shots/1600-01..06, 1600-text.json, review/phase9/01-ux.md]
-->
