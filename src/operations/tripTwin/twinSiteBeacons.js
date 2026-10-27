// Trip view (phase 3 Part A): every other site of the trip as a beacon, so the
// operator sees how spread out the trip is and can click one to switch.
// Only drawn when the camera is high enough to need them (City scale).
import * as Cesium from 'cesium';
import { mapLabel } from './twinMapLabelEntries.js';

const BEACON_RANGE = new Cesium.DistanceDisplayCondition(1200, 60000);

export function createSiteBeacons(viewer, site) {
  const ds = new Cesium.CustomDataSource('trip-twin-site-beacons');
  viewer.dataSources.add(ds);
  const base = site.field.at(0, 0);
  const text = Cesium.Color.fromCssColorString('#eef5f3');
  return {
    /** sites: siteConfig list; counts: {key → n}; activeKey: this site. */
    update(sites, { activeKey, counts = {} } = {}) {
      ds.entities.removeAll();
      for (const s of sites) {
        if (s.key === activeKey) continue;
        const p = s.anchors?.inside || s.center;
        const n = counts[s.key] ?? 0;
        const when =
          s.kind === 'lodging' ? 'Hotel' : `Day ${s.day} · ${s.start}`;
        ds.entities.add({
          id: `twin-site:${s.key}`,
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, base + 120),
          point: {
            pixelSize: 10,
            color: Cesium.Color.fromCssColorString('#040c12'),
            outlineColor: text,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: BEACON_RANGE,
          },
          // On the world overlay (review/map-labels L5): a click switches.
          mapLabel: mapLabel('site', {
            title: s.short,
            details: [`${when}${n ? ` · ${n} here` : ''}`],
            near: BEACON_RANGE.near,
            far: BEACON_RANGE.far,
            pick: true,
          }),
          polyline: {
            positions: [
              Cesium.Cartesian3.fromDegrees(p.lon, p.lat, base),
              Cesium.Cartesian3.fromDegrees(p.lon, p.lat, base + 120),
            ],
            width: 1,
            arcType: Cesium.ArcType.NONE,
            material: text.withAlpha(0.5),
            distanceDisplayCondition: BEACON_RANGE,
          },
        });
      }
      viewer.scene.requestRender();
    },
    dispose() {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    },
  };
}
