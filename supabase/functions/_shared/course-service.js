import {buildCourseData,qualityOf,OVERPASS_MIRRORS} from './course-build.js';
import {validateCandidate,queryForCandidate,selectCourseElements} from './course-selection.js';
export async function courseSource(input,fetcher=fetch) {
  const candidate=validateCandidate(input);
  for(const url of OVERPASS_MIRRORS.slice(0,3)) {
    try {
      const r=await fetcher(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','user-agent':'TDP-course-builder/1.0 (admin@v3tr4.com)'},
        body:'data='+encodeURIComponent(queryForCandidate(candidate)),signal:AbortSignal.timeout(45000)});
      if(!r.ok) continue;
      const data=await r.json();
      if(!Array.isArray(data.elements)||data.remark) continue;
      const selected=selectCourseElements(data.elements,candidate);
      return {...selected,candidate,outline:data.elements.find(e=>e.id===candidate.osmId && e.type===candidate.osmType)};
    } catch(e) {if(e.layouts || !/fetch|abort|timeout|timed out|network|json/i.test(e.message)) throw e;}
  }
  throw Object.assign(new Error('The map service is busy. Your saved course is still available; try again shortly.'),{retryable:true,status:503});
}
export async function buildSelectedCourse(input,card=null,fetcher=fetch) {
  const selected=await courseSource(input,fetcher);
  const built=buildCourseData(selected.name,selected.candidate.loc||'',selected.elements,card,
    {expectedHoles:selected.expectedHoles,minHoles:1});
  built.course.id=selected.id;
  return {...built,quality:qualityOf(built.coverage),identity:selected.candidate};
}
