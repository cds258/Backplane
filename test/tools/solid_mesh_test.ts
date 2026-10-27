// Run: bun test/tools/solid_mesh_test.ts
// Board-coordinate wire must reach WebGL in a right-handed world, as on phones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mesh, Orbit } from '../../src/web/solid.js';

type Tri = { color: number, points: number[][] };
function wire(tris: Tri[]) {
  const bytes: number[] = [];
  const put = (v: number) => { do { let b=v%128;v=Math.floor(v/128);bytes.push(b|(v?128:0)); } while(v); };
  let color=0,prev=[0,0,0];
  for(const t of tris){
    put((color^t.color)>>>0);color=t.color;
    for(const p of t.points)for(let i=0;i<3;i++){
      const d=p[i]-prev[i];put(d<0?-2*d-1:2*d);prev[i]=p[i];
    }
  }
  return {n:tris.length,mesh:new Uint8Array(bytes)};
}
const tris:Tri[]=[
  {color:0xffffff,points:[[10,20,5],[10,40,5],[30,20,5]]},
  {color:0x123456,points:[[-30,-20,-5],[-30,-40,-5],[-10,-20,-5]]},
];
const encoded=wire(tris),saved=encoded.mesh.slice(),m=mesh(encoded);
assert.deepEqual([...m.pos],tris.flatMap(t=>t.points.flatMap(([x,y,z])=>[x,-y,z])));
assert.deepEqual(encoded.mesh,saved,'decoding must not mutate the wire');
assert.deepEqual(m.box,[-30,-40,-5,30,40,5]);
assert.equal(m.count,6);
for(const n of [0,1,2])assert.ok([...m.nrm.slice(n*3,n*3+3)].every((v,i)=>Math.abs(v-[0,0,1][i])<1e-7));
for(const n of [3,4,5])assert.ok([...m.nrm.slice(n*3,n*3+3)].every((v,i)=>Math.abs(v-[0,0,-1][i])<1e-7));
assert.ok(Math.abs(m.col[9]-0x12/255)<1e-7&&Math.abs(m.col[10]-0x34/255)<1e-7);
console.log('ok wire→WebGL conversion, signed deltas, winding, normals, colours and reflected bounds');

// A top view projects source x right and source y down; a bottom view
// reverses x, so text authored mirrored on the back becomes readable.
const screen=(o:Orbit,p:number[])=>{
  const d=p.map((v,i)=>v-o.eye()[i]),dot=(v:number[])=>d.reduce((s,x,i)=>s+x*v[i],0);
  return [dot(o.r)/dot(o.f),dot(o.u)/dot(o.f)];
};
for(const bottom of [false,true]){
  const o=new Orbit().aim(bottom?Math.PI:0,bottom?-Math.PI/2:Math.PI/2);o.dist=100;
  const a=screen(o,[10,-20,0]),x=screen(o,[30,-20,0]),y=screen(o,[10,-40,0]);
  assert.equal(x[0]>a[0],!bottom);assert.ok(y[1]<a[1]);
  const before=screen(o,[0,-20,0]);o.pan(4,3,o.unit(700));const after=screen(o,[0,-20,0]);
  assert.ok(after[0]>before[0]&&after[1]<before[1]);
}
const d=mesh(wire([{color:0,points:[[1,2,3],[4,5,6],[7,8,9]]}]));
assert.ok([...d.nrm].every(Number.isFinite));
console.log('ok top/bottom screen orientation, camera pan and finite degenerate normals');

// Phones already convert the entire board/overlay scene in their MVP.
const ios=readFileSync('mobile/ios/Backplane/PlotView.swift','utf8');
const android=readFileSync('mobile/android/app/src/main/java/dev/backplane/mobile/PlotView.kt','utf8');
assert.ok(ios.includes('float4x4(diagonal: SIMD4(1, -1, 1, 1))'));
assert.ok(android.includes('Matrix.scaleM(m, 0, 1f, -1f, 1f)'));
console.log('ok phone MVPs retain the existing board-wire overlay convention');
