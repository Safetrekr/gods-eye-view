// SafeTrekr Executive: the entry of twin-executive.html (EP-50 B2–B4).
// ?view=screen is a wall (walls/wallsEntry.js: the WebSocket tap first,
// then page.js unchanged, then the executive overlay); ?as=desk is the
// analyst's desk on this computer (desk/deskEntry.js, B4); anything else
// is the B2 diagnostic (diag.js). The presenter has its own page
// (twin-executive-remote.html).
const params = new URLSearchParams(location.search);
if (params.get('view') === 'screen') import('./walls/wallsEntry.js');
else if (params.get('as') === 'desk') import('./desk/deskEntry.js');
else import('./diag.js');
