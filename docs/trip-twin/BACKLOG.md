# Trip Twin backlog (next rounds)

## Next round: streets, walkways and a "ways out" view (Jesse, 16 Oct 2026)
Jesse: "the streets … more defined than they are now, and maybe walking paths … if I need to quickly see what the best escape routes are I might toggle just the buildings and the roads."

- **Streets layer (Layers › Site):** OpenStreetMap roads drawn by class (major / minor / service), width and brightness by class, street names along the larger ones, one-way arrows optional. Data is already in each site fixture (`roads`, with `highway` and now `name`).
- **Walkways layer:** footways, pedestrian areas, steps (marked, since steps matter for wheelchairs and evacuation), crossings and building entrances. Also in the fixtures (`footway`, `steps`, `pedestrian`, `entrance` nodes).
- **"Ways out" view preset:** one click (and a key) shows only buildings + streets + walkways + entrances + the rally points, everything else steps back; Esc returns to the previous layers. The suggested and saved paths stay visible on top.
- **Wording:** on screen "ways out" / "paths out", never "escape routes" or "safe routes" (06 never-list: no "safe"). Streets stay neutral grey; blue stays for paths; green for approved places only.
- Review with the four agents after the build, as every phase.

## Later
- Draft PR into Justin's World View branch; demo scripts for the four scenarios.
- Usability round with 10–12 operators (IA validation plan, review/phase5/04-ia.md).
- Production delta (07-production-delta.md): Core tables, mobile pressure capture, own routing and geocoding.
- Multi-trip operations view (SOC).
- Leader lines for moved labels; help overlay regrouped; frame-whole-trip honours Reduce motion.

## More of the city in 3D (Jesse, 16 Oct 2026)
Jesse: "right now there is a limited 3d area then there is nothing … the routes between the hotel and the venues, or an additional mile around the hotel … I'm assuming the model would be built out to encompass the rally points and emergency stuff."
- Today: each site is a detailed twin of ~400 m radius from OpenStreetMap fixtures (Austin hotel ~160 buildings, London ~470).
- **A. Bigger detailed twin** (e.g. 1 mile): ~16× area (Austin ~2,500, London 10,000+ buildings); needs a light outer ring (merged geometry, no picking/labels) and slower first load. ~1 session.
- **B. Context ring:** Cesium OSM Buildings 3D Tiles streamed beyond the core, styled to the hologram (neutral, translucent), so the view never ends in darkness. Cheap at runtime; commercial use needs a paid Cesium ion plan (check). ~1–2 sessions.
- **C. Corridors:** detailed ~200 m strips along hotel ↔ venue paths and to rally points / nearest hospital / police (Overpass by path buffer). ~1–2 sessions.
- **Production rule — trip footprint:** site cores + path corridors + rings around safety places, built once at trip set-up and cached as 3D tiles (server job), with B underneath. A few weeks of engineering.
- Recommended for the prototype: B + C (~3 sessions).

## Select any path, see its details, edit it (Jesse, 16 Oct 2026)
Jesse: "I should be able to select each unique route and view the details — and from there manually edit them."
- Today: saved paths are clickable on the map and in Layers › Paths → saved-path card → "Edit saved path". Suggested paths (card paths, the standing rally path and its alternate, the Advance hotel path) are not clickable; "Plan your own path" starts the editor from the same ends but re-plans instead of starting from the drawn line.
- Build: every drawn path clickable (map and a "Paths on the map" list) → one path card (kind, from → to, distance and time, checks and flags, source and run, age of the start position) → "Edit this path" opens the editor seeded with that line (waypoints taken from its shape), so the operator adjusts rather than redraws; alternates selectable on their own; selected path highlighted (same glow rule as places).
- Wording: "path" throughout; a suggested path stays "Suggested · unverified" until saved and reviewed.
