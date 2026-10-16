# Phase 6 — Weather in 3D and a weather timeline (Trip Twin prototype)

Jesse, 16 Oct 2026: "do the weather phase — go for it". Builds on phase 2 weather (WEATHER-SOURCES.md) and the answers given in the session: amounts and type from real data (MET Norway forecast), location from radar where available (observed in the US, satellite estimate in Europe), shapes illustrative and labelled.

## A. 3D precipitation, clouds, haze (`twinWeatherFx.js`)
- **Rain / snow / sleet particles** (Cesium ParticleSystem) over the site; type from the MET symbol + temperature; intensity from mm/h (light / moderate / heavy); drift from wind speed and direction.
- **Where it falls:** with radar on, particles fall only where the radar frame shows precipitation over the site; with radar off or unavailable, the whole site, labelled "forecast for the site, not a map".
- **Disagreement is said, not drawn:** forecast says rain but radar shows none over the site → no particles, the row says "forecast rain · none on radar now".
- **Clouds:** Cesium CloudCollection cumulus at the low / mid / high bands, count from cover %; a clear column is kept over the site so the hologram stays visible (said in the row).
- **Haze:** low translucent ground layers when MET fog fraction > 0.
- **Reduce motion:** precipitation is drawn still (streaks / flakes that do not move).
- **Colours:** neutral white / grey; no blue (paths). Lightning stays static.
- Layers › Hazards › Weather gains: `Rain & snow (3D)`, and `Cloud cover` switches from discs to 3D clouds. Off by default.
- Prototype drawer: `Simulated snow` next to rain and lightning; everything simulated is labelled SIMULATED.

## B. Weather timeline (`twinWeatherTimeline.js`)
- A thin bar above the toolbar while any weather layer is on: −2 h · NOW · +18 h map / +48 h site, Play / Pause, speed, Back to now, keyboard ← → when focused.
- The bar shades the data kind: observed (radar / satellite past frames), model forecast map (US: HRRR via IEM, if verified), site forecast (MET Norway hourly). Each layer row names source and time.
- Away from now: banner `VIEWING FORECAST 23:15 (+1 h 45 min) — not live` (or `VIEWING PAST … — observed radar`); people dimmed with "positions now"; the mode chip says FORECAST / PAST.
- Lightning has no forecast: shown for the past only.
- Advance: picking an event scrubs the weather to that event's time when it is inside the forecast range.
- Sources and steps: WEATHER-TIMELINE-SOURCES.md (verified by curl before use; anything unverified is not built).

## C. Rules
Never "will"; forecast says forecast and the run time; further-out hours are marked less certain; a feed down says unavailable; frames are fetched lazily and cached; requests are rate-limited.

## Verification
Unit tests for the pure parts (MET steps, precip type, intensity, timeline kinds, honest texts); browser checks (particles appear with simulated rain/snow, reduce motion still, timeline scrub changes chip/fx/radar frame, banner, back to now, Advance link); screenshots at 1600×900 and 1280×720; four reviewers (UX, UI, supervision, IA) on fresh shots → fix list → fixes → after-shots. Full suite, build, boundaries, 9-site QA. Commit and push.
