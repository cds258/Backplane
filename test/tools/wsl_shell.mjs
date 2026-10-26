// test/wsl_shell_test.bend's driver: the hub's folder and file shell, run
// under /bin/sh. On a hub in WSL (a stand-in wslpath on PATH) Windows paths
// become the distro's and files open in Explorer (a stand-in that records its
// argv); with no wslpath on PATH every answer is what it was before WSL.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const lib = (await import(pathToFileURL(resolve(process.argv[2])).href)).default;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'bp-wsl-shell-')));
const dir = (...p) => { const d = join(root, ...p); mkdirSync(d, { recursive: true }); return d; };
const script = (file, text) => { writeFileSync(file, text); chmodSync(file, 0o755); return file; };
const unc = p => '\\\\wsl.localhost\\Fake' + p.replaceAll('/', '\\');

// tools the scripts call that are not sh builtins, without wslpath
const tools = dir('tools');
for (const t of ['uname', 'sed', 'dirname', 'mkdir', 'find', 'sort', 'head']) {
  const found = ['/usr/bin', '/bin'].map(d => join(d, t)).find(existsSync);
  symlinkSync(found, join(tools, t));
}
// wslpath as WSL's: -u maps X:\ and X:/ under <root>/mnt/x and this distro's
// \\wsl.localhost\Fake\..., refuses anything else; -w is the reverse
function wslpath(root) {
  const [how, p = ''] = process.argv.slice(2), fake = '\\\\wsl.localhost\\Fake\\';
  const out = s => { process.stdout.write(s + '\n'); process.exit(0); };
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (how === '-u' && p.startsWith(fake)) out('/' + p.slice(fake.length).replaceAll('\\', '/'));
  if (how === '-u' && drive) out(`${root}/mnt/${drive[1].toLowerCase()}/${drive[2].replaceAll('\\', '/')}`);
  if (how === '-w' && p.startsWith('/')) out('\\\\wsl.localhost\\Fake' + p.replaceAll('/', '\\'));
  process.stderr.write(`wslpath: ${p}\n`);
  process.exit(1);
}
// Explorer and an opener that write their argv, a line each, and exit 1 as Explorer does
function recorder(log) {
  const fs = require('node:fs');
  fs.writeFileSync(log + '.tmp', process.argv.slice(2).map(a => a + '\n').join(''));
  fs.renameSync(log + '.tmp', log);
  process.exit(1);
}
const stub = (file, f, arg) => script(file, `#!${process.execPath}\n(${f})(${JSON.stringify(arg)});\n`);
const wsl = dir('wsl');
stub(join(wsl, 'wslpath'), wslpath, root);
const exp = dir('exp');
stub(join(exp, 'explorer.exe'), recorder, join(root, 'explorer.log'));
stub(join(dir('mnt', 'c', 'Windows'), 'explorer.exe'), recorder, join(root, 'windows-explorer.log'));
const opener = stub(join(dir('opener'), 'open'), recorder, join(root, 'open.log'));

const home = dir('home');
const run = (sh, arg, path, extra = {}) => {
  const r = spawnSync('/bin/sh', ['-c', sh, 'sh', arg], { cwd: '/', encoding: 'utf8', timeout: 10000,
    env: { PATH: path, HOME: home, ...extra } });
  return { code: r.status, out: (r.stdout || '').trim() };
};
const logged = name => {
  const file = join(root, name), until = Date.now() + 5000;
  while (!existsSync(file) && Date.now() < until) spawnSync('/bin/sh', ['-c', 'sleep 0.05']);
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').split('\n').slice(0, -1);
  rmSync(file);
  return lines;
};
let n = 0;
const ok = (name, f) => { f(); n++; console.log('ok ' + name); };

const inWsl = [wsl, exp, tools].join(':'), elsewhere = tools;
const users = dir('mnt', 'c', 'Users', 'me', 'board one'), proj = dir('proj'), inHome = dir('home', 'proj');
const resolveSh = lib.resolve_sh(), mkdirSh = lib.mkdir_sh(), listSh = lib.list_sh(), openSh = lib.open_sh(), revealSh = lib.reveal_sh();

ok('a C:\\ path is the distro folder on a hub in WSL', () =>
  assert.deepEqual(run(resolveSh, 'C:\\Users\\me\\board one', inWsl), { code: 0, out: users }));
ok('a C:/ path is the same folder', () =>
  assert.deepEqual(run(resolveSh, 'C:/Users/me/board one', inWsl), { code: 0, out: users }));
ok('a \\\\wsl.localhost path of this distro is its own folder', () =>
  assert.deepEqual(run(resolveSh, unc(proj), inWsl), { code: 0, out: proj }));
ok('a path wslpath refuses is not a folder this hub can open', () =>
  assert.deepEqual(run(resolveSh, '\\\\server\\share\\x', inWsl), { code: 2, out: 'not a folder this hub can open: \\\\server\\share\\x' }));
ok('another distro\'s path is refused the same way', () =>
  assert.deepEqual(run(resolveSh, '\\\\wsl.localhost\\Other\\home', inWsl), { code: 2, out: 'not a folder this hub can open: \\\\wsl.localhost\\Other\\home' }));
ok('a missing drive folder is the usual no such folder', () =>
  assert.deepEqual(run(resolveSh, 'D:\\nope', inWsl), { code: 2, out: `no such folder: ${root}/mnt/d/nope` }));
for (const [arg, want] of [['proj', inHome], ['~/proj', inHome], ['', home], [proj, proj]])
  ok(`"${arg}" resolves as before on a hub in WSL`, () => assert.deepEqual(run(resolveSh, arg, inWsl), { code: 0, out: want }));
ok('with no wslpath a Windows path stays as typed (under home, as before)', () =>
  assert.deepEqual(run(resolveSh, 'C:\\Users\\me', elsewhere), { code: 2, out: `no such folder: ${home}/C:\\Users\\me` }));
for (const [arg, want] of [['proj', inHome], ['~/proj', inHome], ['', home], [proj, proj]])
  ok(`"${arg}" resolves as before with no wslpath`, () => assert.deepEqual(run(resolveSh, arg, elsewhere), { code: 0, out: want }));
ok('a new C:\\ folder is made in the distro\'s view of the drive', () =>
  assert.deepEqual(run(mkdirSh, 'C:\\Users\\me\\made', inWsl), { code: 0, out: join(root, 'mnt', 'c', 'Users', 'me', 'made') }));
ok('a C:\\ folder lists its folders', () =>
  assert.deepEqual(run(listSh, 'C:\\Users\\me', inWsl), { code: 0, out: [join(root, 'mnt', 'c', 'Users', 'me'), 'board one', 'made'].join('\n') }));
ok('a refused path makes nothing', () =>
  assert.deepEqual(run(mkdirSh, '\\\\server\\share\\new', inWsl), { code: 2, out: 'not a folder this hub can open: \\\\server\\share\\new' }));
ok('with no wslpath a new Windows-looking folder is made under home, as before', () =>
  assert.deepEqual(run(mkdirSh, 'C:\\x', elsewhere), { code: 0, out: `${home}/C:\\x` }));

const file = join(users, 'ecc 83.kicad_pcb');
writeFileSync(file, '');
ok('open on a hub in WSL hands Explorer the file\'s Windows path', () => {
  assert.deepEqual(run(openSh, file, inWsl, { DISPLAY: ':0' }), { code: 0, out: '' });
  assert.deepEqual(logged('explorer.log'), [unc(file)]);
});
ok('reveal hands Explorer "/select," then the file, two words', () => {
  assert.deepEqual(run(revealSh, file, inWsl, { DISPLAY: ':0' }), { code: 0, out: '' });
  assert.deepEqual(logged('explorer.log'), ['/select,', unc(file)]);
});
ok('a ~/ path opens from the hub\'s home', () => {
  writeFileSync(join(home, 'notes.txt'), '');
  assert.equal(run(openSh, '~/notes.txt', inWsl).code, 0);
  assert.deepEqual(logged('explorer.log'), [unc(join(home, 'notes.txt'))]);
});
ok('Explorer off PATH is C:\\Windows\\explorer.exe', () => {
  assert.equal(run(revealSh, file, [wsl, tools].join(':')).code, 0);
  assert.deepEqual(logged('windows-explorer.log'), ['/select,', unc(file)]);
});
ok('BACKPLANE_OPEN wins over Explorer', () => {
  assert.equal(run(openSh, file, inWsl, { DISPLAY: ':0', BACKPLANE_OPEN: opener }).code, 0);
  assert.deepEqual(logged('open.log'), [file]);
  assert.equal(existsSync(join(root, 'explorer.log')), false);
});
ok('a missing file is refused before Explorer', () =>
  assert.deepEqual(run(openSh, join(users, 'gone'), inWsl), { code: 1, out: `No such file: ${join(users, 'gone')}` }));
ok('with no wslpath open is the desktop opener, as before', () => {
  assert.equal(run(openSh, file, elsewhere, { DISPLAY: ':0', BACKPLANE_OPEN: opener }).code, 0);
  assert.deepEqual(logged('open.log'), [file]);
});
ok('with no wslpath reveal opens the folder, as before', () => {
  assert.equal(run(revealSh, file, elsewhere, { DISPLAY: ':0', BACKPLANE_OPEN: opener }).code, 0);
  assert.deepEqual(logged('open.log'), [users]);
});
ok('with no wslpath and no desktop it says so, as before', () =>
  assert.deepEqual(run(openSh, file, elsewhere), { code: 1, out: 'No desktop on this machine to open it on' }));
assert.equal(existsSync(join(root, 'explorer.log')) || existsSync(join(root, 'windows-explorer.log')), false, 'Explorer ran only where asked');
rmSync(root, { recursive: true, force: true });
console.log(`ok wsl shell: ${n} cases`);
