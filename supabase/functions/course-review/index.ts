import {CORS} from '../_shared/gemini.ts';
import '../../../js/course-package.js';
Deno.serve(async req=>{
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'content-type':'application/json'}});
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return json({error:'Use POST'},405);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth=req.headers.get('authorization')||'';
  const userRes=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,authorization:auth}});
  if(!userRes.ok)return json({error:'Sign in to review maps.'},401);
  const user=await userRes.json();
  const headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'};
  const rest=async(path:string,init:RequestInit={})=>{
    const r=await fetch(`${url}/rest/v1/${path}`,{...init,headers,signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error('Could not save the review. Please refresh and try again.');
    const text=await r.text();return text?JSON.parse(text):null;
  };
  try {
    const roles=await rest(`course_reviewers?user_id=eq.${encodeURIComponent(user.id)}&select=user_id`);
    if(!roles.length)return json({error:'Course reviewer access required.'},403);
    const input=await req.json();
    if(!/^[0-9a-f-]{36}$/i.test(input.id)||!['publish','reject'].includes(input.action))return json({error:'Choose a draft and review action.'},400);
    const [draft]=await rest(`course_map_drafts?id=eq.${input.id}&status=eq.submitted&select=id,package`);
    if(!draft)return json({error:'This draft has already been reviewed.'},409);
    if(input.action==='reject') {
      if(!input.note?.trim())return json({error:'Explain the corrections needed.'},400);
      await rest(`course_map_drafts?id=eq.${input.id}&status=eq.submitted`,{method:'PATCH',body:JSON.stringify({status:'rejected',reviewed_by:user.id,reviewed_at:new Date().toISOString(),review_note:String(input.note).slice(0,2000)})});
      return json({status:'rejected'});
    }
    const geometry=globalThis.TDPCoursePackage.assemble(draft.package);
    geometry.provenance={...geometry.provenance,reviewStatus:'reviewed',reviewedBy:user.id,reviewedAt:new Date().toISOString()};
    const revision=await rest('rpc/publish_course_draft',{method:'POST',body:JSON.stringify({p_draft:draft.id,p_reviewer:user.id,p_geometry:geometry,p_note:String(input.note||'').slice(0,2000)})});
    return json({status:'published',courseId:geometry.course.id,revision});
  } catch(e) {return json({error:String(e.message)},422);}
});
