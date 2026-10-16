# 06 Trip Twin layer taxonomy, information hierarchy and controlled vocabulary

Owner: information architect. Status: draft for PROJECT-PLAN.md.
Skills applied: INA-003 dashboard IA, INA-012 information hierarchy, INA-018 wayfinding, INA-039 labeling system, INA-035 controlled vocabulary, INA-010 contextual navigation.

Inputs read: 00-CONTEXT.md, 01-operator-scenarios.md, 02-layer-catalog.md. Code read (read-only) in gods-eye-view `src/operations/`: `worldControls.js`, `main.js`, `globe.js`, `model.js`, `boundaries.js`, `alertFeed.js`, `participantPins.js`, `visualModes.js`, `demo.js`.

What this file decides:
- Where each piece of information sits (always on / incident in focus / one action away) and what kind of element it is.
- The five layer groups, their layers, order, defaults and couplings.
- The exact operator-facing words. 04 (screen spec) and 05 (motion) use these strings and do not invent synonyms.
- How the operator enters, moves through and leaves Trip Twin.
- The legend grammar (color + shape + icon + label) and label density limits.

Visual styling (exact hex, glow, motion) belongs to 04 and 05. Where this file names a color, it names the semantic role and the existing token. 04 may tune the shade but not reassign the meaning.

Assumptions are tagged **[IA-A#]** and listed in section 8. References to 01 and 02 assumptions keep their own tags (e.g. 01 [A5], 02 [A2]).

---

## 0. Findings that change other sections

These came out of reconciling 01, 02 and Justin's existing labels. Each needs an owner decision; my proposed resolution is used in the rest of this file.

| # | Finding | Proposed resolution | Owner to confirm |
|---|---|---|---|
| F1 | 01 and 02 use two different vocabularies for the same states. Roster buckets: 01 "Inside (likely) / At hotel, undetermined / Outside nearby / Away / Not current"; 02 "At hotel / Hotel edge / Elsewhere / Not current / Not located". Floor: 01 "Floor likely 7 (6–8)"; 02 "≈ level 6 above lobby (5-7) · est.". Routes: 01 "Suggested path (unverified)"; 02 "Shortest mapped path · not hazard-checked". | One vocabulary, section 3. It keeps 01's roster words (they are the protective agent's ranked answers), adds 02's "Not located" bucket, and keeps Justin's existing strings wherever he already has one. Conflict register in 3.12. | Product owner |
| F2 | 01 classifies inside/outside with **2x** the accuracy radius (life-safety rule). 02 classifies with **1x** (Core's containment constant). The same label would mean different things depending on which agent's rule the developer reads. | "Inside (likely)" and "Outside, nearby" use 01's 2x rule. The 1x rule stays only for Core's group-zone state, which Trip Twin displays unchanged. The definition in 3.2 states the 2x rule. | 03 architect, product owner |
| F3 | 02 fixture P05 is "aging" yet "AT HOTEL", which breaks 02's own rule (verdict requires a current fix) and 01's rule (aging counts as Not current). | P05 counts under **Not current**, with the qualifier "last known inside (likely), 5m ago". Its floor band shows in aging style (3.4). Fix the fixture table. | 02 analyst |
| F4 | 02 rule R1 names its distance bands "Awareness / Watch / Warning". "Watch" and "Warning" are official public-warning terms (NWS, national CAP feeds). 01 says official instructions must always outrank SafeTrekr's. A computed "Warning" next to a real official warning would confuse authority. | Use distance wording only: "Heat detections within 3 km". The words Watch, Warning, Advisory and Alert are reserved for official sources (3.11). | 02 analyst |
| F5 | Justin's `worldControls.js` binds keys 1–9 globally to whole-globe visual modes (Night vision, FLIR, CRT...). Inside Trip Twin one key press would apply FLIR to the hologram, implying thermal sensing we lack (01 anti-pattern 12). | Suspend the visual-mode keys and the Visual modes tab while Trip Twin is open. Restore the previous mode on exit. | 03 architect, Justin |
| F6 | Justin colors current travelers green (`#71cc9a`) and stale people red (`#d98585`). In Trip Twin the brand brief reserves green for "ours / safe" and destructive red for hazards. A green traveler reads as "safe"; Justin's own copy says "A fresh location does not establish that a traveler is safe". A red person reads as "the person is the hazard". | Inside Trip Twin, a person's ring color shows only time state, and role is shown by the existing T/C badge. Red is never drawn on a person (5.1). World View keeps its colors. Raise with Justin whether World View should follow. | Justin, 04 |
| F7 | Justin's toggle is labeled "Active fires", but his alert feed calls the same data "Satellite heat detections … not confirmed fire incidents". | Trip Twin uses "Satellite heat detections" (Justin's alert-feed term). | Justin |
| F8 | Justin's sample fixture names its geofence "Sample group safety zone". "Safety zone" implies the area is safe. | The Trip Twin fixture must not use "safe" or "safety zone" in any name. Use "Hotel perimeter" or "Group zone". | 02 analyst (fixture) |
| F9 | Justin's people detail has a field called "Group boundary". His explanatory copy, the brief, 01 and 02 all say "group zone". | Trip Twin uses "Group zone" for the moving chaperone-anchored circles and "Trip boundary" for fixed geofences. Justin's value strings ("Unknown · location not current", "Unknown · boundary update overdue", "· uncertain boundary") are kept word for word. | Justin |

---

## 1. Information hierarchy

### 1.1 Element types

Every item on the Trip Twin screen is exactly one of these types. The type decides where the item lives and whether the operator can turn it off.

| Type | What it is | Where it lives | Can the operator hide it? |
|---|---|---|---|
| **Layer** | A spatial overlay drawn in the 3D scene (or flat plan view) | Hologram | Yes, through the Layers panel, unless marked *locked* |
| **Attribute** | A property of a drawn item (age, accuracy ring, floor band, hotel verdict) | On the item, in its hover and in its card | Only together with its parent layer. Accuracy rings and ages can never be hidden on their own |
| **Readout** | Non-spatial text: counts, lists, ages, source health, empty-state statements | Status rail (always), incident panel (Tier 1), More drawer (Tier 2), person card | No. Readouts never depend on whether a layer is visible. Turning off the People layer does not change the roster line |
| **Action** | Something the operator does: navigate, set an input, or start an existing lever | Toolbar, cards, breadcrumb | Shown or disabled per role (`capabilities.send_alert`, `capabilities.direct_group`). Security officers see sends as disabled with the reason "View-only role" |
| **Mandatory element** | Not a layer and not optional: status rail, sample watermark, OSM attribution | Fixed screen positions | Never |

Rule: **an operator question is answered by a readout first and a layer second.** The 3D view shows *where*; the rail and panels state *how many, how old, how sure*. This keeps the five-second read working when the hologram is cluttered, rotated or on a wall display.

### 1.2 Hierarchy driven by the 01 decision matrix

Ranks are from 01 section 5. Tier placement follows 01 ("Tier 0 / 1 / 2") with one change: rank 9 (approved destinations) is split. The rally points are Tier 0 as 01 says; the full destination list with times is Tier 1.

**Tier 0: always on screen when Trip Twin is open (five-second read)**

| 01 rank | Information | Element type | Where | Prototype |
|---|---|---|---|---|
| 1 | Hotel verdict per person (Inside (likely) / At hotel, undetermined / Outside, nearby / Away) | Attribute of People layer + Readout (roster line) | Pin badge; rail line 1 | Built (client computation) |
| 2 | Position state and age, accuracy, battery | Attribute (pin ring, label, card) + Readout (not-current list) | Pin; rail list | Fixture |
| 2 | Roster count line | Readout | Rail, line 1 | Built |
| 2 | Not-current list, oldest first, with age and battery | Readout | Rail, expandable list | Built |
| 4 | Outside group zone / Unaccompanied list; chaperone positions | Readout (rail line 2 + list) + Layer (group zone rings) + Attribute (C badge) | Rail; hologram | Fixture |
| 9 (part) | Rally point primary and secondary with walking time | Layer (Safety resources) + Readout (rail chip) | Hologram; rail | Fixture + OSRM |
| 10 | Local time, night/day | Readout | Rail header | Computed |
| — | Data age of every visible layer; snapshot age; source issues | Readout | Rail, source section | Built |
| — | Hotel outline and its match quality; context buildings | Layer (Site, locked) + Readout ("Hotel location approximate") | Hologram; rail | OSM |
| — | Sample watermark | Mandatory element | Full frame | Built |

**Tier 1: appears automatically when an incident or hazard is in focus**

"In focus" means one of: an operator-entered reported incident exists, a hazard proximity card (02 R1, R6, R8) is active, or the operator opens a hazard. Tier 1 opens the **incident panel**; it does not change layer toggles except as stated in 2.3.

| 01 rank | Information | Element type | Where |
|---|---|---|---|
| 5 | Official instructions slot (shows "No official instruction on file. Check local authorities." when empty) | Readout, permanent slot at the top of the incident panel | Incident panel |
| 6, 8 | Hazard location and extent, source, observation time, confidence | Layer (Hazards) + Attribute (age, source) + Readout (hazard card) | Hologram; incident panel |
| 6 | Distance and bearing from hotel and from each person | Readout (hazard card, person card) | Incident panel |
| 7 | Suggested path primary + alternate, closest approach to hazard, shared chokepoint | Layer (Paths) + Readout (path card) | Hologram; incident panel |
| 12 | Destination side relative to hazard ("in the direction of the heat detections") | Readout (path card) | Incident panel |
| 9 | Approved destinations with walk/drive time | Readout (destination list) | Incident panel |
| 11 | Floor band per person; reported incident floor; floor partition (above / at or near / below / floor unknown / not shared / no floor) | Attribute (band on hologram) + Layer element (reported floor slab) + Readout (floor partition) | Hologram; incident panel |
| 3 | Delivery and acknowledgement of the last message (sent / accepted by push provider / acknowledged) | Readout | Incident panel |
| — | Shelter-in-place option card (shown beside the paths, default card in unrest and active-threat types) | Readout | Incident panel |

**Tier 2: one action away (More drawer, or the relevant card)**

| 01 rank | Information | Element type | Opened from |
|---|---|---|---|
| 13 | Emergency numbers, police, embassy | Readout | More drawer |
| 14 | Headcount / muster status | Readout (+ badge on rally point when a muster exists) | More drawer; rally point card |
| 15 | Hotel interior, hotel assembly point, group floors (the hotel card; "Interior unknown" slot) | Readout | Hotel card |
| 16 | Emergency-capable hospitals with drive time | Readout (the glyphs are already on in Safety resources) | More drawer; hospital card |
| 17, 18 | Hazard trend, weather | Readout | Hazard card |
| 19 | Traffic, closures | Layer (P2, off) + Readout | Layers panel |
| 20 | Last-known trail: geofence crossings, co-located people | Readout in person card + Layer (Geofence crossings, off) | Person card |
| 21 | Group vehicle | Readout (hotel card slot, "Unknown") | Hotel card |
| 22 | Hotel elevation, coast distance, high ground | Readout | More drawer |

**Scenario promotion** (01 section 5): when the incident type is set, these Tier 2 items move into the incident panel. The prototype sets the type from the fixture.

| Incident type | Promoted into Tier 1 |
|---|---|
| Medical | Hospitals with drive time; emergency number |
| Missing person | Last-known trail; possible-area ring for that person |
| Hotel evacuation | Hotel card (assembly point, group floors, "Interior unknown"); floor partition at the top of the panel |
| Earthquake (coastal) | Elevation and high-ground direction |

### 1.3 Actions inventory

| Action | Label (exact) | Type | Exists today | Notes |
|---|---|---|---|---|
| Enter | Open Trip Twin | Navigation | New | See 4.1 |
| Leave | Exit Trip Twin | Navigation | New | Restores World View state (4.5) |
| Switch site | Site: {name} ▾ | Navigation | New | Lodgings of the trip; venues listed as "not in prototype" |
| Change scale | Building · Neighborhood · City | Navigation | New | Segmented control (4.2) |
| Plan view | Plan view (north up) / 3D view | View toggle | New | 01 anti-pattern 17 |
| Focus a person | (click pin or list row) | Navigation | Partly (`selectRecord`) | Opens person card |
| Focus a floor range | (click band or reported floor slab) | Navigation | New | 4.3 |
| Set reported floor | Add reported floor | Operator input | New (in memory only, 02) | Requires source text and floor; stamped with time and operator |
| Choose path destination | Show paths to… | Input | New | Approved destinations only |
| Recompute paths | Recompute | Input | New | Shown when a path is stale |
| Copy relay text | Copy for hotel / responders | Utility | New | Copies e.g. "M.R.: likely floor 10 (9–11), reading 4m old. Not verified." No full names unless on the operator console |
| Draft direction note | Draft note from path | Utility | New | Prefills Direct group note text (01 R9) |
| Broadcast | Send alert | Existing lever (`actions.js`) | Yes | org_admin and HQ only. Trip Twin never sends on its own |
| Direct group | Direct group here | Existing lever | Yes (Justin's label) | Same gating; destination must be approved |
| Hand off to globe | Show in World View | Navigation | New | For people or places beyond City scale |
| Sample clock | Play · Pause · Scrub | Sample only | New | Hidden outside sample mode |

There is no "Evacuate", "All clear" or "Stand down" action, now or later (01 doctrine 1, anti-pattern 16).

---

## 2. Layer taxonomy

### 2.1 Five groups, ordered by operator question

The visible top level of the Layers panel has exactly five groups. Order follows the five questions, so the panel reads top to bottom as the operator's reasoning. Q5 (freshness and trust) is not a group: it is the status rail, which cannot be turned off.

| Order | Group label | Answers | Why it is its own group |
|---|---|---|---|
| 1 | **People** | Q1 Where are my people? | P0, mandatory. Readouts depend on it |
| 2 | **Hazards** | Q2 What is the threat, and where? | Observed or reported conditions. Kept apart from Safety so that a hazard color never appears in a safety group |
| 3 | **Safety** | Q3 Where is safety? | SafeTrekr-approved places and services |
| 4 | **Paths** | Q4 How do they get there? | Computed, unverified street paths. Separated from Safety so "path" never inherits "safe" |
| 5 | **Site** | Orientation; the base for Q1 verdicts | The hologram and fixed places |

Group label notes:
- "Hazards", not "Threats". A satellite heat pixel or a crowd report is a hazard observation, not a confirmed threat. "Threat" stays in operator speech and in the five questions, and is a search synonym (3.11).
- "Paths", not "Routes". 01 R-rules call the drawn line a "suggested path". "Route" is kept for the computation in the code.

### 2.2 Layers in each group (prototype defaults)

Priority (P0/P1/P2) is from 02 section 5. "Locked" means the operator cannot turn it off inside Trip Twin.

| Group | Order | Layer label (exact) | What it draws | Priority | Prototype default | Toggle behavior |
|---|---|---|---|---|---|---|
| People | 1.1 | **Travelers & chaperones** (Justin's label) | Photo pins with T/C badge, accuracy ring at true scale, state ring, hotel-verdict badge, hotspot ring for attention states | P0 | On, **locked** | No role filter inside Trip Twin. Justin's traveler/chaperone checkboxes are not shown, because readouts count everyone |
| People | 1.2 | **Floor estimates** | Floor band slabs over the hotel, dashed tether to the ground pin, approximate floor-height grid on the hotel only | P0 (attribute) | On when an incident is in focus; otherwise off, one click | Coupled to 1.1. When off, the person card still shows the floor text. Wall-display mode forces it off unless an incident is open (01 [A9]) |
| People | 1.3 | **Group zone & trip boundaries** | Ground-plane rings for the chaperone group zone; fixed trip boundaries share this toggle (02) | P0 | On | Zone readouts (rail line 2) stay on when the layer is off |
| People | 1.4 | **Geofence crossings** | Hollow ticks at recorded enter/exit points with time | P1 | Off | Always listed in the person card regardless |
| Hazards | 2.1 | **Reported incidents** | Operator-entered reports (reported floor slab, crowd report areas with their stated uncertainty radius) | P0 (reported floor) | On whenever one exists | Can be hidden; the rail then shows "Reported incidents hidden (1)" |
| Hazards | 2.2 | **Satellite heat detections** | Pixel-sized ground footprints; off-screen edge bearings | P0 | On | Sub-toggle **Include low-confidence detections**: Off |
| Hazards | 2.3 | **Earthquakes** | Epicenter only when inside the site radius; otherwise a rail chip | P1 | Off (rail chip still shows events within 02 R8 range) | — |
| Hazards | 2.4 | **Public cameras** | Real provider cameras within 300 m of hotel or path | P2 | Not in prototype; row shown disabled "Not in prototype" | Seed, Street View and synthetic frames are never shown |
| Safety | 3.1 | **Safety resources** (Justin's label) | Category glyphs for all 12 categories; draft and unvetted styles; coverage-gap chips | P0 | On | Category sub-filters, all On: Rally points · Safe houses & relocation · Shelters · Medical (hospital, pharmacy) · Police & fire · Embassies & consulates · Other |
| Safety | 3.2 | **Unvetted OSM services** | Hollow glyphs, only for categories with no approved point | P2 | Not in prototype | — |
| Paths | 4.1 | **Suggested walking paths** | Primary + alternate from the hotel's street start to the chosen destination; paths for outside clusters back to the hotel when a hazard is in focus | P0 | On, destination = rally point (primary) | Destination picker. Max two destinations drawn at once (2.4) |
| Paths | 4.2 | **Driving paths** | Car profile paths | P2 | Not in prototype | — |
| Paths | 4.3 | **Live traffic** | TomTom-matched segments only | P2 | Not in prototype | Never shown when simulated |
| Paths | 4.4 | **Mapped entrances** | OSM `entrance=*` rings on the hotel edge, labeled unverified | P1 | Off | — |
| Site | 5.1 | **Hotel** | The highlighted subject footprint with match state | P0 | On, **locked** | — |
| Site | 5.2 | **Surrounding buildings** | OSM context buildings within ~500 m, height-source styling | P0 | On | Off = streets visible on the grid floor (useful with plan view) |
| Site | 5.3 | **Venues & itinerary stops** | Venue and stop markers within radius; edge bearings beyond | P1 | Off | — |
| Site | 5.4 | **Distance rings** | 250 m / 500 m / 1 km from the hotel | P1 in 02 | Off | 01 anti-pattern 23 counts fixed rings as noise. Keep off; cut if the prototype test shows no use (open question Q9) |

Not available inside Trip Twin (row not shown at all): aircraft, ships, satellites, military flights, bikeshare, simulated traffic, visual modes (night vision, FLIR, CRT and the rest), Google photorealistic tiles. Trip flights stay in World View (02 section 1g).

Visible layer rows: 13 in the prototype (8 active, 5 shown disabled or off). Each group has 2–4 rows, inside the 7±2 limit.

### 2.3 Couplings and mutual exclusions

| Rule | Type | Detail |
|---|---|---|
| C1 | Locked pair | Accuracy ring and age are part of every pin. They cannot be hidden separately (02 section 2.3). |
| C2 | Parent–child | Floor estimates (1.2) require Travelers & chaperones (1.1). Since 1.1 is locked, 1.2 can be turned on at any time. |
| C3 | Auto-on | Adding a reported floor turns Floor estimates on, and opens the floor partition readout. The operator can turn the layer back off; the partition stays in the panel. |
| C4 | Parent–child | Approximate floor-height grid lines appear only on the hotel and only while Floor estimates are on. Never on context buildings. |
| C5 | Dependency warning | Suggested paths check against hazards. If any Hazards layer is off, unavailable or stale, every path card shows "Hazard check incomplete: {layer} off/unavailable". The path is not hidden. |
| C6 | Dependency | A drawn path keeps its destination glyph visible even when Safety resources is off. |
| C7 | Readout independence | Turning off any People or Hazards layer never changes the roster line, the not-current list, the zone line or any hazard card. The rail adds "{layer} hidden" so the operator knows the view is filtered. |
| C8 | Mutually exclusive (view) | Plan view (north up) and 3D view. One at a time; layers are identical in both. |
| C9 | Mutually exclusive (mode) | Trip Twin and Justin's visual modes. Visual modes are suspended inside Trip Twin (F5). |
| C10 | Mutually exclusive (base) | Hologram and Google photorealistic tiles. The photoreal city is not drawn under the hologram (00-CONTEXT licensing and design). |
| C11 | Excluded source | Simulated traffic, seeded/synthetic cameras and Street View fallbacks are never rendered, even when their World View layer is on. |
| C12 | Wall mode | On a shared display: initials only, Floor estimates off unless an incident is open, person card shows no full names (01 [A9], anti-pattern 19). |

### 2.4 Default view on entry (prototype)

- Scale: Neighborhood. View: 3D, oblique, north up.
- On: Travelers & chaperones, Group zone & trip boundaries, Satellite heat detections, Reported incidents (if any), Safety resources, Suggested walking paths to rally point (primary), Hotel, Surrounding buildings.
- Floor estimates: on if the sample scenario has an incident (Demo A), else off.
- Incident panel open if the scenario has an incident in focus; else closed.
- Path destinations: at most two drawn at once (each with primary + alternate = four lines). A third choice replaces the oldest, with a "Path to {name} removed" note.

---

## 3. Controlled vocabulary

How to read the tables:
- **Label** is the exact operator-facing string. `{braces}` are values. ` · ` (space, middle dot, space) is the separator, as in Justin's UI. Sentence case throughout, as in Justin's UI.
- **Forbidden synonyms** must not appear in UI copy, tooltips, fixture names, or demo narration.
- IDs (e.g. `POS-01`) let 04, 05 and the developer reference a term without copying it.
- Strings marked **(Justin)** already exist in gods-eye-view and are reused unchanged.

### 3.1 Position states (one per person; first match wins, order from 02 section 2.3)

| ID | State chip | Readout text (person label / card) | Definition | Forbidden synonyms |
|---|---|---|---|---|
| POS-01 | Not located | No location reported **(Justin)** | No coordinates have ever been received for this person on this trip | Missing, lost, offline, at hotel |
| POS-02 | Time unknown | Capture time unknown **(Justin)** | Coordinates exist, but there is no usable capture time, so we cannot say when they were there | Live, current, recent |
| POS-03 | Stopped · current | At this location for {3h} **(Justin)** · contact {4m} ago | The phone stopped GPS on purpose while stationary and answered a location check within 40 min; treat the position as current | Idle, inactive, asleep, live, safe |
| POS-04 | Live | {34s} ago **(Justin)** · ±{18} m | Fix is 120 s old or less | Real-time, tracking, exact, confirmed |
| POS-05 | Aging | Aging · {4m} ago **(Justin)** · ±{18} m | Fix is between 120 s and 10 min old; where they were, not where they are | Recent, current, delayed |
| POS-06 | Last known | Last known · {2h} ago **(Justin)** | Fix is more than 10 min old | Stale (internal only), missing, lost, current |
| POS-06b | Last known | Did not answer a location check · Updated {52m} ago **(Justin)** | Stopped phone that has not answered a location check in 40 min | Asleep, fine, stopped · current |

Modifiers (added after the state, never replacing it):

| ID | Label | Definition | Forbidden |
|---|---|---|---|
| POS-M1 | ±{n} m | Phone-reported accuracy radius. Hover: "About 2 in 3 chance the phone is inside this ring" | "precise", "exact", decimals |
| POS-M2 | Accuracy unknown | Phone sent no accuracy. No ring is drawn | Any guessed radius |
| POS-M3 | Approx. · ±{180} m | Accuracy worse than 100 m. Hotel and zone verdicts become undetermined | — |
| POS-M4 | Battery {6}% · discharging | Battery at the time of the fix (Justin's field "Battery at capture") | "dead phone" as a fact. Use "likely dead phone" only in the not-current list hint |
| POS-M5 | Traveler data delayed {1m 10s} | Snapshot more than 45 s old; every private layer is treated one state older | "offline", "down" |

Grouping term: **Not current** = Aging + Last known + Time unknown. **Not located** is counted separately. "Current" = Live or Stopped · current.

### 3.2 Hotel verdict (per person) and roster count line

All verdicts require a current fix (Live or Stopped · current) and use **2x the accuracy radius** (F2).

| ID | Label (roster line) | Long form (person card) | Definition | Forbidden synonyms |
|---|---|---|---|---|
| HTL-01 | Inside (likely) | Inside hotel (likely) | The real (not approximate) hotel outline contains the whole 2x accuracy circle, OR the fix is inside and a current floor band is 2 or more floors above the lobby, OR the phone has been stopped · current since its last hotel-perimeter entry | In hotel, inside, safe, sheltered, in room, accounted for |
| HTL-01b | Inside (likely) | Inside building (likely) | Same, when the hotel shares its building with other uses | Inside hotel |
| HTL-02 | At hotel, undetermined | At hotel · inside or outside undetermined | Current fix whose 2x circle crosses the hotel outline, or the hotel outline is approximate, or accuracy is unknown or worse than 100 m near the hotel | Probably inside, at hotel (alone), on site |
| HTL-03 | Outside, nearby | Outside hotel · {120} m {N} | The whole 2x circle is outside the outline and the fix is within ~150 m (01 [A5]) | Out, evacuated, cleared the building, safe |
| HTL-04 | Away | Away · {2.1} km {SW} of hotel | Current fix more than ~150 m from the hotel | Missing, elsewhere, off-site |
| HTL-05 | (counted as Not current) | Last known inside (likely) · {5m} ago | Any verdict from a fix that is not current. Shown on the card, never counted as inside | Inside, at hotel |
| HTL-06 | — | Hotel location approximate: inside/outside cannot be determined | Hotel point not matched to a real outline (02 R12). Inside (likely) shows "—" in the roster line | Near hotel = inside |

**Roster count line** (rail, line 1). Buckets are mutually exclusive and always sum to the loaded roster:

`Inside (likely) 18 · At hotel, undetermined 6 · Outside, nearby 2 · Away 5 · Not current 3 · Not located 0 · of 34 loaded`

- "of N loaded" is Justin's and Core's honesty rule: only count what was loaded. Never "of 34 travelers" when the roster is partial.
- A bucket with 0 stays visible. Hiding it would read as "not applicable".
- Never: "34 safe", "all accounted for", "all in", "everyone located".

### 3.3 Group zone and accompaniment

| ID | Label | Definition | Forbidden synonyms |
|---|---|---|---|
| ZON-01 | Group zone | The moving area made of circles around eligible chaperones, computed by SafeTrekr (Core). The layer name | Safety zone, safe zone, safe area, geofence (for the moving zone) |
| ZON-02 | Trip boundary | A fixed geofence configured for the trip, e.g. "Hotel perimeter" **(Justin: "Trip boundary")** | Safety zone, perimeter (alone, without the name) |
| ZON-03 | Inside group zone | Core reports the person inside, with a current fix and a current zone | With the group, accompanied (see ZON-06), safe |
| ZON-04 | Outside group zone | Core reports the person outside, with a current fix and a current zone | Lost, wandered off, missing, breach, violation |
| ZON-05 | {Inside/Outside} · uncertain boundary **(Justin)** | Core flagged the result ambiguous or the zone is degraded | Possibly outside (02 R4 wording, replaced by this) |
| ZON-06 | Unaccompanied | Current traveler with no current chaperone within the zone radius (01 2.5) | Alone, abandoned, unsupervised |
| ZON-07 | Unknown · location not current **(Justin)** | The person's fix is not current, so no zone state | Outside |
| ZON-08 | Unknown · boundary update overdue **(Justin)** | Zone not refreshed within min(45 s, valid_for_seconds) | Zone lost |
| ZON-09 | Unknown · no current group boundary **(Justin)** | No zone supplied (no eligible chaperone fixes) | — |
| ZON-10 | Approximate boundary | Zone degraded: chaperone fixes have reduced accuracy **(Justin's copy)** | — |
| ZON-11 | Exit recorded {22:14} / Entry recorded {22:31} | A recorded crossing. Card copy **(Justin)**: "The map point is the recorded transition location, not a current position." | Left the hotel, returned (as current facts) |

Rail line 2: `Outside group zone 2 · Unaccompanied 3 · Zone unknown 5`. Zone unknown = ZON-07 + ZON-08 + ZON-09.

### 3.4 Floor estimates

Unit rule: when the building's floor numbering is set (prototype hotel: set by hand to US numbering, lobby = floor 1), labels use **floor** numbers, because that is what the hotel and responders use. When numbering is not set, labels use **levels above lobby** and add "Floor numbering not verified" (reconciles 01 2.6 and 02 2.5).

| ID | State | Label (exact) | Definition | Forbidden |
|---|---|---|---|---|
| FLR-01 | Estimate ±1 | Likely floor {7} ({6}–{8}) · {3m} ago | Band of at most 3 floors from a current reading, anchored at the lobby. The middle number is the likeliest, the range is where to search | "Floor 7", "7F", "on floor 7", "7th floor", "Room…", "level 7" (bare) |
| FLR-01u | Estimate ±1, numbering not set | Likely level {6} above lobby ({5}–{7}) · {3m} ago · Floor numbering not verified | Same, where the hotel's numbering convention is unknown | Converting to a floor number by assumption |
| FLR-02 | Rough ±2 | Rough: floors {5}–{9} · {3m} ago | Band of 4–5 floors. No middle number is shown | "Likely floor 7" when the band is rough |
| FLR-03 | Aging | Likely floor {7} ({6}–{8}) · {5m} ago · aging | Band from a reading 2–10 min old (follows the position's state) | — |
| FLR-04 | Last estimate | Last est. floors {6}–{8} · {25m} ago · not current | Reading more than 10 min old, or position Last known | Current floor |
| FLR-04b | Last estimate, stopped phone | Last est. floors {6}–{8} · {25m} ago · vertical movement not tracked while phone is stopped | Phone stopped GPS and barometer together (02 P07) | — |
| FLR-05 | Floor unknown | Floor unknown — {reason} | No band. Always counted in the floor partition | Blank, "Ground", "Lobby", "0", "—" alone |
| FLR-06 | Not shared | Floor not shared | Traveler has not consented to floor-level location (mocked in prototype). Distinct from unknown | Floor unknown, hidden, private |
| FLR-07 | No floor | (nothing on the pin; partition bucket "No floor (not at hotel)") | Person is Outside, nearby / Away / Time unknown / Not located, or Last known with a last verdict away from the hotel. Floors are meaningless outdoors | Floor unknown (for outdoor people), ground floor |

**Floor unknown reasons** (reason codes from 02 2.5, wording from 01 2.6). Each card adds the action line "Ask the chaperone or check the hotel's room list."

| Code | Label after "Floor unknown — " |
|---|---|
| `no_barometer` | phone has no pressure sensor |
| `no_anchor` | no ground reference since this phone entered the hotel |
| `anchor_expired` | ground reference too old ({6h}) |
| `position_stale` | position not current |
| `band_too_wide` | estimate too uncertain (more than 5 floors) |
| `inconsistent_with_building` | reading does not fit this building's height |
| `sensor_jump` | pressure reading disturbed |
| `building_levels_unknown` | Not a failure. Adds the note "Floor count not verified: bands are wider" |

**Reported floor and floor partition**

| ID | Label | Definition | Forbidden |
|---|---|---|---|
| FLR-10 | Reported: {smoke} · floor {9} · {hotel desk} · {02:12} · not verified | Operator-entered report, stamped with source, time and operator initials | Fire floor (as fact), confirmed, incident floor (without "Reported") |
| FLR-11 | At or above reported floor {9}: {3} | Count of people whose band touches or is above the reported floor (01 fire-floor rule). The priority count | Trapped, in danger, at risk |
| FLR-12 | Partition line | `Above 1 · At or near 2 · Below 9 · Last est. only 2 · Floor unknown 3 · Not shared 1 · No floor (not at hotel) 16 · of 34 loaded` | Collapsing Floor unknown or Last est. only into Below. "Safe" for Below |

"At or near" = the band overlaps the reported floor. "Above" and "Below" = the whole band is above or below. Above / At or near / Below use current and aging bands only (FLR-01 to FLR-03). "Last est. only" = people whose newest band is FLR-04 (02 R15 keeps stale estimates in their own group). FLR-11 = Above + At or near; the card adds "+ {2} with last estimate at or above" when any FLR-04 band touches or is above the reported floor.

### 3.5 Hologram, hotel and site

| ID | Label | Definition | Forbidden |
|---|---|---|---|
| SIT-01 | {Hotel name} | The subject building, name from the trip's lodging record | Safe zone, base, HQ, secure location |
| SIT-02 | Building matched | Hotel point lies inside a real OSM outline | Verified building |
| SIT-03 | Matched by proximity | Nearest real outline within 30 m (02 [A2]) | — |
| SIT-04 | Hotel location approximate | No outline within 30 m; a drawn disc stands in | Hotel (unqualified) |
| SIT-05 | Height {52} m (mapped) | OSM `height` tag | Measured, exact |
| SIT-06 | Height ~{46} m (est. from {14} levels) | `building:levels` x 3.3 m | — |
| SIT-07 | Height unknown (shape only) | Footprint-size heuristic; no height label on the building | A number |
| SIT-08 | Interior unknown | No floor plan, exits or stairwells are known. Shown on the hotel card and as the hotel's hover until a hotel card exists | Exit, stairwell, fire exit, corridor (drawn or named) |
| SIT-09 | Approx. floor heights | Horizontal grid lines on the hotel, from OSM levels. Visible only with Floor estimates | Floors, floor plates |
| SIT-10 | No OSM buildings mapped here | Empty grid area with no OSM data | "No buildings" |
| SIT-11 | Buildings unavailable since {14:20} | Overpass failed with no cache | Empty scene with no message |
| SIT-12 | Map data © OpenStreetMap contributors (ODbL) | Required attribution, always visible | — |
| SIT-13 | Mapped entrance (OSM, unverified) | `entrance=*` node | Exit, fire exit, evacuation exit |
| SIT-14 | Approximate start | Path origin at the address point on the street edge, no mapped entrance | Exit, front door |

### 3.6 Safety resources

Category labels replace the raw `human(category)` strings in Trip Twin.

| ID | Category value | Label | Glyph shape (5.2) |
|---|---|---|---|
| SAF-01 | `rally_primary` | Rally point (primary) | Flag, solid |
| SAF-02 | `rally_secondary` | Rally point (secondary) | Flag, outlined pole |
| SAF-03 | `safe_house` | Safe house · {primary/secondary} | House |
| SAF-04 | `relocation` | Relocation site | House with inward arrow |
| SAF-05 | `shelter` | Shelter (+ "legacy: {church}" in hover) | Roof |
| SAF-06 | `hospital` | Hospital | Cross |
| SAF-07 | `police` | Police | Shield |
| SAF-08 | `fire` | Fire station | Ladder |
| SAF-09 | `pharmacy` | Pharmacy | Capsule |
| SAF-10 | `embassy` | Embassy | Flag on a disc |
| SAF-11 | `consulate` | Consulate | Flag on a disc, outlined |
| SAF-12 | `other` | Other: {name} | Dot in circle |

States and qualifiers:

| ID | Label | Definition | Forbidden |
|---|---|---|---|
| SAF-20 | Approved | `approval_status=active`. Replaces Justin's "Active" in Trip Twin ("Active" next to a hazard reads as "active incident") | Verified, safe, open, operational |
| SAF-21 | Draft, not approved **(02)** | Draft record; cannot be a Direct group destination | Pending, proposed |
| SAF-22 | Reviewed {14 mo} ago | Review age over 12 months | Outdated, invalid |
| SAF-23 | No location on file | Record without coordinates; listed, not placed | — |
| SAF-24 | Chaperone-only / Internal | Visibility tag | Secret |
| SAF-25 | No approved {pharmacy} on file for this hotel | Coverage gap from SafeTrekr records (02 R7) | None nearby, no pharmacies |
| SAF-26 | Hours: "{raw text}" · not verified | Free-text hours | Open now, 24/7, open |
| SAF-27 | ER status not verified | Every hospital without structured capability data | Emergency room, trauma center (as facts) |
| SAF-28 | OSM · not vetted by SafeTrekr | Unvetted OSM service (P2) | — |
| SAF-29 | {4.1} km {NE} → | Edge bearing for a resource beyond the current scale | — |

### 3.7 Paths

| ID | Label | Definition | Forbidden |
|---|---|---|---|
| PTH-01 | Suggested path (unverified) | A walking path from OpenStreetMap streets, computed by SafeTrekr. The layer's item name | Safe route, evacuation route, escape route, exit route, recommended route, best route, clear route |
| PTH-02 | Primary / Alternate | The two paths to one destination. "Alternate" is used only when it shares no chokepoint and not the first ~200 m (01 R1) | Backup, safe alternative |
| PTH-03 | OSM street path · not checked for closures, crowds, lighting, crime or damage | Permanent caption on every path card. Merges 01's caveat and 02's "not hazard-checked" | Shortened forms that drop the caveat |
| PTH-04 | {850} m · walk {11}–{17} min (group pace) · drive {4} min (no traffic data) | Path readout. Always a range for walking time | Single ETA, "arrive at 02:34" |
| PTH-05 | Closest approach to hazard: {420} m | Minimum distance between the path and any hazard footprint | Safe distance, clear of hazard |
| PTH-06 | Passes within buffer | Path enters a hazard buffer. Drawn greyed, not a candidate | Blocked (unless officially closed), unsafe |
| PTH-07 | No independent alternate: both paths use {Congress Ave Bridge} | No alternate passes 01 R1 | — |
| PTH-08 | Chokepoint: {bridge name} | A segment every computed path shares, or an OSM bridge/tunnel/steps/gate | Danger point |
| PTH-09 | In the direction of the hazard | Destination lies toward the hazard from the hotel (02 R3, 01 R3) | Unsafe destination |
| PTH-10 | From last known position, {7} min old | Path origin is not a current fix (01 R4) | From {name} (implying current) |
| PTH-11 | Path computed {3m} ago · hazard data {47m} old | Path age (01 R8) | — |
| PTH-12 | Stale · Recompute | Path older than 10 min, or an endpoint or hazard changed | — |
| PTH-13 | Suggested arrive-by: {35} min ({12} prepare + {16} walk + {7} buffer) | Arrive-by suggestion with its arithmetic (01 R6) | Deadline, ETA |
| PTH-14 | Below the walking time for this path | Warning when the operator's arrive-by is below the lower bound | — |
| PTH-15 | Hazard check incomplete: {Satellite heat detections} {off/unavailable} | Coupling C5 | — |
| PTH-16 | SafeTrekr suggestion | Source tag. Any official evacuation route, when one exists, is shown above it labeled "Official route · {authority}" | — |
| PTH-17 | Shelter in place | Option card shown beside paths: stay inside, away from windows and the lobby. An option, not a verdict | Lockdown (unless official), stay safe |
| PTH-18 | Path unavailable: routing service did not respond ({14:20}) | Upstream failure | No path exists |

### 3.8 Hazards

| ID | Label | Definition | Forbidden |
|---|---|---|---|
| HAZ-01 | Satellite heat detections **(Justin's alert feed)** | NASA FIRMS VIIRS pixels. Layer name | Active fires (in Trip Twin), wildfire, fire, blaze |
| HAZ-02 | {3} heat detections · {2.4} km {NW} · VIIRS · {3h} ago · not confirmed as wildfire | Hazard card headline (02 R1) | Fire approaching, fire front, perimeter, spreading |
| HAZ-03 | Observed {3h} ago (satellite pass {11:20}) | FIRMS age is the pass time, never ingest time | Live, real-time, now |
| HAZ-04 | Possible industrial heat source | Detection on industrial land | False alarm |
| HAZ-05 | Low-confidence detection | FIRMS confidence `l`; hidden by default | — |
| HAZ-06 | Heat detections within {3} km / {10} km / {25} km | Distance bands replacing Awareness / Watch / Warning (F4) | Watch, Warning, Advisory, Alert, Danger |
| HAZ-07 | No FIRMS heat detections within 25 km in the last 24 h (latest data {14:20 UTC}). Satellites miss fires under cloud or smoke and between passes. | Empty state (02 2.4) | No fires, all clear, clear |
| HAZ-08 | Reported: {crowd moving south on Congress at 6th} · {source} · {17:28} · location ± {500} m · not verified | Human report (prototype: fixture, labeled) | Protest zone, riot area (as drawn facts) |
| HAZ-09 | Location approximate (city) | Region-level intel shown as a banner, never pinned (01 anti-pattern 14) | — |
| HAZ-10 | M{5.4} · {82} km {SW} · {12m} ago · USGS {automatic} · distance only, not a shaking estimate | Earthquake chip (02 R8) | Felt, damage, impact |
| HAZ-11 | No official instruction on file. Check local authorities. | Empty official-instruction slot (01) | No orders, nothing required |
| HAZ-12 | Official: {instruction} · {authority} · {time} | A filled official-instruction slot (HUMAN in prototype) | — |
| HAZ-13 | Possible area, not a prediction | Possible-area ring for a not-current person (01 2.3, S7) | Probable location, search area, likely position |
| HAZ-14 | Verify before acting | Caveat for cross-source judgments (02 C3) | — |

Caveat level words (02 section 3, shown as words on every judgment card):

| Level | Label |
|---|---|
| C0 | Recorded |
| C1 | SafeTrekr calculation |
| C2 | Distance check |
| C3 | Verify before acting |
| C4 | (never shown) |

### 3.9 Freshness, provenance and source health

Every item has one **time state** and one **provenance tag**. Approximate geometry is a separate flag.

Time states for layers and feeds (02 2.1, operator words):

| ID | Label | Definition | Forbidden |
|---|---|---|---|
| FRS-01 | Live | Within the source's live threshold (02 2.2). Never used for FIRMS | Real-time, streaming |
| FRS-02 | Updated {3h} ago | Older than live, within the stale threshold | — |
| FRS-03 | Stale **(Justin's badge)** · last update {14:20} | Beyond the stale threshold, or served past its cache life | Old, expired |
| FRS-04 | Unavailable — {reason} | No data, keyless, error with no cache | Empty, none, 0 (as a count) |
| FRS-05 | Reviewed {3 mo} ago | Reference records (safety points, boundaries) | Verified |
| FRS-06 | Snapshot · {12s} ago **(Justin)** / Sample · {12s} ago **(Justin)** | Core snapshot age in the rail | — |
| FRS-07 | Feed interrupted · snapshot {70s} old **(Justin)** | Poll failure | Offline (alone) |
| FRS-08 | {Geofence history} is unavailable / is incomplete **(Justin's alert-feed wording)** | Core `source_issues` | — |
| FRS-09 | Key needed **(Justin)** | Server key missing | — |
| FRS-10 | {Layer} hidden | A layer is off while its readouts are still counted (C7) | — |

Provenance tags (reconciles 01's VERIFIED/CURATED/MAPPED/COMPUTED/UNKNOWN with 02's flags):

| ID | Tag | Applies to | Definition |
|---|---|---|---|
| PRV-01 | Verified · {by whom} · {date} | Hotel card items (future) | Confirmed by someone on site or by the hotel. Nothing in the prototype carries this tag |
| PRV-02 | Approved | Safety resources | SafeTrekr-approved record (01 "CURATED") |
| PRV-03 | OSM | Buildings, entrances, unvetted services | OpenStreetMap, not verified (01 "MAPPED") |
| PRV-04 | Computed | Verdicts, paths, floor bands, distances | Derived by Trip Twin (01 "COMPUTED") |
| PRV-05 | Reported | Operator-entered and human reports | Came from a person; not verified |
| PRV-06 | Unknown | Any empty slot | Not available. The slot is shown, not omitted |
| PRV-07 | Approx. | Any geometry (flag, not a tag) | Uncertainty at or above the decision scale (02 APPROXIMATE) |
| PRV-08 | Sample · fictional | Everything in sample mode | Fixture data. Full-frame watermark "SAMPLE DATA · fictional people and events" |

### 3.10 Messages and accountability (existing levers)

| ID | Label | Definition | Forbidden |
|---|---|---|---|
| MSG-01 | Sent {22:41} | Core accepted the send | Delivered, received |
| MSG-02 | Accepted by push provider: {24} | Core `push_delivery` (02) | Delivered, seen |
| MSG-03 | {7} acknowledged **(Justin)** | Acknowledgement count, no denominator | 7/24, read, confirmed safe |
| MSG-04 | {11} present · {2} absent · {3} unmarked **(Justin)** | Muster counts. Unmarked is never folded into present | Accounted for |
| MSG-05 | At destination {6} · En route {10} · Position unknown {8} | Direction progress (02 R10) | Arrived (for all), complete |
| MSG-06 | Re-entry and stand-down: hotel or authorities only | Fixed line in the incident panel (01) | All clear, stand down (as an action) |
| MSG-07 | View-only role | Reason shown on disabled send controls for security officers | — |

### 3.11 Words never to use, and synonym ring

**Never use, anywhere in Trip Twin** (UI, tooltips, fixture names, demo script). Each has a replacement.

| Never | Why | Use instead |
|---|---|---|
| safe, safely, safe route, safe zone, safety zone, secure | Claims verified safety we never have | Approved (resources), Suggested path (unverified), Group zone |
| all clear, clear, no threats, all good, nominal, normal, OK, green (as status) | Absence presented as an all-clear (Core rule). "NOMINAL" is the reference film's HUD word | Bounded empty states (HAZ-07); counts with "of N loaded" |
| accounted for, all in, everyone located, confirmed (for people) | Accountability comes from people, not pins (01 doctrine 4) | Roster count line buckets |
| evacuated, out, got out, cleared the building | GPS cannot prove it | Outside, nearby (with 2x rule) |
| missing, lost, wandered off | Implies a conclusion | Not current; Last known; Not located; Outside group zone |
| room, unit, side of building, wing (for people) | Never shown (00-CONTEXT) | Floor band only |
| Floor {n} (bare), {n}F, {n}th floor, on floor {n}, level {n} (bare) | False precision | FLR-01 to FLR-04 |
| exact, precise, pinpoint, real-time, live tracking | Implies precision or continuity we lack | Live · {age} · ±{n} m |
| predicted, probable location, projected, fire front, spread, perimeter (for FIRMS) | Predictions are out of scope (02 C4) | Possible area, not a prediction; heat detections |
| danger zone, risk score, threat level, at risk | Unsourced scoring | Distance check wording (HAZ-06) |
| Watch, Warning, Advisory, Alert (for our computations) | Reserved for official sources (F4) | Distance bands |
| evacuate, shelter (as commands), stand down, all clear (as buttons) | The operator never declares these (01 doctrine 1) | Information steps; Shelter in place as an option card |
| delivered, read, seen | Push acceptance is not delivery (Core) | MSG-01 to MSG-03 |
| open now, 24/7, operational, staffed, capacity available | Not known | SAF-26, SAF-27 |
| fire exit, emergency exit, stairwell, exit route (drawn or labeled) | No indoor data | Interior unknown; Mapped entrance (OSM, unverified) |
| FLIR, thermal, night vision (inside Trip Twin) | Implies sensors we lack | Not available inside Trip Twin |
| Active (for safety resources) | Collides with "active incident" | Approved |

**Synonym ring** (for the roster filter, the layer panel filter and any future command search; maps operator speech to preferred terms):

| Operator may type or say | Resolves to |
|---|---|
| threat, danger, incident, fire, wildfire, hotspot | Hazards group; Satellite heat detections; Reported incidents |
| route, escape route, evacuation route, way out, exit route | Paths group; Suggested walking paths |
| students, kids, participants, group | Travelers & chaperones |
| leaders, teachers, staff, adults | Chaperones (role filter in the roster list) |
| geofence, perimeter, boundary, safety zone | Group zone & trip boundaries |
| safe house, rally, meeting point, muster point | Safety resources (category filter) |
| ER, A&E, clinic, emergency room | Hospital |
| floor, level, storey, height | Floor estimates |
| missing, lost, no signal, offline | Not current list; Not located |
| hotel, lodging, accommodation | Hotel (Site) |

### 3.12 Conflict register (what was chosen, from which source)

| Concept | 01 says | 02 says | Justin says | Chosen | Reason |
|---|---|---|---|---|---|
| Current, fresh fix | Live | LIVE · MOVING | (no word) "34s ago" | Live · {34s} ago | Operator needs a word in the chip; Justin's age string is kept |
| Stopped phone | Stopped, current | STOPPED · CURRENT | At this location for {25m} | Chip "Stopped · current"; readout Justin's + contact age | Both ages visible (02) |
| 2–10 min fix | Aging | RECENT (aging) | Aging · {4m} ago | Aging | Justin + 01 agree |
| > 10 min fix | Stale / last known | STALE (last known) | Last known · {2h} ago | Last known | "Stale" is jargon for a person |
| No time | Unknown | TIME UNKNOWN | Capture time unknown | Time unknown / Capture time unknown | Justin |
| No location | Unknown | NOT LOCATED | No location reported | Not located / No location reported | Separate bucket (02) |
| Inside | Inside (likely) | AT HOTEL | — | Inside (likely) | "At hotel" does not say inside |
| Edge case | At hotel, undetermined | HOTEL EDGE | — | At hotel, undetermined | Covers approximate outlines too, not only edges |
| Near outside | Outside, nearby | OUTSIDE HOTEL | — | Outside, nearby | Keeps the 150 m distinction |
| Far | Away | Elsewhere | — | Away | Shorter |
| Floor | Floor likely 7 (6–8) | ≈ level 6 above lobby (5-7) · est. | — | Likely floor 7 (6–8) when numbering set; levels above lobby otherwise | Responders use floor numbers; 02's unit kept as the fallback |
| Path | Suggested path (unverified) | Shortest mapped path · not hazard-checked | — | Suggested path (unverified) + caption PTH-03 | Neither label alone carried both facts |
| Zone noun | group zone | Group zone | "Group boundary" (field), "group zone" (copy) | Group zone | Brief, 01, 02 and Justin's copy |
| FIRMS | heat detections | Satellite heat detections | "Active fires" (toggle), "Satellite heat detections" (feed) | Satellite heat detections | Does not over-claim |
| Approval | CURATED | REFERENCE | "Active" / "Draft" | Approved / Draft, not approved | "Active" collides with incidents |
| Proximity bands | — | Awareness / Watch / Warning | — | Distance wording | F4 |

---

## 4. Wayfinding

### 4.1 Entering Trip Twin from World View

Trip Twin opens on **one site** (a trip's lodging) of **one trip**. Entry points, all ending in the same state:

| # | From | Control (exact label) | Clicks from World View home |
|---|---|---|---|
| E1 | Lodging marker or lodging row in the Safety tab → place detail card | **Open Trip Twin** (primary button on lodging cards only) | 2 |
| E2 | Person detail card, when the person's trip has a lodging | **Open Trip Twin at {hotel name}** | 2 (person row → button) |
| E3 | Alert item near a lodging (hazard proximity) | **Open Trip Twin** | 2 |
| E4 | Sample mode: "Explore a sample trip" **(Justin)**, then E1 | Same buttons | 3 |
| E5 | Deep link `?twin={lodging_id}` [IA-A3] | — | 0 |

Rules:
- If the trip has more than one lodging, E2 and E3 open the lodging nearest the person or the hazard. The site switcher lists the others.
- Venues: the site switcher lists them as "{venue} · not in prototype" (disabled). Venue Twins are P1.
- Entering clears any World View visual mode (F5) and remembers it for exit.
- During an open incident the photoreal-to-hologram transition is capped at ~1 s or skipped (01 anti-pattern 1, 01 [A19]); 05 owns the motion.

**3-click check** (from World View, trip already listed):
- Any person's floor band: lodging → Open Trip Twin → person in the not-current or floor list = 3.
- Reported floor partition: Open Trip Twin (2) → Add reported floor (3).
- Paths to a hospital: Open Trip Twin (2) → hospital glyph → Show paths to… (3), or More → Hospitals (3).
- A person beyond City scale: their edge chip → Show in World View (3, after entry).

### 4.2 Scale: Building · Neighborhood · City

Scale is a zoom state of the same site, not a navigation level. It does not appear in the breadcrumb; it shows as a segmented control in the toolbar with the current scale pressed.

| Scale | Extent [IA-A1] | What is drawn | What becomes edge chips |
|---|---|---|---|
| Building | Hotel outline + ~150 m (the "Outside, nearby" distance) | Hotel, floor bands readable, accuracy rings, zone rings, nearby resources | Everything beyond 150 m |
| Neighborhood (default) | ~500 m site radius (02 [A1]) | Full hologram, paths, rally points, nearby hazards | Relocation, embassy, away people, distant hazards |
| City | Up to ~5 km | Hologram stays at 500 m; beyond it a flat grid with glyphs only (no invented buildings) | Items beyond 5 km |

- Mouse wheel and orbit change the camera freely; the segmented control snaps to a preset. When the free camera passes a threshold, the pressed segment updates.
- Edge chips: `{label} {distance} {bearing} →`, for example `Relocation site 4.1 km NE →`, `5 away →`. Clicking a chip moves to the scale that contains the item, or offers "Show in World View" if beyond City.
- City scale is the widest Trip Twin goes. Wider means World View.

### 4.3 Drill-down: person and floor range

**Person focus** (click a pin, a list row, or a name in the not-current / outside-zone list):
- Camera centers on the person at the current scale (no forced zoom). Other people dim but stay visible and counted.
- Person card opens: state, age, accuracy, battery, hotel verdict, group zone, floor (with reason when unknown), last crossing, nearest current chaperone and distance, possible-area ring toggle for not-current people, Copy for hotel / responders.
- Breadcrumb gains `{initials} ({role})`.
- Next/previous within the list the operator came from (e.g. not-current list, oldest first). Keys proposed: `[` and `]` [IA-A4].

**Floor-range focus** (click a floor band, the reported floor slab, or a row of the floor partition):
- The hotel hologram above the selected range turns to outline only; the range is highlighted; the approximate floor-height grid shows labels for that range only.
- The panel lists every person whose band intersects the range, grouped Above / At or near / Below relative to the reported floor, plus Floor unknown and Not shared, which are always listed in this view.
- No interior is drawn. The hotel shows "Interior unknown" in the focused range.
- Breadcrumb gains `Floors {9}–{11}`.

Person focus and floor focus nest at most one level: focusing a person from inside a floor focus gives `… › Floors 9–11 › M.R. (traveler)`. There is no deeper level.

### 4.4 Location indication (breadcrumb and header)

Header (always visible, top left):

`TRIP TWIN · {hotel name} · {trip title}` plus `SAMPLE` tag in sample mode, plus the local time `02:14 local (CDT)` and night chip `Night · civil dusk 18:42`.

Breadcrumb (under the header):

`World View › {trip title} › {hotel name} › {focus}`

| Segment | Click does |
|---|---|
| World View | Exit Trip Twin (4.5) |
| {trip title} | Exit Trip Twin to World View filtered to that trip (Justin's "View trip participants" behavior) |
| {hotel name} | Clear focus, stay in Trip Twin at the current scale |
| {focus} | Current location; not a link (`aria-current="location"`) |

Truncation: the trip title truncates first (to 24 characters with an ellipsis and a full-text tooltip), then the hotel name. The focus segment never truncates.

### 4.5 Leaving and what persists

- **Esc** unwinds one level: close card → clear person focus → clear floor focus → stop. Esc never exits Trip Twin, so an operator cannot lose the incident view by tapping Esc repeatedly.
- **Exit Trip Twin** (toolbar button) or the World View breadcrumb segment exits. World View is restored exactly: camera, layer toggles, visual mode, selected record, open panel. This meets the 00-CONTEXT rule that World View is unchanged for users who never open Trip Twin.

| State | Across scale changes | Across person / floor focus | Across site switch | After exit and re-entry (same session) |
|---|---|---|---|---|
| Trip, snapshot polling, roster line, rail | Kept | Kept | Kept (rail recomputes for the new site) | Kept |
| Layer toggles | Kept | Kept | Kept | Kept [IA-A5] |
| Reported floor / reported incidents | Kept | Kept | Kept per site | Kept in memory for the session; exit shows "Reported floor kept for this session" (prototype has no storage, 02) |
| Incident panel open/closed | Kept | Kept | Kept | Kept while the incident exists |
| Chosen path destinations | Kept | Kept | Reset (paths belong to a site) | Kept per site |
| Person or floor focus | Kept | — | Cleared | Cleared |
| Camera and scale | — | Kept | Reset to Neighborhood | Reset to Neighborhood |
| Plan view / 3D | Kept | Kept | Kept | Kept |
| Sample clock position | Kept | Kept | Kept | Kept |
| World View state | Untouched while in Trip Twin | — | — | Restored on exit |

### 4.6 Keyboard, focus and screen reader structure

| Requirement | Specification |
|---|---|
| Landmarks | `<header>` (Trip Twin header), `<nav aria-label="Breadcrumb">`, `<nav aria-label="Trip Twin view">` (toolbar: scale, plan view, layers, exit), `<main id="trip-twin-scene">` (canvas with an accessible description), `<aside aria-label="Status">` (rail), `<aside aria-label="Incident">` (incident panel), `<aside aria-label="Details">` (person or resource card) |
| Skip link | "Skip to status" → rail. The canvas cannot be the only path to any answer: every drawn item is also reachable as a list row |
| Live regions | Roster line and floor partition are `aria-live="polite"`, announced at most every 30 s and on change of any bucket that needs attention [IA-A6]. Hazard cards and new reported incidents are `polite` too. No `assertive` announcements during an incident, to avoid talking over a phone call |
| Order | Header → breadcrumb → toolbar → rail → incident panel → scene → card |
| Keys (proposed, 04 to confirm) | `Esc` unwind one level; `P` plan view / 3D; `1`/`2`/`3` Building / Neighborhood / City (only inside Trip Twin, F5); `L` legend; `[` `]` previous/next person in the current list. All disabled while focus is in a text field |
| Focus | Visible focus ring on every control and list row; when a card closes, focus returns to the row or pin that opened it |
| Text alternatives | Every pin has a text equivalent equal to its label (e.g. "M.R., traveler, last known 1 hour 28 minutes ago, accuracy plus or minus 40 metres, battery 4 percent") |

---

## 5. Legend and labeling rules

### 5.1 Semantic color, shape, icon and label pairing

Rule: **one color, one meaning, everywhere in Trip Twin.** Every meaning also has a shape or line style, an icon or glyph, and a word, so that none depends on color (red/green color blindness, monochrome wall displays, screenshots).

Grammar used throughout:
- **Line style on people rings = time state**: solid = current, dashed = aging, dotted + hollow = last known.
- **Line style on areas and structures = geometry certainty**: solid = mapped outline, dashed = approximate.
- **Hollow glyph = not vetted or not current. Filled glyph = approved or current.**
- **Hotspot ring = needs an operator decision now** (01 anti-pattern 24). Never decorative.

| Meaning | Color role (existing token) | Shape / line | Icon / glyph | Word on screen |
|---|---|---|---|---|
| Structure: hologram, grid, streets (no status) | Slate-teal ramp: glass `#415e6b`, edges `#80959b`, grid `#2a4a59` on field `#061a23` | Translucent extrusions; grid floor | None | None (attribution only) |
| Subject: the hotel | Slate-teal light `#b8c3c7` edge, brighter than context | Solid edge if matched; dashed if approximate | Lodging glyph in the header | {Hotel name}; "Hotel location approximate" |
| Approved place of safety or service | Brand green `#4ba467` glyph fill; text `#81bf95` | Filled category glyph (3.6) | Category glyph | Category label + "Approved" |
| Draft, unvetted, no data | Neutral grey `#9aa8ac` **(Justin's unknown)** | Hollow glyph, dashed | Category glyph, hollow | "Draft, not approved" / "OSM · not vetted" |
| Person, current (Live, Stopped · current) | Near-white `#eff7f3` **(Justin's pin text)** | Solid ring; photo at full strength | T or C badge **(Justin)**; Stopped adds a still glyph | "Live · 34s ago" / "Stopped · current" |
| Person, aging | Warning amber `#f59e0b` | Dashed ring | Clock glyph | "Aging · 4m ago" |
| Person, last known | Neutral grey `#9aa8ac` | Dotted ring, hollow, desaturated photo | Clock glyph | "Last known · 2h ago" |
| Person, time unknown | Neutral grey `#9aa8ac` | Ghost pin, no ring | "?" glyph | "Capture time unknown" |
| Needs attention (hotspot) | Warning amber `#f59e0b` | Outer ring around the item, no fill | None (the ring) | The reason, e.g. "Outside group zone", "At or above reported floor 9", "Not current" |
| Hazard: observed or reported | Destructive `#ee7789` (dark theme) | Observed: ground footprint sized to the pixel. Reported: area with dashed edge sized to the stated uncertainty. Reported floor: hatched slab | Heat: square pixel with ticks. Report: diamond with "!" | "Satellite heat detections" / "Reported: …" |
| Suggested path | Info (dark) `#3b82f6`; label text tint from 04 at 4.5:1 or better on `#061a23` | Primary: solid line with direction chevrons. Alternate: long dash | Destination glyph at the end | "Suggested path (unverified) · primary/alternate" |
| Path segment near a hazard | Warning amber `#f59e0b` on that segment only | Same line, with a caution tick | Caution tick | "Closest approach to hazard: 420 m" |
| Path inside a hazard buffer | Neutral grey `#9aa8ac` | Greyed line with cross-hatch | None | "Passes within buffer" |
| Group zone / trip boundary | Justin's boundary teal `#80c3c9` | Ground-plane ring, never extruded. Solid = current; dashed + amber label = overdue; dashed = approximate | None | "Group zone", "Update overdue", "Approximate boundary" |
| Floor band | Near-white `#eff7f3` at low alpha | Horizontal slab over the hotel outline, dashed tether to the ground pin. Hollow slab = last estimate | Band brackets | "Likely floor 7 (6–8) · 3m ago" |
| Muster "present" (only positive confirmation) | Brand green `#81bf95` text | — | Check glyph allowed only here | "{11} present" |
| Sample data | Watermark in neutral | Full-frame diagonal text | — | "SAMPLE DATA · fictional people and events" |

Hard rules:
- Red (`#ee7789`) is never drawn on a person, a path, a safety resource or the hotel. It belongs to the hazard or report itself.
- Green is never drawn on a person, a path, the hotel, or an empty state. It means "SafeTrekr-approved place or service" and, in text only, muster "present".
- Amber means "needs attention or degraded". It never decorates.
- Blue is used only for suggested paths. (Cross-view note: in World View blue is Justin's chaperone color. See open question Q3.)
- Contrast: glyphs and lines at least 3:1 against `#061a23`; text at least 4.5:1. Estimated: `#ee7789` ≈ 7:1, `#f59e0b` ≈ 8:1, `#81bf95` ≈ 8:1, `#3b82f6` ≈ 4.8:1 (lines only; labels need the lighter tint), `#4ba467` ≈ 5:1 (glyph fill). 04 to measure on the rendered hologram, which adds glow behind items.

### 5.2 Legend behavior

- **Dynamic legend**: shows only the meanings currently drawn, plus three fixed grammar rows: "Solid = current or mapped · Dashed = aging or approximate · Hollow = not current or not vetted".
- Opened with the **Legend** button in the toolbar (key `L`). On first entry in a session it opens once and closes on first interaction.
- Each legend row reuses the exact label from section 3. The legend never introduces a word not in the vocabulary.
- The legend states the two caveats that apply to the whole view: "Positions are phone fixes, not confirmation that someone is safe." and "Paths are OSM street paths, not checked for hazards or closures."

### 5.3 Label density rules (the 3D view must never clutter)

| # | Rule | Value [IA-A2] |
|---|---|---|
| D1 | Persistent label budget per scale (labels that show without hover) | Building 10 · Neighborhood 12 · City 8, plus at most 6 edge chips |
| D2 | Budget priority (first fills first) | 1 reported incidents and the nearest hazard; 2 people with a hotspot ring; 3 chosen destination and its path readouts; 4 hotel name; 5 rally points; 6 everything else (hover only) |
| D3 | Hotspot overflow | More than 5 people with hotspots → label the 5 with the most urgent reason (at or above reported floor, then not current oldest first, then unaccompanied, then outside zone) and show "+{n} more need attention → list" |
| D4 | People labels on the hologram | Initials + state age only: "M.R. · Last known 1h 28m". Full names only in the panel and card, and never on a wall display (C12) |
| D5 | Clustering | Pins closer than 24 px on screen merge into a count bubble: "{6}". If any member needs attention the bubble says so: "6 · 1 not current", and gets the hotspot ring. Not-current people are never hidden inside a bubble without that note |
| D6 | Accuracy rings when clustered | Drawn as one combined outline (union) at true scale, never removed |
| D7 | Never labeled | Context buildings, streets (except a street named in a path note or chokepoint), grid lines (except the approximate floor-height grid in floor focus), OSM POIs not in the safety layer |
| D8 | Text is screen-space | Labels billboard to the screen and are never painted on hologram surfaces; leader lines join a label to its item; labels may not overlap; a label that cannot be placed drops to hover and its item keeps its glyph |
| D9 | Line limits | At most 2 lines, about 32 characters per line on the scene. Longer text goes to the card |
| D10 | Truncation order | Truncate names first. Never truncate an age, an accuracy, a band range, "likely", "approx.", "not verified" or "unverified" |
| D11 | Every time-varying label carries its age | Positions, floor bands, hazards, paths, zones. A label without an age is a defect |
| D12 | Numbers | Distances: under 1 km to the nearest 10 m, from 1 km one decimal ("2.4 km"). Accuracy: whole metres. Times: ranges for travel ("11–17 min"). Ages: Justin's "34s / 4m / 2h ago". Coordinates: not shown on the scene; 4 decimals at most in a card |
| D13 | Units | Metric, as in Justin's UI ("Radius: N meters") [IA-A7] |
| D14 | Local time | Every clock time in the site's time zone with its abbreviation on first use in a panel ("02:12 CDT"); FIRMS pass times may add UTC in the card |
| D15 | Separator and case | " · " between facts; sentence case; no all-caps except the header "TRIP TWIN", "SAMPLE" and the watermark |
| D16 | Motion is not a label | Pulses and glows never carry meaning on their own; hotspot rings may pulse only if 05 also gives them a static form for reduced motion |

---

## 6. Open questions

For the screen designer (04) and motion designer (05):

| # | Question | Why it matters |
|---|---|---|
| Q1 | Where does the rail sit at desktop width versus a wall display, and does the roster line fit on one line at 1280 px? If not, which bucket wraps? | The five-second read depends on it |
| Q2 | Is a still glyph for "Stopped · current" distinguishable from a "paused/no tracking" reading? Test with operators | Misreading it as "not tracking" causes false alarms |
| Q3 | Blue paths inside Trip Twin versus blue chaperones in World View: is the cross-view mismatch acceptable, or should paths use another hue derived from the brand ramps? | One-meaning-per-color applies within Trip Twin; operators move between views |
| Q4 | Floor-range focus: does fading the hologram above the range read as "those floors are empty"? Consider a caption "Floors above: outline only" | Avoid implying absence of people |
| Q5 | Proposed keys (`P`, `1`/`2`/`3`, `L`, `[`/`]`) versus Justin's global digit keys: confirm the suspension (F5) works with his handler | Accidental FLIR inside Trip Twin |

For the product owner (and Justin where noted):

| # | Question | Why it matters |
|---|---|---|
| Q6 | Confirm F1–F9 resolutions, especially the 2x accuracy rule (F2) and that aging people count as Not current (F3) | They change the counts in the demo |
| Q7 | Operator-facing name: keep "Trip Twin", or use a plainer label such as "3D site view"? "Twin" is jargon to some staff | Button label E1–E3 and header |
| Q8 | Justin: should World View adopt "Approved" (not "Active"), "Satellite heat detections" (not "Active fires") and "Group zone" (not "Group boundary")? Trip Twin uses them either way | Two names for one thing across views |
| Q9 | Distance rings (02 P1) versus 01 anti-pattern 23: keep as an off-by-default layer, or cut? | Removes a row with no decision attached |
| Q10 | When floor numbering is not set for a lodging, should the operator be able to set it in Trip Twin (prototype memory only), or only through the future hotel card? | Decides whether "Likely floor" or "level above lobby" is shown for the 2nd and 3rd cities |
| Q11 | The reported floor is entered in the hotel's numbering. If numbering is unknown, how does R15 compare it with "levels above lobby"? Proposed: require the operator to state "lobby is floor 1 / G / 0" when adding the report | R15 can be off by one floor otherwise |
| Q12 | Metric only, or a metric/imperial preference for US-based operators? | Austin demo audience |
| Q13 | Wall-display mode: is it in the prototype at all? If not, C12 and D4 are documented but not built | Scope |
| Q14 | Should "Unaccompanied" be shown for chaperones' own status (a chaperone alone is not "unaccompanied")? Proposed: travelers only | Label definition |
| Q15 | Multi-lodging trips: which lodging does E1 pick when the operator enters from the trip rather than a lodging? Proposed: the lodging where most current people are; else the first by check-in date | Entry predictability |

---

## 7. Findability and comprehension validation plan

The users are a small expert population (SafeTrekr operations staff, org security officers, org admins), so samples are small and tasks are scenario-based.

| Method | What it validates | Tasks (examples) | Success metric | Participants |
|---|---|---|---|---|
| Five-second test on the rail | Roster line and zone line wording | "How many people might still be in the building?" (answer: Inside (likely) + At hotel, undetermined + any Not current last seen inside) | ≥ 80% correct; 0 participants count "At hotel, undetermined" as out | 8–12 staff |
| Label comprehension test | Stopped · current; At hotel, undetermined; Likely floor 7 (6–8); Floor not shared vs Floor unknown; Suggested path (unverified); Approved | Participant explains each label in their own words | ≥ 90% match the 3.x definition; any "safe" reading of a path or green glyph is a failure | 8–12 |
| Tree test (layer panel) | The five groups | "Show where the group could walk to", "Show fire information", "Hide surrounding buildings", "Show who is above the smoke floor" | ≥ 70% direct success per task; median under 30 s | 10–15 |
| First-click test | Entry points E1–E3 | From World View: "Open the 3D view of the group's hotel" | ≥ 60% correct first click | 10–15 |
| Scenario run (the 01 demo pass bar) | Whole hierarchy | Demo A, B, C decisions within 60–90 s without asking "where is that from?" or "how old is that?" | Per 01 section 8 | 5–8 operators |

---

## 8. Assumptions

| ID | Assumption | Verify with |
|---|---|---|
| IA-A1 | Scale extents: Building ≈ outline + 150 m, Neighborhood ≈ 500 m, City ≈ 5 km; the hologram is not extended beyond 500 m | 03 architect (render cost), operator test |
| IA-A2 | Label budgets (10 / 12 / 8, 6 edge chips, 24 px clustering, 5 hotspot labels) are starting values | Prototype screenshots at 1280 px and 1920 px; 04 |
| IA-A3 | A deep link per lodging is feasible in World View's routing and respects the same auth | 03 architect |
| IA-A4 | `[` and `]` are free in World View's key handling | Justin |
| IA-A5 | Layer toggles are remembered for the browser session only, not stored per user | Product owner |
| IA-A6 | A 30 s minimum interval for polite live-region announcements is acceptable to screen-reader users in an incident | Accessibility review |
| IA-A7 | Operators accept metric units, as World View already uses | Q12 |
| IA-A8 | "Hotel" is the generic operator word for the Twin's lodging subject, even when the lodging is a hostel or dorm; the record's name is shown first | Product owner |
| IA-A9 | Category grouping in the Safety sub-filters (Rally points · Safe houses & relocation · Shelters · Medical · Police & fire · Embassies & consulates · Other) matches how analysts think about coverage | Card sort with 5–8 analysts |
| IA-A10 | Contrast ratios in 5.1 are calculated estimates against flat `#061a23`, not measured on the glowing hologram | 04 measurement |

---
<!-- FACTORY_OUTPUT_METADATA
artifact_type: information_architecture
pages_mapped: 1 view (Trip Twin) with 3 scales, 2 focus levels, 3 panels (rail, incident, More drawer), 1 card type family
nav_items: 13 layer rows in 5 groups; 16 actions; 4 breadcrumb segments; 3 scale presets
roles_covered: [org_admin, security_officer (view-only), hq_staff, wall_display_mode]
facets_defined: 7 safety category sub-filters
accessibility_verified: false (specified, not tested)
validation_plan_included: true
three_click_verified: true (on paper, section 4.1)
confidence: 0.75
source_artifacts: [00-CONTEXT.md, 01-operator-scenarios.md, 02-layer-catalog.md, gods-eye-view/src/operations/{worldControls,main,globe,model,boundaries,alertFeed,participantPins,visualModes,demo}.js]
-->

## 9. Phase 2 vocabulary (15 Oct 2026, review/phase2 F22)

| Term (as shown) | Meaning | Never say |
|---|---|---|
| Floors | The building cutaway: one bar per floor, top floor first | "cutaway" in operator copy, "empty floor" |
| Floor card | The list for one floor (opens from Floors, the incident title, or ↑/↓) | "floor list", "who is on it" |
| Most likely here | A current phone estimate's most likely floor is this floor | "on this floor", "confirmed" |
| Possibly here (estimate range includes floor N) | A current estimate range covers this floor; most likely elsewhere | "maybe", "probably" |
| Last estimate includes floor N · not current | A stopped / not-current phone's last range covers the floor | "was on" |
| Assigned here, floor not known | On the rooming list for this floor, at the hotel, no floor estimate | "missing", "unaccounted" |
| Assigned here, estimate on another floor | On the rooming list here; current estimate places them elsewhere | "not in room", "absent" |
| Assigned here, not at the hotel now | On the rooming list here; position outside / away / not located | "left", "evacuated" |
| May be at or above floor N | Union of: estimate at/above, last estimate reaching it, assigned at/above with no floor | "trapped", "above the fire" |
| by phone estimate · by last estimate (not current) · assigned above, floor not detected | The three sources of the at-or-above count | — |
| Not a headcount | Required line on every floor copy | "all accounted for", "clear" |
| Whole group (27): … | Scope of the floor-status counts | bare counts without scope |
| Lightning detected (8 km grid cell) | Density raster cell, not a strike | "strike" for raster data, "all clear" |
| SIMULATED · SIM | Prototype data (drawer); on every surface it reaches | unlabelled simulated values |
| Live · forecast HH:MM · MET Norway | Live weather next to the fictional sample clock | "now" for a forecast hour |
| Official weather alert · NWS: <event> · area alert | Area weather alert in the OFFICIAL block | "warning" for an advisory, "instruction" |
| No official instruction about this incident on file | Incident-specific official slot | "no official instruction" (unscoped) |

Banned in phase-2 copy (lint): missing, empty, clear / all clear, safe (for people or floors), confirmed, trapped, unaccounted.

## 10. Phase 3 vocabulary (16 Oct 2026, review/phase3 G20)

| Term (as shown) | Meaning | Never say |
|---|---|---|
| Site | Any trip place shown as a twin: the hotel (lodging) or a venue | "location" (ambiguous with positions) |
| Hotel · Venue | The site's kind; cards read GROUP HOTEL / TRIP VENUE · DAY 2 · 19:00 | "the building" for a site |
| Place | A point of safety or service near a site (hospital, police, fire, rally point, shelter) | "POI" in operator copy |
| On screen | The site whose twin is built now | "current site" |
| Between sites · Elsewhere · Not current | Per-site line buckets: near the straight line hotel → venue; current but not at any site; fix not current | "in transit" (speed is not known), "missing" |
| Away from this site | Roster bucket at any site | "away" alone at a venue |
| Live · Advance | The two modes; Advance = planning, no traveler positions | "preview", "simulation" |
| PLANNING | Mode chip in Advance | "ADVANCE · PLANNING" (too long for the bar) |
| Site brief · Reviewed by you · <day time zone> | Advance per stop; a review is a person's check, not an approval | "approved", "cleared", "safe" |
| Draft for review | Header of every copied advance brief | "final", "approved" |
| Path · Walking path · Driving path | Any suggested line between two points | "route" in operator copy (06 §5) |
| Walk from <origin> to <place> | Path card title; the origin is always named | untitled paths |
| Start · End | Labels on an on-demand path's ends | — |
| Frame path · Clear path (Esc) | Path card actions | "clear route" |
| Viewing from S · looking N | Compass caption | "facing" (ambiguous) |
| North up | Centre of the compass and key N | "reset" |
| Top floor number (as on the lift buttons) | The numbering question's count | "floors above ground" (ambiguous) |
| Floor numbering from operator entry · not verified | Shown wherever an operator answer changes a count | unlabelled counts |
| Outside this building's floors | A reported floor the numbering can't place; no count shown | a bare 0 |
| INCIDENT · OTHER SITE | Mode chip when a report exists at a site not on screen | "No incident reported" (never while a report exists) |

## 11. Phase 4 vocabulary (16 Oct 2026, review/phase4 H20)

| Term (as shown) | Meaning | Never say |
|---|---|---|
| Suggested path | Any path the router proposes (rally path, PATH HERE, Advance path) — blue glow | "safe route", "recommended" |
| Plan your own path | The one verb that opens the editor for a new path | "Draw", "Edit this path" (for a new plan) |
| NEW PATH · NOT SAVED | Editor state for an unsaved plan | "draft" (taken by "not approved" places) |
| Edit saved path · Duplicate | Change / copy a saved path; saving an edit clears its review | — |
| Saved path | An operator's path, kept for the trip — long dash with gaps | "route" |
| Not reviewed · Reviewed by you · <date time zone> · Review out of date | Review states; a review is a check, not an approval, and goes out of date when avoid-areas or checks change | "approved", "verified", "safe" |
| Avoid-area | A trip-wide circle with a reason; every path is checked against it | "no-go zone", "danger zone" |
| Routed around: X · ENTERS avoid-area: X · not applied (fallback) · checked | What happened with an avoid-area — only what the router and the check found | "avoids" (unless routed around and no entry found) |
| Save anyway — enters an avoid-area | Second, deliberate click to keep a path that enters an area or does not reach | — |
| Discard · Esc again to discard | Leaving the editor without saving | "Cancel" for throwing work away |
| Live only (traveler's position) | A path that starts at a traveler's position: shown, never saved | storing a traveler's name or position in a saved path |
| X (key) | Place an avoid-area while editing | A (A = attention) |

## 12. Phase 5 vocabulary — panel clarity (16 Oct 2026, review/phase5 J16)

| Term (as shown) | Meaning | Never say |
|---|---|---|
| `PATH FROM {person}` · `PATH TO {place}` | Path section kicker; it names the fixed end | "PATH HERE", "Route" |
| `1 To` / `1 From` · `2 How` | Step labels; the variable end, then Walk / Drive | "Destination:", "Origin:" |
| `Nearest listed hospital` | Nearest in a straight line among every hospital on file | "closest ER", "best hospital" |
| `Rally point (primary)` / `Rally point (secondary)` + `not approved` tag | Rally endpoints, same strings as the rail | "nearest rally point (draft)" |
| `Group center · {n} people` | Median of current positions at this site (≥ 3) | "centre", bare "(19)" |
| `{Name} · last selected` | A person endpoint not currently selected | "From selected person" |
| `Showing the drive: {d} in a straight line. Walk is one click.` | Why Drive was drawn before the operator chose | silent default |
| `Copy path summary` | Clipboard text: no coordinates, traveler as first name + initial | "Share route" |
| `Remove path` | Takes the drawn path off the map | "Clear path" |
| `Finding a suggested path…` | Path request in progress | "Asking OpenStreetMap routing…" |
| `{Name} has moved since this path was planned` · `Re-plan from the current position` | The path's start is older than the person's fix; re-plan is the operator's action | auto re-route |
| `Unaccompanied or outside group zone` | Needs-attention group | "Alone…" |
| `Switch to {site}` | Rebuild the twin at another site | "Go to {site}" |
| `street path not checked` | Advance straight-line caveat | "route not checked" |
| `always shown` (lock glyph) | Locked layer | "always on" with a disabled checkbox |
| `Weather overlays · {k} of 4 on` | Weather sub-group row | bare "Weather" |
| `Prototype · SIM ON` · `· SIMULATED DATA` | Any simulated feed is on | — |
| `Out leg · leave about {t} to arrive for {event} at {t}` / `Back leg · after {event} ends {t} · about {t}–{t}` | A saved path tied to an event (phase 4 deferred) | "departure", "ETA" |
| `On the way after sunset ({t}) — check lighting on this path` / `On the way before sunset ({t})` | Leg-timed after-dark check | "safe", "daylight route" |
| `Copy for chaperones` | Reviewed saved paths only; copied, not sent | "Send", "Share" |

## 13. Phase 5b vocabulary (16 Oct 2026, review/phase5b)

| Term (as shown) | Meaning | Never say |
|---|---|---|
| `Distances: Meters and kilometers (m, km)` · `Feet and miles (ft, mi)` · `Yards and miles (yd, mi)` | Display › Units; every distance on screen and in copied text | "Metric/Imperial" alone |
| `Temperature: Fahrenheit (°F)` · `Celsius (°C)` | Display › Units | — |
| `{d} straight line` | A distance that is not along a path | bare distance next to a path distance |
| `22 min ago` (copied text) | Ages read aloud | "22m ago" in copied text |
| `Go to floor` · `Floor 52 is outside this building's floors (1–37)` | Hotel card and incident floor list | "invalid floor", "clamped" |
| `Incident at {site} — switch to {site}? The incident stays on screen with a way back.` · `Stay at {site}` · `Switch to {site}` | Leaving the site of a live incident (also Advance, Exit) | "Are you sure?" |
| `Elevation contours` · `Ground in view: −12 ft to +34 ft relative to hotel street level` | Layers › Site | "terrain contours", "vs" |

## 14–16. Phases 6–8 vocabulary
Kept in the review files for now: phase 6 weather (`review/phase6/04-ia.md`), phase 7 streets and Ways out (`review/phase7/04-ia.md`, `00-FIX-LIST.md` M2/M5/M8/M12), phase 8 wider area (`review/phase8/00-FIX-LIST.md` N4/N7/N9/N12). Never-list additions from those phases: "corridor", "escape route", "exit" for an entrance.

## 17. Phase 9 vocabulary — selecting a drawn path (16 Oct 2026, review/phase9)
Amends PTH-02: paths rank **Main / Alternate**; "primary / secondary" rank rally points only; "Suggested path" is the type, never a rank.

| Term (as shown) | Meaning | Never say |
|---|---|---|
| `Main` · `Alternate` | Rank of a suggested path in one drawn set. Main is the router's first result, not a recommendation | "Primary" for a path, best, recommended, preferred, backup |
| `SUGGESTED · MAIN · UNVERIFIED` / `SUGGESTED · ALTERNATE · UNVERIFIED` / `SUGGESTED PATH · UNVERIFIED` | Path card kicker; no rank when one path is drawn | SUGGESTED ROUTE, VERIFIED |
| `{From} → {To}` | Path card title; the origin is always named | the destination alone |
| `Walk · {d} · {a}–{b} min group pace` / `Drive · {d} · {a}–{b} min no live traffic` | Card metric, mode first | a single ETA |
| `Start: Emi S. · position at 21:31 · 4 min old` | A traveler start, age read live; amber with "Not a current position — the traveler may not be there now" when not current | a start without its age |
| `Edit a copy of this path` / `Edit a copy (live only)` | Opens the editor on the drawn line itself; the suggestion stays unchanged | "Edit this path", "Edit route", "Modify" |
| `NEW PATH · COPY OF THE SUGGESTED PATH (MAIN) · NOT SAVED` | Editor kicker for a copy | "EDITING" for a new path |
| `NEW PATH · LIVE ONLY · CANNOT BE SAVED` | Editor kicker when the start is a traveler's position; no save fields | a Save button that cannot save |
| `PLANNING PATH` / `EDITING PATH` | Top-bar chip and banner: a new path / a saved path being changed | — |
| `Started from the suggested path (main) · OSRM · 1.2 mi · planned 21:31` | Provenance line on a saved copy | — |
| `SUGGESTED · DRAWN NOW · {n}` | Layers › Paths sub-kicker over drawn suggested paths | "On the map now" |
| `Main · {From} → {To} · walk {d}` | Index row; opens the card and frames the path | a row without origin or mode |
| `SAVED ON THIS TRIP · {n}` · `AVOID-AREAS · {n}` | Separate Layers summaries | one combined line |
| `Main path to Rally point (primary)` / `Alternate path to Rally point (primary)` | Incident-panel path titles; they open the card | "Path to rally point (primary)" |
| `› Suggested path · main` / `› Emi S. › Suggested path` | Breadcrumb focus; never truncated | "› Suggested…" |
| `That path was replaced — card closed` / `That path is no longer on the map — card closed` | A card never outlives its line | a card silently updated with new numbers |
| `Frame path` · `Copy path summary` · `Remove path` | The only labels for these verbs, on cards and the pill | Frame, Copy, Remove |
| `OSM street path · not checked for closures, crowds, lighting, crime or damage` | PTH-03, in full on the card and in copied text | shortened forms |
