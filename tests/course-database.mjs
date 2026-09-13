// Optional real PostgreSQL migration test, isolated in PGlite (no production writes).
// npm install --prefix build/db-test --no-save --package-lock=false @electric-sql/pglite
// node tests/course-database.mjs
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '../build/db-test/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.role() returns text language sql as $$ select current_setting('role') $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  for (const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  }
  const candidate={provider:'osm',id:'osm-way-123',osmType:'way',osmId:123,lat:51,lon:0,name:'Club'};
  const insert=async c=>db.query(`insert into course_requests(name,candidate) values ($1,$2) returning id`,[c.name,JSON.stringify(c)]);
  const claim=async()=>(await db.query('select * from claim_course_request()')).rows[0];
  const finish=async (job,course=null,retry=true)=>(await db.query('select finish_course_request($1,$2,$3,$4,$5) as ok',
    [job.id,job.lease_token,course && JSON.stringify(course),'Provider unavailable',retry])).rows[0].ok;
  await db.exec('set role anon');
  const {rows:[request]}=await insert(candidate);
  await assert.rejects(insert(candidate),/duplicate key/);
  await assert.rejects(insert({...candidate,id:'wrong'}),/row-level security/);
  await assert.rejects(insert({...candidate,id:'osm-way-124',osmId:124,lat:null}),/row-level security/);
  await assert.rejects(db.exec(`insert into course_requests(name,candidate,status) values ('Fake','{}','done')`),/permission denied/);
  await assert.rejects(db.exec(`select requested_by from course_requests`),/permission denied/);
  await assert.rejects(claim(),/permission denied/);
  await assert.rejects(db.exec(`update course_requests set status='done'`),/permission denied/);
  await insert({...candidate,layout:'Old'});
  await insert({...candidate,layout:'New'});
  await db.exec('reset role');
  await db.exec(`delete from course_requests where candidate ? 'layout'`);
  await db.exec('set role service_role');
  const first=await claim(); assert.equal(first.id,request.id); assert.equal(first.attempts,1);
  assert.equal(await claim(),undefined,'another worker cannot claim an active lease');
  await db.query(`update course_requests set lease_expires_at=now()-interval '1 second' where id=$1`,[first.id]);
  const second=await claim(); assert.equal(second.attempts,2); assert.notEqual(second.lease_token,first.lease_token);
  const course={id:'osm-way-123',name:'Club',geometry:{course:{lat:51,lon:0}},quality:'partial',coverage:{},osm_id:123};
  assert.equal(await finish(first,course),false,'expired worker cannot publish');
  assert.equal((await db.query('select * from courses')).rows.length,0);
  assert.equal(await finish(second,course),true);
  assert.equal((await db.query('select status from course_requests where id=$1',[request.id])).rows[0].status,'done');
  assert.equal((await db.query('select lat,lon from courses')).rows[0].lat,51,'generated coordinates work');
  // Explicit re-request after a failure/completion is allowed, with delayed retries.
  await insert(candidate);
  const third=await claim(); await finish(third);
  assert.equal(await claim(),undefined,'backoff prevents immediate retry');
  await db.query('update course_requests set next_attempt_at=now() where id=$1',[third.id]);
  const fourth=await claim(); await finish(fourth,null,false);
  assert.equal((await db.query('select status from course_requests where id=$1',[third.id])).rows[0].status,'failed');
  // A repeatedly crashed worker cannot exceed three attempts.
  await insert(candidate);
  for (let attempt=1;attempt<=3;attempt++) {
    const job=await claim(); assert.equal(job.attempts,attempt);
    await db.query(`update course_requests set lease_expires_at=now()-interval '1 second' where id=$1`,[job.id]);
  }
  assert.equal(await claim(),undefined);
  assert.equal((await db.query(`select count(*)::int n from course_requests where status='failed'`)).rows[0].n,2);
  // Existing curated maps are protected even when a job finishes with the same ID.
  await db.exec(`update courses set source='user', name='Reviewed Club'`);
  await insert(candidate); await finish(await claim(),course);
  assert.equal((await db.query('select name from courses')).rows[0].name,'Reviewed Club');
  // Published geometry is immutable history; contributions cannot self-approve.
  const before=(await db.query('select current_revision from courses')).rows[0].current_revision;
  await db.exec("update courses set geometry=jsonb_set(geometry,'{course,name}','\"Changed\"'::jsonb)");
  const after=(await db.query('select current_revision from courses')).rows[0].current_revision;
  assert.notEqual(before,after);
  assert.equal((await db.query('select geometry from course_revisions where id=$1',[before])).rows[0].geometry.course.name,undefined);
  await db.exec('reset role');
  await db.exec("insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111111','contributor@example.test'),('22222222-2222-4222-8222-222222222222','reviewer@example.test')");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",['11111111-1111-4111-8111-111111111111']);
  await db.exec('set role authenticated');
  await assert.rejects(db.exec("insert into course_map_drafts(created_by,course_id,package,status) values ('11111111-1111-4111-8111-111111111111','osm-way-123','{}','published')"),/permission denied/);
  const {rows:[draft]}=await db.query("insert into course_map_drafts(created_by,course_id,package) values ('11111111-1111-4111-8111-111111111111','osm-way-123',$1) returning id",[JSON.stringify({course:{id:'osm-way-123'}})]);
  await assert.rejects(db.exec("select publish_course_draft(gen_random_uuid(),gen_random_uuid(),'{}','')"),/permission denied/);
  await assert.rejects(db.exec("update course_revisions set geometry='{}'"),/row-level security|permission denied/);
  await db.exec('set role service_role');
  await db.exec("insert into course_reviewers values ('22222222-2222-4222-8222-222222222222')");
  const published={...course.geometry,course:{id:'osm-way-123',name:'Approved map',lat:51,lon:0},quality:'partial',coverage:{}};
  const reviewed=(await db.query("select publish_course_draft($1,'22222222-2222-4222-8222-222222222222',$2,'Checked') revision",[draft.id,JSON.stringify(published)])).rows[0].revision;
  assert.ok(reviewed);assert.equal((await db.query('select map_status from courses')).rows[0].map_status,'reviewed');
  await assert.rejects(db.query("select publish_course_draft($1,'22222222-2222-4222-8222-222222222222',$2,'Checked')",[draft.id,JSON.stringify(published)]),/already been reviewed/);
  console.log('PASS: all migrations, guest permissions, canonical identity, independent layouts, lease recovery, stale publication, backoff, attempt limit, generated coordinates, curated map protection.');
} finally {await db.close();}
