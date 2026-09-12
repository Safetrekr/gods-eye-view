import * as Cesium from 'cesium';
import { createStandaloneScene } from '../standalone/scene.js';
import { DataLayerManager } from '../data/manager.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';
import flights from '../data/flights.js';
import cameras from '../data/cctv.js';
import earthquakes from '../data/earthquakes.js';
import satellites from '../data/satellites.js';
import military from '../data/militaryFlights.js';
import traffic from '../data/traffic.js';
import ships from '../data/aisLiveVessels.js';
import { createFirmsHeatmapLayer } from '../data/firmsHeatmap.js';
import { createVisualModes } from './visualModes.js';
import { createCameraPlayer } from './cameraPlayer.js';
import {
  initWorldOverlay,
  destroyWorldOverlay,
} from '../overlays/worldOverlay.js';
import {
  initTrackedReadout,
  destroyTrackedReadout,
} from '../data/trackedReadout.js';
import { currentFreshness, PEOPLE_COLORS, validPoint } from './model.js';

export async function createOperationsGlobe({
  loaderStatus,
  onSelect,
  signal,
}) {
  const cleanups = [];
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch {
        /* Continue releasing the owned viewer. */
      }
    }
  };
  try {
    const scene = await createStandaloneScene({
      googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
      cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
      loaderStatus,
      signal,
      defer: (cleanup) => cleanups.push(cleanup),
    });
    const { viewer } = scene;
    viewer.targetFrameRate = 30;
    initWorldOverlay(viewer);
    cleanups.push(destroyWorldOverlay);
    initTrackedReadout(viewer);
    cleanups.push(destroyTrackedReadout);
    const manager = new DataLayerManager(viewer);
    const fires = createFirmsHeatmapLayer({
      id: 'local-firms',
      name: 'Active fires',
      icon: '▲',
      source: 'NASA FIRMS',
    });
    const publicLayers = [
      flights,
      cameras,
      earthquakes,
      satellites,
      military,
      traffic,
      fires,
      ships,
    ];
    for (const layer of publicLayers) manager.register(layer);
    manager.finalizeRegistrations(
      LAYER_STATE_REGISTRY.filter((entry) =>
        publicLayers.some((layer) => layer.id === entry.id),
      ),
    );
    cleanups.push(() => manager.destroyAll());
    cleanups.push(() => flights.setContactPresentation());
    const visualModes = createVisualModes(viewer);
    cleanups.push(() => visualModes.dispose());
    const cameraPlayer = createCameraPlayer();
    cameras.setCameraOpenHandler((camera) => cameraPlayer.open(camera));
    cleanups.push(() => {
      cameras.setCameraOpenHandler(null);
      cameraPlayer.dispose();
    });
    // Public layers coordinate their own handoffs through trackedEntityChanged.
    // Explicit staff navigation releases every owner before moving the camera.
    const stopTracking = () => {
      for (const layer of [flights, military, satellites]) layer.stopTracking();
      viewer.trackedEntity = undefined;
    };
    const people = new Cesium.CustomDataSource('SafeTrekr participants');
    const context = new Cesium.CustomDataSource('SafeTrekr trip context');
    await viewer.dataSources.add(people);
    await viewer.dataSources.add(context);
    cleanups.push(() => {
      viewer.dataSources.remove(context, true);
      viewer.dataSources.remove(people, true);
    });
    const click = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    click.setInputAction((event) => {
      const entity = viewer.scene.pick(event.position)?.id;
      if (entity?.opsRecord) onSelect(entity.opsRecord);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    cleanups.push(() => click.destroy());
    const visibility = () => {
      viewer.useDefaultRenderLoop = !document.hidden;
    };
    document.addEventListener('visibilitychange', visibility);
    cleanups.push(() =>
      document.removeEventListener('visibilitychange', visibility),
    );
    visibility();
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-45, 25, 18000000),
    });

    let snapshot = null;
    let receivedAt = 0;
    const layerVisibility = {
      people: true,
      places: true,
      safety: true,
      itinerary: false,
      boundaries: true,
    };
    const roleVisibility = { traveler: true, chaperone: true };
    const color = (css) => Cesium.Color.fromCssColorString(css);
    const position = (point) =>
      Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 2);
    const label = (text) => ({
      text,
      font: '12px sans-serif',
      fillColor: Cesium.Color.WHITE,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineColor: color('#0b1519'),
      outlineWidth: 3,
      pixelOffset: new Cesium.Cartesian2(0, -21),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 30000),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    const pointStyle = (css, size = 10) => ({
      pixelSize: size,
      color: color(css),
      outlineColor: color('#0b1519'),
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });

    function renderPeople() {
      if (!snapshot || disposed) return;
      const seen = new Set();
      const elapsed = (performance.now() - receivedAt) / 1000;
      for (const person of snapshot.participants) {
        if (!validPoint(person.coordinates)) continue;
        const id = `person:${person.trip_id}:${person.id}`;
        seen.add(id);
        const state = currentFreshness(person, elapsed).state;
        const css =
          state === 'fresh'
            ? PEOPLE_COLORS[person.role] || PEOPLE_COLORS.traveler
            : PEOPLE_COLORS[state];
        let entity = people.entities.getById(id);
        if (!entity) entity = people.entities.add({ id });
        entity.position = position(person.coordinates);
        entity.point = pointStyle(css, person.role === 'chaperone' ? 14 : 10);
        entity.label = label(person.name);
        entity.show =
          layerVisibility.people && roleVisibility[person.role] !== false;
        entity.opsRecord = { kind: 'person', record: person };
      }
      for (const entity of [...people.entities.values])
        if (!seen.has(entity.id)) people.entities.remove(entity);
      cullFarSide();
      viewer.scene.requestRender();
    }

    function marker(kind, record, css) {
      if (!validPoint(record.coordinates)) return;
      const entity = context.entities.add({
        id: `${kind}:${record.trip_id}:${record.id}`,
        position: position(record.coordinates),
        point: pointStyle(css, 9),
        label: label(record.name || record.title || kind),
      });
      entity.opsRecord = { kind, record };
    }
    function circle(id, center, radius, css, text) {
      if (
        !validPoint(center) ||
        !Number.isFinite(radius) ||
        radius <= 0 ||
        radius > 100000
      )
        return;
      context.entities.add({
        id,
        position: position(center),
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: color(css).withAlpha(0.11),
          outline: true,
          outlineColor: color(css).withAlpha(0.55),
        },
        name: text,
      });
    }
    function renderContext() {
      context.entities.removeAll();
      if (!snapshot) return;
      if (layerVisibility.places)
        for (const p of snapshot.places) marker('place', p, '#d4b68b');
      if (layerVisibility.itinerary)
        for (const e of snapshot.itinerary) marker('event', e, '#cfb5f0');
      if (layerVisibility.safety)
        for (const p of snapshot.safety_points)
          marker(
            'safety',
            p,
            p.approval_status === 'active' ? '#72d5c5' : '#8d959b',
          );
      if (layerVisibility.boundaries) {
        for (const fence of snapshot.geofences) {
          if (fence.type === 'circle')
            circle(
              `fence:${fence.id}`,
              { lat: fence.center_lat, lng: fence.center_lng },
              fence.radius,
              '#80c3c9',
              fence.name,
            );
          else {
            const raw = fence.polygon;
            const points = Array.isArray(raw)
              ? raw.map((p) =>
                  Array.isArray(p) ? { lat: p[1], lng: p[0] } : p,
                )
              : raw?.type === 'Polygon'
                ? raw.coordinates?.[0]?.map((p) => ({ lat: p[1], lng: p[0] }))
                : [];
            if (
              points?.length >= 3 &&
              points.length <= 2000 &&
              points.every(validPoint)
            )
              context.entities.add({
                id: `fence:${fence.id}`,
                name: fence.name,
                polygon: {
                  hierarchy: points.map(position),
                  material: color('#80c3c9').withAlpha(0.1),
                  outline: true,
                  outlineColor: color('#80c3c9'),
                },
              });
          }
        }
        for (const zone of snapshot.group_zones)
          zone.centers.forEach((center, index) =>
            circle(
              `group:${zone.trip_id}:${index}`,
              center,
              zone.radius_m,
              zone.degraded ? '#e6bb66' : '#75b9f2',
              'Chaperone group boundary',
            ),
          );
      }
      cullFarSide();
      viewer.scene.requestRender();
    }
    function cullFarSide() {
      if (disposed) return;
      const occluder = new Cesium.EllipsoidalOccluder(
        Cesium.Ellipsoid.WGS84,
        viewer.camera.positionWC,
      );
      for (const entity of people.entities.values) {
        const role = entity.opsRecord?.record.role;
        entity.show =
          layerVisibility.people &&
          roleVisibility[role] !== false &&
          occluder.isPointVisible(
            entity.position.getValue(viewer.clock.currentTime),
          );
      }
      for (const entity of context.entities.values) {
        if (entity.point && entity.position)
          entity.show = occluder.isPointVisible(
            entity.position.getValue(viewer.clock.currentTime),
          );
      }
    }
    cleanups.push(viewer.camera.moveEnd.addEventListener(cullFarSide));
    const agingTimer = setInterval(renderPeople, 5000);
    cleanups.push(() => clearInterval(agingTimer));
    return {
      viewer,
      manager,
      flights,
      cameras,
      visualModes,
      mapStack: scene.mapStackController,
      resetView() {
        stopTracking();
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(-35, 25, 18000000),
          duration: matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 0
            : 1.2,
        });
      },
      dispose,
      mapMode: scene.tileset ? 'Google photorealistic 3D' : 'Satellite globe',
      setSnapshot(value) {
        snapshot = value;
        receivedAt =
          performance.now() - (value.transportAgeSeconds || 0) * 1000;
        renderPeople();
        renderContext();
      },
      setLayer(key, enabled) {
        layerVisibility[key] = enabled;
        renderPeople();
        renderContext();
      },
      setRole(key, enabled) {
        roleVisibility[key] = enabled;
        renderPeople();
      },
      focus(point, range = 1400) {
        if (!validPoint(point)) return;
        stopTracking();
        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(position(point), 30),
          {
            duration: matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 0
              : 1.5,
            offset: new Cesium.HeadingPitchRange(
              0,
              Cesium.Math.toRadians(-45),
              range,
            ),
          },
        );
      },
      follow(person) {
        const entity = people.entities.getById(
          `person:${person.trip_id}:${person.id}`,
        );
        if (entity?.show) {
          stopTracking();
          viewer.trackedEntity = entity;
        }
      },
      stopFollowing() {
        stopTracking();
      },
      frameTrip(tripId) {
        const entities = people.entities.values.filter(
          (e) => !tripId || e.opsRecord.record.trip_id === tripId,
        );
        if (entities.length) {
          stopTracking();
          const positions = entities.map((entity) =>
            entity.position.getValue(viewer.clock.currentTime),
          );
          const bounds = Cesium.BoundingSphere.fromPoints(positions);
          viewer.camera.flyToBoundingSphere(bounds, {
            duration: matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 0
              : 1.2,
            offset: new Cesium.HeadingPitchRange(
              0,
              Cesium.Math.toRadians(-60),
              Math.max(2500, bounds.radius * 5),
            ),
          });
        } else {
          const place = snapshot?.places.find(
            (p) =>
              (!tripId || p.trip_id === tripId) && validPoint(p.coordinates),
          );
          if (place) this.focus(place.coordinates, 8000);
        }
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
