import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/course-package.js';
import {buildCourseData} from '../supabase/functions/_shared/course-build.js';
const P=globalThis.TDPCoursePackage;
export function packageFixture(){
  const p=P.empty({id:'osm-way-123',name:'Test Club',lat:51,lon:0,provider:'osm',osmType:'way',osmId:123});
  p.course.expectedHoles=9;p.provenance={source:'Club survey',permission:'Club permission',imageryDate:'2026-09-01'};
  const poly=coords=>({type:'Polygon',coordinates:[coords]});
  p.features=[{id:'boundary',type:'boundary',geometry:poly([[-.1,50.9],[.1,50.9],[.1,51.1],[-.1,51.1],[-.1,50.9]])},
    {id:'hole-6',type:'hole',hole:6,par:4,geometry:{type:'LineString',coordinates:[[0,51],[0,51.003]]}},
    {id:'green-6',type:'green',hole:6,geometry:poly([[-.0001,51.0029],[.0001,51.0029],[.0001,51.0031],[-.0001,51.0031],[-.0001,51.0029]])}];
  return p;
}
test('reviewed packages preserve partial hole numbers, sources and unknown ratings',()=>{
  const b=P.assemble(packageFixture());assert.equal(b.holes[0].num,6);assert.equal(b.quality,'partial');assert.equal(b.course.slope,null);assert.equal(b.holes[0].pin.source,'green-centre');
  assert.equal(b.provenance.permission,'Club permission');assert.ok(b.holes[0].green.depth>10);
});
test('editor rejects duplicate routing, missing greens, invalid coordinates and missing permission',()=>{
  const p=packageFixture();p.features.push({...p.features[1],id:'duplicate'});assert.throws(()=>P.assemble(p),/unique/);
  const q=packageFixture();q.features.pop();assert.throws(()=>P.assemble(q),/assigned green/);
  const r=packageFixture();r.features[1].geometry.coordinates[0]=[200,51];assert.throws(()=>P.assemble(r),/valid points/);
  const s=packageFixture();s.provenance.permission='';assert.throws(()=>P.assemble(s),/permission/);
});
test('multipolygon greens retain islands and interior rings through package round trips',()=>{
  const p=packageFixture(),green=p.features[2],outer=green.geometry.coordinates;
  green.geometry={type:'MultiPolygon',coordinates:[outer,[[[.001,51.003],[.0012,51.003],[.0012,51.0032],[.001,51.0032],[.001,51.003]]]]};
  const b=P.assemble(p);assert.equal(b.holes[0].green.polygons.length,2);
  const draft=P.fromMap(b);assert.equal(draft.features.find(f=>f.type==='green').geometry.coordinates.length,2);
});
