# Trip Twin weather sources (research, 15 Oct 2026)

Free sources, checked for commercial use. Full research notes were returned by the research agent in the build session; this is the decision record.

## Prototype stack (browser-ready or tiny proxy)

| Need | US (Austin, DC) | Europe / London | Licence |
|---|---|---|---|
| Weather now (temp, condition, cloud % low/mid/high, precipitation) | MET Norway Locationforecast 2.0 (proxy; identifying User-Agent required; browsers should not call it directly) | same | NLOD 2.0 / CC BY 4.0 — credit "Data from MET Norway" |
| Precipitation now | Iowa Environmental Mesonet NEXRAD n0q (WMS, CORS *) | EUMETView H SAF `mtg_fd:h40b` satellite rain rate (WMS, CORS *) — label "satellite estimate" | IEM public domain; EUMETSAT Core data CC BY 4.0 (Data Policy amended 25 Nov 2025) |
| 24 h accumulation | IEM MRMS `q2-p24h` (WMS, CORS *) | not shown (OPERA licence unverified) | public domain |
| Lightning | NOAA nowCOAST `ldn_lightning_strike_density` (WMS, CORS *, 8 km) | EUMETView MTG-LI accumulated flash area `mtg_fd:li_afa` (WMS, CORS *, 2 km) | NOAA open; EUMETSAT CC BY 4.0 |
| Official warnings | NWS API `/alerts/active?point=` (GeoJSON, CORS *) | MeteoAlarm UK Atom/CAP (proxy, no CORS) | NWS "free to use for any purpose"; MeteoAlarm "terms equivalent to CC BY 4.0" + extra redistribution terms (UNVERIFIED) |

## Excluded for commercial use
- RainViewer free API — "personal and educational use only".
- Open-Meteo hosted free API — non-commercial (self-hosting the AGPLv3 server is allowed).
- Blitzortung — forbids storm-warning/risk use.
- WeatherFlow Tempest remote API — commercial needs TempestONE / agreement; station lightning is distance-only.

## Production ingest (later)
GOES GLM and MTG-LI individual flashes (NetCDF), MRMS 3-D reflectivity cube (GRIB2, 33 levels, US), OPERA radar for Europe after licence confirmation, METAR pressure (aviationweather.gov, proxy) as floor-drift reference, global warnings via national CAP feeds.

## Open checks before production
1. OPERA / Open Radar Data commercial licence — support.opera@eumetnet.eu.
2. MeteoAlarm "additional requirements for redistributing".
3. Met Office DataHub free-plan commercial terms.
4. Tempest commercial pricing / network lightning listener terms.
5. Measured end-to-end latency of GLM (AWS) and MTG-LI.
6. CC BY-SA implications if Met Office UKV model data is used.


## Phase 6 (16 Oct 2026)
Timeline frame sources (past radar / satellite, model forecast maps) were verified separately: see `WEATHER-TIMELINE-SOURCES.md`. Licence note: DWD open data is now CC BY 4.0 (source: Deutscher Wetterdienst).
