// Trip view (phase 3 Part A): every other site of the trip as a beacon, so the
// operator sees how spread out the trip is and can click one to switch.
// Only drawn when the camera is high enough to need them (City scale).
import * as Cesium from 'cesium';

const BEACON_RANGE = new Cesium.DistanceDisplayCondition(1200, 60000);

export function createSiteBeacons(viewer, site) {
  const ds = new Cesium.CustomDataSource('trip-twin-site-beacons');
  viewer.dataSources.add(ds);
  const base = site.field.at(0, 0);
  const text = Cesium.Color.fromCssColorString('#eff7f3');
  return {
    /** sites: siteConfig list; counts: {key → n}; activeKey: this site. */
    update(sites, { activeKey, counts = {} } = {}) {
      ds.entities.removeAll();
      for (const s of sites) {
        if (s.key === activeKey) continue;
        const p = s.anchors?.inside || s.center;
        const n = counts[s.key] ?? 0;
        const when = s.kind === 'lodging' ? 'hotel' : `Day ${s.day} ${s.start}`;
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
          label: {
            text: `${s.short} · ${when}${n ? ` · ${n} here` : ''}`,
            font: '500 12px Inter, sans-serif',
            fillColor: text,
            showBackground: true,
            backgroundColor:
              Cesium.Color.fromCssColorString('#040c12').withAlpha(0.85),
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: BEACON_RANGE,
          },
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
