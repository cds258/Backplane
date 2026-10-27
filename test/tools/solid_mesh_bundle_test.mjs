// Read-only deployment check: execute only the mesh decoder extracted from
// the built JS asset, then verify its output against the reviewed wire.
// Usage: bun test/tools/solid_mesh_bundle_test.mjs PATH/TO/chunk-HASH.js
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const path=process.argv[2];assert.ok(path,'supply a built frontend JS asset');
const text=readFileSync(path,'utf8');
const hit=/new Float32Array\([^)]{1,30}\s*\*\s*9\)/.exec(text);
assert.ok(hit,'mesh position/normal/colour buffers not found');
const start=text.lastIndexOf('function ',hit.index);assert.ok(start>=0,'mesh function not found');
const open=text.indexOf('{',start);let depth=0,quote='',escape=false,end=-1;
for(let i=open;i<text.length;i++){
  const c=text[i];
  if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';}
  else if(c==='"'||c==="'"||c==='`')quote=c;
  else if(c==='{')depth++;
  else if(c==='}'&&--depth===0){end=i+1;break;}
}
assert.ok(end>hit.index&&end-start<12000,'unexpected decoder closure');
const body=text.slice(start,end);
const decode=runInNewContext(`(${body})`,{Float32Array,Uint8Array,Math,Infinity},{timeout:1000});
const fixture=JSON.parse(readFileSync('test/fixtures/solid-handedness/wire.json','utf8'));
const bytes=new Uint8Array(Buffer.from(fixture.mesh_base64,'base64'));
const got=decode({n:fixture.n,mesh:bytes});
const b=fixture.wire_bounds.map(x=>x|0);
assert.equal(got.count,fixture.n*3);
assert.deepEqual(Array.from(got.box),[b[0],-b[4],b[2],b[3],-b[1],b[5]],'deployed mesh bounds must convert board Y to right-handed world Y');
assert.ok(got.pos.every((v,i)=>i%3!==1||v<0),'fixture wire Y must be negated');
const sha=x=>createHash('sha256').update(x).digest('hex');
console.log(JSON.stringify({asset:path,asset_sha256:sha(text),decoder_sha256:sha(body),wire_sha256:fixture.mesh_sha256,count:got.count,box:Array.from(got.box),handedness:'corrected x,-y,z'}));
console.log('ok built frontend decoder applies board→WebGL conversion exactly once');
