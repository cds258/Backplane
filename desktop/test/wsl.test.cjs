'use strict';
// desktop/wsl.cjs: wsl.exe's argv and stdin, its answers, and the scripts
// themselves run under the real sh with a stand-in wslpath (and curl).
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const w = require('../wsl.cjs');

const exe = 'C:\\Windows\\System32\\wsl.exe';
const iso = { isolated: true, home: '/tmp/bp/home', prefix: '/tmp/bp/prefix', installer: '' };
const answer = (fields, code = 0) => ({ code, out: Object.entries(fields).map(([k, v]) => `${k}=${v}\n`).join('') });
const probed = { home: '/tmp/bp/home', unc: '\\\\wsl.localhost\\Ubuntu\\tmp\\bp\\home', proc: '\\\\wsl.localhost\\Ubuntu\\proc',
  browse: '\\\\wsl.localhost\\Ubuntu\\home\\me', prefix: '/tmp/bp/prefix' };
const recorder = reply => { const calls = []; return { calls, run: async (args, o) => { calls.push({ args, ...o }); return reply; } }; };

test('wsl.exe is System32\'s, by SystemRoot whatever its case', () => {
  assert.equal(w.wslExe({ SystemRoot: 'C:\\Windows' }), exe);
  assert.equal(w.wslExe({ SYSTEMROOT: 'D:\\Win' }), 'D:\\Win\\System32\\wsl.exe');
  for (const env of [{}, { SystemRoot: 'Windows' }, { SystemRoot: 'C:\\a;b' }]) assert.throws(() => w.wslExe(env), /SystemRoot/);
});

test('an isolated app names its own distro home and prefix before any wsl.exe', () => {
  assert.deepEqual(w.wslPaths({}, false), { isolated: false, home: '', prefix: '', installer: '' });
  assert.deepEqual(w.wslPaths({ BACKPLANE_WSL_INSTALLER: '/x/i.sh' }, false).installer, '', 'only an isolated app replaces the installer');
  assert.deepEqual(w.wslPaths({ BACKPLANE_WSL_HOME: '/t/h', BACKPLANE_WSL_PREFIX: '/t/p', BACKPLANE_WSL_INSTALLER: '/t/i.sh' }, true),
    { isolated: true, home: '/t/h', prefix: '/t/p', installer: '/t/i.sh' });
  for (const env of [{}, { BACKPLANE_WSL_HOME: '/t/h' }, { BACKPLANE_WSL_PREFIX: '/t/p' }])
    assert.throws(() => w.wslPaths(env, true), e => e.code === 'ERR_WSL_ISOLATION');
  for (const bad of ['t/h', '/t/../h', '/t/h/', '/t/./h', '/t/h\n', 'C:\\h'])
    assert.throws(() => w.wslPaths({ BACKPLANE_WSL_HOME: bad, BACKPLANE_WSL_PREFIX: '/t/p' }, true), e => e.code === 'ERR_WSL_ISOLATION', bad);
});

test('distros from wsl -l -q: UTF-16 or UTF-8, BOM and CRLF, valid names only, docker\'s and rancher\'s left out', () => {
  const utf16 = Buffer.from('\uFEFFUbuntu\r\nDebian\r\ndocker-desktop\r\ndocker-desktop-data\r\n', 'utf16le').toString('utf8');
  assert.deepEqual(w.parseDistros(utf16), ['Ubuntu', 'Debian']);
  assert.deepEqual(w.parseDistros('Ubuntu-24.04\nrancher-desktop\nWindows Subsystem for Linux has no installed distributions.\n\n'), ['Ubuntu-24.04']);
});

test('listing runs only when wsl.exe exists, and a failed listing is none', async () => {
  let ran = 0;
  assert.deepEqual(await w.listDistros({ exe, exists: () => false, run: async () => { ran++; } }), []);
  assert.equal(ran, 0);
  const r = recorder({ code: 0, out: 'Ubuntu\n' });
  assert.deepEqual(await w.listDistros({ exe, exists: () => true, run: r.run }), ['Ubuntu']);
  assert.deepEqual(r.calls[0].args, ['-l', '-q']);
  assert.deepEqual(await w.listDistros({ exe, exists: () => true, run: async () => ({ code: 1, out: 'Ubuntu\n' }) }), []);
  assert.deepEqual(await w.listDistros({ exe, exists: () => true, run: async () => { throw new Error('gone'); } }), []);
});

function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: 0 });
  child.kill = () => { child.killed++; };
  let input = ''; child.stdin.on('data', d => { input += d; }); child.input = () => input;
  return child;
}

test('a run hands wsl.exe the script on stdin, UTF-8 asked, the app\'s WSLENV dropped, and streams its lines', async () => {
  const child = fakeChild(), seen = [], lines = [];
  const before = process.env.WSLENV; process.env.WSLENV = 'BACKPLANE_HOME/p';
  try {
    const p = w.runWsl(['-d', 'Ubuntu'], { exe, input: 'echo hi\n', onLine: l => lines.push(l), spawn: (file, args, o) => { seen.push({ file, args, o }); return child; } });
    child.stdout.write('first\r\nsec'); child.stdout.write('ond\n');
    child.stderr.write(Buffer.from('w\0a\0r\0n\0\r\0\n\0'));
    child.stdout.end(); child.stderr.end();
    await new Promise(r => setImmediate(r));
    child.emit('close', 3);
    const r = await p;
    assert.equal(r.code, 3);
    assert.deepEqual(lines, ['first', 'second', 'warn']);
    assert.equal(child.input(), 'echo hi\n');
    assert.equal(seen[0].file, exe); assert.deepEqual(seen[0].args, ['-d', 'Ubuntu']);
    assert.equal(seen[0].o.shell, false); assert.equal(seen[0].o.windowsHide, true); assert.equal(seen[0].o.env.WSL_UTF8, '1');
    assert(!Object.keys(seen[0].o.env).some(k => k.toUpperCase() === 'WSLENV'));
  } finally { if (before === undefined) delete process.env.WSLENV; else process.env.WSLENV = before; }
});

test('a run past its time stops its own wsl.exe and fails', async () => {
  const child = fakeChild();
  await assert.rejects(w.runWsl([], { exe, timeoutMs: 10, spawn: () => child }), /did not answer in 0.01 s/);
  assert.equal(child.killed, 1);
});

test('the probe: argv, script on stdin, and the hub it describes', async () => {
  const r = recorder(answer({ ...probed, serve: '/tmp/bp/prefix/backplane-serve' }));
  const hub = await w.wslHub({ distro: 'Ubuntu', paths: iso, run: r.run, exe });
  assert.deepEqual(r.calls[0].args, ['-d', 'Ubuntu', '--cd', '~', '--exec', '/usr/bin/env', 'BP_WSL_HOME=/tmp/bp/home', 'BP_WSL_PREFIX=/tmp/bp/prefix', 'BP_WSL_ISOLATED=1', 'sh', '-s']);
  assert.equal(r.calls[0].input, w.PROBE_SH); assert.equal(r.calls[0].timeoutMs, 60000);
  assert.equal(hub.home, probed.unc); assert.equal(hub.browse, probed.browse); assert.equal(hub.host.procRoot, probed.proc);
  const plan = await hub.host.plan(41234);
  assert.equal(plan.file, exe); assert.equal(plan.env.WSL_UTF8, '1');
  assert.deepEqual(plan.args, ['-d', 'Ubuntu', '--cd', '~', '--exec', '/usr/bin/env', 'BACKPLANE_HOME=/tmp/bp/home',
    'sh', '-c', 'mkdir -p "$0" && exec "$@" >>"$0/desktop-hub.log" 2>&1', '/tmp/bp/home',
    '/tmp/bp/prefix/backplane-serve', '--home', '/tmp/bp/home', '--port', '41234', '--host', '127.0.0.1', '--web', '/tmp/bp/prefix/web', '--foreground', '--no-tailscale']);
  const live = recorder(answer(probed));
  await w.wslHub({ distro: 'Ubuntu', paths: { isolated: false, home: '', prefix: '', installer: '' }, run: live.run, exe });
  assert.deepEqual(live.calls[0].args.slice(6, 9), ['BP_WSL_HOME=', 'BP_WSL_PREFIX=', 'BP_WSL_ISOLATED=']);
});

test('nothing installed is the Install offer, when the hub would start; a refusal or a missing distro is an error', async () => {
  const hub = await w.wslHub({ distro: 'Ubuntu', paths: iso, run: recorder(answer(probed)).run, exe });
  await assert.rejects(hub.host.plan(1), e => e.code === 'ERR_HUB_NOT_INSTALLED' && e.message === 'Backplane is not installed in Ubuntu.');
  await assert.rejects(w.wslHub({ distro: 'Ubuntu', paths: iso, run: recorder(answer({ error: 'BACKPLANE_WSL_HOME is the live hub\'s home: /x' })).run, exe }), /live hub's home/);
  await assert.rejects(w.wslHub({ distro: 'Gone', paths: iso, exe,
    run: async () => ({ code: 255, out: 'There is no distribution with the supplied name.\nError code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\n' }) }),
  /^Error: Gone: There is no distribution with the supplied name\.$/);
  for (const bad of [{ ...probed, unc: 'C:\\x' }, { ...probed, home: 'rel' }, { ...probed, proc: undefined }])
    await assert.rejects(w.wslHub({ distro: 'Ubuntu', paths: iso, run: recorder(answer(Object.fromEntries(Object.entries(bad).filter(([, v]) => v !== undefined)))).run, exe }), /Invalid answer from Ubuntu/);
  await assert.rejects(w.wslHub({ distro: '-d', paths: iso, run: async () => assert.fail('ran'), exe }), /Invalid WSL distro/);
});

test('install: the app\'s own release, hub only, into an isolated prefix with its own bin; its last line on failure', async () => {
  assert.equal(w.installUrl('0.12.3'), 'https://github.com/i2cjak/Backplane/releases/download/v0.12.3/install.sh');
  for (const v of ['0.12.3-dev.1', '', undefined]) assert.equal(w.installUrl(v), 'https://github.com/i2cjak/Backplane/releases/latest/download/install.sh');
  const r = recorder({ code: 0, out: '' }), lines = [];
  await w.install({ distro: 'Ubuntu', paths: { ...iso, installer: '/tmp/bp/i.sh' }, version: '0.12.3', run: r.run, exe, onLine: l => lines.push(l) });
  assert.deepEqual(r.calls[0].args, ['-d', 'Ubuntu', '--cd', '~', '--exec', '/usr/bin/env', 'BP_WSL_PREFIX=/tmp/bp/prefix', 'BP_WSL_BIN=/tmp/bp/prefix/bin',
    'BP_WSL_ISOLATED=1', 'BP_WSL_INSTALLER=/tmp/bp/i.sh', 'BP_WSL_URL=https://github.com/i2cjak/Backplane/releases/download/v0.12.3/install.sh', 'sh', '-s']);
  assert.equal(r.calls[0].input, w.INSTALL_SH); assert.equal(typeof r.calls[0].onLine, 'function');
  const live = recorder({ code: 0, out: '' });
  await w.install({ distro: 'Ubuntu', paths: { isolated: false, home: '', prefix: '', installer: '' }, version: '0.12.3', run: live.run, exe });
  assert.deepEqual(live.calls[0].args.slice(6, 10), ['BP_WSL_PREFIX=', 'BP_WSL_BIN=', 'BP_WSL_ISOLATED=', 'BP_WSL_INSTALLER=']);
  await assert.rejects(w.install({ distro: 'Ubuntu', paths: { ...iso, prefix: '' }, run: async () => assert.fail('ran'), exe }), e => e.code === 'ERR_WSL_ISOLATION');
  await assert.rejects(w.install({ distro: 'Ubuntu', paths: iso, exe, run: async () => ({ code: 4, out: 'Downloading x\nCould not download Backplane\'s installer: x\n' }) }), /^Error: Could not download Backplane's installer: x$/);
});

// the scripts, as a distro runs them: a temp HOME, wslpath (and curl) stand-ins first on PATH
function distro() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-wsl-sh-'))), home = path.join(root, 'me'), bin = path.join(root, 'bin');
  fs.mkdirSync(home); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'wslpath'), '#!/bin/sh\n[ "$1" = -w ] || exit 1\nprintf \'\\\\\\\\wsl.localhost\\\\Fake%s\\n\' "$(printf %s "$2" | tr / \'\\\\\')"\n', { mode: 0o755 });
  const sh = (script, env = {}, extraPath = '') => {
    const r = spawnSync('/bin/sh', ['-s'], { input: script, encoding: 'utf8', cwd: home, env: { HOME: home, PATH: `${extraPath}${bin}:/usr/bin:/bin`, ...env } });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  return { root, home, bin, sh, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const fields = out => Object.fromEntries(out.trim().split('\n').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const unc = p => '\\\\wsl.localhost\\Fake' + p.replaceAll('/', '\\');

test('PROBE_SH makes the hub\'s home 0700 and says where things are; serve only once installed', () => {
  const d = distro();
  try {
    const live = fields(d.sh(w.PROBE_SH).out);
    assert.deepEqual(live, { home: path.join(d.home, '.backplane-bend'), unc: unc(path.join(d.home, '.backplane-bend')), proc: unc('/proc'), browse: unc(d.home), prefix: path.join(d.home, '.local/share/backplane') });
    assert.equal(fs.statSync(live.home).mode & 0o777, 0o700);
    const h = path.join(d.root, 'iso', 'home'), p = path.join(d.root, 'iso', 'prefix');
    const env = { BP_WSL_HOME: h, BP_WSL_PREFIX: p, BP_WSL_ISOLATED: '1' };
    assert.equal(fields(d.sh(w.PROBE_SH, env).out).serve, undefined);
    fs.mkdirSync(path.join(p, 'web'), { recursive: true }); fs.writeFileSync(path.join(p, 'backplane-serve'), '', { mode: 0o755 });
    const got = fields(d.sh(w.PROBE_SH, env).out);
    assert.equal(got.serve, path.join(p, 'backplane-serve')); assert.equal(got.home, h); assert.equal(got.unc, unc(h));
    assert.doesNotThrow(() => w.parseProbe(d.sh(w.PROBE_SH, env).out, 'Fake'));
  } finally { d.done(); }
});

test('PROBE_SH for an isolated app refuses the live install, symlinks followed, and makes nothing', () => {
  const d = distro();
  try {
    assert.deepEqual(fields(d.sh(w.PROBE_SH, { BP_WSL_ISOLATED: '1' }).out), { error: 'A checkout\'s app needs BACKPLANE_WSL_HOME and BACKPLANE_WSL_PREFIX' });
    fs.mkdirSync(path.join(d.home, '.local/share/backplane'), { recursive: true });
    fs.symlinkSync(d.home, path.join(d.root, 'link'));
    for (const [h, p, word] of [[path.join(d.root, 'link/.backplane-bend'), path.join(d.root, 'p'), 'BACKPLANE_WSL_HOME'],
      [path.join(d.root, 'h'), path.join(d.root, 'link/.local/share/backplane'), 'BACKPLANE_WSL_PREFIX'],
      [path.join(d.root, 'h'), path.join(d.root, 'link/.local/share/backplane/sub'), 'BACKPLANE_WSL_PREFIX']]) {
      const r = fields(d.sh(w.PROBE_SH, { BP_WSL_HOME: h, BP_WSL_PREFIX: p, BP_WSL_ISOLATED: '1' }).out);
      assert.match(r.error, new RegExp('^' + word + ' is the live'));
    }
    assert.equal(fs.existsSync(path.join(d.home, '.backplane-bend')), false, 'the live home was not made');
    assert.equal(fs.existsSync(path.join(d.root, 'h')), false);
  } finally { d.done(); }
});

test('INSTALL_SH runs an isolated app\'s installer hub only, and checks it installed', () => {
  const d = distro();
  try {
    const p = path.join(d.root, 'prefix'), installer = path.join(d.root, 'install.sh');
    fs.writeFileSync(installer, 'echo "prefix=$BACKPLANE_PREFIX bin=$BACKPLANE_BIN app=$BACKPLANE_NO_DESKTOP_APP menu=$BACKPLANE_NO_DESKTOP"\nmkdir -p "$BACKPLANE_PREFIX"; : > "$BACKPLANE_PREFIX/backplane-serve"; chmod +x "$BACKPLANE_PREFIX/backplane-serve"\n');
    const env = { BP_WSL_PREFIX: p, BP_WSL_BIN: p + '/bin', BP_WSL_ISOLATED: '1', BP_WSL_INSTALLER: installer, BP_WSL_URL: 'https://example.invalid/install.sh' };
    assert.deepEqual(d.sh(w.INSTALL_SH, env), { code: 0, out: `prefix=${p} bin=${p}/bin app=1 menu=1\n` });
    fs.writeFileSync(installer, 'echo "nothing"\n');
    assert.deepEqual(d.sh(w.INSTALL_SH, { ...env, BP_WSL_PREFIX: p + '2' }), { code: 5, out: `nothing\nThe installer finished but ${p}2/backplane-serve is missing\n` });
    fs.mkdirSync(path.join(d.home, '.local/share/backplane'), { recursive: true });
    const r = d.sh(w.INSTALL_SH, { ...env, BP_WSL_PREFIX: path.join(d.home, '.local/share/backplane') });
    assert.deepEqual(r, { code: 2, out: `BACKPLANE_WSL_PREFIX is the live install: ${path.join(d.home, '.local/share/backplane')}\n` });
  } finally { d.done(); }
});

test('INSTALL_SH downloads the release installer to a file and runs it only when it is one', () => {
  const d = distro();
  try {
    const fake = path.join(d.root, 'curl-bin'), body = path.join(d.root, 'body');
    fs.mkdirSync(fake);
    // curl that "downloads" $body to its -o file and logs its argv
    fs.writeFileSync(path.join(fake, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${d.root}/curl.argv"\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && o=$2; shift; done\ncp "${body}" "$o"\n`, { mode: 0o755 });
    const env = { BP_WSL_URL: 'https://github.com/i2cjak/Backplane/releases/download/v0.12.3/install.sh' };
    fs.writeFileSync(body, '<html>not found</html>\n');
    assert.deepEqual(d.sh(w.INSTALL_SH, env, fake + ':'), { code: 4, out: `Downloading ${env.BP_WSL_URL}\nNot an installer: ${env.BP_WSL_URL}\n` });
    assert.deepEqual(fs.readFileSync(path.join(d.root, 'curl.argv'), 'utf8').split('\n').slice(0, 4), ['--proto', '=https', '--tlsv1.2', '-fsSL']);
    fs.writeFileSync(body, '#!/bin/sh\necho "installing into $BACKPLANE_PREFIX bin=${BACKPLANE_BIN:-default}"\nmkdir -p "$BACKPLANE_PREFIX"; : > "$BACKPLANE_PREFIX/backplane-serve"; chmod +x "$BACKPLANE_PREFIX/backplane-serve"\n');
    const live = path.join(d.home, '.local/share/backplane');
    assert.deepEqual(d.sh(w.INSTALL_SH, env, fake + ':'), { code: 0, out: `Downloading ${env.BP_WSL_URL}\ninstalling into ${live} bin=default\n` });
    assert.deepEqual(d.sh(w.INSTALL_SH, { ...env, PATH: d.bin }), { code: 3, out: 'curl is not installed in this distro; install it (sudo apt install curl) and try again\n' });
  } finally { d.done(); }
});
