# 03 Supervision review, phase 5: panel clarity

Lens: an operator under time pressure. Can they go from "this traveler needs a hospital" to "I have a path I can read out or copy" fast, without being misled? Does each panel's top line answer "what needs me now"? Can popovers close themselves without losing work or swallowing an intended click?

Inputs:
- Shots `phase5/shots/1600-01…14`, `1280-04`, `1280-11`, and `1600-text.json`.
- Code:
  - `twinHud.js`: `renderRouteSection`, `cardEl`, `renderRail`.
  - `page.js`: `POPS`/`openPop`/`closePops`, `routeEnds`, `drawRouteSection`, `setRouteTarget`, `routeEndpoints`, `runRoute`, `selectPlace`, `onSelect`, keyboard handler.
  - `twinRoutes.js`: `routeCards`, `planRouteSet`.
  - `tripTwin.js`: the `LEFT_CLICK` handler, and the refresh that re-fires `onSelect`.
  - `twinPathEditor.js`, `tripTwin.css` (`.tt-route-seg`, `.tt-path-card`), and `twin.html` (popovers, report form).
- `page.js` was changing while I read it, so line numbers there are approximate (~). Function names are exact.

## Verdict

The honesty language is strong and mostly in the right places: "Suggested · unverified", "(position 1m old)", "not an all-clear", "OpenStreetMap place · not verified". What fails Jesse's test is the **order and form** of the controls, plus two honesty gaps that hierarchy work could make worse.

- **Hospital run today:** 3 clicks to a walking path and 4 to a driving one. You cannot copy the result. Checking the hospital's phone number (the Hospital chip) **deletes the path** you just made.
- **The path result is a snapshot that never says it is one.** Its start point and its "position 1m old" label are frozen when you ask for it. Twenty minutes later it still says "1m old".
- **"To nearest hospital" means the hospital listed for the site.** It is not the one nearest the person.
- **Click-outside-to-close is safe for 4 of the 6 popovers as-is.** The Report form, and any click on empty map, need explicit rules. Today an empty-map click already wipes the selected card and its path.

---

## Findings

### P0

**1. The hospital run is a 3-row puzzle: same-looking buttons, no step order, a misleading preset, and the wrong instruction.**
- Shots: `1600-02`, `1600-03`, `1600-04`, `1280-04`.
- Evidence:
  - `renderRouteSection` (`twinHud.js:980–1059`) draws three groups with the same `.tt-tb` style: destinations, Walk/Drive, and Plan your own path. Nothing labels them as steps.
  - **The preset is misleading.** `drawRouteSection` picks the first enabled option, so **"To Fairmont Austin" opens already highlighted** (`1600-02`) even though Emi is "Inside hotel (likely)". It looks like a path is already set up. It is a 0 m trip.
  - **Step 2 gives no feedback.** After "To nearest hospital" (`1600-03`), only the button highlight changes. Nothing appears on the map and no distance is shown until Walk or Drive is pressed.
  - **The instruction is wrong for this card.** It reads "Pick where from, then Walk or Drive…" on a card titled PATH FROM THIS PERSON, where you pick where *to*. It also sits *below* the controls it explains.
  - **Click count today:** rail name (1) → To nearest hospital (2) → Walk (3) → path. Drive needs a 4th click. Copy needs ∞ (there is none, finding 5). The hospital phone needs a 5th click on the `Hospital 1.7 km N` chip, and that click clears the path (finding 7).
- Risk:
  - Under pressure, the operator presses the highlighted preset and Walk, and plans a path to the building the child is already in.
  - Or they hesitate and wonder whether anything happened after step 2. Every second spent decoding the card is a second not spent on the call.
- Spec (fastest honest flow):
  - **One primary action, placed first.** On a person card where the site has a hospital, the first control in the path section is a full-width primary button: `Path to hospital · Dell Seton 1.8 km`. It shows the straight-line distance, labelled "straight line" in its tooltip. **One click** does the following:
    - Requests the primary route for **both** Walk and Drive in parallel. That is 2 requests. Alternates load on demand through `Show alternate`.
    - Draws one route (finding 4 says which) and shows the result block (finding 2 and finding 5).
  - **Everything else becomes labelled steps** under a quiet disclosure, `Other destination or mode`:
    - `1  To` is a radio group: Hotel, Rally point (draft), Hospital, …. **Nothing is preselected.** Hide or disable the site option when the person is inside it, with the tooltip "Emi is inside Fairmont Austin (likely)".
    - `2  By` is the Walk/Drive radio group. It stays disabled until step 1 has a value.
    - `Plan your own path` becomes a link at the end of the section, not a third button row.
  - **Instruction copy.** Above the controls (not below), use "Choose a destination, then Walk or Drive." on person cards and "Choose a start, then Walk or Drive." on place cards.
  - **Target:** hospital path drawn in 1 click from an open card, or 2 from the rail. Copy is 1 more click.

**2. The path result freezes the start point and its age, and never says it is a snapshot.**
- Shots: `1600-04` ("position 1m old"), `1280-04` (map label "Start · Emi Sato (position 59s old)").
- Evidence:
  - Every data refresh re-fires `onSelect({kind:'person', row})` (`tripTwin.js` ~843). `setRouteTarget` then returns early for the same key (`if (routeTarget?.key === t.key) return drawRouteSection();`), so **`routeTarget.point` stays at the coordinates from the first click**.
  - The age, however, is re-read from the *current* row in `routeEndpoints` (`personRow.pos.age`). If the operator switches Walk→Drive ten minutes later, the new path starts at the 10-minute-old point but is labelled with the fresh age, for example "position 5s old". **The label understates the age of the coordinates actually used.**
  - The card title (`routeCards`) and the map start label are baked in at request time. They read "1m old" indefinitely.
  - **Not-current people are offered the same one-tap path.** The person card shows the route section whenever coordinates exist (`routeTarget?.point ? [routeNode] : []`). Rory Owen (last known 2 h) gets "To nearest hospital → Walk" with only "(position 2h old)" in the middle of a long blue sentence.
  - **The start can sit inside a tower.** For a person "Inside hotel (likely)" the path starts from a ±12 m point inside the building (`1600-04`). Walking routes do not start mid-floor.
- Risk:
  - A copied or read-out path that claims a fresher fix than it has.
  - A path from where a child *was*, presented as where she *is*.
- Spec:
  - `setRouteTarget` updates `routeTarget.point` on every refresh, but **does not re-route on its own**. Instead it compares the fix used by the drawn path (keep `routeModel.fixAt`) with the current fix.
  - **Result block, line 1**, styled as status, not prose: `From Emi Sato's position at 21:31 · 1 min old when planned`. Show the clock time plus the age at request, so it is always truthful.
  - **Live re-aging chip** next to it: `now 6 min ago`. It ticks with `tt-age` and turns attention-coloured at ≥ 5 min or when `pos.current` flips to false.
  - **Re-plan prompt.** When the current fix moves > 50 m from the one used, or the current fix is newer by ≥ 2 min, show a banner in the result: `Emi has moved since this path was planned · Re-plan from her current position`. The operator presses the button; the path never moves by itself.
  - **Not-current people:** the primary button reads `Path to hospital from last known position (2 h old)` in attention style. It sits next to an equal-weight button, `…from Fairmont Austin instead`. The result's first line is `Last known position, 2 h old — she may not be here`.
  - **Inside a building (likely):** the start snaps to the building's mapped entrance, or its street-level centroid if none is mapped. The label reads `From Fairmont Austin (Emi is inside, floors 9–13, as of 21:31)`. Never route from a point inside a footprint.

### P1

**3. "To nearest hospital" is the site's listed hospital. Emergency department status and phone are missing from the result.**
- Evidence:
  - `routeEnds` uses `.find((p) => p.location_id === here && p.category === 'hospital')` (`page.js` ~945): the first hospital listed for the viewed site. The rally point next to it *is* sorted by distance from the person.
  - Away-from-site travelers (3 in calm, `1600-01`) get the hotel's hospital, labelled "nearest".
  - The Advance brief says "emergency department listed in OpenStreetMap · not verified" (`1600-12`). The traveler result and the hospital card (`1600-05`) do not, and the result shows neither the phone nor the address.
- Risk: in a medical event, "nearest" and "has an ER" are the two claims the operator acts on. Both are unstated or overstated.
- Spec:
  - Pick the hospital by distance from the *start point* across every hospital in the snapshot. Label it `Nearest listed hospital to Emi (of 3 on file)`.
  - If the only one on file is the site's, say `Hospital listed for Fairmont Austin · 3.9 km from Rory — a closer one may exist`.
  - The result block includes: name, `Emergency department listed in OpenStreetMap · not verified` (or `ED not listed`), address, and the phone as a `tel:` link. The operator should never have to open the hospital card for these.
  - Add a fixed footer line in the hospital result: `Medical emergency: call 911 (US). This path is for an escort, not dispatch.` Take the number from the city config, and fall back to "local emergency number".

**4. Walk is the implicit mode at any distance, timed at group pace.**
- Shots: `1600-04` (1.8 km, "walk 28–37 min (group pace)").
- Evidence:
  - `routeModel.profile` defaults to `'foot'`.
  - `routeCards` uses `walkMinutes` with `GROUP_PACE_M_PER_MIN`. A hospital run is one traveler with an escort, not a 27-person group.
- Spec:
  - The one-click hospital action (finding 1) fetches both modes and shows both times on one line. Example: `Drive 5–9 min (no live traffic) · Walk 23–30 min`.
  - **Drawn by default:** Drive when the straight line is ≥ 1.2 km or the walk upper bound is > 20 min. Otherwise Walk. The line says why, for example `Drawing Drive — over 1.2 km`. The other time stays visible and is one tap away. Never hide the walk time: the operator may know there is no car.
  - **Pace label for a person:** use "escorted pace". Give it its own constant, or reuse the group pace and say "group pace, likely slower if injured". Keep "group pace" only for group origins (site, group centre).
  - The drive caveat "no traffic, parking or drop-off checked" stays, as the second line of the drive result.

**5. A suggested path cannot be copied: not from the card, not from the editor.**
- Shots: `1600-04`, `1600-14`.
- Evidence:
  - The result offers only `Plan your own path · Frame path · Clear path (Esc)`.
  - The editor offers `Save path` and `Discard`.
  - The only copy actions are "Copy for responders" (incident), the floor copy, and the Advance brief. Routes have no turn steps, so the operator must transcribe three lines of blue text by hand.
- Spec:
  - Add a primary button `Copy path summary` directly under the result.
  - Text (clipboard only, never stored):
    ```
    Hospital run — suggested, unverified (Trip Twin, 21:33 CDT)
    From: Emi S., inside Fairmont Austin (floors 9–13), position as of 21:31
    To: Ascension Dell Seton Medical Center, 1500 Red River St · +1-512-324-7990
        Emergency department listed in OpenStreetMap · not verified
    Drive 2.1 km · 5–9 min (no live traffic; parking/drop-off not checked)
    Walk 1.8 km · 23–30 min
    Flags: none raised (not a verification)   ← or each flag by name
    Not checked for closures, crowds or lighting.
    ```
  - **No traveler coordinates** in the text, and the first name plus initial only. This stays consistent with phase 4 P0-1 (`twinAdvance.briefText` lint).
  - The editor gets the same `Copy path summary`, with its engine line ("Valhalla … unverified").
  - Button feedback should say `Copied`, as "Copy for responders" does today.

**6. Avoid-area, heat and stale-start warnings sit inside the dim caveat lines.**
- Evidence:
  - `routeCards` pushes the generic `Suggested · unverified…` first, then the drive caveat, *then* `Enters avoid-area: …` and the heat line. `cardEl` renders all of them as `.l` in `--tt-text-dim`.
  - The only signal is `.flag`, which recolours the left border and the title (`tripTwin.css` `.tt-path-card.flag`).
  - The editor already does this right: `tt-edit-flag` rows.
- Risk: when scanning, the title reads like a clean path. The line that says "this path walks through the area you told us to avoid" is the third grey line.
- Spec:
  - `routeCards` returns `{ title, warnings: [], notes: [] }`.
  - `cardEl` renders `warnings` **between the title and the notes** as `tt-edit-flag`-style rows: attention colour, ⚠ glyph, normal weight.
  - Warning order: stale or last-known start (finding 2), enters avoid-area, heat ≤ 1 km, after dark, rain pace.
  - The `Suggested · unverified` line stays, always last, dim. The title never changes colour on its own.

**7. An empty-map click, or opening the hospital from its chip, silently deletes the planned path.**
- Evidence:
  - **Empty-map click:** `LEFT_CLICK` on empty ground calls `select(null)` (`tripTwin.js` ~499). `onSelect(null)` then calls `clearRoute()` and `card.hide()` (`page.js` ~523–528). No undo.
  - **Hospital chip:** `selectPlace` (chip `Hospital 1.7 km N`) calls `setRouteTarget` with a new key, which runs `clearRoute()` first.
- Risk: the operator loses the path they were about to read out. Click-outside-to-close (finding 8) will multiply the empty-map clicks.
- Spec:
  - **A drawn path outlives its card.** Deselecting hides the card but keeps the path on the map. A pinned pill appears above the toolbar: `Path: Emi S. → Dell Seton · Drive 5–9 min · Show · Copy · Clear ×`. The pill keeps the finding 2 age chip.
  - Only `Clear`, Esc, or planning a new path removes it. The pill shows one route set at a time, matching today's rule.
  - Opening a place from a chip while a person path exists keeps the path. The place card's PATH HERE preselects `From Emi Sato`.

**8. Click-outside-to-close: rules that never lose work or swallow an intended click.**
- Shots: `1600-07`, `1600-08`, `1600-09`, `1600-10`.
- Evidence:
  - `POPS` has six entries (Layers, Display, Report, Prototype, Help, Sites).
  - They close only via their own button (toggle), another popover's `openPop`, or Esc (`closePops`).
  - No outside-pointer listener exists.
- Spec, implemented as one `pointerdown` listener on `document` in the capture phase:

  | Where the pointerdown lands | Layers · Display · Prototype · Sites · Help | Report, clean | Report, dirty (floor typed) |
  |---|---|---|---|
  | Inside the open popover, or its trigger button | nothing (the trigger keeps its toggle) | nothing | nothing |
  | Another HUD control (rail, card, toolbar, header) | close, **and let the click through** (it selects or acts as normal) | close and pass through | **stay open**, pass the click through, show the inline line `Not shown yet — Show on twin or Cancel` (no shake, no modal) |
  | 3D map, on a person, building or place | close and **pass through**: the pick is additive and almost certainly intended | close and pass through | stay open, pass through |
  | 3D map, empty ground | close and **swallow** this click: it would only deselect (finding 7) | close and swallow | stay open, swallow |
  | 3D map while the path editor is active | close and **swallow**: never add a waypoint with a dismiss click | same | same |
  | Camera drag (pointerdown, then movement > 4 px) | close at the drag's start; the drag still orbits | close | stay open |

  - **Implementation note.** Set a one-shot `dismissedOnThisPointer` flag in the capture listener. The `LEFT_CLICK` handler and `pickHandler` check the flag and return early only for the empty-ground and editing rows. Use `contains(e.target)`, not geometry, so native `<select>` dropdowns in Display and Prototype don't count as outside.
  - **Keyboard parity.** Also close on `focusout` when the new focus is outside both the popover and its trigger. This applies to every popover except a dirty Report.
  - **Never** close a popover because of a data refresh, a re-render, or the incident arriving. An incident arriving should close Layers, Display and Sites, but not a dirty Report.

**9. The Report form: Esc is ignored in its input, typed input can vanish from view, and focus is never returned.**
- Evidence:
  - `openPop('tt-report')` focuses `#tt-report-floor`.
  - The global keydown returns early for `input, select, textarea` (`page.js` ~2706) *before* the Escape branch. So **Esc does nothing in the Report form**, which opens with focus in that input, and does nothing in the selects in Display and Prototype.
  - `closePops` hides the popover but never returns focus to its trigger.
  - Today the typed value survives a close, because it is cleared only on submit. Once the popover closes, nothing shows that a half-made report exists.
- Spec:
  - **Esc inside any popover field** closes that popover. Exception: a dirty Report, where the first Esc shows `Esc again to discard the floor you typed`, matching the path editor's two-step discard.
  - **Every close returns focus to the trigger** (`$(btn).focus()`), unless the close was a pass-through click on another control.
  - If a dirty Report is ever closed by Cancel or a second Esc, clear the input. Never leave a hidden draft.
  - Submit stays an explicit `Show on twin`.

**10. Once the Prototype drawer auto-closes, nothing persistent shows that simulation is on.**
- Evidence:
  - `Simulated heat detections`, `Simulated lightning` and `Simulated rain` are labelled "SIMULATED" only on the lines they produce: the hazard line, route cards and weather notes.
  - The `Prototype ▾` pill (`twin.html`) and the `MONITORING` status carry no state.
  - With click-outside (finding 8), the drawer disappears on the next click.
- Risk:
  - A demo or training run screenshots as real heat near the hotel.
  - An operator forgets a toggle and later reads a simulated "within 1 km of a heat detection" flag as real.
- Spec:
  - While any `sim*` toggle is on, the pill reads `Prototype · SIM ON ▾` in hazard-outline style.
  - The status pill adds the suffix `· SIMULATED DATA`.
  - "Copy for responders", the path copy and the brief copy prepend `[SIMULATED DATA IN USE — training only]`.

**11. Incident mode: the hotel card takes the incident panel's height, and the rail headline is a 6-line red run-on.**
- Shots: `1600-11`, `1280-11`.
- Evidence:
  - The incident panel is cut off at "OFFICIAL" (1600) and partway down the floor list (1280). `IF THE GROUP MUST MOVE`, with the rally path, arrive-by and shelter option, is below the fold.
  - The space goes to a docked hotel card whose body is only `Floors: in the incident panel above · H` plus height metadata.
  - The rail headline packs incident, counts and breakdowns into one red paragraph (`1600-text.json` shot 11). It repeats the panel's hero and the rail's own groups.
- Spec:
  - In incident mode, collapse the hotel card to its title bar. Its body comes back only when the operator selects a different building.
  - Panel order: title → hero → names → **Copy for responders** → **move summary line, one line, always visible**: `If the group must move: rally point 640 m · walk 10–13 min · arrive-by 32 min ▸`, which expands to the full section → floors → official.
  - Rail headline, line 1, red: `INCIDENT · Smoke, floor 9 · hotel desk 2 min ago · not verified`.
  - Line 2, normal: `3 may be at or above · 5 may still be inside · 3 not current or not located`.
  - Line 3, dim: `No official instruction · Headcount not reported`.
  - In incident mode, collapse the PEOPLE roster to the existing `Group:` line, so the attention groups start above the fold at 1280.

### P2

**12. Calm rail: the top line is right, but it is not actionable, and the roster pushes the attention list down.**
- Shots: `1600-01`, `1280-04`.
- Evidence:
  - The top line answers "what needs me now" well: "No incident reported · 6 to check on — first: Jay Patel, unaccompanied outside group zone".
  - But "Jay Patel" is plain text. Only the `A` key selects him.
  - The `Group:` subline restates the six-row roster below it.
  - At 1280 the NEEDS ATTENTION list shows 1½ people above the fold.
- Spec:
  - Make the first name in the top line a button. It does the same as `A`: select and frame. Add the hint `(A)`.
  - In calm, show the roster as one line by default (the existing `Group:` subline), with `People breakdown ▸` to expand it. Remember the open state per viewer, as the other disclosures do.
  - NEEDS ATTENTION moves up directly under the head.

**13. One button style for three different jobs makes every card read flat.**
- Shots: `1600-02`, `1600-05`, `1600-13`, `1600-14`.
- Evidence:
  - `.tt-tb` is used for choice chips (destinations, origins), for actions (Walk and Drive, which fire a network request and draw on the map), and for toolbar toggles.
  - Each card mixes in `.tt-btn` (Plan your own path) and `.tt-link` (Frame, Clear).
  - The `.on` state was restyled twice (`tripTwin.css` ~1464 and ~1765), and the selected chip and the default chip look alike.
- Spec, three tiers used the same way on every card (person, place, Advance site brief, editor):
  1. **Primary action**, at most one per card: filled. Examples: `Path to hospital`, `Copy for responders`, `Copy path summary`, `Save path`.
  2. **Choice controls**: a real `role="radiogroup"` with a visible group label (`To`, `From`, `By`). The selected item is filled and carries a check glyph, and unselected items are outlined. Never preselect a choice that would mislead (finding 1).
  3. **Quiet actions**: text links (`Frame path`, `Clear path (Esc)`, `Plan your own path`, `Show alternate`), always last in the section.

  Section kickers become questions that say the order: `GET EMI TO…` / `HOW` instead of `PATH FROM THIS PERSON`, and `GET HERE FROM…` / `HOW` instead of `PATH HERE`.

---

## Keep

- Honesty strings: `Suggested · unverified · not checked for closures, crowds or lighting`, `(not an all-clear)`, `OpenStreetMap place · not verified by SafeTrekr`, `No checks raised (not a verification of the path)`, `a review is a check, not an approval`.
- Position age everywhere: "(position 1m old)", "Last known · 2h ago", "Aging", and the dashed avatar ring for not-current people. Finding 2 is about keeping that age *true*, not adding it.
- Time ranges, never bare numbers: `walk 28–37 min`, `drive … (no live traffic)`, and `Suggested arrive-by: 32 min` with its arithmetic in "Why these numbers?".
- Paths are drawn only on an operator action, and the camera never moves by itself.
- The calm top line "N to check on — first: …" and the incident hero "3 may be at or above floor 9" with the reason under it ("2 by phone estimate, 1 assigned above, floor not detected").
- `Copy for responders` placed directly under the names.
- The `Session only · nothing here is sent to anyone` and `PROTOTYPE · NOT OPERATOR CONTROLS` labels.
- One popover at a time, Esc closing popovers before anything else, and `aria-expanded` kept in sync.
- The path editor's banner (`EDITING PATH · click map: add waypoint · … · Esc: discard`), its two-step discard, and its engine line saying whether avoid-areas were routed around or only checked.
- Advance's "Live: monitoring · … — switch to Live" strip. Live state stays visible while planning.
