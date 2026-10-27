const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {applicationMenu,installShortcuts}=require('../window.cjs');
test('Linux has no application menu, Windows only Change hub…; macOS keeps only its Backplane system menu',()=>{
  const Menu={buildFromTemplate:x=>x};assert.equal(applicationMenu(Menu,'linux',()=>{}),null);assert.equal(applicationMenu(Menu,'win32'),null);
  assert.deepEqual(applicationMenu(Menu,'darwin').map(x=>x.label),['Backplane']);
  let changed=0;const win=applicationMenu(Menu,'win32',()=>changed++);const item=win[0].submenu[0];
  assert.deepEqual([win.length,win[0].submenu.length,item.label,item.accelerator],[1,1,'Change hub…','Ctrl+Shift+H']);item.click();assert.equal(changed,1);
});
test('Ctrl+Shift+H opens the chooser of hubs where there is one, and nowhere else',()=>{
  const press=changeHub=>{let handler,prevented=0;const contents={on:(_e,f)=>handler=f};
    installShortcuts({webContents:contents},{webContents:{getFocusedWebContents:()=>contents},app:{}},undefined,'win32',()=>false,changeHub);
    handler({preventDefault(){prevented++;}},{type:'keyDown',key:'H',control:true,shift:true});return prevented;};
  let changed=0;assert.equal(press(()=>changed++),1);assert.equal(changed,1);assert.equal(press(null),0);
});
test('local window shortcuts preserve editing, zoom, reload and window controls',()=>{
  let handler,prevented=0,zoom=0,full=false;const calls=[];
  const contents={on:(_e,f)=>handler=f,copy:()=>calls.push('copy'),paste:()=>calls.push('paste'),reload:()=>calls.push('reload'),reloadIgnoringCache:()=>calls.push('reload-no-cache'),getZoomLevel:()=>zoom,setZoomLevel:v=>zoom=v};
  const win={webContents:contents,isFullScreen:()=>full,setFullScreen:v=>full=v,close:()=>calls.push('close')};
  installShortcuts(win,{webContents:{getFocusedWebContents:()=>contents},app:{quit:()=>calls.push('quit')}},undefined,'linux');
  const press=(key,extra={})=>handler({preventDefault(){prevented++;}},{type:'keyDown',key,control:true,...extra});
  press('c');press('v');press('r');press('r',{shift:true});press('+');assert.equal(zoom,.5);press('0');assert.equal(zoom,0);press('F11',{control:false});assert(full);press('w');press('q');
  assert.deepEqual(calls,['copy','paste','reload','reload-no-cache','close','quit']);const before=prevented;press('v',{isComposing:true});assert.equal(prevented,before);
});
test('shortcuts still work in this window\'s Browser guest and ignore other windows',()=>{
  let created;const listeners=new Map(),calls=[];
  const root={on:(_e,f)=>listeners.set('root',f),focus(){calls.push('focus');},send(){calls.push('address');}};
  const win={webContents:root};const app={on:(_e,f)=>created=f};
  installShortcuts(win,{app,webContents:{getFocusedWebContents:()=>guest}},()=>({edit:x=>calls.push(x)}),'linux');
  const guest={on:(_e,f)=>listeners.set('guest',f),getOwnerBrowserWindow:()=>win};created({},guest);
  listeners.get('guest')({preventDefault(){}},{type:'keyDown',key:'l',control:true});
  listeners.get('guest')({preventDefault(){}},{type:'keyDown',key:'c',control:true});
  assert.deepEqual(calls,['focus','address','copy']);
  const other={on:(_e,f)=>listeners.set('other',f),getOwnerBrowserWindow:()=>({})};created({},other);
  listeners.get('other')({preventDefault(){assert.fail('unrelated window intercepted');}},{type:'keyDown',key:'l',control:true});
});
test('packaged icon formats contain the established Backplane artwork',()=>{
  const {png,ico,icns,iconPath}=require('../branding.cjs');assert.equal(iconPath('win32'),ico);
  assert.deepEqual(fs.readFileSync(png),fs.readFileSync(path.join(__dirname,'../../assets/icon/backplane-desktop-512.png')));
  const windows=fs.readFileSync(ico),mac=fs.readFileSync(icns);assert.equal(windows.readUInt16LE(2),1);assert.equal(mac.subarray(0,4).toString(),'icns');assert.equal(mac.readUInt32BE(4),mac.length);
  const {appFiles}=require('../prepare-components.cjs');const files=appFiles(path.join(__dirname,'..'));for(const f of ['window.cjs','branding.cjs','backplane.png','backplane.ico','backplane.icns'])assert(files.includes(f),f);
});
test('warm switching is synchronous and bounded, and cannot cross target, epoch, language, identity or bot tab',async()=>{
  const {ViewTransition}=await import('../../src/web/view-transition.js');const cache=new ViewTransition({limit:2,bytes:1000});
  const scope={origin:'https://test',identity:'private',language:'en',epoch:'actual',selected:'bub-thread',target:{kind:'bot',id:'bub'},route:{bot:'bub',tab:'chat'}};
  const shown={type:'element',tag:'main',attrs:[{name:'data-thread',value:'bub-thread'}],kids:[{type:'element',tag:'form',attrs:[{name:'class',value:'composer'}],kids:[]}]};assert(cache.put(scope,shown));assert.equal(cache.get(scope),shown);
  for(const field of ['origin','identity','language','epoch','selected','target','route'])assert.equal(cache.get({...scope,[field]:field==='target'?{kind:'thread',id:'B'}:field==='route'?{bot:'bub',tab:'settings'}:'other'}),null,field);
  cache.savePosition(scope,{top:240,atEnd:false,anchor:'row',offset:8});assert.equal(cache.position(scope).top,240);
  cache.put({...scope,target:{kind:'bot',id:'A'}},shown);cache.put({...scope,target:{kind:'bot',id:'B'}},shown);assert.equal(cache.get(scope),null);assert.equal(cache.position(scope),null);assert.equal(cache.put(scope,{text:'x'.repeat(2000)}),false);cache.clear();assert.equal(cache.views.size,0);assert.equal(cache.put(scope,{type:'element',tag:'textarea',attrs:[{name:'data-bfield',value:'mrreply'}],kids:[]}),false);
});
test('cold transition retains the sidebar and only the new selection composer; no old messages',async()=>{
  const {loadingShell}=await import('../../src/web/view-transition.js');const el=(tag,key,attrs=[],kids=[])=>({type:'element',tag,key,attrs,kids});
  const aside=el('aside','sidebar',[],[{type:'text',text:'all projects'}]),composer=el('form','new-draft',[{name:'class',value:'composer'}],[{type:'text',text:'new target draft'}]);
  const old=el('div','app',[],[aside,el('main','thread',[],[{type:'text',text:'OLD PRIVATE THREAD'}])]);
  const fresh=el('div','app',[],[el('aside','sidebar'),el('main','thread',[],[composer])]);const shown=loadingShell(old,fresh,'New thread');
  assert.equal(shown.kids[0],aside);assert.equal(shown.kids[1].kids.at(-1),composer);assert(!JSON.stringify(shown).includes('OLD PRIVATE THREAD'));assert(JSON.stringify(shown).includes('New thread'));
});
