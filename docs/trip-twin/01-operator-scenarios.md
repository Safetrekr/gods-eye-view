# 01 Operator scenarios: what a remote operator must decide at a group's hotel

Owner: protective operations (skills applied: C18 site/venue assessment, C19 route planning with redundancy, B12 vulnerability assessment, D29 incident recognition and immediate protective decisioning, D30 shelter/safe location planning, F44 emergency evacuation coordination, D31 day-of operations management).

Purpose: define the decisions a remote operator makes when something happens at or near a group's hotel, the information each decision needs, and where that information comes from today. The ranking in section 5 sets what the Trip Twin screen shows first. Visual treatment belongs to 04 and 05. This file only says what must be true on screen.

Assumptions are tagged `[A#]` and collected in section 8.

---

## 0. The operator, their levers, and the doctrine

The operator is a SafeTrekr staff member or an org security officer, working remotely in World View. They are not on the ground. People on scene (chaperones, hotel staff, police, fire) make the immediate life-safety calls. The operator provides the wide view, accountability, destinations and timing, and escalation.

| Lever | Exists today | Who can use it | Limits that matter in an incident |
|---|---|---|---|
| See traveler and chaperone positions | Yes (snapshot `participants`) | All operations roles | Freshness: fresh ≤ 120 s, aging 120–600 s, stale > 600 s, unknown (no usable capture time). `accuracy_m` horizontal radius. Battery level and state. "Stopped" presence: the device is stationary and answered a location check within 40 min. No room. No floor yet (see 2.6). |
| See group zones, geofences, crossings | Yes (`group_zones`, `geofences`, `geofence_events` from the last 24 h) | All operations roles | Zones are nearest-chaperone circles with `valid_for_seconds`. When the zone update is overdue, zone status is unknown. |
| See safety points | Yes (curated, approved per lodging/venue) | All operations roles | Some trips have gaps. Contact details and access hours are not guaranteed to be current. |
| Broadcast | Yes | `org_admin` and HQ roles only. `security_officer` is **view-only** | Audiences are all / travelers / chaperones only. You cannot message one person or "the six who are out". Push acceptance is not the same as being seen. |
| Direct group to destination | Yes | `org_admin` and HQ roles only | Destination must be an approved `rally_point`, `safe_house`, `relocation` or analyst-picked `poi`, with coordinates and not `org_internal`. `arrival_minutes` is 1–10080, **default 15**. The traveler gets a destination and a deadline, not our route. |
| Phone the chaperone, the hotel desk, emergency services, the embassy, the assistance provider | Outside World View | Anyone | This is the main real-world lever. World View holds no contact data by design (privacy rule), so it cannot act as the dialer today. |

Doctrine used throughout:

1. **People on scene own immediate life safety.** The operator never overrides a hotel fire warden, police cordon or official evacuation order. When an official instruction exists, the screen shows it above anything SafeTrekr suggests.
2. **Use the least movement that achieves safety** (D29). Moving a youth group through a city at night is a risk in itself. Staying put (shelter in place) is a valid answer, and it is often the right one.
3. **Two sources before acting when time allows.** When time is short, act on the best information and label it unconfirmed (C18 assumption validation).
4. **Accountability comes from people, not pins.** Positions tell you whom to ask about. They do not confirm that someone is safe, out of the building, or on a given floor.
5. **No primary without an independent alternate** (C19, D30). This applies to rally points, routes and shelters. Two options that share one chokepoint count as one option.

---

## 1. What an operator needs at a hotel (the advance site picture)

The site picture should exist **before** anything happens. Build it when a lodging is added, refresh it each evening, and open Trip Twin on it. Each element carries a status, adapted from the C18 assumption log:

- **VERIFIED**: confirmed by someone on site or by the hotel, with the date and who confirmed it.
- **CURATED**: an approved SafeTrekr safety point.
- **MAPPED**: from OpenStreetMap and not verified.
- **COMPUTED**: derived by us (routes, distances, chokepoint analysis, floor band).
- **UNKNOWN**: not available. The screen says so instead of leaving the space blank.

### 1.1 Site picture elements

| # | Element | Why the operator needs it | Knowable from outside data | Needs ground or hotel input | Default status |
|---|---|---|---|---|---|
| 1 | Building outline and height | Orientation, scale, floor count for the floor band, earthquake/fire context | OSM footprint. Height from `height`, else `building:levels` x ~3 m, else a default | True height, floor count, which wing the group is in, lobby/mezzanine levels | MAPPED (approximate if synthesized) |
| 2 | Street frontage and main entrance | Where routes start. Where a leaving group gathers | OSM `entrance=main` node where mapped (often missing). Address geocode | Which door the group actually uses. Side and rear doors to the street | MAPPED or UNKNOWN |
| 3 | Fire exits, stairwells, corridors | How people get out of the building | None. No indoor data source exists | Hotel evacuation plan (posted on room doors). The chaperone photographs it at check-in | UNKNOWN until provided |
| 4 | Floors and rooms the group occupies | Fire and earthquake priority. Cross-check against the floor estimate | None. Room numbers are not in the snapshot and never will be shown | Chaperone at check-in gives **floor numbers and per-floor counts only**. The hotel's room list stays with the hotel | UNKNOWN |
| 5 | Hotel fire assembly point | Hotel staff count guests here after an alarm. It may differ from the SafeTrekr rally point | None | Hotel desk or plan photo | UNKNOWN |
| 6 | 24 h front desk phone, night security | Confirming or denying reports in minutes | Places holds name and address only. OSM sometimes has `phone` | Hotel | UNKNOWN or MAPPED |
| 7 | Vehicle approaches and walking streets | How vehicles reach and leave. Walking options | OSM street network, one-ways, `highway=steps`. OSRM | Current closures, construction, lighting, night safety | MAPPED |
| 8 | Chokepoints | Places all routes funnel through. If they are blocked, every plan through them fails | OSM `bridge`, `tunnel`, `railway=level_crossing`, `noexit`, `barrier=gate`, `highway=steps`, plus segments every computed route shares | Whether gates are locked at night | COMPUTED |
| 9 | Barriers that cut walking options | Rivers, motorways, rail corridors, walled compounds | OSM | None | MAPPED |
| 10 | Rally primary and secondary | First place to go | Safety points | That they are reachable, lit and unobstructed | CURATED. Independence is COMPUTED (1.3) |
| 11 | Safe house, relocation site | Longer stay away from the hotel | Safety points | 24 h access, capacity, whether the contact is current | CURATED |
| 12 | Nearest emergency-capable hospital | Medical | Curated hospital preferred. Else OSM `amenity=hospital` with `emergency=yes` (often missing or wrong) | ER open 24 h, pediatric care, approved by the insurer or assistance provider | CURATED or MAPPED |
| 13 | Police, fire station | Escalation, missing-person report | Safety points or OSM | Which police station handles visitors and missing persons | MAPPED |
| 14 | Embassy or consulate for the travelers' nationality | Lost passport, crisis support | Safety points. OSM `office=diplomatic` | Nationality of the travelers `[A1]` | CURATED |
| 15 | 24 h pharmacy | Night medication | OSM `opening_hours` (sparse) | None | MAPPED |
| 16 | Open spaces clear of tall buildings | Earthquake assembly | OSM parks and squares, plus nearby building heights | Whether the space is safe at night | MAPPED |
| 17 | Hotel ground elevation, distance to coast or river | Tsunami and flood exposure. Ground anchor for the floor band | Terrain elevation. OSM coastline and waterways | Official tsunami/flood zones (not integrated) | COMPUTED (elevation only) |
| 18 | Local emergency number(s) | Chaperones often do not know them | Static country table (new, trivial) | None | VERIFIED (static) |
| 19 | Group vehicle | Decides walk or drive in an evacuation | Possibly in itinerary text. Not in the snapshot | Trip lead | UNKNOWN |
| 20 | Public cameras near the hotel | Visual check of smoke or crowds | CCTV layer (sparse, may be delayed snapshots) | None | MAPPED. Image time must be shown |

### 1.2 The "hotel card" (check-in input, new)

Most of what an operator lacks at 02:00 is something a chaperone could capture in five minutes at check-in. Proposed fields, each timestamped and attributed, becoming VERIFIED:

- Photo of the evacuation plan on the room door.
- Floors occupied by the group, with counts per floor and which floors have chaperones. **No room numbers.**
- Hotel fire assembly point, dropped as a pin.
- 24 h desk phone.
- The stairwell nearest the group's rooms, as read from the plan.
- Count of people who need help on stairs. No medical detail, consistent with the privacy rule.
- Group vehicle and driver availability.
- Whether lobby/mezzanine levels exist. This feeds the floor-band calculation (2.4).

Until a hotel card exists, the hologram shows "Interior unknown" and no exits. `[A2]`: this needs a mobile-app change and is outside the Trip Twin prototype, but the screen must reserve the slot and show it as empty.

### 1.3 Advance checks the screen can compute (flags, not verdicts)

| Check | Flag text | Basis |
|---|---|---|
| Rally primary and secondary leave the hotel in different directions and share no chokepoint | "Rally points not independent: both use [street/bridge]" | C19 dependency isolation. Bearing difference ≥ 90° where the grid allows `[A3]` |
| Rally primary walking distance | "Rally primary is 14 min walk" if > ~10 min, or "Rally primary within 50 m of building" if too close for fire or falling glass | `[A3]` thresholds |
| Hospital coverage | "No curated hospital. Nearest OSM hospital 22 min drive, ER status unknown" | Threshold 20 min `[A3]` |
| Missing categories | "No relocation site", "No rally secondary", "No embassy point" | Safety point categories |
| Destination behind a chokepoint | "Relocation site depends on [bridge]" | Graph analysis |
| Exposure | "FIRMS detections within 10 km in last 24 h", "Hotel ground elevation 4 m, 300 m from coast" | FIRMS, terrain |
| Footprint quality | "Building outline approximate: inside/outside judgments limited" | Annotation resolver approximate flag |
| Floor count unknown | "Building floor count unknown: floor bands will be wide" | Missing `building:levels` |

---

## 2. Reading positions and floors under time pressure (core to every scenario)

The traveler positions overlay is P0. In every scenario below, the first four questions are always the same:

- Where is each traveler and chaperone right now?
- How fresh is that fix?
- Who is inside the hotel, and who is outside?
- Who is outside their group zone?

This section defines how the screen classifies people and how an operator should read the result in seconds. The screen classifies conservatively so that the operator does not have to second-guess it.

### 2.1 Position states (from existing code; operator reading)

| State on screen | Source rule (existing) | What the operator may conclude | What they may not conclude |
|---|---|---|---|
| **Live** | Fix ≤ 120 s old | The person was within the accuracy circle about one or two minutes ago | That they are still there if they were moving |
| **Stopped, current** | Device stationary since T and answered a location check within 40 min ("At this location for 25m") | They are very likely still at that spot. Treat the position as current | That they are inside a building if the circle crosses the footprint edge |
| **Aging** | 120–600 s | Where they were up to 10 min ago | Current position. A walker can be 850 m away |
| **Stale / last known** | > 600 s, or stationary but no answer to a location check | Where they were last seen, and when | Anything about now. This person goes on the "not current" list |
| **Unknown** | No usable capture time, a future timestamp, or no location ever | Nothing about location | Never place this person, not even at the hotel |

### 2.2 The five-second read

The order matters. It is built so the operator sees who to ask about first, and individual pins last.

1. **Roster count line** (always visible, sums to roster): `Inside (likely) 18 · At hotel, undetermined 6 · Outside nearby 2 · Away 5 · Not current 3 · of 34`. "Not current" (aging, stale or unknown) is never counted under "Inside".
2. **Not-current list**, oldest first, with age and battery. Example: "Mia R. · last fix 1h 28m · battery 4%". This is the list of people to ask about.
3. **Outside group zone / unaccompanied list.** Only people whose own fix is current and whose zone is current. Otherwise shown as "zone unknown".
4. **Chaperone positions.** Which adult is with which cluster.
5. Individual pins and accuracy circles on the hologram.

### 2.3 Turning age and accuracy into "where could they be now"

The rule is: **possible area = accuracy radius (doubled for life-safety calls) + age x plausible speed.**

| Fix age | Walking (~85 m/min) | In a vehicle, city (~300–600 m/min) | Operator reading |
|---|---|---|---|
| 30 s | +40 m | +150–300 m | Current for most decisions |
| 2 min | +170 m | +0.6–1.2 km | Current if the person was stopped. Otherwise "nearby" |
| 5 min | +425 m | +1.5–3 km | Could already be past a street, a square or a cordon |
| 10 min | +850 m | +3–6 km | Last known only. Ask, don't infer |
| 30 min+ | +2.5 km | anywhere in the city | Starting point for a search, nothing more |

Accuracy rules:

- **Treat `accuracy_m` as roughly a 1-in-3 miss.** The phone platforms report about a 68% confidence radius `[A4]`. For any life-safety judgment (inside/outside a building, inside/outside a hazard buffer), use twice the displayed radius.
- **Expect poor indoor accuracy.** 20–65 m is common in and near buildings, which is larger than many hotel footprints `[A4]`. A pin drawn inside the footprint is not evidence the person is inside.
- **Low battery plus stale usually means a dead phone.** If battery was < 10% and discharging at the last fix, the likely explanation for going stale is the phone, not the person. They are still not accounted for.
- **No `accuracy_m` means the uncertainty is unknown.** Draw the "unknown accuracy" treatment and never a tight pin.

### 2.4 Inside vs outside the hotel (classification rule)

| Class | Rule (all require a current fix: live or stopped-current) | Notes |
|---|---|---|
| **Inside (likely)** | Footprint is real (not synthesized) AND one of: (a) the 2x accuracy circle lies fully inside the footprint; (b) the fix is inside the footprint and a current floor estimate is ≥ 2 floors above the lobby anchor; (c) the device has been stopped-current since its last lodging geofence **enter** event and the fix is inside or touching the footprint | Corroborated, never certain. The word "likely" stays on screen |
| **At hotel, undetermined** | The 2x accuracy circle overlaps the footprint edge and nothing corroborates; or the footprint is approximate | Expected to be the common class for small hotels. This is the honest answer |
| **Outside, nearby** | The 2x circle is entirely outside the footprint and the fix is within ~150 m `[A5]` | |
| **Away** | Farther than nearby | Shown with distance and bearing from the hotel |
| **Last known at hotel** | Any of the above with an aging, stale or unknown fix | Counted under "Not current", never under "Inside" |

### 2.5 Group zone status

- **Outside zone** is shown only when the person's fix is current **and** the zone is current (not "update overdue"). The zone is anchored on chaperone fixes. If the chaperones are stale, every traveler's zone status becomes "zone unknown".
- **Unaccompanied** = a current traveler with no current chaperone within the zone radius. This matters more than "outside zone" in scenarios S3, S6 and S7.
- Recent `geofence_events` (enter/exit of the lodging geofence) appear in the person's detail with times. They show the last crossing, not where the person is now.

### 2.6 Floor estimate (in scope this phase; not available until mobile + Core ship `[A6]`)

What it is: a barometric height above a lobby anchor, converted to floors using the building's floor height. It is shown as a band. Example: `Floor likely 7 (6–8) · 3 min · medium`. It is never a bare number and never a room. GPS altitude is never used for floors.

**Decisions an approximate floor enables**

| Decision | How the floor band helps | Example scenario |
|---|---|---|
| Who may be at or above a reported fire or smoke floor | Priority list for the hotel and fire service: "2 travelers likely at or above fire floor 5" | S2 |
| Is a person descending during an evacuation? | A falling band over successive fixes means they are moving down. A band unchanged after 10 min is a priority flag | S2, S5 |
| Where to send hotel staff to look for someone not in their room | Search the band, starting at the likely floor | S4, S7 |
| Upper-floor exposure after an earthquake | Who to check first, and which floors to report to rescuers if someone is trapped | S5 |
| Corroborating "inside" | Several floors up is very hard to explain by being outside (exceptions: hillside, elevated terrace, adjacent building) `[A7]` | All |
| Shelter quality during an active threat | Upper floors away from the street-level lobby are usually better. Do not broadcast floors | S6 |

**How responders and operators treat a ±1 band**

- **Pass on the whole band.** Say "likely floor 7, could be 6 to 8, reading 3 minutes old". Responders search the whole band, starting at the likely floor.
- **Fire-floor rule:** if any part of the band touches or is above the incident floor, treat the person as at or above it. Example: likely 4 (3–5) with fire on 5 means at or above.
- **A band that includes the lobby or ground floor** means "may be at ground level, possibly outside". It does not mean out.
- **Floor estimates age like positions.** A 12-minute-old floor is a last-known floor. Show its age next to the band.
- **Hotels skew floor numbering.** Mezzanines, a lobby on "0" vs "1", skipped 13th floors, and podium levels all distort it. Give the band plus the building's numbering convention if the hotel card has it. Otherwise say "floor numbering not verified" `[A8]`.
- **Relay the hotel's room list alongside the band, never instead of it.** For people in their rooms, the hotel's room list is authoritative. The floor band matters for people who are not where the list says.

**What must be said when floor is unknown**

Show `Floor unknown`, a reason, and the action to take. Never show a blank, a default to ground, or a guess.

| Reason | Text |
|---|---|
| No barometer on device | "Floor unknown: device has no pressure sensor. Ask the chaperone or check the hotel's room list." |
| No anchor since entering the hotel | "Floor unknown: no ground reference since this phone entered the hotel." |
| Reading stale | "Floor last estimated 2–4, 26 min ago: not current." |
| Building floor count/height unknown | "About 18 m above lobby (roughly floors 5–6). Floor count not verified: low confidence." |
| Not inside (likely) | No floor shown. Floors are only meaningful for people classified inside or at the hotel. |

Privacy: floor-level location is more sensitive than street position. It is shown under the same role gating as positions, with short retention. On a shared SOC wall, floor bands should appear only while an incident is open `[A9]`.

---

## 3. Incident scenarios at or near the hotel

### Source legend

| Code | Meaning |
|---|---|
| ST | SafeTrekr operations snapshot, available today (positions, freshness, accuracy, battery, presence, group zones, geofences/events, safety points, itinerary, flights, musters, alert acknowledgements) |
| ST-new | SafeTrekr would hold it after planned work (floor estimate, hotel card) |
| OSM | OpenStreetMap through the existing Overpass proxy (completeness varies by city) |
| OSRM | Existing routing proxy. Walking/driving, **no live traffic, no closures** |
| LIVE | Public layer already in World View: NASA FIRMS, USGS quakes, TomTom traffic flow (needs a key; otherwise simulated), CCTV, aircraft |
| TRI | TarvaRI intel feeds (NWS, GDACS, GDELT, State Dept, FCDO, NOAA tsunami, Open-Meteo, WHO...). Exists in SafeTrekr but **not wired into World View** `[A10]` |
| PUB-new | Public source not yet integrated (USGS ShakeMap/PAGER, wind, official fire perimeters) |
| HUMAN | Only from a person: chaperone, hotel, police, assistance provider. Arrives by phone or message, outside the system |
| NONE | Not available to us |

Time pressure is the window in which the **operator's** decision must be made:

- **Seconds**: under a minute. The information must be readable at a glance.
- **Minutes**: 1–30 min.
- **Hours**: more than 30 min.

On-scene actions (leaving a burning building, drop-cover-hold) happen in seconds and do not wait for the operator.

Every scenario table starts with the same position row on purpose. It is the P0 answer.

---

### S1. Wildfire or large fire detected near the hotel

**Setting.** 15:00 local. 28 students and 3 chaperones. 9 are at the hotel, 22 are at a museum 3 km away. FIRMS shows a cluster of detections 6 km north-west of the hotel. The system has no wind data.

**Default posture.** Watch, prepare early, move early, preferably by vehicle. Wildfire evacuations fail by leaving late, not early.

| Decision | Information needed | Where it could come from | Time pressure |
|---|---|---|---|
| Where is everyone, and who is away from the hotel? | Roster count line. Clusters (hotel vs museum) with freshness. Not-current list | ST | Seconds |
| Is this a real fire that matters to us? | Detection locations, **satellite pass time** (not ingest time), confidence, repeat detections; distance and bearing from hotel and from each cluster; corroboration | FIRMS (LIVE; detections can be hours old; 375 m or 1 km pixels; industrial heat false positives). Corroboration: TRI (GDACS, NWS, news), CCTV (LIVE, sparse), HUMAN | Minutes to hours |
| Is it moving toward us, and how fast? | Wind speed/direction at the fire and the hotel; trend across passes; official perimeter | Wind: PUB-new (Open-Meteo, via TRI). Perimeter: PUB-new in the US (NIFC), NONE in most countries | Hours (minutes if within ~2 km) |
| Recall the museum group, or keep everyone where they are? | The museum cluster's route back, relative to the fire; next itinerary items | ST, OSRM, COMPUTED | Minutes |
| Leave now, or wait for an official order? | Official evacuation orders or zones; smoke/air quality; road congestion; whether the group has a vehicle | Orders: HUMAN or local news; TRI (NWS, US only). Air quality: TRI. Traffic: TomTom (LIVE only with a key; simulated mode must be hidden). Vehicle: HUMAN | Minutes to hours |
| Where to go? | Relocation/safe house sites: drive time, direction relative to fire and wind, whether the route passes closer to the fire | ST, OSRM (no traffic), COMPUTED closest approach | Minutes |
| What arrive-by to set? | Drive time + congestion allowance + time to pack and board | OSRM + section 6 rule | Minutes |
| Has everyone arrived? | Fresh fixes converging on the destination; acknowledgements; who is not current | ST | Minutes |

**First screen.**
- The hotel.
- Detections with their pass time.
- People by state, with the roster count line.
- Relocation sites, marked upwind or downwind.

**Do not.**
- Draw a fire front or a spread prediction. FIRMS pixels are observations, not perimeters.

---

### S2. Hotel evacuation ordered (fire alarm, gas leak or bomb threat), 02:10 local

**Setting.** The alarm sounds and hotel staff clear the building. At 02:14 a chaperone calls: "We're out on the street, counting." Nothing in the data told the operator about the alarm. 30 travelers and 3 chaperones are on floors 4, 5 and 7, according to the hotel card if one exists.

**Default posture.**
- Leave the building by its exits as directed by hotel staff and the fire service.
- Assemble at the **hotel's** assembly point first, so the wardens can count.
- The operator supports the headcount, then decides whether to move the group to shelter if the evacuation drags on.

| Decision | Information needed | Where it could come from | Time pressure |
|---|---|---|---|
| Who is still possibly in the building? | Chaperone headcount (primary). Inside (likely) / at hotel, undetermined / outside counts. Not-current list. Floor bands, and whether they are descending | HUMAN (headcount). ST positions, classification 2.4. ST-new floor band | Seconds to minutes |
| Who is at or above the incident floor? | Reported fire/smoke floor; each person's floor band with age; the group's floors from the hotel card | HUMAN (fire floor, from hotel or fire service). ST-new (band, hotel card) | Seconds to minutes. Pass to the hotel/fire service immediately as "likely floor 6 (5–7), 2 min ago". Never as a room |
| What to tell the fire service about missing people | Names (operator console only), last fix age, last floor band and age, last geofence crossing | ST, ST-new | Minutes |
| Stay at the hotel assembly point, or move to the SafeTrekr rally point? | Hotel assembly point; rally primary walking time and route; whether wardens still need guests present | Assembly: hotel card or HUMAN. Rally: ST. Route: OSRM | Minutes |
| If prolonged (bomb threat or gas leak can last hours), move to indoor shelter? | Weather; safe house/relocation open now; walking distance; cordon extent | Weather: PUB-new. Sites: ST (access hours HUMAN). Cordon: HUMAN | Minutes to an hour |
| Direct the group, or let the chaperones lead? | Chaperone positions; audience (chaperones only first); delivery and acknowledgement | ST | Minutes |
| Report to org leadership | Accountability: N accounted for by headcount, N not current, injuries yes/no (no detail) | HUMAN, ST | Minutes |
| Re-entry / stand down | All-clear from hotel or fire service | HUMAN only. **The operator never declares it** | Hours |
| Alternative lodging tonight | Relocation site, availability | ST, HUMAN | Hours |

**What the floor band changes here.**
- It turns "3 people unaccounted for" into "1 likely on floor 7 (6–8), 4 min ago, not descending; 2 not current, last bands 4–5". That is a priority order the fire service can use.
- With no barometer data, the screen says `Floor unknown`, gives the reason, and points to the hotel's room list. It does not leave a blank.

**First screen.**
- The roster count line with a large "At hotel, undetermined" share. This is expected and honest.
- Accuracy circles around the footprint.
- Floor bands for anyone not confirmed out.
- Chaperones.
- The hotel assembly point (or "unknown").
- Rally primary with the walking route from the street.
- Local time and temperature.

**Do not.**
- Mark anyone "out" from GPS.
- Draw interior exits.
- Show a bare floor number.
- Broadcast to all travelers mid-headcount. It competes with the chaperones; address chaperones first.

---

### S3. Civil unrest moving toward the hotel

**Setting.** 17:30 Saturday. Reports of a march leaving a square 1.5 km away, along the avenue that passes 200 m from the hotel. Six travelers on free time are in the shopping district between the square and the hotel. One chaperone is with three of them.

**Default posture.** Get people indoors. Those at the hotel stay in, away from the lobby and street-facing windows. Those outside avoid the march route and the squares; if returning means crossing the route, they shelter where they are. Relocate the whole group only if the hotel itself is on the route or near a likely target.

| Decision | Information needed | Where it could come from | Time pressure |
|---|---|---|---|
| Who is outside, and who is unaccompanied? | Roster count line; the six outside with freshness, accuracy and zone status; which three are with the chaperone | ST (positions, group zones), COMPUTED | Seconds to minutes (**most time-critical decision here**) |
| Is it real, where exactly, which way is it moving, is it violent? | Report locations with time, size, nature; announced route; police cordons; tear gas use | TRI (GDELT/news; often geocoded only to city level `[A11]`, must not be pinned near the hotel). CCTV (LIVE, if a camera covers the avenue). HUMAN (travelers, chaperone, hotel). Social media: NONE | Minutes |
| Who is in or near the path? | Each current person's distance to the reported crowd and to the announced route, using the possible-area rule (2.3) | ST, COMPUTED | Minutes |
| Recall to the hotel, or shelter where they are? | Their walking route back: does it cross the avenue, a square or a bridge? Indoor public places near them | OSRM, OSM, COMPUTED closest approach | Minutes |
| Shelter in the hotel, or relocate everyone? | Hotel on or near the route? Near a likely target (government building, embassy, police station, party office)? Event duration | OSM (targets), TRI (event schedule), HUMAN (hotel security) | Minutes to hours |
| If relocating: which destination and which way? | Destinations on the far side from the crowd; routes that avoid the avenue | ST, OSRM, COMPUTED | Minutes |
| Message wording and audience | Acknowledgement by the people outside (only visible as a count) | ST | Minutes |
| Tomorrow's plan | Event schedule, curfew, advisories | TRI | Hours |

**Lever gaps.**
- Direct group cannot target only the six who are outside.
- "Return to the hotel" is only possible if the hotel is an approved POI or rally point `[A12]`.

**First screen.**
- People outside the hotel, highlighted with age and accuracy.
- Unaccompanied travelers flagged.
- Crowd reports as uncertain areas with time and source.
- Each outside person's walking route back, with crossing warnings.

**Do not.**
- Draw a crowd as a precise polygon, an animated flow, or a heatmap.

---

### S4. Medical emergency, one traveler, 23:40

**Setting.** A chaperone calls: a 15-year-old has a severe allergic reaction. Two chaperones are at the hotel with 20 travelers; the third is out with 4 travelers. Variant: the traveler texted "I feel really sick" and has not answered since. They are not in their room.

**Default posture.**
- The chaperone calls the local emergency number first.
- The operator supports: emergency number, hospital choice, the chaperone ratio, and finding the person if they are not where expected.

| Decision | Information needed | Where it could come from | Time pressure |
|---|---|---|---|
| Where is the patient, and who is nearest to them? | Patient's position, state, age and accuracy; nearest current chaperone | ST | Seconds |
| (Variant) Patient not in room: where in the hotel? | Inside/at-hotel class; floor band with age and confidence; last geofence crossing | ST, ST-new floor band | Seconds to minutes. Hotel staff search the band starting at the likely floor. If the floor is unknown, say so and search common areas and the floors from the hotel card |
| Which number to call, if the chaperone is unsure | Local emergency number(s) | Static country table (new) | Seconds |
| Ambulance or taxi? | Drive time to the nearest emergency-capable hospital; whether local ambulances are slow | Curated hospital (ST); OSM `emergency=yes` (partial); OSRM (no traffic). Ambulance response: NONE | Minutes |
| Which hospital? | ER open 24 h, pediatric care, approved by insurer/assistance provider, language | Curated instructions (ST) when entered; else HUMAN (assistance provider) | Minutes |
| Who goes with the patient, who stays? | Chaperone positions and roles; ratio at the hotel after one leaves | ST | Minutes |
| Pharmacy tonight | Open-now pharmacies | OSM `opening_hours` (sparse) | Hours |
| Notify parents and org; track the hospital trip | Contacts (excluded from World View by design); accompanying chaperone's position | NONE in World View; ST | Minutes to hours |

**Privacy.**
- No medical detail on screen.
- To choose a hospital, the operator needs "emergency-capable, open, reachable", never the diagnosis.

**Lever note.**
- Direct group is the wrong tool for moving one patient.
- Hospitals appear as destinations with drive time, not as a "direct group" button.

**First screen.**
- Patient pin with age and accuracy (and floor band in the variant).
- Nearest 2–3 emergency-capable hospitals with drive time and source (curated vs OSM).
- Chaperone positions.
- Local time.
- Emergency number.

---

### S5. Earthquake

**Setting.** 03:05 local. USGS reports M6.4, 40 km away, 15 km deep. Coastal city. Phone networks are congested and many positions go stale within minutes.

**Default posture.**
- During shaking: drop, cover, hold (on scene).
- Afterward: leave the building if it is damaged or the hotel orders it. Avoid falling glass and façades, and go to open space.
- **If coastal and the shaking was strong or long: go to high ground immediately, without waiting for an official warning.**

| Decision | Information needed | Where it could come from | Time pressure |
|---|---|---|---|
| Who has been heard from since the quake? | For each person: last fix before or after the quake time; roster count line; not-current list. Expect most to be stale from congestion | ST | Seconds to minutes |
| Tsunami: move to high ground now? | Hotel ground elevation and distance to coast; tsunami warnings; nearest high ground (or a tall reinforced building for vertical evacuation) and walking time | Elevation: terrain (COMPUTED). Warnings: TRI (NOAA tsunami centers, not wired). Official zones: PUB-new or NONE | **Seconds to minutes. Life-critical** |
| Did the hotel get strong shaking? | Magnitude, depth, distance, time; estimated intensity at the hotel | USGS event (LIVE); ShakeMap/PAGER (PUB-new) | Minutes |
| Who is on upper floors, and who may be trapped? | Floor bands with age, from the last fixes before and after the quake; descending or not | ST-new | Minutes. Report bands to the hotel or rescuers; never a room |
| Stay in the building or go to open space? | Building damage; hotel instructions; aftershocks; open spaces away from tall buildings | HUMAN; OSM parks and squares plus building heights (MAPPED, approximate) | Minutes |
| Which route to open space or rally? | Walking routes avoiding narrow streets lined with tall buildings; bridges and overpasses flagged as possibly unusable | OSRM, OSM (COMPUTED, unverified) | Minutes |
| Medical | Hospitals (may be damaged or overwhelmed) | ST, OSM. Status: NONE | Minutes to hours |
| Relocate if the hotel is unusable | Relocation site, road status | ST. Roads: NONE or HUMAN | Hours |

**Reading positions here.**
- Show "not heard from since 03:05" as a count with a likely cause ("network congestion likely"). Do not show it as a list of missing people.
- Do not fill the gap with the last pre-quake positions shown as current.

**First screen.**
- Epicenter bearing, distance and time.
- Hotel elevation and coast distance (if coastal), with the high-ground direction.
- People split by before/after-quake contact.
- Floor bands for people at the hotel.
- Open spaces and rally points.

---

### S6. Active threat (shooting or attack) reported nearby

**Setting.** 21:15 local. Shooting reported on a nightlife street about 600 m from the hotel. 24 travelers are in the hotel. 4 travelers and 1 chaperone are at a restaurant 300 m away, on the other side of the hotel from the incident.

**Default posture.**
- Those inside stay inside: lock rooms, stay away from windows and the lobby, silence phones.
- Those outside get indoors at the nearest place away from the area. They do not move toward or through it to reach the hotel.
- Moving the group is almost never the right first action.

| Decision | Information needed | Where it could come from | Time pressure |
|---|---|---|---|
| Who is outside the hotel, and how close to the reported location? | Current positions with the possible-area rule; distance/bearing to the report; whether they are with the chaperone | ST, COMPUTED | Seconds to minutes |
| Where is the threat? Is it ongoing? More than one location? | Report locations, times, official police statements. Early reports are often wrong or multiple | HUMAN (police, chaperone, news). TRI GDELT/news (too slow for the first 30 min). CCTV (rarely useful; sensitive) | Minutes |
| Shelter where they are, or move? | Is their position between the incident and the hotel? Nearest indoor place away from the area | ST, OSM, COMPUTED | Minutes |
| What message, and how | A loud push can give away someone who is hiding. Wording: "Shelter where you are. Silence your phone. Reply OK when safe." Severity choice may control sound or silent-mode override `[A13]` | Broadcast (org_admin/HQ); acknowledgement count (ST) | Minutes |
| Should anyone move to the rally point? | Rally location relative to the incident; route closest approach | ST, OSRM, COMPUTED | Minutes (usually: not yet) |
| Shelter quality inside the hotel | Who is likely on upper floors vs at lobby level (floor band); never broadcast floors | ST-new | Minutes |
| Accountability | Acknowledgements, positions, chaperone headcount | ST, HUMAN | Minutes |
| Later: cordons, the route back, tomorrow | Police cordon, transport closures | HUMAN, TRI | Hours |

**First screen.**
- Reported locations as uncertain areas with time and source.
- People outside the hotel, highlighted with age.
- The shelter-in-place card as the default action.
- Direct group visually de-emphasized.

**Do not.**
- Present any outdoor route as safe.
- Auto-suggest direct group.

---

### S7. Traveler missing / last seen away from the hotel

**Setting.** Curfew is 22:00. At 22:40 one traveler has not returned. Their last fix was at 21:12 at a market 1.8 km away, ±40 m, battery 4% and discharging, state stale. Variant: the last fix was inside the hotel footprint at 21:50 with a floor band of 3–5, and they are not in their room.

| Decision | Information needed | Where it could come from | Time pressure |
|---|---|---|---|
| Missing, or just a dead phone? | Last fix time, accuracy, battery level and state at last fix, presence state; last lodging geofence crossing; who else was co-located at that time | ST (freshness, battery, `accuracy_m`, geofence_events), COMPUTED co-location | Minutes |
| Where to look first | Last known position and its surroundings (venue, transit stop); path from there to the hotel; other travelers last seen near them | ST, OSM, OSRM | Minutes |
| (Variant) Where inside the hotel? | Last floor band with age; the group's floors from the hotel card; common areas | ST-new | Minutes. The hotel searches the band, starting at the likely floor. If the floor is unknown, say so and do not guess |
| Who searches? | Nearest current chaperone; whether they can leave the group (ratio) | ST | Minutes |
| Ask the group who saw them | Broadcast to travelers; acknowledgements | Lever, ST | Minutes |
| When to call police, embassy, org, parents | Time since last contact; whether the traveler is a minor (age not in snapshot); darkness; area risk; the org's policy threshold | ST (time). Age and policy: NONE in World View `[A14]`. HUMAN | Minutes to hours (escalate early for minors) |
| Which police station | Nearest police (tourist police where they exist) | Curated or OSM | Minutes |

**First screen.**
- The last-known pin, explicitly aged: "last fix 1h 28m ago · ±40 m · battery 4%". It is not drawn as a live dot.
- The possible-area ring per 2.3, labeled as "possible area, not a prediction".
- The path to the hotel.
- The nearest chaperone.

**Do not.**
- Extrapolate a trajectory.
- Draw a "probable location" cloud.
- Style the last fix like a live pin.

---

### S8. Transport disruption affecting the next movement

**Setting.** 19:00. A national transport strike is announced for tomorrow, or the airport closes for weather. The group leaves the hotel at 05:30 for an 08:10 flight.

| Decision | Information needed | Where it could come from | Time pressure |
|---|---|---|---|
| Is everyone back and accounted for tonight? | Roster count line; not-current list at curfew | ST | Minutes |
| Does it affect our next movement? | Next itinerary items and flights; disruption scope and timing | ST (itinerary, flights). TRI (State Dept, FCDO, news). Airport status: NONE or PUB-new | Hours |
| Leave earlier, change route, or change mode? | Drive time now and expected; alternate routes to the airport with no shared chokepoint; road closures | OSRM (no traffic or closures); TomTom flow (LIVE, with a key); closures NONE or HUMAN | Hours |
| Stay another night or relocate? | Lodging availability; relocation site | HUMAN, ST | Hours |
| Tell the group the plan | Broadcast; acknowledgements | Lever, ST | Hours |
| Demonstrations linked to the strike near our route? | See S3 | See S3 | Minutes to hours |
| Flight status | Flight assignments; live aircraft position only | ST flights (no live aviation provider in Core); aircraft layer (LIVE) | Hours |

**First screen.**
- Next movement and time.
- Route to the airport with its chokepoints and an independent alternate.
- Disruption source and time.

---

## 4. Decisions common to all scenarios (summary)

| Decision | Appears in | Tool lever | Usually owned by |
|---|---|---|---|
| Where is everyone, and who is not current? | All | Positions overlay (P0) | Operator |
| Stay or move (shelter in place vs relocate) | S1, S2, S3, S5, S6 | Broadcast / direct group | On-scene first; operator for the group-level move |
| Which destination | S1, S2, S3, S5, S6, S8 | Direct group (approved destinations only) | Operator |
| Which way | S1, S2, S3, S5, S8 | Note text on direction | Operator suggests; people on scene decide |
| Arrive-by | S1, S2, S3, S5 | `arrival_minutes` | Operator |
| Audience and wording | All | Broadcast / direct group | Operator (org_admin/HQ only) |
| Who to escalate to, and when | All | Phone (outside the tool) | Operator |
| Stand down | All | Broadcast | **Authorities / hotel only.** The operator relays and never declares |

---

## 5. Consolidated decision-to-information matrix (ranked)

Cell values: **2** = needed to make the decision; **1** = helps; blank = not relevant.

Score = sum across scenarios. Ties are broken by the fastest time pressure (seconds > minutes > hours).

| Rank | Information | S1 Fire | S2 Hotel evac | S3 Unrest | S4 Medical | S5 Quake | S6 Active threat | S7 Missing | S8 Transport | Score | Fastest | Available today |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Position of each traveler/chaperone, classified inside (likely) / at hotel undetermined / outside nearby / away** | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 16 | Seconds | ST (classification is new, computed from ST + OSM) |
| 2 | **Fix state and age (live / stopped-current / aging / stale / unknown), accuracy radius, battery; roster count line and not-current list** | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 16 | Seconds | ST |
| 3 | Delivery and acknowledgement of last message (sent / push accepted / acknowledged) | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 1 | 14 | Minutes | ST |
| 4 | **Group-zone status and chaperone coverage (who is outside zone, who is unaccompanied, chaperone positions)** | 1 | 2 | 2 | 2 | 2 | 2 | 2 | | 13 | Seconds | ST (zone unknown when anchors are stale) |
| 5 | Official instructions (evacuation/shelter orders, cordons, curfews) | 2 | 2 | 2 | | 2 | 2 | 1 | 2 | 13 | Minutes | **Mostly NONE.** HUMAN; partial TRI (not wired) |
| 6 | Threat location and extent; distance and bearing from hotel and from each person | 2 | 1 | 2 | | 2 | 2 | 1 | 2 | 12 | Seconds | Partial: FIRMS, USGS (LIVE); others TRI or HUMAN |
| 7 | Primary + independent alternate route, closest approach to threat, chokepoints | 2 | 2 | 2 | | 2 | 1 | 1 | 2 | 12 | Minutes | OSRM + OSM (COMPUTED; no live closures) |
| 8 | Threat source, observation time, confidence | 2 | 1 | 2 | | 2 | 2 | | 2 | 11 | Minutes | Partial |
| 9 | Approved destinations with walk/drive time | 2 | 2 | 2 | 1 | 2 | 1 | | 1 | 11 | Minutes | ST + OSRM |
| 10 | Local time, darkness, next itinerary event | 1 | 2 | 1 | 2 | 1 | 1 | 2 | 1 | 11 | Seconds | ST + computed |
| 11 | **Floor estimate band with age and confidence (people at/in hotel)** | | 2 | | 2 | 2 | 1 | 1 | | 8 | Seconds | **ST-new** (barometer + Core). Until then "Floor unknown" |
| 12 | Destination side relative to threat (beyond/away) | 2 | 1 | 2 | | 2 | 2 | | | 9 | Minutes | COMPUTED |
| 13 | Emergency numbers; police; embassy | | 1 | | 2 | 1 | 1 | 2 | | 7 | Seconds | Static table (new) + ST |
| 14 | Headcount / muster status | 1 | 2 | 1 | | 2 | 1 | | | 7 | Minutes | HUMAN; ST musters if a chaperone opens one `[A15]` |
| 15 | Hotel interior, hotel assembly point, group floors | 1 | 2 | | 1 | 2 | 1 | | | 7 | Seconds | **NONE** until the hotel card (ST-new) |
| 16 | Emergency-capable hospitals with drive time | 1 | 1 | | 2 | 1 | 1 | | | 6 | Minutes | Curated / OSM + OSRM |
| 17 | Threat trend (wind, march direction, aftershocks) | 2 | | 2 | | 1 | 1 | | | 6 | Minutes | Partial / PUB-new |
| 18 | Weather (wind, rain, cold) | 2 | 1 | | | 1 | | | 2 | 6 | Hours | PUB-new (not in World View) |
| 19 | Traffic, closures, transport status | 1 | | 1 | 1 | | | | 2 | 5 | Hours | TomTom flow (key-dependent); closures NONE |
| 20 | Last-known trail: geofence crossings, co-located people | | | 1 | | | 1 | 2 | | 4 | Minutes | ST |
| 21 | Group vehicle availability | 2 | 1 | | | | | | 1 | 4 | Hours | HUMAN |
| 22 | Hotel elevation, coast distance, high ground | 1 | | | | 2 | | | | 3 | Seconds | Terrain (COMPUTED) |

(Item 12 scores above item 11 on points but is listed below it. The floor band is decisive in the three highest-consequence hotel scenarios and must be readable in seconds, so it is promoted.)

### What this ranking means for the screen

**Tier 0: always visible when Trip Twin is open, readable in five seconds**
- Items 1, 2 and 4: the positions overlay.
  - Roster count line.
  - Not-current list.
  - Outside-zone / unaccompanied list.
  - Pins with age and accuracy.
- Item 10: local time and darkness.
- Item 9: rally primary/secondary with walk times.
- The data age of every visible layer.

**Tier 1: appears automatically when an incident or hazard is in focus**
- Items 3, 5, 6, 7, 8, 11 and 12.
- Item 5 (official instructions) gets a permanent slot even when empty: "No official instruction on file. Check local authorities."

**Tier 2: one action away**
- Items 13–22.

**Scenario-critical promotion.** Some items score low overall but decide one scenario. When that scenario type is active, the screen moves them to Tier 1:

| Scenario | Promoted items |
|---|---|
| S4 medical | Hospitals and emergency number |
| S7 missing | Last-known trail |
| S5 coastal quake | Elevation and high ground |
| S2 hotel evacuation | Hotel interior/assembly point and floor bands |

**Biggest gaps** (high rank, weak availability), in order:
1. Official instructions.
2. Hotel interior and assembly point (hotel card).
3. Floor estimate (barometer pipeline).
4. Threat corroboration (TarvaRI not wired into World View).
5. Wind.

Each of these must render as an explicit "unknown" state, not be omitted.

### Mapping to the five operator questions

| Operator question | Matrix items |
|---|---|
| Where are my people? | 1, 2, 4, 11, 14, 20 |
| What is the threat, and where? | 6, 8, 17, 5 |
| Where is safety? | 9, 12, 16, 15, 22 |
| How do they get there? | 7, 19, 21 |
| How fresh and trustworthy is this information? | 2, 8, plus data-age badges on every layer |

---

## 6. Escape and evacuation route principles for the display

Routes are outdoor street paths from OSM via OSRM. They are planning aids for the operator. Neither SafeTrekr nor any authority has verified them.

### 6.1 Rules

| # | Rule | Detail |
|---|---|---|
| R1 | **Primary plus an independent alternate** | The alternate must not share the first chokepoint or roughly the first 200 m from the hotel `[A3]`. Where the grid allows, the two routes leave in different directions. If no independent alternate exists, say so: "No independent alternate: both routes use [bridge]". |
| R2 | **Never toward or through the threat** | Each hazard gets an avoid-buffer with a stated basis. FIRMS: detection footprint plus at least 1 km, more downwind `[A16]`. Crowd report: report point plus an uncertainty radius scaled to how vague the report is (default 500 m `[A16]`). Active threat: no walking routes computed into its sector by default. Quake: avoid streets lined with tall buildings where heights are known. Each route shows "closest approach to hazard: 420 m". A route that enters a buffer is not presented as a candidate; it is shown greyed with "passes within buffer". |
| R3 | **Check the destination's side** | If the destination lies beyond the hazard as seen from the hotel, warn even if the route bends around it. |
| R4 | **Start at the street, not inside the building** | Origin = mapped main entrance if present, else the address point on the street edge, labeled "approximate start". For people outside (S3, S6, S7), origins are **current fixes only**. A route from a stale fix is labeled "from last known position, N min old", or not drawn. |
| R5 | **Show distance, walking range and drive time separately** | Example: "850 m · walk 11–17 min (group pace) · drive 4 min (no traffic data)". Walking uses OSRM foot (~5 km/h) adjusted to a group pace of 3–4 km/h at night `[A17]`. Show a range, never a single figure. Drive time states that it ignores traffic and closures. |
| R6 | **Suggest an arrive-by and show the arithmetic** | Suggested arrive-by = preparation/muster time + upper walking time + 25% buffer `[A17]`. Night preparation 10–15 min, day 5 min. Example: rally 800 m at 02:00 → 12 + 16 + 7 ≈ 35 min. Warn when the operator's value is below the lower bound. **The default 15 min is often infeasible at night.** |
| R7 | **Shelter in place is shown as an option** | It sits beside the routes, not hidden behind them. In S3 and S6 it is the default card. |
| R8 | **Routes have an age** | Example: "Route computed 3 min ago against fire data 47 min old". Recompute when the hazard updates. Superseded routes are visibly retired. |
| R9 | **Travelers do not see this route** | Direct group sends a destination, its location and a deadline `[A18]`. If the route matters, the operator writes it in the note (up to 2000 characters). The screen can draft that text: "Leave by [street] northbound. Avoid [avenue] and [square]." |
| R10 | **Official routes win** | Published evacuation routes or zones display above ours. Ours are labeled "SafeTrekr suggestion". |
| R11 | **Mode caveats** | In S3 and S5, vehicle routes are flagged "roads may be blocked". Bridges and overpasses after a quake are flagged "may be closed". |
| R12 | **Accessibility** | If the hotel card reports people needing help on stairs, widen walking ranges and flag `highway=steps` on routes. |

### 6.2 What the display must never imply

- **That an outdoor route is safe or clear.**
  - Label: "Suggested path (unverified)". Never "safe route".
  - Always-present caveat: "Street path from OpenStreetMap. Not checked for closures, crowds, lighting, crime or damage."
- **Indoor exits, stairwells, corridors, or which door to use.**
  - None may be drawn unless VERIFIED from a hotel plan, and then labeled "from hotel plan photographed [date]".
  - A floor band does not imply knowledge of the floor's layout or its stairs.
- **A room.** Ever.
- **A floor as fact.** Floors appear only as a band with age and confidence (2.6).
- **That the hologram building is accurate.** Height and outline are approximate when OSM lacks data, and this is visibly marked.
- **That a destination is open, staffed, has capacity, or will accept the group.**
- **That people are moving along the route.** No animated walkers. No pin interpolation between fixes.
- **That an ETA is precise.** Ranges only.
- **That no hazard is drawn because none exists.** Layers that are off or unavailable say so.
- **That SafeTrekr's route is an official evacuation route.**
- **That a route from an old fix starts where the person is now.**

---

## 7. Anti-patterns: looks impressive, misleads or slows the operator

| # | Anti-pattern | Why it is tempting | Harm | Do instead |
|---|---|---|---|---|
| 1 | Long cinematic photoreal-to-hologram dissolve during an incident | It is the signature moment from the reference film | Costs seconds when seconds matter | Make it instant or skippable when an incident is open. Cap the transition at ~1 s `[A19]`. Respect reduced motion |
| 2 | Smoothly animated traveler pins between fixes | Looks like live tracking | Implies positions we do not have | Snap to fixes. Show age labels. Fade by state |
| 3 | Stale or unknown people drawn like live ones, or placed at the hotel by default | Clean map | False accountability | Distinct state treatments. Roster count line. Not-current list |
| 4 | Pins inside the hotel hologram, or on a floor plate, treated as proof of "inside" or "on floor 6" | Looks precise and immersive | Indoor GPS error often exceeds the footprint; floors are estimates | Use the 2.4 classification with "likely" and "undetermined". Show floor as a band spanning the floors with age, never a dot on a floor slab |
| 5 | Bare floor number, room number, or floor from GPS altitude | Feels exact | Sends responders to the wrong place with confidence | Band + age + confidence, or "Floor unknown" with a reason |
| 6 | Glowing exits, stairwells or invented interior floors on the hologram | Sci-fi x-ray look from the film | Invented data in a life-safety context | "Interior unknown" until a hotel card exists. Floor lines only as an approximate height grid, labeled |
| 7 | Pulsing threat rings with an arbitrary radius | Dramatic | Implies a known danger zone | A radius only with a stated basis (pixel footprint, report uncertainty, official zone), and labeled |
| 8 | Risk heatmaps and blended hazard glows | Rich-looking | Unsourced, cannot be acted on | Discrete items with source and time |
| 9 | Fire-spread, smoke-plume or crowd-flow predictions | Futuristic | False certainty | Show observations with time. Show trend only between real observations |
| 10 | Every OSM POI in range (12 pharmacies, 30 police posts) | Looks thorough | Clutter hides the answer | Curated items first, then the nearest 1–3 per category, marked by source |
| 11 | Auto-playing CCTV mosaic | Looks like a SOC | Attention sink; camera often not pointed at the event; unclear image time; privacy | On demand, one feed, image timestamp prominent |
| 12 | Aircraft, ships, satellites, night-vision or FLIR shaders inside Trip Twin | Already built; looks cool | Irrelevant; FLIR implies sensors we lack | Off in Trip Twin. Aircraft only in S8, on demand |
| 13 | TomTom simulated traffic shown when there is no key | Layer never looks empty | Fake data presented as live | Hidden in Trip Twin. Never shown unlabeled anywhere |
| 14 | Country- or city-geocoded intel pinned at hotel coordinates | Puts the alert "on the map" | Makes a national item look local | Show it as a region-level banner: "location approximate (country)" |
| 15 | Green "all clear" ticks from push acceptance or read counts | Satisfying | False reassurance (Core docs forbid this) | Three separate counts: sent / push accepted / acknowledged, plus positions |
| 16 | Big "EVACUATE" button or an auto-suggested life-safety course of action | Mirrors the film's suggested course of action | Confuses authority; wrong in S3 and S6 | Suggest information steps (call the chaperone, confirm headcount, check official instructions), never a shelter/evacuate verdict |
| 17 | Orbit-only oblique 3D views | Shows off the hologram | Buildings hide streets; distances distort | One-key north-up plan view with a scale bar. 3D for context only |
| 18 | Over-precise numbers (6-decimal coordinates, ETAs to the second, "risk 7.3") | Looks rigorous | False precision | Round, and use ranges |
| 19 | Full names of minors and floor bands on a shared wall display | Wall looks complete | Privacy; shoulder-surfing | Initials and role on the wall; names on the operator console. Floor bands only while an incident is open `[A9]` |
| 20 | Empty layer when a source failed (Overpass timeout shown as "no hospitals") | Nothing to render | Reads as "none exist" | Explicit "unavailable since HH:MM" state |
| 21 | Same color for hazard and route; red/green-only status | Default palettes | Misreads under stress; color blindness | Reserve the hazard color; routes never use it. Add a shape or label to every status |
| 22 | Hotel glowing as a "safe zone" | Pleasing focal point | Not verified safe; in S2 it is the hazard | Neutral subject treatment. Status comes from data only |
| 23 | Fixed distance rings (1/2/5 km) everywhere | HUD aesthetic | Noise with no decision attached | Only decision-tied rings: hazard buffers with a basis, possible-area rings for the missing person |
| 24 | Yellow hotspot rings (from the film) on everything | Signature look | They lose meaning | Reserve hotspot rings for items that need an operator decision now: a not-current person, a person outside zone, a person at or above an incident floor, a hazard, a chosen destination |

---

## 8. Prototype demo: which scenarios the mock trip should script

The prototype uses a fictional trip at a real Austin hotel (`demo.js` pattern, mock data only). The demo must prove decisions, not visuals. Script three scenarios: one inside the hotel, one around it, and one away from it. Together they exercise every position state, the inside/outside classification, group zones, the floor band and routes. Each scenario is a timed replay, so states age on screen. A **pass** means a test operator reaches the listed decision from the screen alone, within the stated time, without asking "where is that from?" or "how old is that?".

**Hotel choice `[A20]`.**
- A downtown high-rise hotel with OSM `building:levels` or `height` present, at least 8 floors, a real footprint (not synthesized), within about 1 km of Congress Avenue.
- Reuse Justin's sample hotel coordinate if its OSM building qualifies; otherwise pick one that does and record the OSM way ID.
- Required nearby: at least one real OSM hospital with `emergency=yes`, a police station, a fire station, and a mapped chokepoint (e.g., a Lady Bird Lake bridge) so R1/R2 have something to avoid.

**One fictional roster across all three scenarios.**
- 24 travelers and 3 chaperones, with initials and fictional names.
- Avatars: placeholder art only. No real photos.

### Demo A (hero): S2 hotel evacuation, 02:10 local

Proves: inside/outside honesty, the floor band, the at-or-above-fire-floor answer, and "operator never declares stand-down".

| Element | Mock content |
|---|---|
| Incident | Fire alarm. A HUMAN-sourced note "Smoke reported floor 9 (hotel desk, 02:12)" is injected as an operator-entered report, not as a feed |
| Group floors | Hotel card present: travelers on floors 8, 9 and 11; chaperones on 8 and 11; hotel assembly point pinned across the street; evacuation-plan photo slot filled with a placeholder |
| Positions at T0 | 14 travelers and 2 chaperones descending, then outside: live, accuracy 8–25 m, across the street. 5 "at hotel, undetermined": live, accuracy 35–60 m straddling the footprint edge. 2 inside (likely): fix inside the footprint plus a current band of 9–11. 1 stopped-current in the lobby area ("At this location for 3m", accuracy 30 m). 1 stale, last fix 21:40 at a bar 600 m away, battery 6% (unrelated to the fire; tests "not current" vs "inside"). 1 unknown (never reported). 1 chaperone aging (4 min) |
| Floor traces | Mock barometer traces: descending staircase profiles for evacuees (band drops 11 → 8 → lobby over 4–6 min). One trace flat at "likely 10 (9–11)" for 8 minutes: the priority person. One Android-style device with no barometer: "Floor unknown: no pressure sensor". One with no lobby anchor: "Floor unknown: no ground reference". Noise ±0.3 m, a slow weather drift, and a +1 m HVAC offset on one trace, so one band is visibly off by one |
| Expected operator decisions (≤ 60 s) | (1) Read the count line, with "at hotel, undetermined" not counted as out. (2) Name the person likely at or above floor 9 and pass "likely 10 (9–11), N min" to the hotel. (3) List the not-current people, separating the bar and never-reported cases from the building. (4) Hold at the hotel assembly point; prepare rally primary with a suggested arrive-by of ~30+ min, not the default 15. (5) No stand-down button exists |

### Demo B: S3 unrest on Congress Avenue, 17:30 Saturday

Proves: people outside, unaccompanied travelers, zone status, routes that avoid a hazard, shelter-in-place as the default card, and region-level intel not pinned locally.

| Element | Mock content |
|---|---|
| Incident | Two mock crowd reports: "march forming at Capitol south steps, 17:20" and "crowd moving south on Congress at 6th, 17:28", each with a 500 m uncertainty area and source labels. One mock city-level advisory ("demonstrations expected in Austin") shown as a region banner, not a pin |
| Positions | 18 inside the hotel (stopped-current). 6 on free time near Congress/6th: 3 with a chaperone inside the zone (live); 2 outside the zone, live, accuracy 10 m, 250 m from the crowd report; 1 aging, 7 min, last seen walking toward Congress (possible-area ring crosses the avenue). The chaperone group's zone shown current. One traveler's zone shown "zone unknown" because their nearest-chaperone anchor went stale |
| Routes | Walking routes from each current outside cluster back to the hotel: the direct route crosses Congress inside the buffer (greyed, "passes within buffer"); the alternate goes east and south (closest approach shown). From the aging traveler: no route, "from last known position, 7 min old" |
| Expected operator decisions (≤ 90 s) | (1) Identify the 3 people without a chaperone and the 1 not current. (2) Choose shelter-in-place for those whose way back crosses the march, and the alternate route for the others. (3) Draft the direction note text from the route ("Go east on 5th, avoid Congress"). (4) See that direct group cannot target only these 6 (lever gap) |

### Demo C: S7 missing traveler, 22:40

Proves: stale vs dead phone, the possible-area ring, last-known styling, last geofence crossing, and escalation timing with no false precision.

| Element | Mock content |
|---|---|
| Incident | Curfew 22:00. One traveler not back |
| Positions | The missing traveler: last fix 21:12 at a South Congress location across the river, ±40 m, battery 4% discharging, state stale; last lodging geofence **exit** at 19:05. Another traveler co-located with them until 20:50, now back at the hotel (live). All others inside the hotel (stopped-current). Nearest chaperone is in the lobby, current |
| Display | Possible-area ring per 2.3 labeled "possible area, not a prediction". The river bridge flagged as a chokepoint on the path to the hotel. Nearest police (OSM) with drive time |
| Expected operator decisions (≤ 60 s) | (1) Read "likely dead phone, still unaccounted for". (2) Ask the co-located traveler first (broadcast or chaperone). (3) Send the chaperone to the last known point via the bridge. (4) Name the escalation step and its time. No trajectory or "probable location" shown |

**Not scripted for the first demo.**
- S1 wildfire: live FIRMS near downtown Austin is unlikely. A faked detection would teach the wrong lesson about FIRMS timing.
- S5 earthquake: not credible for Austin.
- S4 medical: the S2 roster can replay a patient-not-in-room variant with the same floor traces if time allows.
- S6 active threat: too sensitive for a sales-adjacent demo.

**Second and third cities (pass bar).**
- Pick one coastal city with a tall hotel, so the S5 tsunami/high-ground logic and elevation are exercised.
- Pick one non-US city with sparse OSM `building:levels`, so "floor count not verified" and approximate footprints are exercised honestly.

---

## 9. Assumptions

| ID | Assumption | Verify with |
|---|---|---|
| A1 | The trip or org knows the travelers' nationality for embassy selection; it is not in the snapshot | Product owner |
| A2 | The hotel card requires a mobile-app change and is outside the Trip Twin prototype; the screen reserves its slot | Product owner |
| A3 | Thresholds: rally bearing separation ≥ 90°, rally primary ≤ ~10 min walk and ≥ 50 m from the building, hospital ≤ 20 min drive, routes independent after ~200 m | Ops review; tune per city |
| A4 | Reported `accuracy_m` is about a 68% radius on iOS/Android; indoor and near-building accuracy is commonly 20–65 m | Field test with the SafeTrekr app |
| A5 | "Outside, nearby" = within ~150 m of the footprint | Ops review |
| A6 | The floor estimate is not available until the barometer sampling (mobile) and the floor computation and snapshot field (Core) ship; until then every person shows "Floor unknown" | 03-architecture |
| A7 | A current floor estimate ≥ 2 floors above the lobby anchor is strong evidence of being inside; exceptions include hillside sites, elevated terraces and adjacent buildings | Field test |
| A8 | Hotel floor numbering (lobby 0 vs 1, mezzanine, skipped 13) varies and is unknown unless the hotel card captures it | Hotel card design |
| A9 | Floor bands and full names are restricted on a shared SOC wall unless an incident is open | Privacy review |
| A10 | TarvaRI feeds are not consumed by World View today | 02-layer-catalog / 03-architecture |
| A11 | TarvaRI geo-fallback resolves some records only to city, state or country level | TarvaRI `geo_fallback.py` |
| A12 | The lodging itself is not a direct-group destination unless an approved POI or rally point sits at it | Core `direct-group` + trip data |
| A13 | Broadcast severity may control push sound or silent-mode override on traveler phones | Mobile push configuration |
| A14 | Traveler age/minor status is not in the snapshot (birthdate excluded); escalation thresholds are org policy, not in World View | Product owner |
| A15 | Musters can be opened by chaperones in the app and show check-ins in the snapshot; they cannot be opened from World View | Core musters |
| A16 | Avoid-buffers: FIRMS ≥ 1 km plus downwind extension; crowd report 500 m default | Ops review |
| A17 | Group walking pace 3–4 km/h at night; preparation 10–15 min at night and 5 min by day; 25% buffer | Ops review; drills |
| A18 | Travelers receive the destination and arrive-by in the app, not the operator's route; the app's own navigation is out of our control | Mobile app |
| A19 | Transition cap of ~1 s during an open incident | 05-motion-language |
| A20 | A downtown Austin hotel exists with OSM levels/height, ≥ 8 floors, a real footprint, and the required nearby hospital/police/fire and a bridge chokepoint; Justin's sample hotel coordinate (30.2641, -97.7394) may or may not qualify | Overpass check before fixture authoring |
| A21 | The prototype has no live operator-entered incident report; the "smoke reported floor 9" and crowd reports are fixture events labeled HUMAN/mock | 04-screen-spec, 03-architecture |
