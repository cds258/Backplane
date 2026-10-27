// Focused native library acceptance; no hub build, canonical board or GUI UI.
// bun test/tools/kicad_library_real.ts HEADER RUNTIME NEW_EVIDENCE_DIR
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
const [header,runtimeArg,outArg]=process.argv.slice(2);
assert(header&&runtimeArg&&outArg,'HEADER RUNTIME NEW_EVIDENCE_DIR required');
const runtime=path.resolve(runtimeArg),out=path.resolve(outArg),cli=path.join(runtime,'bin/kicad-cli');
assert(!fs.existsSync(out),'evidence output must be new');fs.mkdirSync(out,{recursive:true});
const home=path.join(out,'home'),custom=path.join(out,'custom-config'),project=path.join(out,'project');
fs.mkdirSync(path.join(custom,'10.99'),{recursive:true});fs.mkdirSync(project);
const customText='(fp_lib_table\n (lib (name "UserCustom")(type "KiCad")(uri "${KICAD_CONFIG_HOME}/my.pretty")(options "")(descr "keep me"))\n)\n';
fs.writeFileSync(path.join(custom,'10.99/fp-lib-table'),customText);
fs.writeFileSync(path.join(project,'fp-lib-table'),'(fp_lib_table (lib (name "ProjectCustom")(type "KiCad")(uri "${KIPRJMOD}/custom.pretty")(options "")(descr "")))\n');
fs.mkdirSync(path.join(project,'custom.pretty'));fs.writeFileSync(path.join(project,'test.kicad_pro'),'{}\n');
const projectTable=fs.readFileSync(path.join(project,'fp-lib-table'),'utf8');
new Function(fs.readFileSync(header,'utf8'))();
const effect=fs.readFileSync('src/server/effects/kicad_library.js','utf8').replace(/CID\(([A-Za-z0-9_.]+)\)/g,'"$1"');
const prepare=new Function('io_eff','require',effect+';return bp_kl_prepare;')(()=>{},require);
const start=performance.now();assert.equal(prepare(runtime,home,custom),'');const coldMs=performance.now()-start;
const library=process.env.BACKPLANE_KICAD_LIBRARY!,config=process.env.KICAD_CONFIG_HOME!;
fs.mkdirSync(path.join(custom,'my.pretty'));
const customFootprint=fs.readFileSync(path.join(library,'libraries/Backplane_Passives_Nominal.pretty/R_0402_1005Metric.kicad_mod'));
fs.writeFileSync(path.join(custom,'my.pretty/CustomPart.kicad_mod'),customFootprint);
fs.writeFileSync(path.join(project,'custom.pretty/ProjectPart.kicad_mod'),customFootprint);
const started=performance.now();assert.equal(prepare(runtime,home,custom),'');const warmMs=performance.now()-started;
const env={...process.env,HOME:home,BACKPLANE_HOME:home,KICAD_CONFIG_HOME:config,BACKPLANE_KICAD_LIBRARY:library,DISPLAY:'',WAYLAND_DISPLAY:''};
const logs:Record<string,string>={};
function run(name:string,args:string[],extra:Record<string,string>={}) {
  const r=spawnSync(cli,args,{env:{...env,...extra},encoding:'utf8',timeout:30000});
  const text=r.stdout+r.stderr;fs.writeFileSync(path.join(out,name+'.log'),text);logs[name]=text;
  assert.equal(r.status,0,text);return text;
}
run('version',['--version']);
// Native fixture assembled from the installed, hash-checked footprint. This
// is test data in a disposable directory, never a user's active board.
let fp=fs.readFileSync(path.join(library,'libraries/Backplane_Passives_Nominal.pretty/R_0402_1005Metric.kicad_mod'),'utf8');
fp=fp.replace('(footprint "R_0402_1005Metric"','(footprint "Backplane_Passives_Nominal:R_0402_1005Metric"')
  .replace(/\s*\(version [^)]+\)/,'').replace(/\s*\(generator "[^"]+"\)/,'')
  .replace('(layer "F.Cu")','(layer "F.Cu") (uuid "'+randomUUID()+'") (transform (translate 10 10) (rotate 0) (scale 1 1))')
  .replace('"Reference" "REF**"','"Reference" "R1"');
const board=path.join(project,'test.kicad_pcb');
fs.writeFileSync(board,'(kicad_pcb (version 20260901) (generator "pcbnew") (general (thickness 1.6)) (paper "A4")\n'
  +'(layers (0 "F.Cu" signal) (2 "B.Cu" signal) (13 "F.Paste" user) (5 "F.SilkS" user) (1 "F.Mask" user) (3 "B.Mask" user) (25 "Edge.Cuts" user) (31 "F.CrtYd" user) (35 "F.Fab" user))\n'
  +'(gr_rect (start 0 0) (end 20 20) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts") (uuid "'+randomUUID()+'"))\n'+fp+'\n)\n');
const step=path.join(out,'cli.step');run('cli-step',['pcb','export','step','--force','--output',step,board]);
assert(!/could not|not found|missing|unable to|error:/i.test(logs['cli-step']),logs['cli-step']);
assert(fs.readFileSync(step,'utf8').includes('R_0402_1005Metric'),'CLI STEP must contain passive product, not only the board');
// Negative control proves that exit 0 alone does not validate inclusion.
const missing=path.join(out,'missing.step');run('missing-model-control',['pcb','export','step','--force','--output',missing,board],{BACKPLANE_KICAD_LIBRARY:path.join(out,'does-not-exist')});
assert(!fs.readFileSync(missing,'utf8').includes('R_0402_1005Metric'),'control unexpectedly found the passive model');
const helperEnv={...env};delete (helperEnv as any).BACKPLANE_KICAD_LIBRARY;delete (helperEnv as any).KICAD_CONFIG_HOME;
const helper=spawn(process.execPath,['tools/kipc/src/main.ts'],{env:helperEnv,stdio:['pipe','pipe','pipe']});
let stderr='',seq=0;const events:any[]=[],pending=new Map<number,{resolve:(v:any)=>void,reject:(e:any)=>void,timer:any}>();
let readyResolve:(v:string)=>void,readyReject:(e:any)=>void;
const ready=new Promise<string>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
const readyTimer=setTimeout(()=>readyReject(new Error('IPC server ready timeout')),20000);
helper.stderr!.on('data',b=>stderr+=b);
createInterface({input:helper.stdout!}).on('line',line=>{
  const o=JSON.parse(line);events.push(o);
  if(o.event==='line'&&o.text.startsWith('KiCad API server listening at ')){clearTimeout(readyTimer);readyResolve(o.text.slice('KiCad API server listening at '.length));}
  const p=pending.get(o.id);if(p){pending.delete(o.id);clearTimeout(p.timer);o.ok?p.resolve(o):p.reject(new Error(JSON.stringify(o)));}
});
function ask(message:any):Promise<any>{const id=++seq;return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('helper request timeout '+JSON.stringify(message)));},20000);
  pending.set(id,{resolve,reject,timer});helper.stdin!.write(JSON.stringify({...message,id})+'\n');
});}
let sock='';
const sockets=fs.mkdtempSync(path.join(tmpdir(),'bp-kl-'));
const ipc=(type:string,message:any={})=>ask({sock,type,message,lib:path.join(runtime,'lib'),desc:path.join(runtime,'share/backplane/api.desc')});
try {
  const socket=path.join(sockets,'api.sock');
  await ask({op:'spawn',key:'library-smoke',argv:[cli,'api-server',path.join(project,'test.kicad_pro'),'--socket',socket,'--parent-pid',String(process.pid),'--idle-exit','20'],env:{BACKPLANE_KICAD_LIBRARY:library,KICAD_CONFIG_HOME:config}});
  sock=await ready;
  const caps=await ipc('kiapi.backplane.GetCapabilities');fs.writeFileSync(path.join(out,'capabilities.json'),JSON.stringify(caps,null,2));
  const C='kiapi.common.commands.';
  const doc=(await ipc(C+'OpenDocument',{type:'DOCTYPE_PCB',path:board})).message.document;
  const table=await ipc(C+'GetLibraryStatuses',{types:['LT_FOOTPRINT'],scope:'LTS_GLOBAL'});
  assert.equal(table.message.libraries.filter((r:any)=>(globalThis as any).BACKPLANE_KICAD_BUNDLE.pin.library_nicknames.includes(r.entry.nickname)).length,5);
  assert(table.message.libraries.some((r:any)=>r.entry.nickname==='UserCustom'));
  const customItems=await ipc(C+'GetLibraryItems',{type:'LT_FOOTPRINT',nickname:['UserCustom','ProjectCustom']});
  assert.equal(customItems.message.items.length,2,'both custom config-root and project-relative libraries remain usable');
  const items=await ipc(C+'GetLibraryItems',{type:'LT_FOOTPRINT',nickname:(globalThis as any).BACKPLANE_KICAD_BUNDLE.pin.library_nicknames});
  assert.equal(items.message.items.length,199);
  const chosen=items.message.items.filter((x:any)=>x.library_nickname==='Backplane_MountingHole').slice(0,1)
    .concat(items.message.items.filter((x:any)=>x.library_nickname==='Backplane_Shoggoth'))
    .concat(items.message.items.filter((x:any)=>x.entry_name==='R_0402_1005Metric'));
  assert.equal(chosen.length,10); // one hole, six artwork variants, three densities
  const loaded=await ipc(C+'GetItemsFromLibrary',{type:'LT_FOOTPRINT',document:doc,item_ids:chosen});
  fs.writeFileSync(path.join(out,'loaded-samples.json'),JSON.stringify(loaded,null,2));
  assert.equal(loaded.message.status,'IRS_OK');assert.equal(loaded.message.items.length,10);
  assert(!/not found|error|invalid/i.test(JSON.stringify(loaded)),JSON.stringify(loaded).slice(0,500));
  const ipcStep=path.join(out,'ipc.step');
  const exported=await ipc('kiapi.board.jobs.RunBoardJobExport3D',{job_settings:{document:doc,output_path:ipcStep},format:'B3D_STEP',overwrite:true,include_unspecified:true,include_dnp:true,export_board_body:true,export_components:true,optimize_step:true,board_outlines_chaining_epsilon:0.01});
  fs.writeFileSync(path.join(out,'ipc-export.json'),JSON.stringify(exported,null,2));
  assert.equal(exported.message.status,'JS_SUCCESS',JSON.stringify(exported));
  assert(fs.readFileSync(ipcStep,'utf8').includes('R_0402_1005Metric'),'IPC STEP must include the passive model');
  // Both source tables must retain every byte after native CLI/IPC use.
  assert.equal(fs.readFileSync(path.join(custom,'10.99/fp-lib-table'),'utf8'),customText);
  assert.equal(fs.readFileSync(path.join(project,'fp-lib-table'),'utf8'),projectTable);
  const sha=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const result={state:'passed',platform:process.platform,libraryPin:(globalThis as any).BACKPLANE_KICAD_BUNDLE.pin,coldMs,warmMs,cliVersion:logs.version.trim(),cliModelPresent:true,missingModelControlExcluded:true,ipcModelPresent:true,ipcLibraries:5,ipcFootprints:199,smokeSamples:chosen,sourceTablesPreserved:true,helperStartedWithoutLibraryEnv:true,cliStepSha256:sha(step),ipcStepSha256:sha(ipcStep),coverage:'Native Linux CLI + IPC through actual helper source; GUI/agent process inheritance unit-probed. Full compiled service/native package gate remains coordinator-owned.'};
  fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally {
  clearTimeout(readyTimer);
  if(sock)try{await ipc('kiapi.backplane.Shutdown');}catch{}
  helper.stdin!.end();helper.kill();
  fs.writeFileSync(path.join(out,'helper-events.json'),JSON.stringify(events,null,2));fs.writeFileSync(path.join(out,'helper-stderr.log'),stderr);
  fs.rmSync(sockets,{recursive:true,force:true});
}
