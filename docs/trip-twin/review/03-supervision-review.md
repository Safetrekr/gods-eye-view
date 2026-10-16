# 03 Supervision review: Trip Twin prototype (modes, exceptions, trust, actions)

Reviewer lens: real-time monitoring UX (D26), exception triage and playbooks (D29), calm under complexity (E40), alert strategy (E36), trust calibration (B15), explainability (B10), evidence and receipts (D28).
Inputs: shots 01–08, `04-screen-spec.md`, `01-operator-scenarios.md` §0 §2 §5 §7, `06-layer-taxonomy.md` §1.2, `05-motion-language.md` §4, `ROUND-2.md`, and code `twinHud.js`, `tripTwin.js`, `twinData.js` (`assessSnapshot`), `page.js` (read only).
Tags: **[A-n]** = assumption, **[D-n]** = deliberate deviation from the plans (Jesse to confirm).

---

## Verdict in five lines

1. **There is no mode.** CALM and INCIDENT render the same rail, the same floor partition, the same caveat plates and the same always-open Group Hotel card. The incident adds a right panel but takes nothing away. The operator reads ~70 lines of text in CALM (shot 01) and ~95 in INCIDENT (shot 04).
2. **The screen has no top line.** The first thing read is `GROUP STATUS / Spring choir tour (sample)`, which is not news. In S2 the most important sentence is "8 people may still be in the building and 2 of them are likely at or above the smoke floor". The screen never says it.
3. **Freshness is invisible in every screenshot.** `SOURCES` and `HAZARDS` sit below the fold of a scrolling rail (`twinHud.js` L203–243). Q5 ("how fresh is this?") has no answer on screen, and the delayed state only turns a block amber that nobody can see.
4. **Two over-statements matter for life safety.** (a) Pins inside the glass tower are read against the floor ruler on the near corner. Perspective lifts them visually to floors 20–25 when their bands are 8–11 (shots 02, 05). (b) The primary path still shows as the primary path while it "passes within 320 m" of a heat detection (shot 07). 01 R2 sets a 1 km FIRMS buffer and says such a path "is not presented as a candidate".
5. **The action surface is unsafe in small ways.** One click on `Clear reported floor` erases even the hotel desk's report. The reported-floor input is rebuilt every 5 s, so typed digits vanish. At 1280×720 the hotel card covers both controls (shot 08). The real levers (message chaperones, direct group, copy for responders) are absent.

Code defects found while reading:
- *(Fixed on disk while this review was being written.)* `createHud` did not destructure `onTogglePaths` and `onToggleSimFires`, so those two checkboxes threw a `ReferenceError`. The current `twinHud.js` L54–55 adds them with no-op defaults. Line numbers for `twinHud.js` below refer to the earlier read and may be off by about 6.
- `refresh()` re-fires `onSelect` on every 5 s tick (`tripTwin.js` L605–608) into `#tt-card`, which is `aria-live="polite"` (`twin.html` L101). A screen reader re-announces the whole person card every 5 s.

---

## 1. Mode model

### 1.1 Modes

Three modes plus one overlay. The current mode is the **highest-severity open exception**, never a toggle the operator sets by hand. The operator can still focus an item, but cannot "declare calm".

| Mode | On-screen label | Enters when | Leaves when (hysteresis) |
|---|---|---|---|
| **CALM** | `MONITORING` (never "calm", "normal" or "nominal". 06 §3.11 bans "nominal", and "calm" reads as an all-clear) | No open exception of severity P1 or P2 | n/a |
| **WATCH** | `WATCH · {cause}` e.g. `WATCH · Heat detection 0.7 km SW` | Any P2 exception that is a *hazard near the group*, not a person issue. Examples: a heat detection within the path buffer (1 km FIRMS, 01 R2) or within 3 km of the hotel (04 §6.6); a region advisory; lightning within 10 km of an outdoor gathering point in use (round 2); no approved alternate rally point while a hazard exists | The cause has been outside its threshold for **15 min** (stops flapping on satellite revisits), or the operator opens it and marks it `Not relevant to this group`. That choice needs a reason, is logged, and can be undone |
| **INCIDENT** | `INCIDENT · {type} · {place}` e.g. `INCIDENT · Hotel fire alarm · Fairmont Austin` | A reported incident exists for a place of this trip (snapshot `reported_incidents` or an operator entry); or a WATCH hazard crosses into the hotel's radius or onto a path in use; or an official instruction arrives | Only when the last reported incident is **dismissed with a reason** (5.3), and then through RECOVERY. Never by timeout. Never by `Esc` |
| *RECOVERY* (transient sub-state of CALM) | `MONITORING · Incident closed 02:51 · Undo` | Leaving INCIDENT | 30 min after closing, or the operator collapses it. R4 shrinks to one line with the incident summary, the receipts, and **Undo** (reopens INCIDENT with everything intact) |
| **DEGRADED** (overlay on any mode) | Amber chip in the status strip, e.g. `Traveler data delayed 1m 10s` | Snapshot > 45 s old or poll failing (04 §7); `source_issues` present; hotel footprint approximate (`selectHotelFootprint` fallback); floor pipeline unavailable; FIRMS or weather unavailable **while an exception depends on it** | The source recovers. The chip stays as `Recovered 02:16 · was delayed 1m 10s` for 60 s so the gap is on record |

Rule: DEGRADED never *lowers* a mode. A delayed feed during INCIDENT keeps INCIDENT and appends `· data as of 02:13:40` to the top line. A delayed feed during CALM **becomes** the top line, because in CALM the data is the only thing the operator is relying on.

### 1.2 What each mode promotes and demotes

✓ = visible by default · ▸ = one action away (expand, card or More) · — = not shown

| Element | CALM | WATCH | INCIDENT | DEGRADED overlay |
|---|---|---|---|---|
| Mode chip + top line (new) | ✓ | ✓ | ✓ (loudest element) | Chip amber. Top line in CALM |
| Status strip (one line, replaces SOURCES) | ✓ quiet | ✓ quiet | ✓ quiet | ✓ amber, failing source first |
| Roster block (sticky) | ✓ | ✓ | ✓ | ✓ with `as of {time}` |
| Needs attention | ✓ capped 5 | ✓ capped 5 | ✓ grouped, see 2.3 | ✓ pins one state older (POS-M5) |
| Zone line, Chaperones line | ✓ one line each | ✓ | ▸ folded into the Needs attention groups | Zone unknown (ZON-08) |
| Floor estimates on pins (Jesse: on by default) | ✓ pins only | ✓ pins only | ✓ **locked on** (06 C3) | ✓ banded as last-known |
| Floor partition line `Above 0 · At or near 0 …` | — (meaningless without a reported floor; zeros read as reassurance) | — | ▸ behind `Why 2?` under the priority count | ▸ |
| Floor caveat (`phone barometer · not verified · US numbering · lobby = 1`) | One strip chip | One strip chip | One strip chip + once in the copy-for-responders text | Same |
| Group Hotel card (height, OSM way id) | ▸ on click only (today it auto-opens on entry: `tripTwin.js` L449) | ▸ | ▸ | ▸ |
| Hotel card (assembly point, group floors, stair help) | ▸ | ▸ | ✓ **one line** with its age; full card ▸ | ✓ |
| Incident panel R4 | — | ✓ compact: hazard card + paths + shelter | ✓ full, order in 5.1 | ✓ |
| Official instruction slot | — | ✓ one muted line when empty | ✓ first in R4 | ✓ |
| Chaperone headcount slot (HUMAN) | — | — | ✓ `Headcount: not reported` until entered | ✓ |
| Rally chip (primary + alternate, walk range) | ✓ one line | ✓ | ✓ inside "If the group must move" | ✓ |
| Arrive-by arithmetic | — | ▸ | Result ✓, arithmetic ▸ | ✓ |
| HAZARDS bounded empty statement (HAZ-07) | ✓ as a strip chip (`Heat: none within 25 km · FIRMS 20:20 UTC`) | ✓ hazard card | ✓ | ✓ `Heat: unavailable` |
| Context glass alpha | 0.12 | 0.12 | 0.06 (04 §6.6) | No change |
| Snapshot sweep | ✓ (only while live) | ✓ | ✓ | **Stopped** (that is the signal) |
| Edge chips | ≤ 6 | ≤ 6, hazard chip first | ≤ 4: people beyond view + hazard + relocation | Same |
| Simulated-heat toggle, glow style, scenario and city selects | ▸ move to a `Prototype` drawer | ▸ | ▸ | ▸ |

### 1.3 How the operator knows which mode they are in

Four redundant carriers, so meaning never rests on color alone (06 F21, 04 §8.3):

1. **Mode chip**, leftmost in R1 after `Exit Trip Twin`. A word, a shape (◯ monitoring, △ watch, ◆ incident) and a color (slate, amber, hazard red).
2. **Top line** (2.1): the first line of R2, 16 px, in the mode's words.
3. **R4 frame**: absent in CALM, amber 3 px top border in WATCH, hazard-red 3 px top border in INCIDENT (exists today: `.tt-incident` border-top).
4. **Scene**: context glass dims in INCIDENT only.

**Transitions.** Mode changes are instant (01 AP1). Entering WATCH or INCIDENT spends one pulse slot (3 cycles, 05 §4.3) on the chip, plus one polite live-region sentence that repeats the top line. The camera does not move unless the operator has been idle for 10 s (04 §6.6, 05 P6).

### 1.4 Round-2 features inside the mode model

The structure above already has the slots these need: an exception taxonomy, R4 sections and strip chips. Each feature adds **rules**, not new chrome.

**Building cutaway mini-map (ROUND-2 §1)**

| | CALM / WATCH | INCIDENT with a reported floor in this hotel | INCIDENT, hazard outside the hotel |
|---|---|---|---|
| Visibility | Closed. Opened from the hotel card (`Floors ▸`) or a key (`C` proposed [A-1]) | **Auto-opens**, docked at the top of R4 under the priority count. It becomes *the* floor read: a 2D elevation with no perspective error (fixes over-statement T1 in §3) | Closed (floors are not the question) |
| Encoding | Per floor: `likely here {n}` in neutral white tick marks. Assigned floors drawn as an outline (when a rooming list exists). **No green** (06 F6: green = approved place of safety). **No amber** | Reported floor: red hatch. Floors at or above with anyone likely there: amber with count. Assigned-but-not-detected floors at or above: amber outline + `?` | — |
| Click a floor | 3-column list: *Assigned here* / *Likely here now (±1)* / *Assigned here, not detected here* + reason. Words `no one detected`, never `empty` or `missing` | Same list. Rows sort at-or-above first. `Copy for hotel / responders` per floor | — |
| Camera | Clicking a floor frames it (operator action) | Auto-open never moves the camera | — |

Exception rules added by the cutaway:
- **EX-FLR-03 (P1, INCIDENT):** assigned to a floor at or above the reported floor, and floor unknown / not shared / not current. This person joins the at-or-above group as `assigned floor 11 · floor not detected (no pressure sensor)`. It is the group's most important blind spot (a kid asleep with a phone that has no barometer).
- **No CALM exceptions from per-floor presence.** Floor-level location is more sensitive than street position (01 §2.6), and kids changing floors is normal. A future curfew or bed-check rule must go through the itinerary, not the cutaway [A-2].

**3D weather (ROUND-2 §2)**

| | CALM | WATCH | INCIDENT |
|---|---|---|---|
| Default render | **No particles, no cloud deck.** One strip chip: `18 °C · light rain · Open-Meteo 21:00`. Rain and snow particles break the calm budget (05 §4.4: ≤ 1 moving element, < 2% pixel change) | The cause is drawn as a **static, sourced marker**: lightning glyph with age, precipitation band with time. Particles only if the operator turns on `Layers › Weather (3D)` | Same as WATCH. Particles are force-off while the INCIDENT camera reframes |
| Lightning strike arrival | — | One-shot glyph appearance, ≤ 1 flash, no saturated full-screen flash (WCAG 2.3.1, 05 flash safety). Uses a pulse slot | Same |

Exception rules added by weather:
- **EX-WX-01 Lightning (P2 → WATCH):** a strike within **10 km** [A-3, 30-30 rule] in the last 30 min of an *outdoor gathering point in use*: the hotel assembly point, a rally point that is a current destination, or ≥ 3 people `Outside, nearby` clustered within 50 m. **Escalates to P1** inside INCIDENT when the group is outdoors (S2: 16 people outside on the street at 02:14). Resolves after 30 min with no strike within 10 km. The resolution text states the source and its latency (`No strikes within 10 km since 02:20 · {provider} · ~1 min delay`). It never says "all clear" (06 §3.11).
- **EX-WX-02 Exposure (P2, INCIDENT only):** ≥ 5 people `Outside, nearby` for ≥ 20 min while apparent temperature is < 5 °C or > 32 °C, or precipitation is moderate or heavier. The text is information, not a verdict: `16 outdoors · 4 °C, rain · 25 min since alarm`. It feeds 01 S2's "if prolonged, move to indoor shelter?" decision and never suggests the move.
- **Precipitation accumulation is not an exception.** It widens the walk range and the arrive-by inside the path card, and the arithmetic says why (`+20% walk: heavy rain`).
- **Weather source down** turns DEGRADED only while EX-WX-01 or EX-WX-02 depends on it. Otherwise the chip says `Weather unavailable` quietly.

**Keyboard map (ROUND-2 §4)**

- Keys are the same in every mode. `A` jumps to the **top-line subject** (the first exception). `[` `]` step through Needs attention in rank order, crossing group headers.
- `Esc` unwinds focus only. It never closes R4 in INCIDENT, never dismisses a report and never exits (04 §6.8).
- **No key ever sends, directs, dismisses or clears.** `R` opens the *Add reported floor* dialog (focus in the field) and commits nothing by itself.
- The `?` overlay lists the current mode's keys and actions. All keys stay inert while typing (exists: `page.js` L323).

### 1.5 Implementation shape (keep it pure and testable)

Add `deriveMode(assessment, ctx)` to `twinData.js` next to `assessSnapshot`. No DOM, no Cesium, no clock reads, same as the rest of the file.

```
deriveMode(assessment, {
  reportedIncident, officialInstruction, hazards, paths, weather,
  feed: { ageS, pollOk, sourceIssues }, hotelApproximate, night, now
}) → {
  mode: 'calm' | 'watch' | 'incident',
  degraded: [{ source, text, sinceIso }],
  topLine: { text, subjectId, parts: [...] },      // parts allow bolding counts
  exceptions: [{ id, code, severity: 'P1'|'P2'|'P3', group, personId?, reason, ageS, isNew, evidence: {...} }],
  groups: [{ key, label, count, rows: [...], cap, collapsed }]
}
```

`twinHud.js` renders only from this object. Unit tests sit beside `demoTripTwin.test.mjs`: baseline produces `calm`, Demo A produces `incident`, an injected 70 s feed age produces `degraded`, and the simulated heat detection plus the path produces `watch`.

---

## 2. Exception-first design

### 2.1 The single top line per mode

One sentence, ≤ 140 characters, in the mode's words. It holds counts and the first name only, never a verdict. It is generated from `deriveMode().topLine`. Rendered for the screenshots:

| Mode | Template | Rendered (from the shots) |
|---|---|---|
| CALM, people to check | `No incident reported · {n} to check on — first: {name}, {reason} ({age})` | `No incident reported · 6 to check on — first: Jay Patel, unaccompanied outside group zone (live)` (shot 01) |
| CALM, nothing open | `No incident reported · no one needs a check-in · traveler data {age}` | `No incident reported · no one needs a check-in · traveler data 12s` (bounded: it states what it is based on) |
| CALM + DEGRADED | `Traveler data delayed {age} — counts as of {time}; positions shown one state older` | `Traveler data delayed 1m 10s — counts as of 21:31:40; positions shown one state older` |
| WATCH | `{Hazard} {dist} {bearing}, {age} ({source}) — {what it touches}` | `Heat detection 0.7 km SW, 24 min ago (SIMULATED) — primary path passes within 320 m; no clear alternate` (shot 07, minus the incident) |
| INCIDENT (S2) | `{Kind} reported, floor {f} ({source}, {age}, not verified) — {n} likely at or above, {m} more may still be inside, {k} not current or not located` | `Smoke reported, floor 9 (hotel desk, 2 min ago, not verified) — 2 likely at or above, 6 more may still be inside, 3 not current or not located` (shot 04) |
| INCIDENT + DEGRADED | Same, plus `· data as of {time}` | `… · data as of 02:13:40` |

Directly under the INCIDENT top line, as one muted line that is always present: `No official instruction on file · Headcount: not reported`. These are the two human sources that outrank everything SafeTrekr computes (01 doctrine 1 and 4). When either is filled, it replaces its half of the line and becomes the loudest element (04 §3.2 rule).

Why "6 more may still be inside" is the right second clause: in shot 04, `Inside (likely) 3 + At hotel, undetermined 5 = 8` people could be in a building with smoke on floor 9. Only 2 of them appear in Needs attention. The other 6, including the 3 `Below` the smoke floor, appear nowhere actionable. 01 S2's first decision is "Who is still possibly in the building?". The prototype answers only the second ("who is at or above?").

### 2.2 Exception taxonomy

Severity drives the mode, the order and the pulse slot. Nothing pages. Trip Twin has no paging: it is an in-console surface with a polite live region (04 §6.6). The table keeps the "Paging" column so the rule is stated explicitly.

| Code | Exception | Sev | Mode effect | Paging / announce | Recovery affordance (all information steps, never verdicts) | Source |
|---|---|---|---|---|---|---|
| EX-INC-01 | Reported incident at a trip place | P1 | → INCIDENT | Polite live region + chip pulse | Edit floor, dismiss with reason, copy for responders | Snapshot or operator |
| EX-INC-02 | Official instruction received | P1 | → INCIDENT, top of R4 | Same | Acknowledge (logged) | HUMAN or feed |
| EX-FLR-01 | Likely at or above the reported floor (band touches or exceeds it, 01 §2.6 fire-floor rule) | P1 | INCIDENT group 1, uncapped | Ring + 1 pulse per new person | Person card, copy, call chaperone | Computed |
| EX-FLR-02 | At or above, and the band has not changed in ≥ 8 min (not descending) | P1 | Sorts first within group 1 | Re-announce on worsening (05 §4.3) | Same | Computed |
| EX-FLR-03 | Assigned to a floor at or above, floor not detected (cutaway, round 2) | P1 | Group 1 | Ring | Same + reason | Rooming list + computed |
| EX-BLD-01 | May still be in the building: `Inside (likely)` or `At hotel, undetermined`, not at or above | P1 (INCIDENT only) | INCIDENT group 2 | Group ring on the hotel, not per person | Copy list, call chaperone | Computed |
| EX-POS-01 | Not current with last verdict at the hotel | P1 in INCIDENT / P2 in CALM | Group 3 | Ring | Person card: last known, battery, last geofence crossing | Snapshot |
| EX-POS-02 | Not current elsewhere (aging, stale, time unknown) | P2 | Group 3 | Ring | Same | Snapshot |
| EX-POS-03 | Not located | P2 | Group 4 | Static ring at roster only | Ask chaperone | Snapshot |
| EX-ZON-01 | Unaccompanied (current traveler, no current chaperone in zone) | P2 (P1 at night in CALM [D-1]) | Group "Alone or outside zone" | Ring + pulse at night | Call chaperone | Core |
| EX-ZON-02 | Outside group zone, accompanied | P3 | Same group, after unaccompanied | Static ring | — | Core |
| EX-CHP-01 | Chaperone not current. Their cluster's zone becomes unknown | P2 | Sorts first in the not-current group, marked `(C)` | Ring | Call the other chaperones | Snapshot |
| EX-HAZ-01 | Heat detection within 3 km of the hotel or the path buffer | P2 | → WATCH | Chip pulse | Hazard card, recompute paths | FIRMS |
| EX-PTH-01 | Path in use enters a hazard buffer (01 R2) | P2 (P1 if INCIDENT) | WATCH / INCIDENT | — | Path greyed `passes within buffer`, show alternate, recompute | Computed |
| EX-SAF-01 | No approved alternate rally point (secondary is `Draft · not approved`: shots 01–02) | P3 in CALM, P2 if WATCH/INCIDENT | Rally chip warning | None | Open safety card | Snapshot |
| EX-WX-01 / 02 | Lightning near an outdoor gathering point / exposure of a group outdoors (round 2) | P2 → P1 in INCIDENT | WATCH / INCIDENT | Chip pulse | Weather card with source + latency | Weather feed |
| EX-SRC-01 | Traveler data delayed > 45 s / poll failing | P2 overlay | DEGRADED | Strip turns amber, sweep stops | `Retry`, show `as of` | Feed |
| EX-SRC-02 | Hotel footprint approximate | P3 overlay | DEGRADED (Inside → `—`) | None | Explanation in strip popover | OSM |

### 2.3 Needs attention: rank, group, cap

Today (`assessSnapshot` L719–734) the list is flat. It sorts by a single reason index with no tie-breaker, so not-current rows come out in roster order (2h, 5m, 51m, time-unknown) instead of oldest first (01 §2.2). It has no group headers, no chaperone mark and no "new" tag. It slices at 8 rows inside a scrolling rail that pushes HAZARDS and SOURCES out of view.

**Rules**

1. **One row per person.** The primary reason sets the group. Secondary reasons follow on the row (`· also unaccompanied`).
2. **Groups in a fixed order per mode.** Each group has a header with a count: `AT OR ABOVE FLOOR 9 · 2`.
   - **CALM / WATCH:** (1) Alone or outside zone, unaccompanied first [D-1]; (2) Not current: chaperones `(C)` first, then oldest first, with `time unknown` treated as oldest; (3) Not located.
   - **INCIDENT (hotel types):** (1) At or above floor {f}: EX-FLR-02 first, then FLR-01, then FLR-03; (2) May still be inside: Inside (likely) before undetermined; (3) Not current, last known at the hotel first; (4) Not located; (5) Alone or outside zone. Outside, nearby people are **not** exceptions in S2. They are the good-news count in the roster and must never be read as "out" (01 §2.4).
3. **"New" wins within its group.** An item that became an exception in the last 10 min sorts first in its group and carries a `new` tag for 60 s (04 E7, 05 §4.3).
4. **Caps.**
   - CALM / WATCH: **5 rows total**. A group with ≥ 3 rows collapses to one summary row: `Not current · 4 · oldest Rory Owen 2h ▸`.
   - INCIDENT: group 1 is **never capped** (it is the list the fire service needs). Every other group shows 3 rows and then `+{n} more ▸`.
   - The rail keeps the roster block **sticky** (04 R2: "never scrolls the roster block off screen"). Needs attention scrolls under it and never takes more than ~45% of the rail height.
5. **Every row carries:** initials + name, a `(C)` mark for chaperones, the reason in 06 words, an age, and battery when < 20% and not current (01 §2.3). Selected row: `aria-current="true"`, highlighted, kept in sync with the scene selection. Today, selecting Maya in the scene leaves her row unmarked (shot 06).
6. **The list and the scene rings match one to one.** A ring in the scene always has a row, and a row always has a ring (when the person is in view) or an edge chip.

**Rendered: CALM (shot 01 data)**
```
◯ MONITORING   No incident reported · 6 to check on — first: Jay Patel, unaccompanied outside group zone (live)
NEEDS ATTENTION · 6
ALONE OR OUTSIDE ZONE · 1
  J.P. Jay Patel · Unaccompanied · outside group zone · live 34s
NOT CURRENT · 4
  T.C. Tess Cole (C) · Aging 5m · her cluster's zone unknown
  Not current · 3 more · oldest Jon Reyes (time unknown) ▸
NOT LOCATED · 1
  E.W. Eli West · No location reported
```

**Rendered: INCIDENT (shot 04 data)**
```
◆ INCIDENT · Hotel fire alarm   Smoke reported, floor 9 (hotel desk, 2 min ago, not verified) — 2 likely at or above, 6 more may still be inside, 3 not current or not located
No official instruction on file · Headcount: not reported
AT OR ABOVE FLOOR 9 · 2
  M.R. Maya Ruiz · likely floor 10 (9–11) · 46s · band unchanged 8 min
  A.K. Aron Kim · likely floor 9 (8–10) · 40s · descending ↓
MAY STILL BE INSIDE · 6
  3 rows… +3 more ▸        (S.D. Sam Diaz · last est. only · stopped near lobby, …)
NOT CURRENT · 2
  T.C. Tess Cole (C) · Aging 4m · last at hotel
  R.O. Rory Owen · Last known 34m · battery 6%
NOT LOCATED · 1
  E.W. Eli West · No location reported
```

---

## 3. Trust calibration

### 3.1 Where the prototype over-states or under-states certainty

| # | Shot | What is on screen | Problem | Calibrated fix |
|---|---|---|---|---|
| T1 | 02, 05 | Pins float inside the tower; the floor ruler is on the near corner. Looking down at −25°, people on floors 8–11 at the back of the footprint sit beside ruler ticks 20–25 | **Over-states, and misreads.** The eye reads the pin against the nearest tick (01 AP4: "pins … on a floor plate treated as proof") | Until the cutaway ships, draw a thin leader from each in-building pin to its band bracket on the ruler, and dim the in-building pins to 60%. The bracket is the floor read. In INCIDENT the cutaway (1.4) becomes the floor read |
| T2 | 07 | `Rally point (primary) · 640 m · walk 10–13 min` stays blue and primary while `Passes within 320 m of a satellite heat detection` | **Over-states route viability.** 01 R2: FIRMS buffer ≥ 1 km; "a route that enters a buffer is not presented as a candidate" | Grey the card: `Passes within buffer (320 m of heat detection, buffer 1 km) · not a candidate`. Raise EX-PTH-01. Show the alternate. Today R4 renders only `pathCards[0]` (`twinHud.js` L317), which also breaks doctrine 5 ("no primary without an independent alternate") |
| T3 | 01, 02 | `Above 0 · At or near 0 · Below 0 · …` with no reported floor | **Over-states.** A row of zeros under a "floor estimates" heading reads as "nobody is above anything" | Hide the partition in CALM (1.2) |
| T4 | 04–08 | `Outside, nearby 16` in 18 px bold, with no headcount anywhere | **Over-states by omission.** 16 phone fixes outside are not 16 people counted out (01 doctrine 4) | Add the `Headcount: not reported` slot under the top line. When a chaperone reports, show `Headcount 22 of 27 · Ms. Cole · 02:16` beside the phone count, never merged with it |
| T5 | 04 | `Hotel card from chaperone, 18:05` in dim text at 02:14 | **Under-flags age.** The card is 8 h old during a night incident | `Hotel card · from chaperone · 8 h old (18:05)`. Amber age when > 6 h during INCIDENT [A-4] |
| T6 | 04 | `Reported: … · 02:12 · not verified`, with the header clock showing `02:14` somewhere else | **Under-states age.** The operator has to do arithmetic | `Reported 2 min ago (02:12)`. Ages are relative first and absolute second (06 D11) |
| T7 | All | Traveler-data age appears only in the below-fold SOURCES block | **Under-states staleness everywhere.** The header shows `21:32 local (sample time)`, a clock rather than an age | Status strip, 3.2 |
| T8 | 01, 02 | `Rally point (secondary) · Draft · not approved` as a scene label colliding with `Fire station` | **Under-states a coverage gap.** There is no approved alternate (doctrine 5) | EX-SAF-01 on the rally chip: `No approved alternate rally point (secondary is a draft)` |
| T9 | 06 | Person card: `Likely floor 10 (9–11) · 46s ago` | Good band and age, but no confidence word and no trend. The R4 rows in 04 §2.3 carry `band unchanged 8 min` | Add `· medium · band unchanged 8 min` (FLR-01..03 vocabulary) |
| T10 | 04, 05 | The scene plate `Floor estimates · phone barometer · not verified / US numbering · lobby = 1`, the rail checkbox `(phone barometer, not verified)`, R4 `REPORTED INCIDENT · NOT VERIFIED` and the R4 title `… · not verified` | **Repetition wears trust down.** The same caveat four times teaches the operator to skip it, including where it matters | One caveat per claim, at the claim: the human report says `not verified` **once**, and the floor caveat lives in one strip chip and in the copy text |
| T11 | 07 | Simulated heat polygons float off the twin disc in the void and bleed under the rail (`SIMULATED heat detection · 1h 1?m ago` visible behind R2; `MULATED heat detection` clipped bottom-left) | Hazard geometry with no ground under it reads as wrongly placed | Beyond the 400 m disc, draw hazards as clamped ground markers with a leader to the hotel and a distance label, or as edge chips only. Never let them render under chrome |
| T12 | 01 | `Inside (likely) 15` while the hotel footprint came from OSM `way/134786106` with a mapped height | Calibrated correctly (the footprint is real, `likely` stays). Keep as is | — |

### 3.2 One status strip instead of repeated text

One line, 28 px, at the top of R2 under the top line (or merged into R1's right side at ≥ 1600 px). It replaces the `SOURCES` block, the floor caveat plate in the scene, the rail checkbox wording and the `HAZARDS` status line.

```
● People 9s  │  Floors est. ±1 · US, lobby = 1  │  Buildings OSM · 15 Oct  │  Heat: SIMULATED  │  Paths 3m  │  SAMPLE
```

| Chip state | Glyph + word | Example |
|---|---|---|
| Live | Filled dot + age | `● People 9s` |
| Aging, within threshold | Text only | `Paths 3m` |
| Stale / delayed | Hollow amber dot + amber text, moves to the **first** position | `○ People delayed 1m 10s` |
| Unavailable | `✕` + reason | `✕ Heat: no FIRMS key` |
| Approximate | `≈` | `≈ Hotel outline approximate` |
| Simulated / sample | Uppercase word, never color alone | `Heat: SIMULATED`, `SAMPLE` |

Click a chip → an evidence popover (§4): source, fetch time, threshold, what is affected, and Retry where one exists. The strip is the only place a source caveat appears outside its claim. Screen readers get it as one `role="status"` line that announces only on a state change, never on the 5 s age tick.

---

## 4. Evidence on demand

Rule: the **answer** is always on. The **derivation** sits one click away behind a `Why?` / `▸` affordance next to the answer it explains. Nothing life-relevant is hover-only (04 §2.4 wall rule).

| Answer (always on) | Evidence (behind `Why?` / `▸`) | Today |
|---|---|---|
| `At or above floor 9: 2` + names, bands, ages | Partition `Above 0 · At or near 2 · Below 3 · Last est. only 1 · Floor unknown 2 · Not shared 0 · No floor (not at hotel) 19 · of 27`. The rule "a band that touches or exceeds the reported floor counts". `+ n with last estimate at or above` | Partition always on, twice (rail L151 and in spirit in R4) |
| `Likely floor 10 (9–11) · 46s · medium` | Barometer anchor time, lobby reference, numbering convention, sample age, `floor-v1` | Partly on (the scene plate) |
| `Inside (likely)` on a person | Which rule fired: 2× accuracy circle inside the footprint / floor ≥ 2 / stopped since geofence entry (01 §2.4). Accuracy, last geofence crossing | Not available |
| `Arrive-by ≈ 32 min` | `12 prepare (night) + 13 walk (upper) + 7 buffer (25%)`. Group pace, night flag, stair-help widening (R12) | Arithmetic always on |
| Path `640 m · walk 10–13 min · suggested path (unverified)` | The OSM/OSRM caveat sentence (01 §6.2), compute time, hazard data age, closest approach | Caveat missing |
| Hotel card one-liner `Assembly across the street · group floors 8, 9, 11 · 8 h old` | Full card: chaperone floors, stair help 1, provenance, evacuation-plan photo | Full card always on in R4 |
| Group Hotel identity | Height `~122 m · from 37 levels (mapped)`, `OpenStreetMap way/134786106`, footprint match source | Auto-opened card on entry |
| Status strip chips | Per-source fetch time, threshold, affected counts, Retry | Below fold |
| Roster counts | Click a bucket → filter the scene + list (04 E5) | Not wired |
| `Heat: none within 25 km` | FIRMS window, satellite pass time, blind spots ("satellites miss fires under cloud") | Below fold |
| Copy for hotel / responders | **Preview of the exact text** before copying (04 §6.7), including the caveat line | Not built |

**Receipts (D28).** Every operator input and dismissal writes one line into the place it affects, with initials and time: `Added floor 9 · J.T. · 02:13`, `Dismissed heat detection: agricultural burn per local news · J.T. · 02:31 · Undo`. These lines are always visible in their card while the session lasts (04 E15).

---

## 5. Action surface

### 5.1 What is visible in each mode

Autonomy is fixed at **Level 1, Suggest** (04 §6.7). Trip Twin computes and drafts. It never sends, never declares, and has no Evacuate / All clear / Stand down control, now or later (06 §1.3).

| Action | CALM | WATCH | INCIDENT | Position |
|---|---|---|---|---|
| Select / frame a person (row, pin, `F`) | ✓ | ✓ | ✓ | Rail rows, scene |
| **Add reported floor…** | ✓ toolbar button (not an always-open input in the rail as today, L270–276) | ✓ | → `Edit floor…` in the reported-incident line | R6 / R4 |
| Dismiss report… | — | — | ✓ text button, secondary, **not** next to Edit | R4, under the receipts |
| Copy for hotel / responders | ▸ person card | ✓ hazard card | ✓ **primary button** (the phone is the main lever, 01 §0) | R4 top block, person card, floor list |
| Show paths to… / Recompute | ▸ rally chip | ✓ | ✓ | Path card |
| Information steps checklist (04 E21) | — | — | ✓ e.g. "Call chaperones for headcount", "Pass at-or-above list to hotel desk", "Confirm hotel assembly point", "Check official instruction" | R4 |
| **Message chaperones…** (Send alert; audience prefilled `Chaperones`, 01 S2) | ▸ More | ✓ secondary | ✓ secondary | R4 action row |
| **Direct group here…** | — | ✓ on approved destinations only | ✓ secondary, **below** Shelter in place for unrest and active-threat types | Path / safety card, R4 action row |
| Exit Trip Twin | ✓ | ✓ | ✓ (reported floor kept for the session, stated on exit) | R1, always |

Prototype stubs: the two send levers open the real two-step dialog. The final button reads **`Prototype · not sent`** and writes a receipt line `Draft only — not sent`. For a `security_officer` the buttons render disabled with the reason `View-only role` (MSG-07), so the governance path can be demonstrated.

### 5.2 Delegation and reversibility

| Capability | Who | Scope | Reversibility | Confirmation | Shown before confirming (blast radius) | Receipt |
|---|---|---|---|---|---|---|
| Verdicts, floor partition, paths, mode (computed) | Trip Twin (client) | This trip, this session | n/a (recomputed every tick) | None | n/a | Strip ages |
| Add / edit reported floor | All roles (04 SS-A8) | Session only | Reversible | Single step + numbering confirm on first entry (`Lobby is floor 1 / G / 0?`, 04 §7) | Floor, source, numbering | `Added floor 9 · J.T. · 02:13` |
| **Dismiss a reported incident** | All roles | Session only | Reversible (Undo for the rest of RECOVERY) | **Two steps**: choose a reason (`Hotel/fire service stood down` · `Entered in error` · `Duplicate`) → confirm. External reports show `Reported by hotel desk — dismissing hides it for you only` | What leaves the screen: the R4 panel, the slab, N priority rows | `Dismissed · reason · J.T. · 02:51 · Undo` |
| Dismiss a WATCH hazard as not relevant | All roles | Session only | Reversible | Reason required | Which paths and exceptions it stops affecting | Same |
| Copy for responders | All roles | Clipboard | n/a | Preview popover → Copy | The exact text | None |
| Message chaperones (Send alert) | org_admin, HQ | Audience + loaded count | **Irreversible** | Two steps: compose → preview → Send | `Chaperones · 3 loaded`, severity, full text, "This sends a push notification. It cannot be recalled." | Core alert record → R4 message status (MSG-01..03) |
| Direct group here | org_admin, HQ | Approved destination | **Irreversible** | Two steps + `I verified …` tick when the call rests on a C3 judgment | Destination, arrive-by **prefilled from the arithmetic** (not the default 15), PTH-14 warning if lower, audience, note | Same |

### 5.3 Preventing accidental actions

1. **Never rebuild controls on the data tick.** `render()` currently replaces the rail and R4 children every 5 s (`twinHud.js` L79, L247). Build the skeleton once and patch text nodes. The reported-floor input must keep its value and focus.
2. **Dismissal is two steps with a reason, and Undo follows it.** The `Clear reported floor` single click (L333–335) goes away. An external report can be hidden for this operator but never deleted. If the source re-reports, INCIDENT reopens with `Re-reported by hotel desk 02:58`.
3. **Irreversible actions:** a preview step; the confirm button is not default-focused, does not fire on `Enter`, and is disabled for 1 s after the preview opens (stops double-click carry-through); the audience is always shown with the loaded count.
4. **Spatial separation.** Destructive or irreversible buttons never sit next to frequent ones. `Dismiss report…` is a text button on its own line, under the receipts and away from `Edit floor…`.
5. **Locked during INCIDENT:** the floor-estimates toggle (06 C3; turning it off today hides the rail priority line, L133–152). `Esc` cannot close R4.
6. **Nothing covers an action.** At < 1440 px the details card (R5) **replaces** R4 behind a `‹ Incident` tab (04 R5 rule), instead of overlapping it as in shot 08. R4 gets `max-height` with internal scroll and a sticky action row.
7. **No keyboard shortcut for send, direct, dismiss or clear** (1.4).
8. **The prototype drawer** (scenario, city, glow style, simulated heat) moves out of the operational toolbar. Today a mis-click on `Scenario` reloads the page mid-incident (`page.js` L331–335).

---

## 6. Ranked changes to implement now

### P0: correctness, trust and the mode spine

1. **`twinHud.js` `createHud` signature:** done on disk (no-op defaults for `onTogglePaths` and `onToggleSimFires`). Confirm that `page.js` L75–76 still passes the real handlers, then close this item.
2. **`twinHud.js` `render()` (L78–341):** build the rail and R4 once and patch text on each tick, so the reported-floor input, focus and scroll survive the 5 s refresh.
3. **`tripTwin.js` `refresh()` (L605–608) + `twin.html` `#tt-card`:** stop re-firing `onSelect` every tick into an `aria-live` card. Update the card silently and announce only on selection or state change.
4. **`twinData.js`:** add the pure `deriveMode(assessment, ctx)` (1.5) with tests for baseline → `calm`, Demo A → `incident`, a 70 s feed age → `degraded`, and simulated heat + path → `watch`.
5. **`twinHud.js` rail head (L80–93) + `twin.html` `#tt-bar`:** replace `GROUP STATUS / trip / scenario · clock` with the mode chip and the one-sentence top line (2.1), plus the INCIDENT sub-line `No official instruction on file · Headcount: not reported`.
6. **`twinHud.js` Sources and Hazards blocks (L186–243) + `page.js` `sources` (L161–167):** collapse them into the one-line status strip at the top of R2 (3.2). It turns amber and takes the CALM top line when the feed is > 45 s old.
7. **`twinData.js` `assessSnapshot` needs (L719–734) + `twinHud.js` list (L155–184):**
   - Rank by mode with oldest-first tie-breaks.
   - Group with headers and counts, and cap per 2.3.
   - Add the INCIDENT group **May still be inside** and the `(C)` chaperone mark.
8. **`twinHud.js` `Clear reported floor` (L333–335) + `tripTwin.js` `reportFloor`/`sessionReported`:** replace with a two-step **Dismiss report…** that needs a reason. Show an inline receipt with Undo and a RECOVERY one-liner, and never silently erase an external report.
9. **`twinPaths.js` `pathCardText` (L157–184) + `twinHud.js` R4 path block (L317–332):**
   - Mark any path inside the 1 km FIRMS buffer `Passes within buffer · not a candidate` and raise EX-PTH-01.
   - Always show the alternate card next to the primary in R4.
10. **`tripTwin.css` `.tt-incident` / `.tt-card` (L434–463):**
    - Below 1440 px the details card replaces R4 behind a `‹ Incident` tab.
    - R4 gets `max-height` with internal scroll and a sticky action row.
    - Nothing covers `Edit floor…` (shot 08).

### P1: hierarchy, evidence and levers

11. **`twinHud.js` R4 (L278–340):** reorder to Official slot → reported line with age → priority rows (band · age · trend) + **Copy for hotel / responders** → headcount slot → hotel card one-liner with age → "If the group must move" (arithmetic behind `▸`) → Shelter in place → message status → stand-down line → actions. Delete the duplicated roster line (L316).
12. **`twinHud.js` floors block (L121–153):** hide the partition and the checkbox caveat in CALM. In INCIDENT, lock floors on, move the partition behind `Why 2?` under the priority count, and delete the rail's duplicate priority line.
13. **`twinPeople.js` floor plate (L260) and in-building pins:** remove the always-on caveat plate (it moves to the strip) and draw pin-to-bracket leaders, with in-building pins dimmed, so floors are read on the ruler and not by parallax (T1).
14. **`tripTwin.js` `open()` (L449):** keep the hotel glow on entry but do not open the Group Hotel card. It opens on click only.
15. **`twinHud.js` new action row:** add the stubbed **Message chaperones…** and **Direct group here…**. Both use the two-step preview (audience + loaded count + "cannot be recalled"), end in `Prototype · not sent`, and have a `View-only role` disabled path.
16. **`twinSafety.js` label (L118) + `deriveMode`:** turn a draft or unapproved secondary rally point into the EX-SAF-01 rally-chip warning, instead of a scene label that collides with `Fire station` (shots 01–02).
17. **`twinFires.js` `drawFires`:** detections beyond the twin disc render as clamped ground markers with a distance leader, or as edge chips. They never float in the void or under chrome (shot 07).
18. **`twinHud.js` `renderPersonCard` (L346–380):** add the confidence word, the trend (`descending` / `band unchanged 8 min`) and a `Why Inside (likely)?` expand naming the 01 §2.4 rule that fired.
19. **`twinHud.js` hotel card line (L312):** show the age (`from chaperone · 8 h old`), amber when > 6 h during INCIDENT.
20. **`twinHud.js` Needs attention + `page.js` keydown (L322–329):** add the selected-row state (`aria-current`), `[` `]` stepping, and `A` = jump to the top-line subject.
21. **`twin.html` toolbar:** move Scenario, City, Selection glow and the simulated-heat toggle into a `Prototype` drawer away from the operational controls.

### P2: round 2 on the same spine

22. **Cutaway mini-map + per-floor three-column list** (1.4): R4-docked and auto-open only for an in-building reported floor, no green, EX-FLR-03.
23. **Weather:** strip chip + EX-WX-01 / EX-WX-02 rules. 3D layer opt-in only, static sourced markers by default, flash-safe strike arrival.
24. **`?` keyboard overlay**, mode-aware. No shortcuts for send, direct or dismiss.
25. **Label collision pass** for scene plates (fire station vs chips, ruler initials stacking `M.R./A.K./N.P./O.H./P.N.` in shots 04 and 08).
26. **RECOVERY state** (30 min collapsed R4 with receipts and Undo) and mode-transition announcements in one polite live region.
27. **Instrument the metrics in §7.**

---

## 7. Supervision metrics

| Metric | Type | Event | Target | Cadence | Kill criterion |
|---|---|---|---|---|---|
| Demo A: time to say the at-or-above names and "may still be inside" count aloud | Leading | `demo_answer_given` (moderated test) | ≤ 20 s (04 §9.1 bar is ≤ 60 s for the whole walkthrough) | Each test round | > 60 s → the top line has failed; redesign before adding features |
| Top-line comprehension (operator restates mode + first action) | Leading | `topline_probe` | ≥ 9/10 correct | Each test round | < 7/10 → rewrite the templates |
| Needs attention overflow (rows hidden behind caps when an incident starts) | Leading | `needs_capped` | Group 1 never capped; ≤ 2 `+more` expansions per incident | Per session | Any P1 row hidden → bug |
| Mode flaps (enter/exit WATCH within 15 min) | Lagging | `mode_changed` | < 1 per hour | Daily | > 3 per hour → widen hysteresis |
| Actions while DEGRADED without opening the strip | Lagging | `action_while_degraded` | < 10% | Weekly | > 25% → make the degraded state block-level (dim scene) |
| Dismiss → Undo within 2 min | Lagging | `report_dismissed`, `report_undo` | < 5% | Weekly | > 15% → dismissal is too easy; add friction |
| Pulse budget breaches | Guardrail | `pulse_slot_denied` | 0 visible breaches of 3 at once (05 §4.3) | CI visual test | Any → block merge |

---

## 8. Assumptions

- **[A-1]** `C` for the cutaway does not collide with the ROUND-2 keymap (`F Z Esc 1 2 3 [ ] A G L ?`).
- **[A-2]** Curfew and bed-check exceptions belong to the itinerary/rooming-list feature, not the cutaway. CALM per-floor presence raises no exceptions (privacy, 01 §2.6).
- **[A-3]** Lightning threshold 10 km / 30 min (30-30 rule). The provider and its latency are TBD (ROUND-2 §2: a commercial feed is needed).
- **[A-4]** A hotel card older than 6 h during an incident is flagged amber.
- **[A-5]** Shot 04 numbers: the 2 at-or-above people are among the 8 `Inside (likely)` + `At hotel, undetermined`, which gives "6 more may still be inside". If the verdict and partition sets differ in edge cases, `deriveMode` computes the set difference by person id, not by subtracting counts.
- **[D-1]** In CALM, a live unaccompanied minor sorts above long-standing not-current people. This differs from 01 §2.2, which puts the not-current list second and outside-zone third. Rationale: it is the only exception with a current fix that says a child is alone *now*. "New" items still win over everything (05 §4.3). Jesse to confirm.
- Floor estimates stay on by default (Jesse's call, recorded in `tripTwin.js` L169), unlike 04's "off". This review keeps them on but strips the partition and caveat chrome in CALM.
- The prototype's single-place assumption (`places[0]`) holds. Multi-site trips need the mode computed per site and the top line naming the site.

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: exception_taxonomy
agents_covered: 1
capabilities_mapped: 9
autonomy_tiers_defined: 1
exceptions_categorized: 18
reversibility_documented: true
multi_surface_covered: false
kill_switch_specified: true
audit_log_surface_designed: true
wcag_level: aa
metrics_leading: 3
metrics_lagging: 3
kill_criteria_defined: 7
confidence: 0.82
source_artifacts: [review/shots/01-08, 04-screen-spec.md, 01-operator-scenarios.md, 06-layer-taxonomy.md, 05-motion-language.md, ROUND-2.md, twinHud.js, tripTwin.js, twinData.js, page.js, twinPaths.js, twinSafety.js, twinPeople.js, tripTwin.css, twin.html]
-->
