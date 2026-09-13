import {buildSelectedCourse} from '../_shared/course-service.js';
Deno.serve(async req=>{
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!key || req.headers.get('authorization')!==`Bearer ${key}`) return new Response('Unauthorized',{status:401});
  if(req.method!=='POST') return new Response('Use POST',{status:405});
  const url=Deno.env.get('SUPABASE_URL');
  async function rpc(name:string,body:unknown) {
    const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key!,authorization:`Bearer ${key}`,'content-type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(!r.ok) throw new Error(`Queue operation failed (${r.status})`);
    return r.json();
  }
  try {
    const [job]=await rpc('claim_course_request',{});
    if(!job) return Response.json({status:'idle'});
    let result;
    try {
      const built=await buildSelectedCourse(job.candidate);
      result={p_course:{id:built.course.id,name:built.course.name,location:built.course.location,geometry:built,
        quality:built.quality,coverage:built.coverage,country:built.identity.country||null,osm_id:built.identity.osmId}};
    } catch(e) {result={p_error:String(e.message).slice(0,200),p_retry:e.retryable===true};}
    const finished=await rpc('finish_course_request',{p_id:job.id,p_lease:job.lease_token,...result});
    return Response.json({status:finished?'processed':'lease_expired'});
  } catch {return Response.json({error:'Queue service unavailable'},{status:503});}
});
