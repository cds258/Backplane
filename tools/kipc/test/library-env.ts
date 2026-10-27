// A helper can outlive runtime selection. Only the two selected KiCad path
// variables may cross its per-spawn environment boundary.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const helper=spawn(process.execPath,[new URL('../src/main.ts',import.meta.url).pathname],{
  env:{...process.env,BACKPLANE_KICAD_LIBRARY:'stale-library',KICAD_CONFIG_HOME:'stale-profile'},stdio:['pipe','pipe','inherit']});
const events:any[]=[],pending=new Map<number,(v:any)=>void>();let seq=0;
let exited:(v:any)=>void;const childExit=new Promise(resolve=>exited=resolve);
createInterface({input:helper.stdout!}).on('line',line=>{const o=JSON.parse(line);events.push(o);pending.get(o.id)?.(o);pending.delete(o.id);if(o.event==='exit')exited(o);});
function ask(o:any):Promise<any>{const id=++seq;return new Promise(resolve=>{pending.set(id,resolve);helper.stdin!.write(JSON.stringify({...o,id})+'\n');});}
const deadline=setTimeout(()=>{helper.kill();throw new Error('KiCad helper env timeout');},10000);
try{
  for(const env of [{LD_PRELOAD:'/tmp/injected'},{KICAD_CONFIG_HOME:42},{BACKPLANE_KICAD_LIBRARY:'bad\0path'}]){
    const r=await ask({op:'spawn',key:'reject',argv:[process.execPath,'-e','process.exit(99)'],env});
    assert.equal(r.ok,false);assert.match(r.error,/environment/);
  }
  const env={BACKPLANE_KICAD_LIBRARY:'/selected/library 日本',KICAD_CONFIG_HOME:'/selected/profile'};
  const childScript='console.log(JSON.stringify([process.env.BACKPLANE_KICAD_LIBRARY,process.env.KICAD_CONFIG_HOME]))';
  assert.equal((await ask({op:'spawn',key:'selected',argv:[process.execPath,'-e',childScript],env})).ok,true);
  assert.equal((await childExit).code,0);
  const line=events.find(e=>e.event==='line'&&e.key==='selected');
  assert.deepEqual(JSON.parse(line.text),[env.BACKPLANE_KICAD_LIBRARY,env.KICAD_CONFIG_HOME]);
  assert(!events.some(e=>e.key==='reject'));
  console.log('ok selected library/profile reach actual helper child; stale env and injection negatives pass');
}finally{clearTimeout(deadline);helper.stdin!.end();helper.kill();}
