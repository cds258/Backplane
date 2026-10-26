'use strict';
// Which hub the Windows desktop app uses: its own native hub, or the hub in
// one WSL distro. One line in <userData>/backend beside `theme`: "windows" or
// "wsl:<distro>". main.cjs is its only writer; the Settings row, the startup
// screen and the preload get copies derived from it.
const fs = require('node:fs');

// a name WSL accepts that crosses as one argv word
const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** @typedef {{kind:'windows'} | {kind:'wsl', distro:string}} Backend */
const WINDOWS = Object.freeze({ kind: 'windows' });

/** "windows" | "wsl:<distro>" -> Backend; anything else -> null */
function parseBackend(token) {
  if (token === 'windows') return WINDOWS;
  const m = typeof token === 'string' && /^wsl:(.*)$/s.exec(token);
  return m && DISTRO.test(m[1]) ? Object.freeze({ kind: 'wsl', distro: m[1] }) : null;
}
const showBackend = backend => backend.kind === 'wsl' ? 'wsl:' + backend.distro : 'windows';
const labelBackend = backend => backend.kind === 'wsl' ? 'WSL · ' + backend.distro : 'Windows';

// a missing, unreadable or garbled file is Windows, as before any choice
function readBackend(file, files = fs) {
  try { return parseBackend(files.readFileSync(file, 'utf8').trim()) ?? WINDOWS; } catch { return WINDOWS; }
}
function writeBackend(file, backend, files = fs) {
  files.writeFileSync(file + '.tmp', showBackend(backend) + '\n'); files.renameSync(file + '.tmp', file);
}

/** The chooser's buttons: Windows, then each distro, the current one marked. */
function choicesFor(current, distros) {
  const now = showBackend(current);
  return [WINDOWS, ...distros.map(distro => ({ kind: 'wsl', distro }))]
    .map(b => ({ token: showBackend(b), label: labelBackend(b), current: showBackend(b) === now }));
}

module.exports = { DISTRO, WINDOWS, parseBackend, showBackend, labelBackend, readBackend, writeBackend, choicesFor };
