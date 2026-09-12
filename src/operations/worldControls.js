import { VISUAL_MODES } from './visualModes.js';
import { layerFeedState } from '../data/manager.js';

const PUBLIC_LAYERS = [
  [
    'flights',
    'Civilian flights',
    'OpenSky / ADS-B',
    'Observed aircraft positions; SafeTrekr links remain green.',
  ],
  [
    'military',
    'Military flights',
    'adsb.lol',
    'Publicly broadcasting aircraft classified as military; coverage is incomplete.',
  ],
  [
    'satellites',
    'Satellites',
    'CelesTrak',
    'Orbital positions calculated from published TLEs.',
  ],
  [
    'ais-live-vessels',
    'Global ships',
    'AISStream',
    'Observed vessel positions across available AIS coverage.',
    'ships',
    'AISSTREAM_API_KEY',
  ],
  [
    'traffic',
    'Traffic',
    'TomTom / OpenStreetMap',
    'Live road flow with a key; moving vehicles are simulated.',
    'traffic',
    'TOMTOM_API_KEY',
  ],
  [
    'local-firms',
    'Active fires',
    'NASA FIRMS',
    'Satellite heat detections from the last 24 hours.',
    'fires',
    'FIRMS_MAP_KEY',
  ],
  [
    'earthquakes',
    'Earthquakes',
    'USGS',
    'Reported M2.5+ seismic events in the last 24 hours.',
  ],
  [
    'cctv',
    'Public cameras',
    'City & transport agencies',
    'Public snapshots and configured feeds; availability varies.',
  ],
];
const PRIVATE_LAYERS = [
  ['people', 'Travelers & chaperones', true],
  ['places', 'Lodging & venues', true],
  ['safety', 'Safety resources', true],
  ['itinerary', 'Itinerary stops', false],
  ['boundaries', 'Trip boundaries', true],
];
const e = (tag, text, cls) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (cls) element.className = cls;
  return element;
};
const button = (text, action, cls) => {
  const element = e('button', text, cls);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
};

export function mountWorldControls({
  globe,
  panel,
  trigger,
  shortcuts,
  badge,
  onPanelChange,
}) {
  let alive = true;
  let activeTab = 'layers';
  let config = null;
  let cameras = [];
  let returnFocus = trigger;
  const controller = new AbortController();
  const rows = new Map();
  const header = e('div', undefined, 'ops-world-heading');
  const title = e('div');
  title.append(
    e('p', 'Explore the world', 'ops-eyebrow'),
    e('h2', 'World controls'),
  );
  const close = button('Close', () => setOpen(false), 'ops-world-close');
  header.append(title, close);
  const nav = e('nav', undefined, 'ops-world-tabs');
  nav.setAttribute('aria-label', 'World controls');
  const content = e('div', undefined, 'ops-world-content');
  panel.replaceChildren(header, nav, content);
  panel.setAttribute('aria-label', 'World controls');
  const panels = {};
  const tabs = {};
  for (const [id, label] of [
    ['layers', 'Layers'],
    ['views', 'Visual modes'],
    ['cameras', 'Cameras'],
  ]) {
    const tab = button(label, () => selectTab(id));
    tab.dataset.worldTab = id;
    tabs[id] = tab;
    nav.append(tab);
    panels[id] = e('section');
    panels[id].hidden = id !== activeTab;
    content.append(panels[id]);
  }

  function setOpen(open) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    onPanelChange(open);
    if (open) close.focus();
    else returnFocus?.focus();
  }
  function selectTab(id) {
    activeTab = id;
    for (const [key, pane] of Object.entries(panels)) {
      pane.hidden = key !== id;
      tabs[key].setAttribute('aria-pressed', String(key === id));
    }
    if (id === 'cameras' && !cameras.length) void loadCameras();
  }
  function openTab(id, source = trigger) {
    returnFocus = source;
    selectTab(id);
    setOpen(true);
  }
  const toggle = () => {
    returnFocus = trigger;
    setOpen(panel.hidden);
  };
  trigger.addEventListener('click', toggle);
  shortcuts.replaceChildren();
  for (const [id, title] of [
    ['layers', 'Layers'],
    ['views', 'Natural'],
    ['cameras', 'Camera cities'],
  ]) {
    const item = button(title, () => openTab(id, item));
    item.dataset.worldShortcut = id;
    shortcuts.append(item);
  }
  const keydown = (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      setOpen(false);
    }
    if (
      event.key === 'Tab' &&
      !panel.hidden &&
      matchMedia('(max-width: 600px)').matches
    ) {
      const focusable = [
        ...panel.querySelectorAll('button, input, select, summary, a[href]'),
      ].filter((el) => !el.disabled && el.getClientRects().length);
      const index = focusable.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && index === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    }
    if (
      /^[1-9]$/.test(event.key) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.target.closest('input, select, textarea, [contenteditable]')
    ) {
      applyMode(VISUAL_MODES[Number(event.key) - 1].id);
    }
  };
  document.addEventListener('keydown', keydown);

  panels.layers.append(e('p', 'SafeTrekr overlays', 'ops-world-section-label'));
  for (const [id, label, checked] of PRIVATE_LAYERS) {
    const row = e('label', undefined, 'ops-world-private');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => {
      globe.setLayer(id, input.checked);
    });
    row.append(input, document.createTextNode(label));
    panels.layers.append(row);
  }
  const publicHeader = e('div', undefined, 'ops-world-section-header');
  publicHeader.append(
    e('p', 'World data', 'ops-world-section-label'),
    button('Turn all off', async (event) => {
      const control = event.currentTarget;
      control.disabled = true;
      await Promise.allSettled(
        PUBLIC_LAYERS.map(([id]) =>
          globe.manager.setEnabled(id, false, { origin: 'user' }),
        ),
      );
      if (alive) {
        control.disabled = false;
        updateStatus();
      }
    }),
  );
  panels.layers.append(publicHeader);
  for (const [
    id,
    label,
    provider,
    description,
    capability,
    envName,
  ] of PUBLIC_LAYERS) {
    const row = e('div', undefined, 'ops-world-layer');
    row.dataset.layer = id;
    const labelEl = e('label');
    const copy = e('span');
    copy.append(e('strong', label), e('small', provider));
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', label);
    labelEl.append(copy, input);
    const status = e('span', 'Off', 'ops-feed-badge');
    const detail = e('p', description, 'ops-world-description');
    const error = e('p', undefined, 'ops-error');
    error.setAttribute('role', 'status');
    row.append(labelEl, status, detail, error);
    const state = {
      row,
      input,
      status,
      error,
      capability,
      envName,
      busy: false,
    };
    rows.set(id, state);
    input.addEventListener('change', async () => {
      const enabled = input.checked;
      state.busy = true;
      error.textContent = '';
      updateStatus();
      try {
        await globe.manager.setEnabled(id, enabled, { origin: 'user' });
        if (alive && enabled && !globe.manager.isEffectivelyEnabled(id)) {
          const stats = globe.manager
            .getAll()
            .find((layer) => layer.id === id)?.stats;
          error.textContent = `Could not start this layer. ${stats?.error || 'Try again.'}`;
        }
      } catch {
        if (alive) error.textContent = 'Could not start this layer. Try again.';
      } finally {
        if (alive) {
          state.busy = false;
          updateStatus();
        }
      }
    });
    panels.layers.append(row);
  }
  panels.layers.append(
    e(
      'p',
      'Zoom in for traffic and camera detail. Click a satellite, aircraft, or ship to inspect it.',
      'ops-small',
    ),
  );

  const modeGrid = e('div', undefined, 'ops-mode-grid');
  const modeButtons = new Map();
  for (const [index, mode] of VISUAL_MODES.entries()) {
    const item = button(
      '',
      () => applyMode(mode.id),
      `ops-mode ops-mode-${mode.id}`,
    );
    item.dataset.mode = mode.id;
    const sample = e('span', undefined, 'ops-mode-swatch');
    sample.setAttribute('aria-hidden', 'true');
    item.append(
      sample,
      e('strong', mode.label),
      e('small', mode.detail),
      e('kbd', String(index + 1)),
    );
    modeGrid.append(item);
    modeButtons.set(mode.id, item);
  }
  const mapLabel = e('label', 'Basemap', 'ops-effect-strength');
  const basemap = document.createElement('select');
  basemap.setAttribute('aria-label', 'Basemap');
  for (const stack of globe.mapStack.getState().stacks) {
    const option = e(
      'option',
      stack.label + (stack.available ? '' : ' · unavailable'),
    );
    option.value = stack.id;
    option.disabled = !stack.available;
    basemap.append(option);
  }
  basemap.value = globe.mapStack.getState().activeId;
  const mapError = e('p', undefined, 'ops-error');
  basemap.addEventListener('change', async () => {
    basemap.disabled = true;
    mapError.textContent = '';
    try {
      const state = await globe.mapStack.setStack(basemap.value);
      if (alive) {
        basemap.value = state.activeId;
        if (state.lastError)
          mapError.textContent =
            'Map source unavailable; retained the available map.';
      }
    } catch {
      if (alive) mapError.textContent = 'Map source unavailable.';
    } finally {
      if (alive) basemap.disabled = false;
    }
  });
  mapLabel.append(basemap);
  panels.views.append(
    mapLabel,
    mapError,
    e('p', 'Choose a view', 'ops-world-section-label'),
    modeGrid,
  );
  const strength = e('label', 'Effect strength', 'ops-effect-strength');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = 0;
  slider.max = 100;
  slider.value = 100;
  slider.addEventListener('input', () =>
    globe.visualModes.setStrength(Number(slider.value) / 100),
  );
  strength.append(slider);
  panels.views.append(strength);
  panels.views.append(
    e(
      'p',
      'FLIR and night vision are visual effects applied to the map. They do not show measured heat or infrared camera data.',
      'ops-world-notice',
    ),
  );
  function applyMode(id) {
    if (!alive || !globe.visualModes.setMode(id)) return;
    for (const [key, item] of modeButtons)
      item.setAttribute('aria-pressed', String(key === id));
    const mode = VISUAL_MODES.find((item) => item.id === id);
    shortcuts.querySelector('[data-world-shortcut="views"]').textContent =
      mode.label + (id === 'blackhot' ? ' · Black hot' : '');
    badge.textContent = id === 'normal' ? '' : `${mode.label} · Visual effect`;
    badge.hidden = id === 'normal';
  }
  applyMode('normal');

  const cameraStatus = e(
    'p',
    'Browse public feeds by city, or add a snapshot source.',
    'ops-muted',
  );
  const citySelect = document.createElement('select');
  citySelect.setAttribute('aria-label', 'Camera city');
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Find a camera';
  search.setAttribute('aria-label', 'Find a camera');
  const cityActions = e('div', undefined, 'ops-camera-city-actions');
  const flyCity = button('Go to city', () => {
    const list = selectedCameras();
    if (list.length)
      globe.focus(
        {
          lat: list.reduce((sum, row) => sum + row.lat, 0) / list.length,
          lng: list.reduce((sum, row) => sum + row.lon, 0) / list.length,
        },
        22000,
      );
  });
  cityActions.append(citySelect, flyCity);
  const list = e('div', undefined, 'ops-camera-directory');
  panels.cameras.append(cameraStatus, cityActions, search, list);
  citySelect.addEventListener('change', renderCameras);
  search.addEventListener('input', renderCameras);
  function selectedCameras() {
    return cameras.filter((camera) => camera.cityId === citySelect.value);
  }
  function renderCameras() {
    const items = selectedCameras().filter((camera) =>
      `${camera.name} ${camera.city}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
    );
    list.replaceChildren();
    for (const camera of items.slice(0, 100)) {
      const row = button(
        '',
        async () => {
          row.disabled = true;
          try {
            globe.stopFollowing();
            await globe.manager.setEnabled('cctv', true, { origin: 'user' });
            if (alive) {
              if (!globe.cameras.selectCamera(camera.id, { focus: true }))
                throw new Error('Camera unavailable');
              setOpen(false);
            }
          } catch {
            if (alive)
              cameraStatus.textContent = 'Camera layer unavailable. Try again.';
          } finally {
            if (alive) row.disabled = false;
          }
        },
        'ops-camera-directory-row',
      );
      row.append(
        e('strong', camera.name),
        e('small', `${camera.city} · ${camera.provider}`),
      );
      if (camera.license) row.append(e('small', camera.license));
      list.append(row);
    }
    if (!items.length)
      list.append(e('p', 'No cameras match this search.', 'ops-muted'));
    if (items.length > 100)
      list.append(
        e(
          'p',
          `Showing 100 of ${items.length}. Search to narrow the list.`,
          'ops-small',
        ),
      );
  }
  async function loadCameras() {
    cameraStatus.textContent = 'Loading city camera catalog…';
    try {
      const response = await fetch('/api/cctv/sources', {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!alive) return;
      cameras = (data.sources || []).filter(
        (camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lon),
      );
      const regions = {
        austin: 'Austin',
        'ca-d4': 'San Francisco Bay Area',
        'ca-d7': 'Los Angeles region',
        'ca-d11': 'San Diego region',
        'ca-d3': 'Sacramento region',
        london: 'London',
      };
      const cities = new Map();
      for (const camera of cameras) {
        const city = cities.get(camera.cityId) || {
          name: regions[camera.cityId] || camera.city,
          count: 0,
        };
        city.count++;
        cities.set(camera.cityId, city);
      }
      citySelect.replaceChildren();
      for (const [id, city] of [...cities].sort((a, b) =>
        a[1].name.localeCompare(b[1].name),
      )) {
        const option = e('option', `${city.name} · ${city.count}`);
        option.value = id;
        citySelect.append(option);
      }
      cameraStatus.textContent = `${cameras.length} registered cameras · ${cities.size} regions. Frame availability varies.`;
      renderCameras();
    } catch {
      if (alive)
        cameraStatus.textContent =
          'Camera catalog unavailable. Close and reopen to retry.';
    }
  }

  const add = e('details', undefined, 'ops-add-camera');
  add.hidden = true;
  add.append(e('summary', 'Add cameras'));
  add.append(
    e(
      'p',
      'Add a public HTTPS snapshot URL with its map location. A city webpage or YouTube link needs a separate adapter.',
      'ops-small',
    ),
  );
  const form = document.createElement('form');
  const fieldset = document.createElement('fieldset');
  form.append(fieldset);
  for (const [name, label, type] of [
    ['name', 'Camera name', 'text'],
    ['city', 'City', 'text'],
    ['provider', 'Source / agency', 'text'],
    ['url', 'Direct HTTPS image URL', 'url'],
    ['lat', 'Latitude', 'number'],
    ['lon', 'Longitude', 'number'],
    ['license', 'Attribution / permission', 'text'],
  ]) {
    const labelEl = e('label', label);
    const input = document.createElement('input');
    input.name = name;
    input.type = type;
    input.required = true;
    if (type === 'number') {
      input.step = 'any';
      input.min = name === 'lat' ? -90 : -180;
      input.max = name === 'lat' ? 90 : 180;
    }
    labelEl.append(input);
    fieldset.append(labelEl);
  }
  const submit = e('button', 'Save camera', 'ops-primary');
  submit.type = 'submit';
  fieldset.append(submit);
  const saved = e('p', undefined, 'ops-small');
  saved.setAttribute('role', 'status');
  const reload = button('Reload view to load saved cameras', () =>
    location.reload(),
  );
  reload.hidden = true;
  const importLabel = e(
    'label',
    'Or import a camera pack (JSON)',
    'ops-camera-import',
  );
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  importLabel.append(file);
  const save = async (entries) => {
    fieldset.disabled = true;
    file.disabled = true;
    saved.textContent = 'Saving locally…';
    try {
      const response = await fetch('/api/safetrekr/cameras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!alive) return;
      if (!response.ok)
        throw new Error(result.error || 'Could not save cameras.');
      saved.textContent = `${result.added} saved · ${result.total} custom cameras on this computer. Reload to load the updated catalog.`;
      reload.hidden = false;
      form.reset();
    } catch (error) {
      if (alive) saved.textContent = error.message;
    } finally {
      if (alive) {
        fieldset.disabled = false;
        file.disabled = false;
      }
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    fields.lat = Number(fields.lat);
    fields.lon = Number(fields.lon);
    void save([fields]);
  });
  file.addEventListener('change', async () => {
    try {
      const selected = file.files[0];
      if (!selected) return;
      if (selected.size > 256 * 1024)
        throw new Error('Camera pack exceeds 256 KB.');
      await save(JSON.parse(await selected.text()));
    } catch (error) {
      saved.textContent = error.message;
    }
    file.value = '';
  });
  add.append(
    form,
    importLabel,
    saved,
    reload,
    e(
      'p',
      'Saved only on this computer. Built-in cities stay available. New feeds are checked when a frame is requested.',
      'ops-small',
    ),
  );
  panels.cameras.append(add);

  function updateStatus() {
    if (!alive) return;
    const layers = globe.manager.getAll();
    for (const layer of layers) {
      const state = rows.get(layer.id);
      if (!state) continue;
      const stats = layer.stats || {};
      state.input.disabled = state.busy;
      if (!state.busy) state.input.checked = layer.enabled;
      let label = 'Off';
      const missing =
        config && state.capability && config[state.capability] === false;
      if (state.busy || stats.loading) label = 'Loading';
      else if (layer.enabled) {
        const feed = layerFeedState(stats);
        label = ['degraded', 'stale', 'unavailable', 'fallback'].includes(feed)
          ? feed
          : `${Number(stats.count || 0).toLocaleString()} loaded`;
        if (layer.id === 'traffic')
          label =
            stats.mode === 'live'
              ? stats.error
                ? `TomTom ${feed} · simulated vehicles`
                : 'TomTom flow · simulated vehicles'
              : 'Simulated traffic';
        if (missing && layer.id !== 'traffic') label = 'Key needed';
      } else if (missing)
        label = layer.id === 'traffic' ? 'Simulation available' : 'Key needed';
      state.status.textContent = label;
      state.status.dataset.state =
        label === 'Key needed' || /unavailable|degraded|stale/.test(label)
          ? 'warning'
          : layer.enabled
            ? 'active'
            : 'off';
      if (missing && !state.busy)
        state.error.textContent = `Configure ${state.envName} in the server environment.`;
      else if (!state.busy && !state.error.textContent.startsWith('Could not'))
        state.error.textContent =
          layer.enabled && stats.error ? stats.error : '';
    }
    const count = layers.filter((layer) => layer.enabled).length;
    trigger.textContent = `World controls${count ? ` · ${count}` : ''}`;
  }
  const unsubscribe = globe.manager.subscribe(updateStatus);
  const timer = setInterval(() => {
    if (!document.hidden) updateStatus();
  }, 2500);
  fetch('/api/safetrekr/providers', { signal: controller.signal })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (alive) {
        config = data;
        add.hidden = !data?.cameraEditing;
        updateStatus();
      }
    })
    .catch(() => {});
  selectTab('layers');
  updateStatus();
  return {
    openTab,
    dispose() {
      alive = false;
      controller.abort();
      unsubscribe();
      clearInterval(timer);
      trigger.removeEventListener('click', toggle);
      document.removeEventListener('keydown', keydown);
      panel.replaceChildren();
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      shortcuts.replaceChildren();
      badge.hidden = true;
      onPanelChange(false);
    },
  };
}
