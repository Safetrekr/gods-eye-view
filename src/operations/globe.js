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
import { enableDefaultWorldLayers } from './defaultLayers.js';
import { tripBoundaries, boundaryIsDelayed } from './boundaries.js';
import { createParticipantPinCache } from './participantPins.js';

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
      const picks = viewer.scene.drillPick(event.position, 16, 7, 7);
      const records = picks.map((pick) => pick.id?.opsRecord).filter(Boolean);
      const record =
        records.find((record) => record.kind === 'person') || records[0];
      if (record) onSelect(record);
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
    let boundaries = [];
    const pinCache = createParticipantPinCache();
    cleanups.push(() => pinCache.dispose());
    const layerVisibility = {
      people: true,
      places: true,
      safety: true,
      itinerary: true,
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
        const near =
          Cesium.Cartesian3.distance(
            viewer.camera.positionWC,
            position(person.coordinates),
          ) < 60000;
        const pinKey = JSON.stringify([
          person.name,
          person.role,
          person.avatar_url,
          css,
          near,
        ]);
        if (entity.pinKey !== pinKey) {
          entity.pinKey = pinKey;
          // Clamped PointGraphics also borrow a billboard internally. Use one
          // billboard owner at every zoom level so picking retains the entity.
          if (near) {
            const image = pinCache.get(person, css, (image) => {
              if (
                disposed ||
                people.entities.getById(id) !== entity ||
                entity.pinKey !== pinKey
              )
                return;
              entity.billboard.image = image;
              viewer.scene.requestRender();
            });
            entity.billboard = {
              image,
              width: 42,
              height: 51,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            };
          } else
            entity.billboard = {
              image: pinCache.dot(css),
              width: person.role === 'chaperone' ? 14 : 11,
              height: person.role === 'chaperone' ? 14 : 11,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            };
        }
        entity.label = {
          ...label(person.name),
          pixelOffset: new Cesium.Cartesian2(0, near ? -61 : -21),
        };
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
    function renderBoundary(boundary) {
      const css = boundary.moving
        ? boundary.degraded
          ? '#e6bb66'
          : '#75b9f2'
        : '#80c3c9';
      const rings = boundary.rings.map((ring) => ring.map(position));
      const record = { kind: 'boundary', record: boundary };
      const fill = context.entities.add({
        id: boundary.id,
        name: boundary.name,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            rings[0],
            rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(ring)),
          ),
          material: color(css).withAlpha(0.16),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          classificationType: Cesium.ClassificationType.BOTH,
        },
      });
      fill.opsRecord = record;
      rings.forEach((ring, index) => {
        const edge = context.entities.add({
          id: `${boundary.id}:edge:${index}`,
          polyline: {
            positions: ring,
            width: 4,
            clampToGround: true,
            classificationType: Cesium.ClassificationType.BOTH,
            material: color(css),
          },
        });
        edge.opsRecord = record;
      });
      const caption = context.entities.add({
        id: `${boundary.id}:caption`,
        position: position(boundary.rings[0][0]),
        label: {
          ...label(''),
          font: '600 12px sans-serif',
          showBackground: true,
          backgroundColor: color('#0b1519').withAlpha(0.85),
          backgroundPadding: new Cesium.Cartesian2(8, 5),
          pixelOffset: new Cesium.Cartesian2(0, -12),
        },
      });
      caption.opsRecord = record;
    }
    function ageBoundaries() {
      const elapsed = (performance.now() - receivedAt) / 1000;
      for (const boundary of boundaries) {
        const fill = context.entities.getById(boundary.id);
        if (!fill) continue;
        const delayed = boundaryIsDelayed(boundary, elapsed);
        const css = boundary.moving
          ? delayed || boundary.degraded
            ? '#e6bb66'
            : '#75b9f2'
          : '#80c3c9';
        fill.polygon.material = color(css).withAlpha(delayed ? 0.06 : 0.16);
        boundary.rings.forEach((_, index) => {
          context.entities.getById(
            `${boundary.id}:edge:${index}`,
          ).polyline.material = delayed
            ? new Cesium.PolylineDashMaterialProperty({
                color: color(css),
                dashLength: 16,
              })
            : color(css);
        });
        const trip = snapshot.trips.find(
          (trip) => trip.id === boundary.trip_id,
        );
        context.entities.getById(`${boundary.id}:caption`).label.text = [
          snapshot.trips.length > 1 ? trip?.title : '',
          boundary.name || 'Trip boundary',
          boundary.radius ? `${Math.round(boundary.radius)} m` : '',
          delayed ? 'Update overdue' : boundary.degraded ? 'Approximate' : '',
        ]
          .filter(Boolean)
          .join(' · ');
      }
      viewer.scene.requestRender();
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
      boundaries = tripBoundaries(snapshot);
      if (layerVisibility.boundaries)
        for (const boundary of boundaries) renderBoundary(boundary);
      ageBoundaries();
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
        if ((entity.point || entity.label) && entity.position)
          entity.show = occluder.isPointVisible(
            entity.position.getValue(viewer.clock.currentTime),
          );
      }
    }
    cleanups.push(viewer.camera.moveEnd.addEventListener(renderPeople));
    const agingTimer = setInterval(() => {
      renderPeople();
      ageBoundaries();
    }, 5000);
    cleanups.push(() => clearInterval(agingTimer));
    return {
      viewer,
      manager,
      flights,
      cameras,
      visualModes,
      mapStack: scene.mapStackController,
      getAlertContext() {
        const states = manager.getAll();
        const state = (id) => states.find((layer) => layer.id === id);
        return {
          earthquakes: earthquakes.getAnalystRecords(5000),
          fires: fires.getAlertAreas(),
          feeds: {
            earthquakes: state('earthquakes'),
            fires: state('local-firms'),
          },
        };
      },
      startWorldLayers() {
        return enableDefaultWorldLayers(manager, signal);
      },
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
        if (
          !value.participants.length ||
          (snapshot &&
            JSON.stringify(snapshot.scope) !== JSON.stringify(value.scope))
        )
          pinCache.clear();
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
        const positions = entities.map((entity) =>
          entity.position.getValue(viewer.clock.currentTime),
        );
        if (layerVisibility.boundaries)
          for (const boundary of boundaries) {
            if (!tripId || boundary.trip_id === tripId)
              positions.push(...boundary.rings[0].map(position));
          }
        if (positions.length) {
          stopTracking();
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
