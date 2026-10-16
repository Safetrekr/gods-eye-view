# Trip Twin weather timeline sources (verified 16 Oct 2026, 14:48–14:57 UTC)

Companion to `WEATHER-SOURCES.md`. Every endpoint below was fetched with curl from macOS, with `Origin: http://localhost:5173` and the User-Agent `SafeTrekr-TripTwin-prototype/0.1 (+https://safetrekr.com)`. Anything not actually fetched is marked **UNVERIFIED**.

Test boxes (20 km): Austin `-97.842,30.172,-97.634,30.352`; DC `-77.151,38.806,-76.921,38.986`; London `-0.264,51.415,0.024,51.595` (lon,lat order; WMS 1.3.0 EPSG:4326 takes lat,lon).
All three cities were dry during the test. Small-box frames came back as valid transparent PNGs with 0 % visible pixels. Each source was then checked over a continental box, which returned real echoes (pixel coverage shown), so the pipeline itself works.

## Recommended table

| Time range | Region | Endpoint (layer) | Step | Latency (measured) | Licence | Browser |
|---|---|---|---|---|---|---|
| Past 0–2 h (to years) | US | IEM `nexrad/n0q-t.cgi` (`nexrad-n0q-wmst`) WMS-T | 5 min, exact :00/:05 | newest frame 2–5 min old | Public domain (IEM: "used freely by anyone for any lawful purpose"; credit appreciated) | CORS `*` |
| Past 0–8.5 h | US (alt) | nowCOAST `weather_radar:conus_base_reflectivity_mosaic` WMS-T | ~4 min, irregular | ~4 min | NOAA, public domain | CORS `*` |
| Future 0–18 h | US | IEM HRRR `hrrr/refd.cgi` (`refd_FFFF` or `refd-t`) | 15 min | run ready ~1 h 40 min after init (13Z at 14:39) | NOAA/NCEP, public domain, via IEM | CORS `*` |
| Future 18–36 h | US | same HRRR, `refd_1140`…`refd_2160` (latest 00/06/12/18Z long run) | 1 h | same | same | CORS `*` |
| Future 0–7 d (6 h totals) | US | NOAA `mapservices…/precip/wpc_qpf` ArcGIS export | 6 h polygons | issued ~4×/day (06Z issue at 05:28) | NOAA, public domain | CORS reflects Origin |
| Past 0–2 h (to Jul 2026) | Europe/London | EUMETView `mtg_fd:h40b` (H SAF satellite rain rate) WMS-T | 10 min, **gaps** | ~60–65 min (latest 13:50 at 14:57) | EUMETSAT, CC BY 4.0 | CORS `*` |
| Future +1…+78 h | Europe/London | DWD `maps.dwd.de/geoserver/dwd/wms` `Icon-eu_reg00625_fd_sl_TOTPREC01H` | 1 h (≈7 km grid) | 12Z run partially ingested at 14:55 | DWD, CC BY 4.0 ("Quelle: Deutscher Wetterdienst") | CORS `*` |
| Point series 0–64 h hourly, then 6 h to +226 h | all | MET Norway Locationforecast 2.0 `complete` | 1 h, then 6 h | model updated 13:17, served 14:56 | NLOD 2.0 / CC BY 4.0 | CORS `*`, but use the proxy (UA rule) |

## 1. US past radar loop: IEM NEXRAD n0q

**WMS-T works (recommended).**
`https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=nexrad-n0q-wmst&SRS=EPSG:4326&BBOX=-97.842,30.172,-97.634,30.352&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&TIME=2026-10-16T13:00:00Z`
200, `image/png`, 256×256 RGBA, 334 B, 0.56 s, `Access-Control-Allow-Origin: *`, `Cache-Control: max-age=300`. The same call over a CONUS box (800×400) at 12:00, 14:00, 14:35 and 14:45 returned 45–58 KB with about 6 % coverage, and each frame was different.
- Capabilities: `<Extent name="time" nearestValue="0">2011-02-16/2026-12-31/PT5M`. **Exact match only.** `TIME=…14:37Z` returns 200 with a blank 1.3 KB PNG, not an error. Always snap to :00/:05.
- Discover valid frames (CORS `*`, 0.3 s): `https://mesonet.agron.iastate.edu/json/radar.py?operation=list&product=N0Q&radar=USCOMP&start=2026-10-16T12:00Z&end=2026-10-16T15:00Z` returns `{"scans":[{"ts":"2026-10-16T12:00Z"},…,{"ts":"2026-10-16T14:50Z"}]}`.
- Latest frame: `https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json` returned `{"valid":"2026-10-16T14:55:00Z","processing_time_secs":102,"radar_quorum":"144/147"}` at 14:57:01.
- **Tile cache also works** (XYZ, EPSG:3857, CORS `*`, `Cache-Control: public, max-age=300`):
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-202610161400/8/58/105.png` returned 200, 256×256, about 0.3 s. Off-grid minutes snap: `…1437` gave the same bytes as `…1435`. Relative layers `nexrad-n0q-900913-m05m` (… to `-m50m`) also return 200.
  Austin tiles: z8 58/105, z10 233/421. DC tiles: z8 73/97, z10 292/391.
- A 2 h loop is 24 GetMaps of about 0.3–0.8 s each. Pick WMS for the existing one-PNG-per-bbox canvas path; tiles are an alternative.

## 2. US future: IEM HRRR simulated reflectivity

WMS `https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refd.cgi` (CORS `*`). GetCapabilities 1.1.1 lists 92 layers:
- `refd_0000`…`refd_1080`: 15-min steps to +18 h from the **latest hourly run**.
- `refd_1140`…`refd_2160`: hourly steps to +36 h from the **latest 00/06/12/18Z long run**.

Calls tested:
- `…refd.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=refd_0060&SRS=EPSG:4326&BBOX=-97.842,30.172,-97.634,30.352&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true` returned 200, `image/png`, 334 B, 0.29 s. The CONUS box returned 58.9 KB with 11 % coverage.
- **Run time per step:** `https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_0015.json` (CORS `*`) returned `{"model_init_utc":"2026-10-16T13:00:00Z","forecast_minute":15.0,"model_forecast_utc":"2026-10-16T13:15:00Z"}`. `refd_1140.json` returned init 12Z, valid 2026-10-17T07:00Z, so the two blocks come from different runs.
- **Pinned run (avoids mixed frames during a run swap):** layer `refd-t` with the extra parameters `&year=2026&month=10&day=16&hour=13&f=0060`. This returned 200 PNG, byte-identical to `refd_0060`.
  - `hour=06&f=0480` returned 200 (82.7 KB).
  - `hour=12&f=1140` returned 200.
  - `hour=12&f=1095` returned a ServiceException: there are no 15-min steps beyond 18 h.
  - `hour=14` at 14:52 returned a ServiceException (run not yet published).
  - `TIME=` is **not** honoured by `refd-t`: it returns an XML error.
  - Errors come back as **HTTP 200 with `application/vnd.ogc.se_xml`**, so check content-type.
- Tile cache: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F0015-0/8/58/105.png` returned 200 PNG. `hrrr::REFD-F0060-202610161300/6/14/26.png` returned 200 (10 % coverage). A run that does not exist yet (`…-202610161400`) returns **503**.
- Latency: `refd_0000.json` for the 13Z run was Last-Modified 14:38:58, about 1 h 39 min after init. At 14:57 the 13Z run was still the latest.
- Licence: NOAA/NCEP HRRR is a US Government work (public domain), redistributed by IEM under its public-domain disclaimer. Credit "NOAA/NCEP HRRR via Iowa Environmental Mesonet".
- Caveat: HRRR `refd` is **simulated** reflectivity. Label it "forecast radar (model)".

## 3. Other US forecast maps (only easy ones)

- **nowCOAST no longer serves NDFD.** The GeoServer GetCapabilities (234 KB) has no ndfd, sky or qpf layers. It does have time-enabled `weather_radar:conus_base_reflectivity_mosaic`, with 06:04→14:43Z at about 4-min irregular steps and `nearestValue="1"`. Tested `TIME=2026-10-16T13:00:00Z`: 200, 8-bit palette PNG, 31 KB, CORS `*`. Its `ldn_lightning_strike_density` layer has 15-min steps over the past 6 h.
- **WPC QPF (6-hour forecast precipitation polygons, day 1–7):** `https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer/export?bbox=-126,24,-66,50&bboxSR=4326&imageSR=4326&size=800,400&format=png32&transparent=true&layers=show:1&f=image` returned 200 PNG, 74 KB, 0.55 s. `Access-Control-Allow-Origin` echoes the Origin.
  - Sub-layers 13–25 are `QPF_00-06_hr`…`QPF_72-78_hr`. Attributes come from `…/MapServer/13/query?where=1%3D1&outFields=issue_time,start_time,end_time&f=json`, which showed issue 2026-10-16 05:28, valid 06–12Z. The first window can already be in the past.
  - A WMSServer extension also exists (UNVERIFIED as WMS).
- `mapservices…/raster/…/NDFD/NDFD_temp` is the only NDFD raster service left. Its `timeInfo.timeExtent` reports Aug 2025, so treat it as stale or unreliable (export returned 200, 121 KB). No NDFD sky-cover or precipitation map was found. `digital.weather.gov/wms.php` returns 404.

## 4. Europe / London past: EUMETView H SAF `mtg_fd:h40b`

- Capabilities: `https://view.eumetsat.int/geoserver/mtg_fd/h40b/ows?service=WMS&version=1.3.0&request=GetCapabilities` (CORS `*`, 1.3 s) gave `time default="2026-10-16T13:50:00Z" nearestValue="1"`, extent `2026-07-23T00:00Z/2026-10-16T13:50Z/PT10M`. At 14:57 the default was still 13:50, so latency is about 60–65 min.
- Frame: `https://view.eumetsat.int/geoserver/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=mtg_fd:h40b&CRS=EPSG:4326&BBOX=51.415,-0.264,51.595,0.024&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&TIME=2026-10-16T13:00:00Z` returned 200, `image/png`, 1225 B, 2.0 s, CORS `*`. The Europe box (35–60N, 15W–25E, 800×500) returned 51–55 KB with 7 % coverage.
- **Gaps:** 13:40 returned **502** (empty body) three times, although the extent says PT10M. 13:45 (off-grid) and 14:30 (future) also returned 502. 11:00–13:30 and 13:50 returned 200. Treat 502 as a missing frame and skip it.
- **Slow:** 1–11 s per GetMap. Prefetch the loop and cache it.
- A 2 h London loop therefore covers about T-3h to T-1h at 10-min steps. There is no free, commercial-OK ground radar for London (OPERA licence still unverified; the DWD radar bbox is lon ≥ 1.46E, which excludes London).
- Alternates (time-enabled, CC BY 4.0, not fetched as frames): `msg_fes:h60b` (15 min, latest 13:30), `msg_fes:rdt` thunderstorm objects (15 min, latest 13:45).

## 5. Europe / London future map

**Use DWD ICON-EU hourly precipitation** via `https://maps.dwd.de/geoserver/dwd/wms` (CORS `*`, `Fees: none`, `AccessConstraints: https://www.dwd.de/copyright`).
- Layer `dwd:Icon-eu_reg00625_fd_sl_TOTPREC01H`. Its abstract says runs 00/06/12/18 UTC, steps vv+1…vv+78, 0.0625° (about 7 km; a 20 km box is about 3×4 cells). Its bbox is 29.5–70.5N, 23.5W–62.5E.
- Dimensions are `time` (`2026-10-15T07:00Z/2026-10-19T12:00Z/PT1H`) and `REFERENCE_TIME`, which lists the last 6 runs (default 12Z).
- Working call: `…/dwd/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=dwd:Icon-eu_reg00625_fd_sl_TOTPREC01H&CRS=EPSG:4326&BBOX=51.415,-0.264,51.595,0.024&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&TIME=2026-10-18T18:00:00.000Z&DIM_REFERENCE_TIME=2026-10-16T06:00:00.000Z` returned 200, `image/png` (4-bit palette), 311 B, 0.97 s.
  - The Europe box at +78 h (`TIME=2026-10-19T12:00Z`, ref 06Z) returned 12.5 KB with 12 % coverage.
- **Gotcha:** the advertised default run (12Z) was only partly ingested at 14:55. `TIME=15:00Z` or later with 12Z returned **HTTP 200 + `text/xml` ServiceException** ("No data available for NinJo NWP data request … modelrun 16.10.26 12:00"); +1 h worked. Always send `DIM_REFERENCE_TIME`. If a frame fails, fall back to the previous run. Check content-type.
- Assumed: `TOTPREC01H` at `TIME=T` is the 1 h total ending at T (UNVERIFIED; it matches DWD convention).
- Licence (fetched from dwd.de legal notice): "All open spatial data and spatial data services of the DWD … may be re-used under the Creative Commons licence conditions CC BY 4.0 providing the source is acknowledged." Commercial use is OK with attribution. This replaces the older GeoNutzV wording.
- Also on DWD but **not for London:**
  - `Radar_wn-product_1x1km_ger` is a radar nowcast: 5 min, ref every 5 min, time extent to +2 h (`…/2026-10-16T16:50Z/PT5M`). Its bbox is 45.7–56.2N, 1.46–18.7E, which covers Germany and neighbours only.
  - `Niederschlagsradar` / RV is the same bbox.
  - Global `Icon_reg025_fd_sl_TOTPREC06H` is 0.25°, 3-hourly, to +7 d. Good for London beyond +78 h.

Rejected or not verified:
- **MET Norway WMS:** `public-wms.met.no` did not resolve (DNS failure). MET's MEPS/nowcast grids cover the Nordics only. Not usable for London (UNVERIFIED beyond DNS).
- **ECMWF public WMS** (`eccharts.ecmwf.int/wms/?token=public`): 155 layers, but no precipitation or cloud layer in the public set (MSL, z500, t850, CAMS composition only). AccessConstraints says "Registered users only".
- **Met Office DataHub map images:** need an API key; free-plan commercial terms are UNVERIFIED (open check #3 in WEATHER-SOURCES.md).

## 6. MET Norway Locationforecast 2.0 `complete`

`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=51.505&lon=-0.12` returned 200, `application/json`, 63.7 KB, 0.90 s. Austin and DC were similar (63.8 / 63.6 KB).
- Headers: `access-control-allow-origin: *`, `last-modified: 14:56:09`, `expires: 15:26:28` (about 30 min). Honour `Expires` and send `If-Modified-Since`.
- `meta.updated_at` = 2026-10-16T13:17Z.
- Timeseries: 92 steps from 2026-10-16T14:00Z (the current, partly elapsed hour) to 2026-10-26T00:00Z (+226 h).
  - **Hourly for 64 steps up to 2026-10-19T05:00Z** (`next_1_hours` present on steps 0–63).
  - From 2026-10-19T06:00Z (+64 h) the step is 6-hourly, with `next_6_hours` and `next_12_hours` only. The last step has no period block.
- `instant.details` (hourly steps): `air_temperature`, `apparent_air_temperature`, `air_pressure_at_sea_level`, `cloud_area_fraction`, `cloud_area_fraction_low`, `cloud_area_fraction_medium`, `cloud_area_fraction_high`, `dew_point_temperature`, `fog_area_fraction`, `relative_humidity`, `ultraviolet_index_clear_sky`, `wind_from_direction`, `wind_speed`.
  - **`fog_area_fraction` and `ultraviolet_index_clear_sky` are missing on the 6-hourly steps.**
- `next_1_hours`: `summary.symbol_code` (e.g. `fair_day`, `cloudy`) and `details.precipitation_amount` (mm) only. No probability or min/max outside the Nordics.
- `next_6_hours.details` has `air_temperature_max`, `air_temperature_min` and `precipitation_amount`.
- Units: °C, hPa, %, mm, m/s, degrees.
- User-Agent: the API returned 200 even with a `curl/8` UA and with no UA. The terms still require an identifying UA, and browsers cannot set one, so keep the dev proxy. Coordinates should be ≤ 4 decimals (5 decimals still returned 200).

## Implementation notes for `weatherSources()` (no code written)
- Every WMS here returns **200 + XML** on error (IEM, DWD) or **502** (EUMETView). Validate `content-type` starts with `image/` before drawing.
- Blank transparent PNGs are normal (dry weather, or IEM off-grid time). Use the timestamp lists instead of guessing times.
- Timeline seam for US: IEM n0q frames up to now; HRRR `refd-t` pinned to the run in `refd_0000.json` for now → +18 h (15 min); then `refd_1140…2160` → +36 h, or MET hourly beyond.
- Timeline seam for London: h40b to about now − 1 h (gap shown honestly); ICON-EU TOTPREC01H from now → +78 h; MET Norway series for the point readout.
