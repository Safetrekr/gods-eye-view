# SafeTrekr provider setup

Put provider credentials in this checkout's **`.env.local`**, next to
`package.json`. Keep the existing Supabase values and `SAFETREKR_CORE_URL`.
The local staff snapshot server runs on port 8002. Its server-only database
credentials are already configured separately in Core's ignored
`.env.operations.local`; they do not belong in the globe checkout.

## What to obtain

| Credential | Purpose | Where to obtain it |
| --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | Photorealistic 3D buildings and terrain; the main visual upgrade | Google Cloud project with billing and **Map Tiles API** enabled; create an API key in APIs & Services → Credentials |
| `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET` | Authenticated live aircraft positions | OpenSky account → create an API client; set `OPENSKY_AUTH_MODE=oauth` |
| `GOOGLE_MAPS_SERVER_API_KEY` (optional) | Street View imagery when an existing camera feed fails; this imagery is not live | Separate Google key with **Street View Static API** enabled; add Places API only if enabling upstream place-search features |
| `CESIUM_ION_TOKEN` (optional) | Alternative route to Google 3D through Cesium ion | Cesium ion → Access Tokens; use `assets:read`, the needed assets, and allowed URLs |
| `TFL_APP_KEY` (optional) | Registered access for London's camera catalog | TfL API developer portal; the current catalog also works without a key |
| `TOMTOM_API_KEY` | Live road-flow speeds for Traffic | TomTom Developer Portal → create an application/API key with Traffic API access |
| `FIRMS_MAP_KEY` | Satellite heat detections for Active fires | NASA FIRMS → request a free MAP_KEY by email |
| `AISSTREAM_API_KEY` | Vessel positions for Global ships | AISStream account → create an API key |

The direct Google key is sufficient for this fork's default 3D scene; a Cesium
token is not also required. SafeTrekr authentication and source data are already
configured for the local production-connected preview.

Edit the following entries in `.env.local` without replacing its existing values:

```dotenv
GOOGLE_MAPS_API_KEY=your_google_browser_key
OPENSKY_AUTH_MODE=oauth
OPENSKY_CLIENT_ID=your_opensky_client_id
OPENSKY_CLIENT_SECRET=your_opensky_client_secret

# Optional:
GOOGLE_MAPS_SERVER_API_KEY=your_separate_google_server_key
CESIUM_ION_TOKEN=your_scoped_ion_token
TFL_APP_KEY=your_tfl_key
TOMTOM_API_KEY=your_tomtom_key
FIRMS_MAP_KEY=your_firms_map_key
AISSTREAM_API_KEY=your_aisstream_key
```

Omit optional entries you are not using rather than entering these placeholders.
Do not prefix the server credentials with `VITE_`. The Google browser key and
Cesium token are intentionally used by the browser; the other provider secrets
remain server-side.

Restrict the Google browser key to **Map Tiles API** and website origins:

```text
http://127.0.0.1:4173/*
http://localhost:4173/*
```

Add the deployed app's HTTPS origin when it exists. The page uses `strict-origin`
referrers so providers receive the origin needed for key restrictions, without
receiving page paths or query parameters. Restrict a separate server key by the
server's public egress IP and its enabled APIs, not by browser referrer.

Restart the globe development server after editing credentials, then reload the
page. With the supported Node version on PATH:

```sh
npm run dev -- --host 127.0.0.1 --port 4173
```

No AviationStack key is used. Voice remains deferred, so no OpenAI key is needed.
The World controls panel now exposes TomTom traffic, AIS ships, and FIRMS fires.
Satellites (CelesTrak), earthquakes (USGS), and publicly broadcasting military
aircraft (adsb.lol) do not need new keys. Satellite positions are calculated from
orbital elements; military and maritime coverage is incomplete. Automatic
flight-number-to-aircraft matching remains separate from supplying OpenSky
credentials: this version uses staff-confirmed aircraft links.

## World controls

Open **World controls** in the header, or use **Layers**, **Natural**, and
**Camera cities** in the footer. **Trips** collapses the staff roster when you
want more map space. **World view**, **Fit trip view**, and **Stop following**
control navigation.

- **Layers:** individual public-layer switches and source status, plus SafeTrekr
  overlays. Zoom into a city for traffic and camera detail. Click a satellite,
  aircraft, or ship for the upstream tracking/card interaction. Missing-key
  states name the required variable.
- **Visual modes:** Natural, Night vision, FLIR white hot, FLIR black hot,
  Ironbow, CRT, Noir, Snow, and Illustrated. Keyboard 1–9 works outside text
  fields. The intensity slider affects only the globe. FLIR/night vision are
  visual effects, not measured heat or infrared imagery. Private map markers
  are also shaded; the staff UI retains its normal colors.
- **Traffic:** TomTom supplies observed road speeds when configured. Individual
  moving vehicles are simulated. Without a key, the layer is labeled simulated;
  configured feeds also show outages and degraded status.
- **Active fires:** recent satellite heat detections, not verified incident
  boundaries. **Global ships:** observed AIS contacts, not every ship worldwide.

These providers run through the local Vite server. A production deployment must
run the provider middleware/gateway as well as serve the built browser assets;
a static-only host or `vite preview` does not supply these API routes. The local
camera editor is available only through localhost.

## Cameras in other cities

The running catalog was checked on 2026-09-12 and contained **800 registered
cameras**: Austin 250, Caltrans 300, and London 250. These are capped catalog
counts, not a guarantee that every frame is available. Caltrans currently loads
districts 4, 7, 11, and 3: San Francisco Bay, Los Angeles, San Diego, Sacramento.
The three adapters use periodically refreshed public still images.

In the staff console:

1. Choose **World controls → Cameras** (or **Camera cities** in the footer).
2. Select a city/region. Use **Go to city**, search by camera name, or click a
   camera in the directory to enable its layer and open the camera viewer.
3. For trip context, select a located traveler, lodging, venue, or safety point,
   choose a radius under **Nearby public cameras**, and click **Find cameras**.

The nearby-camera search in selection details remains centered on the selected
subject. The new directory browses the catalog independently of that selection.

For more California districts, set `CCTV_CALTRANS_DISTRICTS` to the desired
comma-separated district numbers and adjust `CCTV_CALTRANS_MAX_SOURCES` and
`CCTV_MAX_SOURCES` as needed. Other cities require a public/authorized feed pack
or a new municipal adapter; a Google or Cesium key does not provide live CCTV.

### Add a camera without code

On this computer, open **Cameras → Add cameras**. Enter the camera name, city,
agency, direct public HTTPS image URL, latitude/longitude, and attribution or
permission. Click **Save camera**, then **Reload view to load saved cameras**.
The URL must return an image directly; a municipal webpage, a redirect, or a
YouTube/HLS stream requires an adapter. No shared CCTV key unlocks other cities.

You can also import a JSON array (up to 100 entries/256 KB per import):

```json
[
  {
    "id": "city-square",
    "name": "City square",
    "city": "Your city",
    "provider": "City transport agency",
    "lat": 40.7128,
    "lon": -74.006,
    "feedType": "image",
    "url": "https://YOUR_PUBLIC_CAMERA_HOST/snapshot.jpg",
    "license": "Agency attribution and applicable permission"
  }
]
```

Replace the example location and URL with the actual camera. Imported feeds
are stored in ignored, owner-readable
`config/cctv_sources.safetrekr.local.json` (300 cameras total). Reimporting the
same ID updates that camera. Built-in cities remain loaded. The image proxy
rejects private network addresses, rechecks DNS on each fetch, and restricts
image size and fetch duration. No custom feed has been installed by this guide.

The existing advanced `CCTV_SOURCES_FILE` option still accepts an operator-managed
pack and upstream-supported media formats. A nonempty file/env pack suppresses
automatic live-pack loading unless `CCTV_FORCE_AUSTIN=1` is set; despite its name,
that legacy flag forces all enabled live packs. This does not affect cameras
added through the new local form.

The bundled Shinjuku pack is demonstration video, **not live Tokyo footage**.
Seed markers or Street View fallback imagery likewise do not establish a live
camera feed. Coverage, status, and source labels must remain visible.

## Provider references

- [Google Map Tiles setup](https://developers.google.com/maps/documentation/tile/get-api-key)
- [Google key restrictions](https://developers.google.com/maps/api-security-best-practices)
- [Google Street View Static setup](https://developers.google.com/maps/documentation/streetview/get-api-key)
- [OpenSky OAuth API setup](https://openskynetwork.github.io/opensky-api/rest.html#authentication)
- [OpenSky use terms](https://opensky-network.org/about/terms-of-use): commercial and operational use require a written license, separately from credentials.
- [Cesium token setup](https://cesium.com/learn/ion/cesium-ion-access-tokens/)
- [TfL developer portal](https://api-portal.tfl.gov.uk/)
- [TomTom Traffic API and key setup](https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/product-information/introduction)
- [NASA FIRMS MAP_KEY signup](https://firms.modaps.eosdis.nasa.gov/api/map_key/)
- [AISStream authentication](https://aisstream.io/documentation#authentication)

## Hosted configuration

The Vercel project `safetrekr-gods-eye` uses the same provider variable names in
its Production/Preview environment settings. The local `.env.local` is never
uploaded. `SAFETREKR_CORE_URL` must be `https://api.safetrekr.com` there.
`PROVIDER_SESSION_SECRET` is an additional random server-only signing secret,
already generated and configured during setup. Never prefix it with `VITE_`.

Allow `https://safetrekr-eye.tarva.studio/*` in the Google browser key’s website
restrictions. Caltrans streams and TfL clips require no additional playback key.
Camera availability varies, and TfL clips are not continuous streams. See
[deployment and playback details](SAFETREKR.md#production-deployment).

The hosted AIS receiver uses a generated `CRON_SECRET`; collection runs once a
minute. This computer’s `.env.local` also has `AISSTREAM_SHARED_URL` and
`AISSTREAM_SHARED_TOKEN` configured automatically so both views share that
receiver. These are server-only settings, not additional provider accounts.
