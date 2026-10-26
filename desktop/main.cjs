const electron = require('electron');
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = electron;
const { installShortcuts, applicationMenu } = require('./window.cjs');
const { iconPath } = require('./branding.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const { Service } = require('./service.cjs');
const { WINDOWS, readBackend, writeBackend, labelBackend, parseBackend, showBackend, choicesFor } = require('./backend.cjs');
const wsl = require('./wsl.cjs');
const { createBrowserUnknownState } = require('./browser-dispatch.cjs');
const { createDesktopBrowserController } = require('./browser-controller.cjs');
const { createBrowserActions } = require('./browser-actions.cjs');
const { exactObject } = require('./browser-wire.cjs');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { createConnectionLog } = require('./connection-log.cjs');

// Checkout launches always name an isolated home. Packaging supplies its
// explicit product configuration after root's integration review.
const home = process.env.BACKPLANE_HOME || (app.isPackaged ? path.join(os.homedir(), '.backplane-bend') : null);
if (!home || !path.isAbsolute(home)) throw new Error('Set an absolute, isolated BACKPLANE_HOME');
if (!app.isPackaged && path.resolve(home) === path.join(os.homedir(), '.backplane-bend')) throw new Error('Development Electron must use an isolated BACKPLANE_HOME');
app.setPath('userData', path.join(home, 'electron-profile'));
const connectionLog = createConnectionLog(home);
app.setName('Backplane');
if (process.platform === 'linux') app.setDesktopName?.('backplane.desktop');
const resourceRoot = path.join(process.resourcesPath, 'backplane-service');
const desktopBuild = path.join(process.resourcesPath, 'DESKTOP-BUILD.json');
const build = app.isPackaged ? require(fs.existsSync(desktopBuild) ? desktopBuild : path.join(resourceRoot, 'BUILD.json')) : {};
const directBrowser=build.desktopBrowser?.protocol===1||(!app.isPackaged&&process.env.BACKPLANE_DESKTOP_BROWSER==='1');
// A local increment can retain the existing native Browser service while
// withholding its newer cooperative renderer interface until qualified.
const rendererBrowser=directBrowser&&build.desktopBrowser?.rendererBridge!==false;
if(directBrowser)process.env.BACKPLANE_DESKTOP_BROWSER='1';
// Main/home lifetime, including window/controller replacement. No reset API.
const browserUnknown=createBrowserUnknownState();
const nativeService = new Service({ home, binary: process.env.BACKPLANE_SERVICE || (app.isPackaged ? path.join(resourceRoot, process.platform === 'win32' ? 'backplane-serve.exe' : 'backplane-serve') : undefined), web: process.env.BACKPLANE_WEB || (app.isPackaged ? path.join(resourceRoot, 'web') : undefined), expectedVersion: process.env.BACKPLANE_SERVICE_VERSION || build.serviceVersion, residentService: build.lifecyclePolicy?.mode === 'resident-service' });
const startupPath = path.join(__dirname, 'startup.html');
const startupURL = pathToFileURL(startupPath).href;
const launchedAtMs = Date.now();
let window, origin, connection, serviceReadyAtMs, firstVisibleAtMs;
// The hub this app talks to: its own native one, or (Windows only) the hub
// in a WSL distro (backend.cjs). A checkout's app, or one given
// BACKPLANE_HOME, is isolated: it must name its own distro home and prefix.
const offersWsl = process.platform === 'win32';
const isolated = !app.isPackaged || !!process.env.BACKPLANE_HOME;
const backendFile = path.join(app.getPath('userData'), 'backend');
let backend = offersWsl ? readBackend(backendFile) : WINDOWS;
let service = nativeService, dialogStart;
let desktopBrowser;
let quitting = false;
let terminalFocused = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Backplane could not start', error.message); app.quit(); });
}
function senderIsWindow(event) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
}
function trusted(event) {
  try { return senderIsWindow(event) && origin && new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}
// The theme the hub's page last painted (host.js themeSeen), one word in
// this home's profile, so a cold window, the startup page and the page's
// first frame already have it. Nothing is read from or sent to the page but
// "light" or "dark"; with no word kept it is the hub's own default, dark.
const themeFile = path.join(app.getPath('userData'), 'theme');
let theme = 'dark';
try { if (fs.readFileSync(themeFile, 'utf8') === 'light') theme = 'light'; } catch {}
const themeBackground = () => theme === 'light' ? '#fafaf8' : '#111410';
ipcMain.on('desktop:theme', (event, value) => {
  if (!trusted(event) || (value !== 'light' && value !== 'dark') || value === theme) return;
  theme = value;window.setBackgroundColor(themeBackground());
  try { fs.writeFileSync(themeFile + '.tmp', theme);fs.renameSync(themeFile + '.tmp', themeFile); } catch {}
});
ipcMain.on('desktop:theme-now', event => {
  event.returnValue = senderIsWindow(event) && (event.senderFrame.url === startupURL || trusted(event)) ? theme : 'dark';
});
ipcMain.on('desktop:terminal-focus', (event, active) => {
  if (trusted(event) && typeof active === 'boolean') terminalFocused = active;
});
function external(url) {
  try { const parsed = new URL(url); if (['https:', 'http:', 'mailto:'].includes(parsed.protocol) && !parsed.username && !parsed.password) void shell.openExternal(parsed.href); } catch {}
}
/**
 * The startup screen, one value: startup.js draws exactly it, and reads it
 * on load (desktop:startup) so a push sent before it listened is not lost.
 * @typedef {{phase:'connecting'|'install'|'installing'|'error'|'choose', message:string,
 *   offers:('retry'|'install'|'choose')[], choices?:{token:string, label:string, current:boolean}[]}} Screen
 */
let screen = { phase: 'connecting', message: 'Connecting to your service…', offers: [] };
function show(next) {
  screen = next;
  if (window && !window.isDestroyed()) window.webContents.send('desktop:connection', next);
}
const offers = (...names) => names.filter(n => n !== 'choose' || offersWsl);
// One attempt per backend at a time: a Retry or a second pick of the same
// hub joins the one in flight; a pick of another hub starts at once, beside
// a stuck one (a cold or broken distro takes a minute to give up). An
// attempt acts only while its hub is still the chosen one and no chooser is up.
const attempts = new Map();
let choosing = false, installing = null, offered = new Set();
const chosen = b => !choosing && showBackend(b) === showBackend(backend);
function connect(ses) {
  const token = showBackend(backend);
  if (!attempts.has(token)) attempts.set(token, attempt(ses, backend).finally(() => attempts.delete(token)));
  return attempts.get(token);
}
async function attempt(ses, target) {
  try {
    let next = nativeService, browse;
    if (target.kind === 'wsl') {
      if (chosen(target)) show({ phase: 'connecting', message: `Starting ${target.distro}…`, offers: [] });
      const hub = await wsl.wslHub({ distro: target.distro, paths: wsl.wslPaths(process.env, isolated) });
      next = new Service({ home: hub.home, host: hub.host }); browse = hub.browse;
      if (chosen(target)) show({ phase: 'connecting', message: 'Connecting to your service…', offers: [] });
    }
    const found = await next.start();
    if (!chosen(target)) return;
    service = next; dialogStart = browse; connection = found; origin = found.origin; serviceReadyAtMs = Date.now();
    // Credential material stays in main and the service's HttpOnly cookie.
    const response = await ses.fetch(`${origin}/auth/pair`, { method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${await service.token()}` }, redirect: 'error' });
    if (!response.ok) throw new Error('Could not authenticate with the service');
    if (!chosen(target)) return;
    if (!quitting && window && !window.isDestroyed()) await window.loadURL(origin);
    // The in-app browser starts only after the UI is up and never holds it:
    // a hub that does not serve it (started by systemd, --headless or an
    // older install), or one that never answers, leaves the browser
    // unavailable with Reconnect (desktop:browser-reconnect) and nothing else.
    if(directBrowser)void connectBrowser(ses).catch(()=>{});
  } catch (error) {
    if (!chosen(target)) return;
    if (error.code === 'ERR_HUB_NOT_INSTALLED') show({ phase: 'install', message: error.message, offers: offers('install', 'choose') });
    else show({ phase: 'error', message: error.message, offers: offers('retry', 'choose') });
  }
}
// The chooser, on the startup screen: the hub's page goes, and only now is
// WSL asked for its distros (listing earlier can make Windows offer to
// install WSL). The current hub is one of the choices: picking it is the way back.
async function choose() {
  choosing = true;
  desktopBrowser?.close(); desktopBrowser = null; origin = undefined; connection = undefined;
  if (window.webContents.getURL() !== startupURL) await window.loadFile(startupPath);
  show({ phase: 'choose', message: 'Finding WSL distros…', offers: [], choices: [] });
  const distros = await wsl.listDistros();
  if (!choosing) return;
  const choices = choicesFor(backend, distros);
  offered = new Set(choices.map(c => c.token));
  show({ phase: 'choose', message: distros.length ? 'Where should this app’s hub run?'
    : 'Where should this app’s hub run? There is no WSL distro on this PC (wsl --install adds one).', offers: [], choices });
}
// a pick from the chooser on screen; a token it did not offer is refused
function useBackend(ses, token) {
  const next = offered.has(token) ? parseBackend(token) : null;
  if (!next) throw new Error('Not a choice on screen');
  offered = new Set(); choosing = false;
  if (showBackend(next) !== showBackend(backend)) { writeBackend(backendFile, next); backend = next; }
  show({ phase: 'connecting', message: 'Connecting to your service…', offers: [] });
  return connect(ses);
}
// Install in the chosen distro, then connect; a second press joins the one running.
function installHub(ses) {
  if (backend.kind !== 'wsl') throw new Error('Install is only for a hub in WSL');
  if (installing) return installing;
  const target = backend, says = `Installing Backplane in ${target.distro}…`;
  show({ phase: 'installing', message: says, offers: [] });
  installing = (async () => wsl.install({ distro: target.distro, paths: wsl.wslPaths(process.env, isolated), version: app.getVersion(),
    onLine: line => { if (chosen(target)) show({ phase: 'installing', message: `${says} ${line}`, offers: [] }); } }))()
    .then(() => { if (chosen(target)) return connect(ses); },
      error => { if (chosen(target)) show({ phase: 'install', message: `Install failed: ${error.message}`, offers: offers('install', 'choose') }); })
    .finally(() => { installing = null; });
  return installing;
}
// one attempt at a time: the start after load and a Reconnect share it
let browserStarting=null;
function connectBrowser(ses,reconnect=false){
  browserStarting??=startBrowser(ses,reconnect).finally(()=>{browserStarting=null;});
  return browserStarting;
}
async function startBrowser(ses,reconnect){
  if(desktopBrowser&&!desktopBrowser.isClosed())return;
  const browserWindow=window,selectedConnection=connection;
  // A user-requested fresh controller binds to the currently authenticated
  // service version at this same selected origin. Never replay a prior call.
  const browserConnection=reconnect?await service.discover({browserReconnectOrigin:selectedConnection.origin}):selectedConnection;
  if(!browserConnection)throw new Error('Selected Browser service unavailable');
  const guestPath=path.join(__dirname,'browser-guest.cjs'),preloadPath=path.join(__dirname,'browser-recording-preload.cjs');
  const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const config=build.desktopBrowser||{};
  const token=await service.token();
  if(quitting||window!==browserWindow||browserWindow.isDestroyed()||connection!==selectedConnection||origin!==browserConnection.origin)return;
  const controller=createDesktopBrowserController({electron,window:browserWindow,appSession:ses,origin:browserConnection.origin,version:browserConnection.version,token,
    guestManagerSha256:config.guestManagerSha256||hash(guestPath),
    recorder:{preloadPath,preloadSha256:config.preloadSha256||hash(preloadPath),recorderSourceSha256:'2e4b03765cc4ae6595e32048555ffe27e750994a85c18b89027064f3c0c15350',subframePreload:true,popupPreloadVerified:false},
    unknownState:browserUnknown,executeCall:createBrowserActions(),
    onState:value=>{if(window===browserWindow&&!browserWindow.isDestroyed())browserWindow.webContents.send('desktop:browser-state',value);},
    onTakeover:value=>{if(window===browserWindow&&!browserWindow.isDestroyed())browserWindow.webContents.send('desktop:browser-takeover',value);}});
  desktopBrowser=controller;
  await controller.start();
  if(window!==browserWindow||browserWindow.isDestroyed())controller.close();
}
function start() {
  const ses = session.fromPartition('persist:backplane-ui');
  const permitted = (wc, permission, url) => {
    try { return wc === window?.webContents && origin && new URL(url).origin === origin && ['notifications', 'clipboard-sanitized-write'].includes(permission); } catch { return false; }
  };
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(permitted(wc, permission, details.requestingUrl)));
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => permitted(wc, permission, requestingOrigin));
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (new URL(details.url).origin !== origin) return callback({});
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'; worker-src 'self' blob:"] } });
  });
  ipcMain.handle('desktop:version', event => {
    if (!trusted(event)) throw new Error('Invalid sender');
    return { electron: process.versions.electron, service: connection.version, launchedAtMs, firstVisibleAtMs, serviceReadyAtMs };
  });
  const fromStartup = event => senderIsWindow(event) && event.senderFrame.url === startupURL;
  ipcMain.handle('desktop:retry', event => {
    if (!fromStartup(event)) throw new Error('Invalid sender');
    void connect(ses); return true;
  });
  // what the Settings row calls the hub; '' outside the Windows app (no row)
  ipcMain.on('desktop:hub-now', event => {
    event.returnValue = offersWsl && (fromStartup(event) || trusted(event)) ? labelBackend(backend) : '';
  });
  ipcMain.handle('desktop:startup', event => { if (!fromStartup(event)) throw new Error('Invalid sender'); return screen; });
  ipcMain.handle('desktop:choose-backend', event => {
    if (!offersWsl || !(fromStartup(event) || trusted(event))) throw new Error('Invalid sender');
    void choose(); return true;
  });
  ipcMain.handle('desktop:use-backend', (event, token) => {
    if (!fromStartup(event) || typeof token !== 'string') throw new Error('Invalid sender');
    void useBackend(ses, token); return true;
  });
  ipcMain.handle('desktop:install', event => { if (!fromStartup(event)) throw new Error('Invalid sender'); void installHub(ses); return true; });
  // a hub in WSL: the dialog starts in the distro user's home (\\wsl.localhost\<distro>\home\<user>)
  ipcMain.handle('desktop:choose-folder', async event => {
    if (!trusted(event)) throw new Error('Invalid sender');
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], ...(dialogStart ? { defaultPath: dialogStart } : {}) });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('desktop:browser-present',(event,value)=>{
    if(!trusted(event)||!directBrowser)throw new Error('Invalid Browser sender');
    exactObject(value,['owner','bounds']);exactObject(value.bounds,['x','y','width','height']);
    if(typeof value.owner!=='string'||!value.owner.length||value.owner.length>512||/[\x00-\x1f]/.test(value.owner))throw new Error('Invalid Browser owner');
    if(Object.values(value.bounds).some(v=>!Number.isFinite(v)||Math.abs(v)>1000000)||value.bounds.width<1||value.bounds.height<1)throw new Error('Invalid Browser geometry');
    const zoom=window.webContents.getZoomFactor(),box=window.getContentBounds();
    const x=Math.max(0,Math.min(box.width,Math.round(value.bounds.x*zoom))),y=Math.max(0,Math.min(box.height,Math.round(value.bounds.y*zoom)));
    const width=Math.min(box.width-x,Math.round(value.bounds.width*zoom)),height=Math.min(box.height-y,Math.round(value.bounds.height*zoom));
    if(!desktopBrowser||desktopBrowser.isClosed())return{shown:false,phase:'error',message:'Browser unavailable'};
    if(width<1||height<1){desktopBrowser.hide();return{shown:false,message:'Browser panel is hidden'};}
    return desktopBrowser.present({owner:value.owner,bounds:{x,y,width,height}}).then(result=>({shown:result.shown===true,...(result.message?{message:result.message}:{}),...(result.phase?{phase:result.phase}:{})}));
  });
  ipcMain.handle('desktop:browser-hide',event=>{if(!trusted(event)||!directBrowser)throw new Error('Invalid Browser sender');desktopBrowser?.hide();return true;});
  // Reloaded renderers subscribe after main may already have become ready or
  // failed. Query the current state instead of depending on a one-shot event.
  ipcMain.handle('desktop:browser-state',event=>{if(!trusted(event)||!directBrowser)throw new Error('Invalid Browser sender');return desktopBrowser?.state()??{phase:'connecting',message:'Connecting Browser…'};});
  ipcMain.handle('desktop:browser-reconnect',async event=>{if(!trusted(event)||!directBrowser)throw new Error('Invalid Browser sender');await connectBrowser(ses,true);return desktopBrowser?.state()??{phase:'error',message:'Browser unavailable'};});
  Menu.setApplicationMenu(applicationMenu(Menu, process.platform, offersWsl ? () => void choose() : null));
  app.setAppUserModelId?.('works.backplane.desktop');
  if (process.platform === 'darwin') app.dock?.setIcon(iconPath());
  void createWindow(ses).then(() => connect(ses)); // Show before any service/history work.
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void createWindow(ses).then(() => connect(ses)); });
}
function createWindow(ses) {
  window = new BrowserWindow({ width: 1400, height: 940, minWidth: 360, minHeight: 480, title: 'Backplane', icon: iconPath(), backgroundColor: themeBackground(), show: false,
    webPreferences: { session: ses, preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, spellcheck: true,additionalArguments:rendererBrowser?['--backplane-direct-browser=1']:[] } });
  window.webContents.on('console-message', (details, _level, legacyMessage) => {
    // Only our main frame, fixed-prefix and schema-sanitized records reach disk.
    if (!details.frame || details.frame === window.webContents.mainFrame) connectionLog.capture(details.message ?? legacyMessage);
  });
  window.setMenuBarVisibility(false);
  installShortcuts(window, electron, () => directBrowser ? desktopBrowser : null, process.platform, () => terminalFocused, offersWsl ? () => void choose() : null);
  window.webContents.on('did-start-navigation', () => { terminalFocused = false; });
  window.webContents.on('blur', () => { terminalFocused = false; });
  const shown = new Promise(resolve => window.once('ready-to-show', () => { firstVisibleAtMs ??= Date.now(); window.show(); resolve(); }));
  window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (url !== startupURL && new URL(url).origin !== origin) { event.preventDefault(); external(url); } });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  let closingWindow = false;
  window.on('close', () => { connectionLog.record({event:'window-close',cause:quitting?'app-quit':'window-close'});closingWindow = true;desktopBrowser?.close();desktopBrowser=null; });
  window.webContents.on('render-process-gone', (_event, details) => {connectionLog.record({event:'renderer-gone',cause:'renderer',rendererReason:details.reason,exitCode:details.exitCode});desktopBrowser?.hide();if (!quitting && !closingWindow && details.reason !== 'clean-exit' && !window.isDestroyed()) { void window.loadFile(startupPath).then(() => connect(ses)); } });
  void window.loadFile(startupPath);
  return shown;
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { connectionLog.record({event:'app-quit',cause:'app-quit'});quitting = true; });
// The Bend service belongs to the product, independently of UI windows. Closing,
// reloading, or crashing the renderer must not terminate agents, mail or jobs.
// Explicit service shutdown is a separate service-owned authenticated contract.
