// SafeTrekr Executive: the entry of twin-executive.html (EP-50 B2, B3).
// ?view=screen is a wall (walls/wallsEntry.js: the WebSocket tap first,
// then page.js unchanged, then the executive overlay); anything else is the
// B2 diagnostic (diag.js) until the desk arrives in B4.
const params = new URLSearchParams(location.search);
if (params.get('view') === 'screen') import('./walls/wallsEntry.js');
else import('./diag.js');
