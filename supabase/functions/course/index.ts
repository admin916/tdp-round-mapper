import { CORS } from "../_shared/gemini.ts";
import { validateCandidate } from "../_shared/course-selection.js";
import {buildSelectedCourse,courseSource} from '../_shared/course-service.js';
Deno.serve(async req=>{
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'content-type':'application/json'}});
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if(req.method!=='POST') return json({error:'Use POST'},405);
  let input,candidate;
  try {input=await req.json();candidate=validateCandidate(input?.candidate);} catch {return json({error:'Select a course location from the finder first.'},400);}
  try {
    return json(input.action==='source'?await courseSource(candidate):await buildSelectedCourse(candidate,input.card));
  } catch(e) {return json({error:String(e.message),layouts:e.layouts||undefined},e.status||422);}
});
