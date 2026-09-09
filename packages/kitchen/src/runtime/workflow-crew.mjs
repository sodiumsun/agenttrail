const working=s=>s.freshness!=='quiet'&&['reading','writing','executing','working'].includes(s.state);
const urgent=s=>['permission','input','error'].includes(s.state);
const normalized=s=>(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export function roleForSession(project,session){
  const roles=project.workflow?.roles||[];
  if(session.roleBinding){
    if(session.roleBinding.workflowId&&session.roleBinding.workflowId!==project.workflow?.id)return null;
    const role=roles.find(r=>r.id===session.roleBinding.roleId);
    return role?{role,association:{kind:'explicit',source:'role binding',reason:'Workflow explicitly identified this role',componentId:role.components.includes(session.component?.id)?session.component.id:role.components.length===1?role.components[0]:null}}:null;
  }
  const task=normalized(session.currentTask?.title);
  const components=task?project.components.filter(c=>c.tasks.some(t=>normalized(t.title)===task)):[];
  if(components.length===1){const matches=roles.filter(r=>r.components.includes(components[0].id));if(matches.length===1)return {role:matches[0],association:{kind:'inferred',source:'task',reason:'Current session task matches this project responsibility',componentId:components[0].id}};}
  if(session.component){const matches=roles.filter(r=>r.components.includes(session.component.id));if(matches.length===1)return {role:matches[0],association:session.association||{kind:'inferred',source:'component',reason:'Based on observed component context'}};}
  const work=session.workContext;
  if(project.workflow?.origin){
    const infer=(role,reason)=>role?{role,association:{kind:'inferred',source:work?'observed operation':'tool activity',reason,componentId:null}}:null;
    const currentFile=session.currentFile,observedFile=currentFile||work?.file;
    if(observedFile){const matches=roles.filter(r=>(r.files||[]).some(pattern=>matchesGlob(observedFile,pattern)));if(matches.length===1)return infer(matches[0],`Based on ${currentFile?'the current file':'the last observed file'}: ${observedFile}`);}
    const category=work?.category||(/read|search|grep|glob|find|web|list/i.test(session.tool||'')?'research':/write|edit|patch/i.test(session.tool||'')?'build':null);
    if(category){const matches=roles.filter(r=>r.category===category);if(matches.length===1)return infer(matches[0],work?`Based on the ${work.completed?'last completed':'observed'} operation: ${work.label}`:'Based on the observed tool');}
    const coordinator=roles.find(r=>r.category==='coordinate');
    return infer(coordinator,'The session is active here; its specialist responsibility is not yet known');
  }
  return null;
}

export function workflowCrew(projects,sessions){
  return projects.flatMap(p=>{
    const local=sessions.filter(s=>s.project===p.id);if(!p.workflow?.roles?.length)return local;
    const assignments=new Map(p.workflow.roles.map(r=>[r.id,[]])),unlinked=[];
    for(const s of local){if(s.ended)continue;const match=roleForSession(p,s);if(match)assignments.get(match.role.id).push({...s,association:match.association});else unlinked.push({...s,unlinkedRole:true});}
    const roles=p.workflow.roles.map(r=>{
      const executors=assignments.get(r.id).sort((a,b)=>Number(urgent(b))-Number(urgent(a))||Number(working(b))-Number(working(a))||b.lastEventAt-a.lastEventAt),primary=executors[0];
      const component=p.components.find(c=>c.id===r.components[0]);
      const queued=p.workflow.queue?.items.filter(i=>r.components.includes(i.stage))||[];
      const recentWork=local.flatMap(s=>(s.workHistory||[]).filter(work=>roleForSession(p,{...s,roleBinding:null,component:null,currentTask:null,currentFile:null,workContext:work})?.role.id===r.id).map(work=>({...work,sessionId:s.sessionId,provider:s.provider}))).sort((a,b)=>b.at-a.at)[0];
      return {...primary,id:`role:${p.id}:${p.workflow.id}:${r.id}`,sessionId:primary?.sessionId||'',roleId:r.id,name:r.title,project:p.id,roleComponents:r.components,component:component?{id:component.id,title:component.title}:null,
        roleOrigin:r.origin||'configured',roleDescription:r.description||'',roleFiles:r.files||[],recentWork,
        provider:primary?.provider||null,state:primary?.state||'idle',source:primary?.source||'workflow',freshness:primary?.freshness||'recent',ended:false,
        lastEventAt:primary?.lastEventAt||null,startedAt:0,recent:primary?.recent||[],currentTask:primary?.currentTask||null,executors,
        activityComponentId:primary?.association?.componentId||(r.components.includes(primary?.component?.id)?primary.component.id:null),
        roleStatus:queued.length?`${queued.length} ${queued.length===1?'item':'items'} ${queued.every(i=>i.label==='Needs revision')?'to revise':'waiting'}`:recentWork?`Last: ${recentWork.label}`:'Ready for the next task',queueCount:queued.length,
        association:primary?.association||{kind:'configured',source:'project map',reason:'Persistent project responsibility; no session assigned'},
        workingCount:executors.filter(working).length};
    });
    return [...roles,...unlinked];
  });
}

export function workflowPlates(projects){
  return projects.flatMap(p=>(p.workflow?.queue?.items||[]).map(i=>({id:`workflow:${p.id}:${i.id}`,artifactId:i.id,revisionId:i.revision,project:p.id,kind:'text',file:i.file,label:i.title,componentId:i.stage,producer:null,source:'workflow files',workflowItem:i,at:null})));
}
import {matchesGlob} from '../agenttrail/projects.mjs';
