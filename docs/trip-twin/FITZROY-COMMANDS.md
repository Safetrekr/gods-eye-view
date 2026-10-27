# Fitzroy commands

Generated from `src/operations/tripTwin/fitzroy/` by `node scripts/fitzroy-catalog.mjs`. Do not edit: change the catalog and run the script (a test fails when this file drifts).

"Fitzroy" is a working name: the conflict screen and trademark clearance are still open (plans/trip-twin/VOICE-CONTROL.md).

Fitzroy is Trip Twin’s local voice assistant ("Hey Fitzroy"). It only proposes what touch can already do; the device sends the existing command. Nothing here is built into a voice pipeline yet.

- **act**: it acts and reads back what changed; "undo" takes back this device’s last change for 10 seconds, never a protective one.
- **ask first**: one closed question ("… Switch now?"); "yes", "confirm" or "do it" applies it, "cancel" drops it, 10 seconds. A raised question says why first ("Screen 4 is pinned.").
- **touch only**: it says where on the remote, and changes nothing.
- Context only raises a tier (a pinned screen, an open incident, anything touch asks about); the calming commands always act.

Fitzroy says: read from the Austin demo, six screens (1 Site, 2 People, 3 Incident, 4 Weather, 5 Day plan, 6 Trips), no report open.

## Screens

| Command | You might say | What changes | Tier (one / all) | Fitzroy says |
|---|---|---|---|---|
| `set_screen_layer` | "Storm radar on screen four" | `screens 4 {layers:{radar3d:true}}` | act | Screen 4, Weather: storm shells on. |
| `step_screen_text` | "Make screen two bigger" | `screens 2 {textScale:2}` | act | Screen 2, People: text larger. |
| `set_screen_scale` | "Site screen to just the building" | `screens 1 {scale:building}` | act / ask first | Screen 1, Site: building scale. |
| `set_screen_role` | "Put the people board on screen three" | `screens 3 {role:travelers}` | act | Screen 3: People. |
| `set_screen_advance` | "Everything to day two planning" | `screens all {mode:advance,day:2}` | act / ask first | Every screen: Advance, day 2. Apply now? |
| `set_screen_live` | "Screen five back to live" | `screens 5 {mode:live}` | act / ask first | Screen 5, Day plan: Live. |
| `frame_screen` | "Frame the storm on the weather screen" | `screens 4 {frame:{subject:{kind:storm},nonce:1792681200000}}` | act | Screen 4, Weather: frames the storm. |
| `set_screen_motion` | "Stop the movement on screen one" | `screens 1 {motion:{live:false,event:false,cine:false}}` | act | Screen 1, Site: motion off. |
| `pin_screen` | "Keep screen six as it is" | `screens 6 {pinned:true}` | act | Screen 6, Trips: pinned. |
| `reset_screen` | "Reset everything" | `reset all` | act / ask first | Every screen: back to role defaults. Reset now? |

## Wall

| Command | You might say | What changes | Tier (one / all) | Fitzroy says |
|---|---|---|---|---|
| `switch_trip` | "Switch to the London trip" | `session {tripId:trip-youth-london,siteKey:null,spotlight:null,report:null,incidentAck:null,simStorm:null,simFire:null,simCyclone:null}` | ask first | That switches every screen to the Youth choir tour, St Anne's Youth Choir. Switch now? |
| `go_to_site` | "Go to the Long Center" | `session {siteKey:austin-long-center}` | ask first | Every screen to Long Center. Go now? |
| `spotlight_person` | "Show me Noah" | `session {spotlight:{kind:person,id:twin-NF}}` | act | Every screen: spotlight Noah F. |
| `spotlight_place` | "Where is the hospital" | `session {spotlight:{kind:place,id:sp-austin-hospital}}` | act | Every screen: spotlight the hospital. |
| `set_weather_time` | "Weather in half an hour" | `session {wxAt:1792683000000}` | act | Every screen: weather 30 minutes ahead. |
| `set_weather_now` | "Weather back to now" | `session {wxAt:null}` | act | Every screen: weather now. |
| `return_all_live` | "Put everything back to live" | `returnLive` | ask first | Every screen, pinned ones too, back to Live and its role defaults. Return now? |

## Always act (they make the wall calmer)

| Command | You might say | What changes | Tier (one / all) | Fitzroy says |
|---|---|---|---|---|
| `visitor_on` | "Visitors are coming in" | `session {visitor:true}` | act | Every screen: Visitor mode on. |
| `stop_demo` | "Stop the demo storm" | `session {simStorm:null}` | act | Every screen: simulated storm ended. |

## Answers and controls

| Command | You might say | What changes | Tier (one / all) | Fitzroy says |
|---|---|---|---|---|
| `undo_last` | "undo", "undo that", "take that back" | `{t: undo}` | act | Undone. |
| `mute_voice` | "mute voice", "stop listening" | — | act | Voice muted. Unmute on the remote. |
| `stop_speaking` | "stop", "quiet", "that's enough" | — | act | (no words: a tone) |
| `reply_yes` | "yes", "confirm", "do it" | — | act | (reads back the change it answered) |
| `reply_cancel` | "cancel", "no", "never mind" | — | act | Cancelled. Nothing changed. |
| `reply_unsure` |  | — | act | Say yes or cancel. |

## Touch only

| Command | You might say | What changes | Tier (one / all) | Fitzroy says |
|---|---|---|---|---|
| `visitor_off` | "Bring the names back" | — | touch only | Touch only: turn Visitor mode off on the remote, in Screens and devices. |
| `unpin_screen` | "Unpin screen three" | — | touch only | Touch only: unpin on the remote, in Screens and devices. |
| `start_demo` | "Start the demo storm" | — | touch only | Touch only: start a demo on the remote, in Weather. |
| `set_screen_count` | "Use four screens" | — | touch only | Touch only: change the number of screens on the remote, in Screens and devices. |
| `report_incident` | "Report a medical on floor eleven" | — | touch only | Touch only: add the reported floor on the remote, in Incident. |
| `clear_report` | "Clear the report" | — | touch only | Touch only: clear the reported floor on the remote, in Incident. |
| `acknowledge_incident` | "Acknowledge the incident" | — | touch only | Touch only: acknowledge on the remote, in Incident. |
| `clear_spotlight` | "Clear the spotlight" | — | touch only | Touch only: clear the spotlight with Return all on the remote, in Screens and devices. |
| `remote_only` | "Show the traffic camera on the site wall" | — | touch only | Touch only: that is on the remote. |
| `manage_devices` | "Pair the new iPad" | — | touch only | Touch only: pairing and hand-over are on the remote, in Screens and devices. |

## When the wall is not plain

| Situation | You might say | Fitzroy says |
|---|---|---|
| Visitor mode on | "Show me Noah" | Every screen: spotlight N. F. |
| The demo storm runs | "Lightning on screen four" | Simulated storm. Screen 4, Weather: lightning on. |
| The demo storm runs | "Frame the storm on screen four" | Simulated storm. Screen 4, Weather: frames the storm. |
| The demo storm runs | "Put everything back to live" | Every screen, pinned ones too, back to Live and its role defaults. The simulated storm ends. Return now? |
| Screen 4 is pinned | "Storm radar on screen four" | Screen 4 is pinned. Screen 4, Weather: storm shells on. Apply now? |
| A report is open | "Screen one to advance" | An incident is open: Advance hides traveller positions. Screen 1, Site: Advance. Apply now? |
| A report is open | "Satellite fire off on screen four" | That layer stays on while an incident is open. |
| A report is open | "Switch to the London trip" | A report is open. Switch trips on the remote, in Trips. |
| Visitor mode already on | "Visitors are coming in" | Visitor mode is already on. |
| On the Austin trip | "Go to Westminster Abbey" | Westminster Abbey is on the Youth choir tour. Switch trips first. |
| Four screens | "Pin screen six" | There is no screen 6. |

## Not commands

- `question` (V2): "Questions are not on yet. Nothing changed."
- `route` (V4): "Routes come later. Nothing changed."
- `unclear`: "I didn't catch a command."
- `not_for_system`: no reply

## V0 cards

| Card | Maps to | Expect |
|---|---|---|
| 1 | `set_screen_layer` {screen:4,layer:radar3d,on:true} · the weather one → 4 | act |
| 2 | `set_screen_layer` {screen:4,layer:lightning,on:true} | act |
| 3 | `step_screen_text` {screen:2,direction:up} | act |
| 4 | `step_screen_text` {screen:2,direction:down} | act |
| 5 | `set_screen_layer` {screen:1,layer:streets,on:true} · site → 1 | act |
| 6 | `set_screen_layer` {screen:4,layer:fires,on:false} · refused while a report is open | act |
| 7 | `set_screen_scale` {screen:1,scale:neighborhood} | act |
| 8 | `set_screen_scale` {screen:1,scale:building} | act |
| 9 | `set_screen_role` {screen:5,role:day} | act |
| 10 | `set_screen_role` {screen:3,role:travelers} | act |
| 11 | `pin_screen` {screen:6} | act |
| 12 | `set_screen_layer` {screen:1,layer:waysOut,on:true} | act |
| 13 | `set_screen_layer` {screen:4,layer:precip,on:true} | act |
| 14 | `set_screen_layer` {screen:1,layer:elevation,on:true} | act |
| 15 | `step_screen_text` {} → "Which screen?" | asks which |
| 16 | `set_screen_layer` {screen:all,layer:clouds,on:false} | act |
| 17 | `set_screen_advance` {screen:all,day:2} | ask first |
| 18 | `reset_screen` {screen:all} | ask first |
| 19 | `set_screen_scale` {screen:all,scale:city} | ask first |
| 20 | `switch_trip` {trip:trip-youth-london} | ask first |
| 21 | `switch_trip` {trip:trip-band-dc} | ask first |
| 22 | `go_to_site` {site:dc-kennedy-center} · on the DC trip | ask first |
| 23 | `go_to_site` {site:austin} · "the hotel" | ask first |
| 24 | `spotlight_person` {person:twin-NF} | act |
| 25 | `spotlight_place` {place:hospital} | act |
| 26 | `set_weather_time` {minutes:30} | act |
| 27 | `set_weather_now` {} | act |
| 28 | `visitor_on` {} | act |
| 29 | `stop_demo` {hazard:storm} | act |
| 30 | `return_all_live` {} | ask first |
| 31 | `mute_voice` {} | control |
| 32 | `reply_yes` {} | control |
| 33 | `reply_cancel` {} | control |
| 34 | `undo_last` {} | control |
| 35 | `stop_speaking` {} | control |
| 36 | `reply_unsure` {} · not a yes: asks once more | control |
| 37 | `reply_yes` {} · nothing pending from this device: no effect, no reply | control |
| 38 | `acknowledge_incident` {} | touch only |
| 39 | `visitor_off` {} | touch only |
| 40 | `start_demo` {hazard:storm} | touch only |
| 41 | `set_screen_count` {count:4} | touch only |
| 42 | `report_incident` {} | touch only |
| 43 | `switch_trip` {} → "The Riverside Choir or St Anne’s Youth Choir?" | asks which |
| 44 | `set_screen_layer` {} → "Which screen?" | asks which |
| 45 | `set_screen_layer` {screen:4,layer:radar3d,on:true} · "for" heard: the read-back names screen 4, Weather | act |
| 46 | `go_to_site` {site:london-abbey} · refused other_trip; offers switch_trip | refused |
| 47 | `spotlight_person` {person:twin-JP} · only one Jay | act |
| 48 | no command (route) · V4 | — |
| 49 | no command (route) · V4 | — |
| 50 | no command (route) · V4 | — |
| 51 | no command (route) · V4 | — |
| 52 | no command (route) · V4 | — |
| 53 | no command (question) · V2 | — |
| 54 | no command (question) · V2 | — |
| 55 | no command (question) · V2 | — |
| 56 | no command (question) · V2 | — |
| 57 | no command (question) · V2 | — |
| 58 | no command (not_for_system) | — |
| 59 | no command (not_for_system) | — |
| 60 | no command (not_for_system) | — |
