'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { WINDOWS, parseBackend, showBackend, labelBackend, readBackend, writeBackend, choicesFor } = require('../backend.cjs');

test('a token is "windows" or "wsl:<distro>" and comes back the same', () => {
  assert.deepEqual(parseBackend('windows'), { kind: 'windows' });
  assert.deepEqual(parseBackend('wsl:Ubuntu-24.04'), { kind: 'wsl', distro: 'Ubuntu-24.04' });
  for (const t of ['windows', 'wsl:Ubuntu', 'wsl:openSUSE.Tumbleweed_x']) assert.equal(showBackend(parseBackend(t)), t);
  for (const bad of ['', 'linux', 'wsl:', 'wsl:a b', 'wsl:-d', 'wsl:.x', 'wsl:x;y', 'wsl:x\ny', 'wsl:' + 'a'.repeat(65), 'Windows', ' windows', null, undefined, 7])
    assert.equal(parseBackend(bad), null, JSON.stringify(bad));
  assert.equal(labelBackend(WINDOWS), 'Windows');
  assert.equal(labelBackend(parseBackend('wsl:Ubuntu')), 'WSL · Ubuntu');
});

test('the saved choice: missing, empty or garbled is Windows; a write reads back; a crash before rename keeps the old line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-backend-')), file = path.join(dir, 'backend');
  try {
    assert.deepEqual(readBackend(file), WINDOWS);
    for (const text of ['', 'wsl:', 'garbage\n', 'wsl:a b\n']) { fs.writeFileSync(file, text); assert.deepEqual(readBackend(file), WINDOWS, text); }
    writeBackend(file, parseBackend('wsl:Ubuntu'));
    assert.equal(fs.readFileSync(file, 'utf8'), 'wsl:Ubuntu\n');
    assert.deepEqual(readBackend(file), { kind: 'wsl', distro: 'Ubuntu' });
    const crash = { writeFileSync: fs.writeFileSync, renameSync: () => { throw new Error('power cut'); } };
    assert.throws(() => writeBackend(file, WINDOWS, crash), /power cut/);
    assert.deepEqual(readBackend(file), { kind: 'wsl', distro: 'Ubuntu' });
    writeBackend(file, WINDOWS);
    assert.deepEqual(readBackend(file), WINDOWS);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the chooser lists Windows first, then each distro in order, the current one marked once', () => {
  assert.deepEqual(choicesFor(parseBackend('wsl:Debian'), ['Ubuntu', 'Debian']), [
    { token: 'windows', label: 'Windows', current: false },
    { token: 'wsl:Ubuntu', label: 'WSL · Ubuntu', current: false },
    { token: 'wsl:Debian', label: 'WSL · Debian', current: true }]);
  assert.deepEqual(choicesFor(WINDOWS, []).map(c => c.current), [true]);
  assert.deepEqual(choicesFor(parseBackend('wsl:Gone'), ['Ubuntu']).map(c => c.current), [false, false]);
});
