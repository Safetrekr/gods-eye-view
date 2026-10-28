// SafeTrekr Executive B6: the printable leave-behind
// (twin-executive-record.html). The record is computed here, in the page,
// from the loop: by default the live loop this computer's monitor receives
// from the relay (the same loop the desk and the non-MAIN walls get);
// with ?source=script, the scripted day folded locally to ?at= (default
// the close, 0100Z), for printing with no relay. ?paper=letter prints US
// Letter; A4 otherwise. body[data-record-ready] marks a finished render.
import './record.css';
import './print.css';
import { connectExec } from '../host/execClient.js';
import { assembleRecord } from '../loop/record.js';
import { printPages } from './printPages.js';

const params = new URLSearchParams(location.search);
const paper = params.get('paper') === 'letter' ? 'letter' : 'a4';
document.title = "SafeTrekr Executive · The day's record (SAMPLE)";
document.body.className = `rc-print pr-body paper-${paper}`;
const size = document.createElement('style');
size.textContent = `@page { size: ${paper === 'letter' ? 'letter' : 'A4'}; margin: 0; }`;
document.head.append(size);
const root = document.createElement('main');
root.id = 'pr-root';
const wait = document.createElement('div');
wait.className = 'pr-wait';
wait.textContent = 'Waiting for the Trip Twin computer';
root.append(wait);
document.body.append(root);

let lastRev = null;
function render(loop, source, rev) {
  if (rev != null && rev === lastRev) return;
  lastRev = rev;
  const record = assembleRecord(loop, { audience: 'office' });
  root.replaceChildren(...printPages(record, { source }));
  document.body.dataset.recordReady = '1';
  document.body.dataset.recordAt = record.at ?? '';
  document.body.dataset.recordCounter = Object.values(
    record.summary.counter,
  ).join('·');
  document.body.dataset.recordReconciled = String(record.summary.reconciled);
}

async function fromScript() {
  const [{ default: day }, { buildTimeline, fold }] = await Promise.all([
    import('../data/day.json'),
    import('../timeline.js'),
  ]);
  const at = params.get('at') || day.beats[5];
  const loop = fold(
    day,
    buildTimeline(day).filter((e) => Date.parse(e.at) <= Date.parse(at)),
  ).loop;
  render(loop, 'from the scripted day', null);
}

if (params.get('source') === 'script') {
  fromScript().catch((err) => {
    wait.textContent = `The scripted day did not load: ${err?.message || err}`;
  });
} else {
  connectExec({
    kind: 'monitor',
    on: {
      loop(m) {
        if (m.view !== 'loop' || !m.loop) return;
        render(m.loop, `from the live loop · run ${m.run ?? '—'}`, m.rev);
      },
      denied(m) {
        wait.textContent =
          m.error || 'The record prints on the Trip Twin computer only';
      },
    },
  });
}
