# Phase 10 fix list: SOC multi-view (wall screens + remote)
Merged from 01-ux, 02-ui, 03-supervision and 04-ia on 16 Oct 2026: 72 findings, merged into 20 fixes.

## Decisions where the reviews differed
- **Scope of Live / Advance and Day.** The supervision spec made mode one shared value, with no overrides on individual screens. IA and UX found that this lets a push move pinned S3 to Advance during an incident (shots 22–23), which hides traveler positions on the incident board. **Decision: mode and day become per-screen fields.**
  - They follow the target picker, and All skips pinned screens.
  - A big badge on every wall says which mode it is in, which answers the supervision concern about mixed walls.
  - Pushing Advance while an incident is open asks first and says what goes away: "Incident open · traveler positions leave S1, S2…".
- **Wall-wide items.** Site, trip, spotlight, Visitor mode and the reported floor stay one value for the whole wall. Every remote section says its scope: `· S2` or `· EVERY SCREEN`.
- **Station order.** We adopt IA's order with today's four live stations: **01 Incident · 02 People · 03 Weather · 04 Trip · 05 Screens · 06 Layers**. People and Weather come next phase. Roles are renamed: `Travelers` → `People`, `The day` → `Day plan`. The station is called `Weather`, not `Alerts`, because 06 F4 reserves "alert" for official sources.

## Must fix (P0)
| # | Fix | Sources |
|---|---|---|
| R1 | **Relay authenticates sockets.** A socket's identity is bound only after an accepted hello. A device ID that already holds a token cannot be claimed without that token. Denied sockets receive nothing, and presence carries no device IDs (each socket gets `you`). WebSocket upgrades must come from the same origin. The launcher sends `setup` once, never on reconnect. The setup token is removed from a screen's URL once the screen has joined. | SUP P0-1, SUP P1 |
| R2 | **Mode and day per screen, with pins respected.** Advance during an incident asks first and names the walls that lose positions. Site and trip changes ask first and say "every screen". Day-plan rows no longer move the walls without asking. | UX P0-1/2, IA P10-A/D, SUP P1 |
| R3 | **Trips on watch agrees with the other walls.** The focus trip's tile uses that wall's own live counts, the sample clock and the operator's report. Other trips use the same scenario clock. The header reads `3 trips · in focus: Spring choir tour`. The incident banner names its trip. Dates are readable, not ISO. | UX P0-3, UI P0-2, IA P10-B |
| R4 | **Reported floors carry their own time.** The remote stamps `at`; walls show that time and the real age, and a reload does not restamp it. An acknowledgement is tied to one report. | SUP P0-2, SUP P1 |
| R5 | **The incident banner never covers content.** It becomes a full-width 72 px band above the footer, every panel stops above it, it is one line, and it shows clock time instead of "0 min ago". | UI P0-1, UX P1 |

## Walls (P1)
| # | Fix | Sources |
|---|---|---|
| R6 | **Readable at 3 m and honest about state.** Chip text grows to 22 px, the SAMPLE mark to 15 px, the kicker to 28 px. The chip reads `Remote: iPad · changed 13 s ago`. `Remote offline · since 21:41` stays on screen. Hands-on shows in every chip state. A `VISITOR MODE · INITIALS ONLY` mark appears on every wall. The place-chip row no longer lands in the header. | UI P1, UX P1, IA P10-E/F, SUP P2 |
| R7 | **Roles look different from across the room.** People (S2) is top-down. Weather (S4) turns on heat detections, rain and lightning. Day plan in Live is labelled `TODAY'S PLAN · DAY 1`, and its panel no longer says "Advance planning". | UI P1, UX P1, IA P10-E |
| R8 | **No controls and no red on people.** Wall cards hide "Dismiss report" even when hands-on. Incident-board person rows lose their red bars and use neutral rules. The S5 checkboxes and prompts are hidden. | UX P1, SUP P1, UI P1 |
| R9 | **Hands-on is deliberate and visible.** It starts on press, scroll or a key, not on mouse movement. The wall shows a `HANDS-ON · S2` frame. Queued camera moves run after 3 s without input, not only on mouse-up. The remote can "Clear the wall's own selection". | UX P1, SUP P1 |
| R10 | **A replaced screen is told.** When its slot goes to another device, it returns to its pairing code. A cached state shown before the link connects says when it was saved. | SUP P1 |

## Remote (P1)
| # | Fix | Sources |
|---|---|---|
| R11 | **The confirm/undo bar.** A `[hidden]` bug made it always show. It now sits in a fixed slot so content doesn't jump. It lists pinned screens that are skipped. It expires after 15 s. It never repeats the target. | UI P1, SUP P2 |
| R12 | **One undo per operator action.** "Show Day 2 on S5" is one command. Undo restores only the fields that command changed, and never replays an old camera framing. | SUP P1 |
| R13 | **Incident station.** "Frame floor 9 on Site (S1)" uses whichever screen holds Site. "Make {target} the incident screen". "Clear my reported floor" and replacing an open report both ask first. The OPEN pill is red (incident). There is a single primary button. | UX P1, UI P1, IA P2 |
| R14 | **Hand-over is never silent.** A request is granted automatically only when the controller is offline. The controller sees "iPad asks for control · Hand over / Keep". The button reads "Take control" when no one has it. | SUP P1, UX P2 |
| R15 | **Layout.** Rail list rows grow to fit two lines and fade at the bottom edge. The iPad rail scrolls to all six screens. On/Off buttons are 44 px with a clear pressed state. Layer rows are capped at 560 px wide. The iPad preview is narrower. Status dots are neutral, not green, and entry URLs are not path blue. | UI P1/P2, UX P2 |
| R16 | **Names and order.** The stations are 01 Incident · 02 People · 03 Weather · 04 Trip · 05 Screens · 06 Layers. Scope suffixes on every section kicker. The Trip station heading is `Trip in focus`. Day rows read `D2 · Day 2 · 3 to check` instead of a bare `!`. The day list appears once. | IA P10-C/D, UX P1 |

## Setup (P1)
| # | Fix | Sources |
|---|---|---|
| R17 | **Opening screens on two computers.** The launch buttons show which screens have joined and where ("S3 · open on another computer"). The nth window opened on a computer goes to that computer's nth monitor, not `slot mod monitors`. | UX P1 |
| R18 | **A relay restart keeps the wall.** Session, devices and tokens are saved to a file and restored, so screens and the remote rejoin. | SUP P1, UX P1 |
| R19 | **Copy.** "Aging · Aging", the entry chooser's "as today", "Clear the reported floor" → "Clear my reported floor", the orphan "or". | UI P2, IA P2, UX P2 |
| R20 | **Tests.** Spoofed IDs are denied, presence carries no IDs, mode per screen respects pins, undo is field-level, a report keeps its time, an acknowledgement is tied to its report, hand-over is not automatic while the controller is online, a replaced screen is unpaired, state survives a relay restart. | all |

## Deferred
- A People station with the roster and spotlight, and "who may be at or above" listed on the remote (IA P10-C, UX P1).
- A Weather station: acknowledging official alerts, feed health, the log.
- `wss`, single-use remote setup tokens, expiring remote tokens (SUP security; acceptable for a LAN prototype per the review, and noted in 07).
- Banners appearing up to 15 s apart on different walls (each wall's feed tick); a shared clock push is next phase.

## Status (16 Oct 2026, after implementation)
R1–R20 implemented, with these exceptions:
- **R15:** the iPad preview narrowing applies only below 1280 px.
- **R17:** "open on another computer" is inferred from what this launcher opened.

Also added at Jesse's request:
- **Hands-on:** the mouse can reach in on any wall to rotate, zoom and select there. The remote shows "At the wall: hands-on · selected …". Camera pushes wait while you drag.
- **Screens on another computer:** a launch link, for the Mac Studio.

**Fixes made while verifying:**
1. The hidden identify and pairing overlays still covered every wall, because `display: grid` overrode `hidden`.
2. Roles without 3D never finished loading: they paused rendering before the twin had opened.
3. "Remote offline" lagged by up to 30 s after the remote dropped.
4. Starting multi-view again carried over the previous wall's pins and visitor mode.

**Verification:**
- 132 Trip Twin unit tests pass. New tests cover:
  - a spoofed ID is refused and gets no broadcasts; presence carries no IDs
  - mode per screen respects pins
  - undo is field-level and never replays a framing
  - a report keeps its own time
  - an acknowledgement is tied to its report
  - hand-over is never automatic while the controller is online
  - a replaced screen is told
  - a restart keeps the wall
  - the focus-trip tile uses the wall's own data
- The full suite passes apart from the same 3 known failures (not Trip Twin). Build and boundaries OK. QA PASS on all 9 sites.
- **Six-screen end-to-end run** (`after/`, walls at 1920×1080, remote at 1180×820 and 1440×900): zero console errors on all ten pages. Shown working:
  - Day 2 to all screens
  - Return all to Live
  - pinned S3 left unchanged ("S3 pinned, unchanged")
  - visitor mode shows initials only
  - "Remote offline · since 14:32"
  - the incident banner as a band that names its trip
  - Trips on watch agreeing with S1–S5
- **Undo:** checked in a separate run, because in the six-screen run the reads took longer than the 10 s undo window. Push Day 2 → both screens Advance Day 2 → Undo → both Live.
