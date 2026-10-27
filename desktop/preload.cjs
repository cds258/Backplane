const { contextBridge, ipcRenderer } = require('electron');
// Only the selected desktop shell advertises native Browser support. The
// renderer gets geometry/intents and bounded UI events, never the private
// bearer, debugger, guest WebContents or service grants.
const listenBrowser = (channel, accept) => callback => {
  if (typeof callback !== 'function') throw new TypeError('Expected a callback');
  const listener = (_event, value) => { const safe = accept(value); if (safe) callback(safe); };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const owner = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value);
const browser = process.argv.includes('--backplane-direct-browser=1') ? Object.freeze({
  present: value => ipcRenderer.invoke('desktop:browser-present', value),
  hide: () => ipcRenderer.invoke('desktop:browser-hide'),
  reconnect: () => ipcRenderer.invoke('desktop:browser-reconnect'),
  state: () => ipcRenderer.invoke('desktop:browser-state'),
  onState: listenBrowser('desktop:browser-state', value => {
    if (!['connecting', 'ready', 'error'].includes(value?.phase)) return null;
    return {phase:value.phase, message:String(value.message || '').slice(0,240), ...(owner(value.owner)?{owner:value.owner}:{})};
  }),
  onTakeover: listenBrowser('desktop:browser-takeover', value => owner(value?.owner) ? {owner:value.owner} : null),
  onFocusAddress: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback');
    const listener = () => callback();
    ipcRenderer.on('desktop:browser-focus-address', listener);
    return () => ipcRenderer.removeListener('desktop:browser-focus-address', listener);
  },
}) : null;
// the theme main kept for this window, on <html> before anything paints
// (startup.css, style.css's html.light); the page tells main when it changes
const theme = ipcRenderer.sendSync('desktop:theme-now') === 'light' ? 'light' : 'dark';
const paintTheme = () => document.documentElement.classList.toggle('light', theme === 'light');
if (document.documentElement) paintTheme();
else new MutationObserver((_, seen) => { if (document.documentElement) { seen.disconnect();paintTheme(); } }).observe(document, {childList:true});
// What the Windows app calls its hub ("Windows", "WSL · Ubuntu"): main
// answers '' elsewhere, and then neither it nor chooseBackend exists, so
// the page names no hub and Settings has no Hub row.
const hub = String(ipcRenderer.sendSync('desktop:hub-now') || '').slice(0, 96);
// the startup screen (main.cjs's Screen), checked as it crosses
const phases = ['connecting', 'installing', 'install', 'error', 'choose'], named = ['retry', 'install', 'choose'];
const screen = s => phases.includes(s?.phase) && typeof s.message === 'string' ? {
  phase: s.phase, message: s.message.slice(0, 2000),
  offers: (Array.isArray(s.offers) ? s.offers : []).filter(n => named.includes(n)),
  choices: (Array.isArray(s.choices) ? s.choices : []).slice(0, 64).filter(c => typeof c?.token === 'string' && typeof c.label === 'string')
    .map(c => ({ token: c.token.slice(0, 80), label: c.label.slice(0, 96), current: c.current === true })),
} : null;
contextBridge.exposeInMainWorld('backplaneDesktop', Object.freeze({
  theme,
  themeSeen: value => { if (value === 'light' || value === 'dark') ipcRenderer.send('desktop:theme', value); },
  terminalFocus: active => ipcRenderer.send('desktop:terminal-focus', active === true),
  image: Object.freeze({
    local: source => ipcRenderer.invoke('desktop:image-local', source),
    copy: png => ipcRenderer.invoke('desktop:image-copy', png),
    reveal: source => ipcRenderer.invoke('desktop:image-reveal', source),
  }),
  ...(browser ? {browser} : {}),
  chooseFolder: () => ipcRenderer.invoke('desktop:choose-folder'),
  version: () => ipcRenderer.invoke('desktop:version'),
  retry: () => ipcRenderer.invoke('desktop:retry'),
  ...(hub ? { hub, chooseBackend: () => ipcRenderer.invoke('desktop:choose-backend') } : {}),
  startup: () => ipcRenderer.invoke('desktop:startup').then(screen),
  useBackend: token => ipcRenderer.invoke('desktop:use-backend', String(token)),
  install: () => ipcRenderer.invoke('desktop:install'),
  onFocusAddress: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback');
    const listener = () => callback();
    ipcRenderer.on('desktop:browser-focus-address', listener);
    return () => ipcRenderer.removeListener('desktop:browser-focus-address', listener);
  },
  onConnection: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback');
    const listener = (_event, data) => { const s = screen(data); if (s) callback(s); };
    ipcRenderer.on('desktop:connection', listener);
    return () => ipcRenderer.removeListener('desktop:connection', listener);
  },
}));
