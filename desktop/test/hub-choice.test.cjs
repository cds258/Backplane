'use strict';
// The Windows app's choice of hub: main.cjs against a stubbed Electron, a
// stubbed Service and stubbed wsl.exe calls (wsl.cjs's own rules kept), the
// preload's checks, and startup.js drawing main's Screen.
const { test } = require('node:test'), assert = require('node:assert/strict');
const Module = require('node:module'), path = require('node:path'), os = require('node:os'), fs = require('node:fs'), vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const startupURL = pathToFileURL(path.join(__dirname, '..', 'startup.html')).href;

function harness({ hubs, distros = ['Ubuntu'], installed = () => {} }) {
  const calls = { loadURL: [], loadFile: 0, screens: [], handlers: new Map(), syncs: new Map(), probes: [], installs: [], services: [], listed: 0, menus: [] };
  let ready; const whenReady = new Promise(r => ready = r);
  const events = () => { const on = new Map(); return { on(e, f) { on.set(e, f); return this; }, once(e, f) { on.set(e, f); return this; }, emit(e, ...a) { on.get(e)?.(...a); } }; };
  class BrowserWindow {
    constructor() {
      Object.assign(this, events()); const w = this; this.url = '';
      this.webContents = { ...events(), mainFrame: { url: '' }, getURL: () => w.url, setWindowOpenHandler() {}, isDestroyed: () => false,
        send: (ch, v) => { if (ch === 'desktop:connection') calls.screens.push(v); } };
      BrowserWindow.all.push(this); setImmediate(() => w.emit('ready-to-show'));
    }
    show() {} setMenuBarVisibility() {} isDestroyed() { return false; } isMinimized() { return false; }
    loadFile() { calls.loadFile++; this.url = startupURL; this.webContents.mainFrame.url = startupURL; return Promise.resolve(); }
    loadURL(url) { calls.loadURL.push(url); this.url = url; this.webContents.mainFrame.url = url + '/'; return Promise.resolve(); }
    static getAllWindows() { return BrowserWindow.all; }
  }
  BrowserWindow.all = [];
  const paths = new Map();
  const electron = { app: { isPackaged: false, setPath: (k, v) => paths.set(k, v), getPath: k => paths.get(k), getVersion: () => '0.12.3', setName() {}, requestSingleInstanceLock: () => true, on() {}, quit() {}, whenReady: () => whenReady },
    BrowserWindow, Menu: { setApplicationMenu: m => calls.menus.push(m), buildFromTemplate: x => x }, dialog: { showErrorBox: (a, b) => { throw new Error(b); } },
    ipcMain: { handle: (ch, f) => calls.handlers.set(ch, f), on: (ch, f) => calls.syncs.set(ch, f) }, session: { fromPartition: () => ses }, shell: {}, webContents: { getFocusedWebContents: () => null } };
  const ses = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onHeadersReceived() {} }, fetch: async () => ({ ok: true }) };
  class Service {
    constructor(o) { this.o = o; calls.services.push(o); }
    async start() { return hubs(this.o); }
    async token() { return 'a'.repeat(32); }
  }
  const real = require('../wsl.cjs');
  const wsl = { ...real,
    wslHub: async ({ distro, paths }) => { calls.probes.push({ distro, paths }); if (distro === 'Gone') throw new Error('Gone: There is no distribution with the supplied name.');
      return { home: `\\\\wsl.localhost\\${distro}\\hub`, browse: `\\\\wsl.localhost\\${distro}\\home\\me`, host: { procRoot: 'x', plan: async () => ({}) } }; },
    listDistros: async () => { calls.listed++; return distros; },
    install: async o => { calls.installs.push(o); o.onLine?.('copying'); installed(o); } };
  return { calls, ready, stubs: { electron, './service.cjs': { Service }, './wsl.cjs': wsl } };
}

async function boot(h, { env = {}, saved } = {}, check) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-hubchoice-')), keys = ['BACKPLANE_HOME', ...Object.keys(env)];
  const before = Object.fromEntries(keys.map(k => [k, process.env[k]])), load = Module._load, platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.assign(process.env, { BACKPLANE_HOME: home, ...env });
  const resources = process.resourcesPath; process.resourcesPath = home;
  if (saved) { fs.mkdirSync(path.join(home, 'electron-profile')); fs.writeFileSync(path.join(home, 'electron-profile', 'backend'), saved); }
  Object.defineProperty(process, 'platform', { value: 'win32' });
  Module._load = function (request, parent, ...rest) { return Object.hasOwn(h.stubs, request) ? h.stubs[request] : load.call(this, request, parent, ...rest); };
  try {
    const main = require.resolve('../main.cjs'); delete require.cache[main]; require(main);
    h.ready(); await settle();
    Object.defineProperty(process, 'platform', platform);
    const w = h.stubs.electron.BrowserWindow.all[0];
    const from = url => ({ sender: w.webContents, senderFrame: Object.assign(w.webContents.mainFrame, { url }) });
    await check({ home, w, page: () => from(w.url === startupURL ? startupURL : w.url + '/'), startup: () => from(startupURL),
      screen: () => h.calls.screens.at(-1), invoke: async (ch, e, ...a) => { const r = await h.calls.handlers.get(ch)(e, ...a); await settle(); return r; },
      sync: (ch, e) => { const x = { ...e }; h.calls.syncs.get(ch)(x); return x.returnValue; } });
  } finally {
    Object.defineProperty(process, 'platform', platform); Module._load = load; process.resourcesPath = resources;
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(home, { recursive: true, force: true });
  }
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 5)); };
const iso = { BACKPLANE_WSL_HOME: '/tmp/bp/home', BACKPLANE_WSL_PREFIX: '/tmp/bp/prefix', BACKPLANE_WSL_INSTALLER: '/tmp/bp/install.sh' };
const notInstalled = d => Object.assign(new Error(`Backplane is not installed in ${d}.`), { code: 'ERR_HUB_NOT_INSTALLED' });

test('from Windows to a distro with nothing installed: the chooser, Install, then its hub', async () => {
  let installedHub = false;
  const h = harness({ installed: () => { installedHub = true; },
    hubs: o => { if (!o.host) return { origin: 'http://127.0.0.1:1', version: '1' }; if (!installedHub) throw notInstalled('Ubuntu'); return { origin: 'http://127.0.0.1:2', version: 'any' }; } });
  await boot(h, { env: iso }, async t => {
    assert.deepEqual(h.calls.loadURL, ['http://127.0.0.1:1'], 'no choice saved: the Windows hub');
    assert.equal(t.sync('desktop:hub-now', t.page()), 'Windows');
    assert.equal(h.calls.menus.at(-1)[0].submenu[0].label, 'Change hub…');
    assert.equal(h.calls.listed, 0, 'nothing lists distros before the chooser opens');
    await t.invoke('desktop:choose-backend', t.page());
    assert.equal(h.calls.loadFile, 2, 'the hub page gives way to the startup screen');
    assert.deepEqual(t.screen(), { phase: 'choose', message: 'Where should this app’s hub run?', offers: [],
      choices: [{ token: 'windows', label: 'Windows', current: true }, { token: 'wsl:Ubuntu', label: 'WSL · Ubuntu', current: false }] });
    await assert.rejects(async () => t.invoke('desktop:use-backend', t.startup(), 'wsl:Debian'), /Not a choice on screen/);
    await t.invoke('desktop:use-backend', t.startup(), 'wsl:Ubuntu');
    assert.equal(fs.readFileSync(path.join(t.home, 'electron-profile', 'backend'), 'utf8'), 'wsl:Ubuntu\n');
    assert.deepEqual(h.calls.probes, [{ distro: 'Ubuntu', paths: { isolated: true, home: '/tmp/bp/home', prefix: '/tmp/bp/prefix', installer: '/tmp/bp/install.sh' } }]);
    assert.deepEqual(h.calls.services.at(-1).home, '\\\\wsl.localhost\\Ubuntu\\hub');
    assert.equal(h.calls.services.at(-1).expectedVersion, undefined, 'any Backplane in a distro');
    assert.deepEqual(t.screen(), { phase: 'install', message: 'Backplane is not installed in Ubuntu.', offers: ['install', 'choose'] });
    await t.invoke('desktop:install', t.startup());
    assert.equal(h.calls.installs.length, 1); assert.equal(h.calls.installs[0].version, '0.12.3'); assert.equal(h.calls.installs[0].distro, 'Ubuntu');
    assert(h.calls.screens.some(s => s.phase === 'installing' && s.message === 'Installing Backplane in Ubuntu… copying'));
    assert.deepEqual(h.calls.loadURL, ['http://127.0.0.1:1', 'http://127.0.0.1:2'], 'then the hub in Ubuntu');
    assert.equal(t.sync('desktop:hub-now', t.page()), 'WSL · Ubuntu');
  });
});

test('a saved distro starts there; a missing one is an error with Change hub, and Windows is the way back', async () => {
  const h = harness({ hubs: o => ({ origin: o.host ? 'http://127.0.0.1:2' : 'http://127.0.0.1:1', version: '1' }) });
  await boot(h, { env: iso, saved: 'wsl:Gone\n' }, async t => {
    assert.deepEqual(h.calls.loadURL, []);
    assert.deepEqual(t.screen(), { phase: 'error', message: 'Gone: There is no distribution with the supplied name.', offers: ['retry', 'choose'] });
    await t.invoke('desktop:retry', t.startup());
    assert.equal(h.calls.probes.length, 2);
    await t.invoke('desktop:choose-backend', t.startup());
    assert.deepEqual(t.screen().choices.map(c => [c.token, c.current]), [['windows', false], ['wsl:Ubuntu', false]]);
    await t.invoke('desktop:use-backend', t.startup(), 'windows');
    assert.deepEqual(h.calls.loadURL, ['http://127.0.0.1:1']);
    assert.equal(fs.readFileSync(path.join(t.home, 'electron-profile', 'backend'), 'utf8'), 'windows\n');
  });
});

test('an isolated app without its distro home and prefix stops before any wsl.exe', async () => {
  const h = harness({ hubs: () => ({ origin: 'http://127.0.0.1:1', version: '1' }) });
  await boot(h, { env: { BACKPLANE_WSL_HOME: '', BACKPLANE_WSL_PREFIX: '' }, saved: 'wsl:Ubuntu\n' }, async t => {
    assert.equal(h.calls.probes.length, 0);
    assert.equal(t.screen().phase, 'error'); assert.match(t.screen().message, /BACKPLANE_WSL_HOME and BACKPLANE_WSL_PREFIX/);
    assert.deepEqual(t.screen().offers, ['retry', 'choose']);
  });
});

test('the startup page and other senders: only the startup page picks and installs; nothing else is asked', async () => {
  const h = harness({ hubs: () => ({ origin: 'http://127.0.0.1:1', version: '1' }) });
  await boot(h, { env: iso }, async t => {
    const stranger = { sender: {}, senderFrame: { url: startupURL } };
    for (const ch of ['desktop:startup', 'desktop:install', 'desktop:choose-backend']) await assert.rejects(async () => t.invoke(ch, stranger), /Invalid sender/, ch);
    await assert.rejects(async () => t.invoke('desktop:use-backend', t.page(), 'windows'), /Invalid sender/);
    assert.equal(t.sync('desktop:hub-now', stranger), '');
  });
});

function preload(answers) {
  const exposed = {}, listeners = {};
  const electron = { contextBridge: { exposeInMainWorld: (k, v) => exposed[k] = v },
    ipcRenderer: { sendSync: n => answers[n], send() {}, invoke: async (n, ...a) => [n, ...a], on: (n, f) => listeners[n] = f, removeListener() {} } };
  const ctx = { require: () => electron, process: { argv: [] }, document: { documentElement: { classList: { toggle() {} } } }, MutationObserver: class {}, TypeError, Object, String, Array };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8'), ctx);
  return { api: exposed.backplaneDesktop, listeners };
}

test('the preload names the hub only where main does, and checks the Screen as it crosses', async () => {
  const none = preload({ 'desktop:hub-now': '' }).api;
  assert.equal(none.hub, undefined); assert.equal(none.chooseBackend, undefined);
  const p = preload({ 'desktop:hub-now': 'WSL · Ubuntu' });
  assert.equal(p.api.hub, 'WSL · Ubuntu'); assert.deepEqual(await p.api.chooseBackend(), ['desktop:choose-backend']);
  const seen = []; p.api.onConnection(s => seen.push(s));
  p.listeners['desktop:connection']({}, { phase: 'choose', message: 'm', offers: ['install', 'evil'], choices: [{ token: 'windows', label: 'Windows', current: true, extra: 1 }, { token: 7 }] });
  p.listeners['desktop:connection']({}, { phase: 'navigate', message: 'm' });
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [{ phase: 'choose', message: 'm', offers: ['install'], choices: [{ token: 'windows', label: 'Windows', current: true }] }]);
});

test('the startup page draws exactly the Screen and sends a pick by its token', async () => {
  const els = {}, created = [], picks = [];
  const el = id => els[id] ??= { id, hidden: false, textContent: '', dataset: {}, children: [], on: {}, addEventListener(e, f) { this.on[e] = f; }, replaceChildren(...k) { this.children = k; } };
  let draw;
  const bp = { onConnection: f => draw = f, startup: async () => null, retry: async () => {}, install() {}, chooseBackend() { picks.push('choose'); }, useBackend: async t => picks.push(t) };
  const ctx = { window: { backplaneDesktop: bp }, document: { getElementById: el, createElement: () => { const b = el('b' + created.length); created.push(b); return b; } } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'startup.js'), 'utf8'), ctx);
  draw({ phase: 'install', message: 'Backplane is not installed in Ubuntu.', offers: ['install', 'choose'], choices: [] });
  assert.equal(el('status').textContent, 'Backplane is not installed in Ubuntu.');
  assert.deepEqual(['install', 'retry', 'choose'].map(n => el(n).hidden), [false, true, false]); assert.equal(el('choices').hidden, true);
  el('choose').on.click();
  draw({ phase: 'choose', message: 'Where?', offers: [], choices: [{ token: 'windows', label: 'Windows', current: true }, { token: 'wsl:Ubuntu', label: 'WSL · Ubuntu', current: false }] });
  assert.equal(el('choices').hidden, false); assert.deepEqual(el('choices').children.map(b => b.textContent), ['Windows (now)', 'WSL · Ubuntu']);
  el('choices').children[1].on.click();
  assert.deepEqual(picks, ['choose', 'wsl:Ubuntu']);
});
