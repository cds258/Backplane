'use strict';
// Backplane's hub inside a WSL distro, seen from the Windows desktop app.
// Every call is %SystemRoot%\System32\wsl.exe by its absolute path with an
// argv: a script goes on stdin (`sh -s`) and its inputs as `env NAME=value`
// words, so no value is ever shell text. Nothing here signals a hub; only a
// probe or install run past its time is stopped (its own wsl.exe).
const fs = require('node:fs');
const path = require('node:path');
const { spawn: spawnChild } = require('node:child_process');
const { DISTRO } = require('./backend.cjs');

// docker's and rancher's own distros run no Backplane
const INTERNAL = /^(docker-desktop|rancher-desktop)(-data)?$/;
// a cold distro takes ~30 s to start
const COLD_MS = 60000, INSTALL_MS = 600000;
const RELEASES = 'https://github.com/i2cjak/Backplane/releases/';
const UNC = /^\\\\[^\\\0-\x1f]+\\[^\\\0-\x1f]+(\\[^\0-\x1f]*)?$/;

// live(PATH): PATH is, or is inside, the live hub's home or install (symlinks followed)
const GUARD_SH = String.raw`real() { if [ -d "$1" ]; then (cd -P -- "$1" && pwd -P); else printf '%s/%s' "$(real "$(dirname -- "$1")")" "$(basename -- "$1")"; fi; }
live() { r=$(real "$1"); for l in "$HOME/.backplane-bend" "$HOME/.local/share/backplane"; do l=$(real "$l"); case $r/ in "$l"/*) return 0;; esac; done; return 1; }
`;

// Starts the distro, makes the hub's home (0700, as its owner, inside the
// distro, never over \\wsl.localhost) and says where things are, as
// key=value lines; error=<words> when it cannot. serve= only when installed.
// (no shell braces in these scripts: a template literal would take them)
const PROBE_SH = GUARD_SH + String.raw`say() { printf '%s=%s\n' "$1" "$2"; }
no() { say error "$1"; exit 0; }
if [ "$BP_WSL_ISOLATED" = 1 ]; then
  [ -n "$BP_WSL_HOME" ] && [ -n "$BP_WSL_PREFIX" ] || no "A checkout's app needs BACKPLANE_WSL_HOME and BACKPLANE_WSL_PREFIX"
  ! live "$BP_WSL_HOME" || no "BACKPLANE_WSL_HOME is the live hub's home: $BP_WSL_HOME"
  ! live "$BP_WSL_PREFIX" || no "BACKPLANE_WSL_PREFIX is the live install: $BP_WSL_PREFIX"
fi
home=$BP_WSL_HOME prefix=$BP_WSL_PREFIX
[ -n "$home" ] || home=$HOME/.backplane-bend
[ -n "$prefix" ] || prefix=$HOME/.local/share/backplane
command -v wslpath >/dev/null 2>&1 || no "wslpath is missing in this distro (is [automount] off in /etc/wsl.conf?)"
mkdir -p -- "$home" 2>/dev/null && chmod 700 -- "$home" || no "Cannot make $home"
home=$(real "$home")
say home "$home"
say unc "$(wslpath -w "$home")"
say proc "$(wslpath -w /proc)"
say browse "$(wslpath -w "$HOME")"
say prefix "$prefix"
if [ -x "$prefix/backplane-serve" ] && [ -d "$prefix/web" ]; then say serve "$prefix/backplane-serve"; fi
exit 0
`;

// The hub only (no desktop app, no menu entry), by the release's own
// installer, downloaded to a file and checked before it runs; an isolated
// app's own installer (BP_WSL_INSTALLER) instead. Its lines are the output.
const INSTALL_SH = GUARD_SH + String.raw`set -e
prefix=$BP_WSL_PREFIX
[ -n "$prefix" ] || prefix=$HOME/.local/share/backplane
if [ "$BP_WSL_ISOLATED" = 1 ]; then
  [ -n "$BP_WSL_PREFIX" ] || { echo "A checkout's app needs BACKPLANE_WSL_PREFIX"; exit 2; }
  ! live "$prefix" || { echo "BACKPLANE_WSL_PREFIX is the live install: $prefix"; exit 2; }
fi
export BACKPLANE_PREFIX="$prefix" BACKPLANE_NO_DESKTOP_APP=1 BACKPLANE_NO_DESKTOP=1
if [ -n "$BP_WSL_BIN" ]; then export BACKPLANE_BIN="$BP_WSL_BIN"; fi
if [ -n "$BP_WSL_INSTALLER" ]; then
  sh "$BP_WSL_INSTALLER"
else
  command -v curl >/dev/null 2>&1 || { echo "curl is not installed in this distro; install it (sudo apt install curl) and try again"; exit 3; }
  t=$(mktemp); trap 'rm -f "$t"' EXIT
  echo "Downloading $BP_WSL_URL"
  curl --proto '=https' --tlsv1.2 -fsSL -o "$t" "$BP_WSL_URL" || { echo "Could not download Backplane's installer: $BP_WSL_URL"; exit 4; }
  [ -s "$t" ] && [ "$(head -c 2 "$t")" = '#!' ] || { echo "Not an installer: $BP_WSL_URL"; exit 4; }
  sh "$t"
fi
[ -x "$prefix/backplane-serve" ] || { echo "The installer finished but $prefix/backplane-serve is missing"; exit 5; }
`;

const isolation = message => Object.assign(new Error(message), { code: 'ERR_WSL_ISOLATION' });
const posixPath = p => p.startsWith('/') && !/[\0-\x1f]/.test(p) && path.posix.normalize(p) === p && (p === '/' || !p.endsWith('/'));

/**
 * Where the hub lives in the distro, from the app's environment. An
 * isolated app (a checkout, or BACKPLANE_HOME set) must name its own home and
 * install folder; only it may replace the installer. Checked before any wsl.exe.
 * @returns {{isolated:boolean, home:string, prefix:string, installer:string}}  '' = the live defaults
 */
function wslPaths(env, isolated) {
  const home = env.BACKPLANE_WSL_HOME || '', prefix = env.BACKPLANE_WSL_PREFIX || '', installer = isolated && env.BACKPLANE_WSL_INSTALLER || '';
  if (isolated && (!home || !prefix)) throw isolation('A checkout\'s app needs BACKPLANE_WSL_HOME and BACKPLANE_WSL_PREFIX (absolute paths inside the distro)');
  for (const p of [home, prefix, installer]) if (p && !posixPath(p)) throw isolation('Not an absolute path inside the distro: ' + p);
  return { isolated, home, prefix, installer };
}

/** %SystemRoot%\System32\wsl.exe */
function wslExe(env = process.env) {
  const key = Object.keys(env).find(k => k.toLowerCase() === 'systemroot'), root = key && env[key];
  if (!root || !/^[A-Za-z]:\\[^;\0-\x1f]*$/.test(root)) throw new Error('Windows SystemRoot must be native and absolute');
  return path.win32.join(root, 'System32', 'wsl.exe');
}

// WSL_UTF8 makes wsl.exe's own words UTF-8 (measured); the app's WSLENV
// would carry the app's environment into the distro
function wslEnv(env = process.env) {
  return { ...Object.fromEntries(Object.entries(env).filter(([k]) => k.toUpperCase() !== 'WSLENV')), WSL_UTF8: '1' };
}

/** the words worth showing: the last line that is not wsl.exe's "Error code:" */
function lastLine(out) {
  return out.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^Error code:/.test(l)).at(-1) || '';
}

/**
 * One wsl.exe run. Resolves with any exit code (255: WSL's own error, such
 * as a missing distro); rejects when wsl.exe cannot start or runs past its time.
 * @returns {Promise<{code:number, out:string}>}  out: stdout then stderr lines, NULs dropped, the last 64 KiB
 */
function runWsl(args, { input = '', timeoutMs = COLD_MS, onLine, exe = wslExe(), spawn = spawnChild } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: wslEnv(), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const lines = stream => {
      let partial = '';
      stream.setEncoding('utf8');
      stream.on('data', text => {
        // an old wsl.exe ignores WSL_UTF8 and writes UTF-16
        const all = (partial + text.replace(/\0/g, '')).split(/\r?\n/);
        partial = all.pop();
        for (const l of all) { out = (out + l + '\n').slice(-65536); if (l.trim()) onLine?.(l); }
      });
      stream.on('end', () => { if (partial) { out = (out + partial + '\n').slice(-65536); if (partial.trim()) onLine?.(partial); } });
    };
    lines(child.stdout); lines(child.stderr);
    const timer = setTimeout(() => { child.kill(); reject(new Error(`WSL did not answer in ${timeoutMs / 1000} s`)); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, out }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** `wsl.exe -l -q` output -> the distros, valid names only, docker's and rancher's left out */
function parseDistros(out) {
  return String(out).replace(/[\0\uFEFF\uFFFD]/g, '').split(/\r?\n/).map(s => s.trim()).filter(n => DISTRO.test(n) && !INTERNAL.test(n));
}

/**
 * The distros on this PC, for the chooser only: listing while WSL is off or
 * missing can make Windows offer to install it, so nothing lists before the
 * person opens the choice. [] when wsl.exe is absent or the listing fails.
 */
async function listDistros({ run = runWsl, exists = fs.existsSync, exe = wslExe() } = {}) {
  if (!exists(exe)) return [];
  try { const r = await run(['-l', '-q'], { exe, timeoutMs: COLD_MS }); return r.code === 0 ? parseDistros(r.out) : []; } catch { return []; }
}

/** PROBE_SH's lines -> {home, unc, proc, browse, prefix, serve}; its error= line, or an answer that is not one, throws */
function parseProbe(out, distro) {
  const p = {};
  for (const line of out.split('\n')) { const m = /^(home|unc|proc|browse|prefix|serve|error)=(.*)$/.exec(line.replace(/\r$/, '')); if (m) p[m[1]] = m[2]; }
  if (p.error) throw new Error(p.error);
  const ok = ['home', 'prefix'].every(k => typeof p[k] === 'string' && posixPath(p[k])) && ['unc', 'proc', 'browse'].every(k => UNC.test(p[k] || ''))
    && (p.serve === undefined || posixPath(p.serve));
  if (!ok) throw new Error(`Invalid answer from ${distro}: ${lastLine(out)}`);
  return { home: p.home, unc: p.unc, proc: p.proc, browse: p.browse, prefix: p.prefix, serve: p.serve ?? null };
}

const notInstalled = distro => Object.assign(new Error(`Backplane is not installed in ${distro}.`), { code: 'ERR_HUB_NOT_INSTALLED', distro });

/**
 * The hub in a distro, for Service: its home as Windows reads it
 * (\\wsl.localhost\<distro>\...), the host seam, and where the folder dialog
 * starts (the distro user's home). Probes first, which starts the distro.
 * @returns {Promise<{home:string, browse:string, host:{procRoot:string, plan:(port:number)=>Promise<{file:string, args:string[], env:object}>}}>}
 */
async function wslHub({ distro, paths, run = runWsl, exe = wslExe() }) {
  if (!DISTRO.test(distro)) throw new Error('Invalid WSL distro name');
  const ran = await run(['-d', distro, '--cd', '~', '--exec', '/usr/bin/env', `BP_WSL_HOME=${paths.home}`, `BP_WSL_PREFIX=${paths.prefix}`,
    `BP_WSL_ISOLATED=${paths.isolated ? 1 : ''}`, 'sh', '-s'], { exe, input: PROBE_SH, timeoutMs: COLD_MS });
  if (ran.code !== 0) throw new Error(`${distro}: ${lastLine(ran.out) || `WSL exited ${ran.code}`}`);
  const p = parseProbe(ran.out, distro);
  return { home: p.unc, browse: p.browse, host: { procRoot: p.proc, plan: async port => {
    if (!p.serve) throw notInstalled(distro);
    // the hub in the foreground under this wsl.exe: it keeps the distro up
    // while the hub lives and exits with it; its output is kept in its home
    return { file: exe, env: wslEnv(), args: ['-d', distro, '--cd', '~', '--exec', '/usr/bin/env', `BACKPLANE_HOME=${p.home}`,
      'sh', '-c', 'mkdir -p "$0" && exec "$@" >>"$0/desktop-hub.log" 2>&1', p.home,
      p.serve, '--home', p.home, '--port', String(port), '--host', '127.0.0.1', '--web', path.posix.join(p.prefix, 'web'), '--foreground', '--no-tailscale'] };
  } } };
}

/** the release's installer: the app's own version's, else the latest */
function installUrl(version) {
  return /^\d+\.\d+\.\d+$/.test(version || '') ? `${RELEASES}download/v${version}/install.sh` : `${RELEASES}latest/download/install.sh`;
}

/**
 * Installs the hub in the distro. Pressed again it installs again over the
 * same files (the installer replaces them as an update does), so a failed
 * install is fixed by pressing Install again. Rejects with its last line.
 */
async function install({ distro, paths, version, run = runWsl, exe = wslExe(), onLine }) {
  if (!DISTRO.test(distro)) throw new Error('Invalid WSL distro name');
  if (paths.isolated && !paths.prefix) throw isolation('A checkout\'s app needs BACKPLANE_WSL_PREFIX');
  const ran = await run(['-d', distro, '--cd', '~', '--exec', '/usr/bin/env', `BP_WSL_PREFIX=${paths.prefix}`,
    `BP_WSL_BIN=${paths.isolated ? path.posix.join(paths.prefix, 'bin') : ''}`, `BP_WSL_ISOLATED=${paths.isolated ? 1 : ''}`,
    `BP_WSL_INSTALLER=${paths.installer}`, `BP_WSL_URL=${installUrl(version)}`, 'sh', '-s'], { exe, input: INSTALL_SH, timeoutMs: INSTALL_MS, onLine });
  if (ran.code !== 0) throw new Error(lastLine(ran.out) || `The installer exited ${ran.code}`);
}

module.exports = { PROBE_SH, INSTALL_SH, wslPaths, wslExe, runWsl, parseDistros, listDistros, parseProbe, wslHub, installUrl, install };
