// What each wall's menu holds (plans/trip-twin/review/screens/05-S1-PLAN):
// options saved through the session (layout and this role's page options)
// and six view moves that touch only the camera. One role at a time, as
// Jesse asked ("do them one at a time so nothing is missed"): S1 Site is
// in full; the others carry the shared layout options until their turn.
// Pure: no DOM; twinScreen.js renders the result with twinWallRail.js.
import { ICON } from './twinStations.js';
import {
  CARD_CATALOG,
  ROLES,
  layerValue,
  layoutValue,
} from './twinScreenRoles.js';

const svg = (d) => `<svg viewBox="0 0 20 20">${d}</svg>`;
const MOVE_ICON = {
  north: svg('<circle cx="10" cy="10" r="7"/><path d="M10 4.5 12.5 11h-5z"/>'),
  restore: svg(
    '<path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1"/><path d="M4 3.5v3.2h3.2"/>',
  ),
  frame: svg(
    '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><rect x="7" y="6.5" width="6" height="7" rx=".8"/>',
  ),
};

/** Roles drawn over the 3D map (a compass, a map bar, view moves). */
export const MAP_ROLES = new Set(['site', 'travelers', 'weather', 'day']);

/**
 * wallPage(role, ctx) → {groups, tiles}
 * ctx: {screen (this screen's session state), shell (the role is in the
 *   new frame, so layout options do something), canSave: {ok, why},
 *   save(patch, label), api (page.js screen API), reportOpen}
 * → {groups, tiles, tilesTitle}
 */
export function wallPage(role, ctx) {
  const { screen, canSave, save, api } = ctx;
  const l = layoutValue(screen);
  const off = !canSave.ok;
  // The reason is said once, in the menu's note, not under every row.
  const why = '';
  const layout = [];
  // Layout only where it changes something (20-S1-FIX-LIST F18).
  const cards = ctx.shell ? CARD_CATALOG[role] || [] : [];
  if (ctx.shell && MAP_ROLES.has(role)) {
    layout.push({
      key: 'cards',
      label: 'Cards',
      value: l.cards,
      choices: [
        { value: 'shown', label: 'Shown' },
        { value: 'map', label: 'Map only' },
      ],
      disabled: off,
      // Map only never hides this trip's open report (03-spec-aia §3).
      reason: why,
      note:
        ctx.reportOpen && l.cards === 'map'
          ? 'A report is open · its card stays on screen'
          : '',
      pick: (v) =>
        save(
          { layout: { cards: v } },
          v === 'map' ? 'Map only' : 'Cards shown',
        ),
    });
    layout.push({
      key: 'width',
      label: 'Column',
      value: l.width,
      choices: [
        { value: 'standard', label: 'Standard' },
        { value: 'wide', label: 'Wide' },
      ],
      disabled: off || l.cards === 'map',
      reason: why,
      note: l.cards === 'map' ? 'Cards are off · map only' : '',
      pick: (v) =>
        save(
          { layout: { width: v } },
          v === 'wide' ? 'Wide column' : 'Standard column',
        ),
    });
  }
  // Cards that may be hidden one by one (never a locked card).
  const free = cards.filter((c) => !c.lock);
  if (free.length > 1)
    for (const c of free)
      layout.push({
        key: `card-${c.key}`,
        label: c.label,
        value: l.off.includes(c.key) ? 'off' : 'on',
        choices: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
        disabled: off,
        reason: why,
        pick: (v) =>
          save(
            {
              layout: {
                off:
                  v === 'off'
                    ? [...l.off, c.key]
                    : l.off.filter((k) => k !== c.key),
              },
            },
            `${c.label} ${v}`,
          ),
      });
  const groups = [];
  if (layout.length)
    groups.push({
      title: 'LAYOUT',
      note: 'Saved for this screen · shows on the remote',
      options: layout,
    });
  const page = PAGES[role]?.(ctx, { off, why }) || { options: [], tiles: [] };
  // "Settings, layout options and page options" (Jesse): the role's own
  // options are named for it — SITE OPTIONS, PEOPLE OPTIONS … (IA P2-1).
  if (page.options.length)
    groups.push({
      title: `${(ROLES[role]?.label || 'Page').toUpperCase()} OPTIONS`,
      note: 'Saved for this screen',
      options: page.options,
    });
  return {
    groups,
    tiles: page.tiles,
    tilesTitle: page.tilesTitle || 'On this screen · not saved',
  };
}

/** View moves every map wall shares (the camera only, never saved). */
function northTile(api) {
  return {
    key: 'north',
    label: 'Face north',
    icon: MOVE_ICON.north,
    kbd: 'N',
    action: () => api.faceNorth(),
  };
}
function restoreTile(api, title = "Face north, at this screen's saved scale") {
  return {
    key: 'restore',
    label: 'Restore view',
    icon: MOVE_ICON.restore,
    title,
    action: () => api.restoreView(),
  };
}
function nextTile(api, needs) {
  const at = api.checkPosition?.() || '';
  return {
    key: 'next',
    label: at ? `Next to check · ${at}` : 'Next to check',
    icon: ICON.next,
    kbd: ']',
    title: 'Select and frame the next person who needs attention',
    disabled: needs === 0,
    reason: 'No one to check',
    action: () => api.nextToCheck(),
  };
}
function firstTile(api, needs) {
  return {
    key: 'first',
    label: 'First to check',
    icon: ICON.next,
    kbd: 'A',
    title: 'Select and frame the first person who needs attention',
    disabled: needs === 0,
    reason: 'No one to check',
    action: () => api.firstToCheck(),
  };
}
function planTile(api) {
  return {
    key: 'plan',
    label: 'Plan view',
    icon: ICON.topdown,
    title: 'Look straight down; the heading stays',
    action: () => api.planView(),
  };
}

const PAGES = {
  // S1 Site (05-S1-PLAN): Ways out is a saved layer; the tiles move the
  // camera: Floors (H), Frame hotel (F), Plan view, Face north (N), First
  // to check (A), Restore view.
  site({ screen, save, api }, { off, why }) {
    const ways = layerValue(screen, 'waysOut');
    const floors = api.floorsAvailable?.();
    const needs = api.needsCount?.() || 0;
    return {
      options: [
        {
          key: 'waysOut',
          label: 'Ways out view',
          value: ways ? 'on' : 'off',
          choices: [
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ],
          disabled: off,
          reason: why,
          pick: (v) =>
            save({ layers: { waysOut: v === 'on' } }, `Ways out view ${v}`),
        },
      ],
      tiles: [
        // First to check in slot 1 on every People-bearing wall (G17).
        firstTile(api, needs),
        {
          key: 'floors',
          label: 'Floors',
          icon: ICON.building,
          kbd: 'H',
          title: 'Open the hotel floors',
          disabled: !floors,
          reason: 'Floors not mapped',
          action: () => api.viewFloors(),
        },
        // A one-screen wall carries Needs attention: its list ends "Next
        // to check walks them", so the tile is here (S2 round 2, b).
        (screen.merged || []).includes('incident')
          ? nextTile(api, needs)
          : {
              // F frames the selection; this tile always frames the hotel (F15).
              key: 'frame',
              label: 'Frame the hotel',
              icon: MOVE_ICON.frame,
              action: () => api.frameHotel(),
            },
        // Bottom row, the same on every map wall (55-S2-PLAN §5).
        northTile(api),
        planTile(api),
        restoreTile(api, "Face north, at this screen's saved scale"),
      ],
    };
  },
  // S2 People (55-S2-PLAN): Floor estimates is a saved safety layer; the
  // tiles walk the people who need attention and move the camera.
  travelers({ screen, save, api }, { off, why }) {
    const floors = layerValue(screen, 'floors');
    const needs = api.needsCount?.() || 0;
    const plan = api.isPlanView?.();
    return {
      options: [
        {
          key: 'floors',
          label: 'Floor estimates',
          value: floors ? 'on' : 'off',
          choices: [
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
          disabled: off,
          reason: why,
          pick: (v) =>
            save({ layers: { floors: v === 'on' } }, `Floor estimates ${v}`),
        },
      ],
      tiles: [
        firstTile(api, needs),
        nextTile(api, needs),
        {
          key: 'group',
          label: 'Frame the group',
          icon: ICON.travelers,
          title: 'Every located person in view, from above',
          action: () => api.frameGroup(),
        },
        northTile(api),
        {
          // Plan view is S2's resting view: the tile tilts it and back.
          key: 'plan',
          label: plan ? 'Tilt view' : 'Plan view',
          icon: ICON.topdown,
          title: plan
            ? 'Tilt to see the buildings and floors'
            : 'Look straight down; the heading stays',
          action: () => api.togglePlan(),
        },
        restoreTile(api, 'Straight down, north up, the whole group'),
      ],
    };
  },
  // The others until their turn: the shared view moves on map walls.
  weather: ({ api }) => ({
    options: [],
    tiles: [planTile(api), northTile(api), restoreTile(api)],
  }),
  day: ({ api }) => ({
    options: [],
    tiles: [planTile(api), northTile(api), restoreTile(api)],
  }),
};
