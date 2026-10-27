'use strict';
// A cold desktop window paints the theme the hub's page last painted: main
// keeps one word per home profile, takes it only from the current trusted
// window, and seeds the window, the startup page and the page's first frame.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const source=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');

// main.cjs's own block, run against a fake window, IPC and profile folder
function main(kept){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bp-theme-hint-'));if(kept!==undefined)fs.writeFileSync(path.join(dir,'theme'),kept);
 const s=source('main.cjs'),a=s.indexOf('const themeFile = '),b=s.indexOf("ipcMain.on('desktop:terminal-focus'",a);assert(a>0&&b>a);
 const handlers={},colours=[],startupURL='file:///app/startup.html';
 const frame={url:'https://127.0.0.1:4000/'},wc={mainFrame:frame};
 const ctx={path,fs,startupURL,origin:'https://127.0.0.1:4000',app:{getPath:k=>{assert.equal(k,'userData');return dir;}},
  ipcMain:{on:(n,f)=>handlers[n]=f},window:{webContents:wc,setBackgroundColor:c=>colours.push(c)}};
 ctx.senderIsWindow=e=>ctx.window&&e.sender===ctx.window.webContents&&e.senderFrame===ctx.window.webContents.mainFrame;
 ctx.trusted=e=>{try{return ctx.senderIsWindow(e)&&ctx.origin&&new URL(e.senderFrame.url).origin===ctx.origin;}catch{return false;}};
 vm.createContext(ctx);vm.runInContext(s.slice(a,b)+'\nthis.bg=themeBackground;this.now=()=>theme;',ctx);
 const ev=(over={})=>({sender:wc,senderFrame:frame,...over});
 const now=e=>{const x={...e};handlers['desktop:theme-now'](x);return x.returnValue;};
 return{ctx,handlers,colours,dir,ev,now,frame,wc,file:()=>{try{return fs.readFileSync(path.join(dir,'theme'),'utf8');}catch{return null;}}};
}
test('the kept word is read strictly: only an exact "light" is light, anything else or nothing is dark',()=>{
 for(const [kept,want] of [['light','light'],['dark','dark'],[undefined,'dark'],['','dark'],['light\n','dark'],['Light','dark'],['system','dark'],['{"theme":"light"}','dark']]){
  const m=main(kept);assert.equal(m.ctx.now(),want,String(kept));assert.equal(m.ctx.bg(),want==='light'?'#fafaf8':'#111410');
 }
});
test('the window is created on the kept background, not a fixed dark one',()=>{
 const s=source('main.cjs');assert.match(s,/backgroundColor: themeBackground\(\), show: false,/);assert(!/backgroundColor: '#111410'/.test(s));
 // the theme is known before any window is made
 assert(s.indexOf('const themeFile = ')<s.indexOf('function createWindow('));
});
test('only the current trusted window may set it, only to light or dark, and it is kept as that one word',()=>{
 const m=main();const set=(v,e=m.ev())=>m.handlers['desktop:theme'](e,v);
 for(const bad of ['Light','system','',null,undefined,1,{theme:'light'},['light'],'light; token=1','x'.repeat(4096)])set(bad);
 set('light',m.ev({sender:{mainFrame:m.frame}}));                              // a stale or other window
 set('light',m.ev({senderFrame:{url:'https://127.0.0.1:4000/'}}));             // a subframe
 set('light',m.ev({senderFrame:Object.assign(m.frame,{url:'https://evil.example/'})}));m.frame.url='https://127.0.0.1:4000/';
 set('light',m.ev({senderFrame:{...m.frame,url:'file:///app/startup.html'}}));  // the startup page reads, never writes
 m.ctx.origin='https://127.0.0.1:4001';set('light');m.ctx.origin='https://127.0.0.1:4000'; // a page from a previous service
 assert.equal(m.ctx.now(),'dark');assert.deepEqual(m.colours,[]);assert.equal(m.file(),null);
 set('light');assert.equal(m.ctx.now(),'light');assert.deepEqual(m.colours,['#fafaf8']);assert.equal(m.file(),'light');
 set('light');assert.deepEqual(m.colours,['#fafaf8']);                         // the same word again does nothing
 set('dark');assert.equal(m.file(),'dark');assert.deepEqual(m.colours,['#fafaf8','#111410']);
 assert.deepEqual(fs.readdirSync(m.dir).sort(),['theme']);                     // no temporary left, nothing else written
 // a fresh start of main on that profile reads what was kept
 assert.equal(main('dark').ctx.now(),'dark');const again=main(m.file());assert.equal(again.ctx.now(),'dark');
});
test('the word is answered to the startup page and the trusted page of the current window, and to nothing else',()=>{
 const m=main('light');
 assert.equal(m.now(m.ev()),'light');
 const startup={url:'file:///app/startup.html'};m.wc.mainFrame=startup;assert.equal(m.now(m.ev({senderFrame:startup})),'light');m.wc.mainFrame=m.frame;
 assert.equal(m.now(m.ev({sender:{mainFrame:m.frame}})),'dark');
 assert.equal(m.now(m.ev({senderFrame:{url:'https://127.0.0.1:4000/'}})),'dark');
 m.frame.url='https://evil.example/';assert.equal(m.now(m.ev()),'dark');
});

// preload.cjs: the class is on <html> before any page script or paint
function preload({word,early}){
 const sent=[],syncs=[],exposed={},classes=new Set();let html=early?{classList:{toggle:(c,on)=>on?classes.add(c):classes.delete(c)}}:null,observer=null;
 const document={get documentElement(){return html;}};
 class MutationObserver{constructor(f){this.f=f;observer=this;}observe(t,o){assert.equal(t,document);assert.deepEqual(Object.keys(o),['childList']);assert.equal(o.childList,true);}disconnect(){this.off=true;}}
 const electron={contextBridge:{exposeInMainWorld:(k,v)=>exposed[k]=v},ipcRenderer:{sendSync:n=>{syncs.push(n);return word;},send:(n,v)=>sent.push([n,v]),invoke(){},on(){},removeListener(){}}};
 const ctx={require:m=>{assert.equal(m,'electron');return electron;},process:{argv:[]},document,MutationObserver,TypeError,Object,String};
 vm.createContext(ctx);vm.runInContext(source('preload.cjs'),ctx);
 const parse=()=>{html={classList:{toggle:(c,on)=>on?classes.add(c):classes.delete(c)}};observer?.f([],observer);};
 return{api:exposed.backplaneDesktop,classes,sent,syncs,parse,observer:()=>observer};
}
test('preload paints the kept theme on <html> at once, or as soon as <html> exists',()=>{
 const a=preload({word:'light',early:true});assert(a.classes.has('light'));assert.equal(a.api.theme,'light');assert.deepEqual(a.syncs,['desktop:theme-now','desktop:hub-now']);
 const b=preload({word:'light',early:false});assert(!b.classes.has('light'));b.parse();assert(b.classes.has('light'));assert(b.observer().off);
 for(const word of ['dark','system',undefined,'LIGHT']){const c=preload({word,early:true});assert(!c.classes.has('light'));assert.equal(c.api.theme,'dark');}
});
test('preload passes on only light or dark',()=>{
 const p=preload({word:'dark',early:true});for(const v of ['light','dark','system','',null,{},'light '])p.api.themeSeen(v);
 assert.deepEqual(p.sent,[['desktop:theme','light'],['desktop:theme','dark']]);
});
test('the startup page has a light face for the kept light theme',()=>{
 const css=source('startup.css');assert.match(css,/:root\.light\{color-scheme:light;background:#fafaf8;color:#1b1d21\}/);
 // and its dark face is unchanged
 assert.match(css,/^:root\{color-scheme:dark;background:#111410;color:#d9dde4;/);
});
