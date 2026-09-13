import test from 'node:test';
import assert from 'node:assert/strict';
import {processRequests} from '../scripts/course-queue.mjs';
import '../js/course-finder.js';

for (const mode of ['success','temporary','needs-review','expired','publication-error']) {
  test(`worker handles ${mode} through the leased publication RPC`, async () => {
    const calls=[], candidate={id:'osm-way-123', layout:'Old'};
    const rest=async (path, options) => {
      calls.push({path, body:JSON.parse(options.body)});
      if (path.includes('claim')) return calls.length === 1 ? [{id:7,lease_token:'lease',name:'Club',candidate}] : [];
      if (mode === 'publication-error') throw new Error('Database unavailable');
      return mode !== 'expired';
    };
    const scout=async (name, place, opts) => {
      assert.deepEqual(opts.candidate,candidate);
      if (['temporary','needs-review'].includes(mode)) throw Object.assign(new Error('Unavailable'),{retryable:mode === 'temporary'});
      return {id:'osm-way-123-layout-Old'};
    };
    if (mode === 'publication-error') await assert.rejects(processRequests({rest,scout}),/Database unavailable/);
    else await processRequests({rest,scout});
    assert.equal(calls[1].path,'rpc/finish_course_request');
    assert.equal(calls[1].body.p_lease,'lease');
    if (['temporary','needs-review'].includes(mode)) assert.equal(calls[1].body.p_retry,mode === 'temporary');
    else assert.equal(calls[1].body.p_course.id,'osm-way-123-layout-Old');
    assert.ok(calls.every(c=>c.path.startsWith('rpc/')),'no unleased catalogue writes');
  });
}
test('saved layouts have independent keys and progress has honest availability states',()=>{
  const cf=globalThis.TDPCourseFinder;
  assert.notEqual(cf.placeKey({id:'club',layout:'Old'}),cf.placeKey({id:'club',layout:'New'}));
  assert.match(cf.requestMessage({status:'pending',attempts:0}),/worker is available/);
  assert.match(cf.requestMessage({status:'failed',error:'Missing greens'}),/Missing greens/);
  assert.match(cf.requestMessage({status:'done',course_id:null}),/no longer available/);
});
