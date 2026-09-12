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
TomTom traffic, AIS ships, and FIRMS fire overlays are not mounted in this first
staff console; adding those keys alone will not expose those layers. Automatic
flight-number-to-aircraft matching also remains separate from supplying OpenSky
credentials: this version uses staff-confirmed aircraft links.

## Cameras in other cities

The running catalog was checked on 2026-09-12 and contained **800 registered
cameras**: Austin 250, Caltrans 300, and London 250. These are capped catalog
counts, not a guarantee that every frame is available. Caltrans currently loads
districts 4, 7, 11, and 3: San Francisco Bay, Los Angeles, San Diego, Sacramento.
The three adapters use periodically refreshed public still images.

In the staff console:

1. Choose **Layers → Public cameras**.
2. Navigate the globe to a supported city and click a camera marker.
3. For trip context, select a located traveler, lodging, venue, or safety point,
   choose a radius under **Nearby public cameras**, and click **Find cameras**.

There is not yet a city-search or jump-to-city control in the staff shell. A trip
selection or manual globe navigation supplies the location. Camera searches are
centered on the selected subject, not the map viewport.

For more California districts, set `CCTV_CALTRANS_DISTRICTS` to the desired
comma-separated district numbers and adjust `CCTV_CALTRANS_MAX_SOURCES` and
`CCTV_MAX_SOURCES` as needed. Other cities require a public/authorized feed pack
or a new municipal adapter; a Google or Cesium key does not provide live CCTV.

A custom pack can be a JSON array at `config/cctv_sources.safetrekr.json`, selected
with `CCTV_SOURCES_FILE`. Each entry supplies `id`, `name`, `city`, `cityId`,
`provider`, `lat`, `lon`, `feedType`, an actual image/video URL, and attribution.
Without an explicit override, a nonempty custom pack replaces automatic live-pack
loading. To retain Austin, Caltrans, and London alongside it, the existing loader
uses the legacy setting `CCTV_FORCE_AUSTIN=1` (despite the name, it forces all
enabled live packs). No custom pack has been installed by this guide.

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
