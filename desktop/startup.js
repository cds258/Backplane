// Draws main.cjs's Screen and nothing else: the words, the buttons it
// offers, and in the chooser one button per hub.
const bp = window.backplaneDesktop, el = id => document.getElementById(id);
function draw(s) {
  el('status').textContent = s.message;
  for (const name of ['install', 'retry', 'choose']) el(name).hidden = !s.offers.includes(name);
  const box = el('choices');
  box.hidden = s.phase !== 'choose';
  box.replaceChildren(...s.choices.map(c => {
    const b = document.createElement('button');
    b.textContent = c.current ? `${c.label} (now)` : c.label;
    b.dataset.token = c.token;
    b.addEventListener('click', () => bp.useBackend(c.token).catch(() => draw({ ...s, message: 'Could not switch.' })));
    return b;
  }));
}
bp.onConnection(draw);
bp.startup().then(s => s && draw(s), () => {});
el('retry').addEventListener('click', () => {
  draw({ phase: 'connecting', message: 'Connecting to your service…', offers: [], choices: [] });
  bp.retry().catch(() => draw({ phase: 'error', message: 'Could not connect.', offers: ['retry'], choices: [] }));
});
el('install').addEventListener('click', () => { el('install').hidden = true; bp.install(); });
el('choose').addEventListener('click', () => bp.chooseBackend?.());
