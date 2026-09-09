import path from 'node:path';

export const clean = (v, max = 180) => typeof v === 'string' ? v.replace(/[\x00-\x1f]/g, ' ').slice(0, max) : '';
export const within = (file, root) => file === root || file.startsWith(root + path.sep);
export function activityFor(tool = '') {
  if(/(?:^|\.)(?:update_plan|TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|todo_write|write_todos)$/i.test(tool))return 'working';
  if(/^(?:functions\.)?exec$/.test(tool))return 'working';
  if (/read|grep|glob|search|list|find|web|browse/i.test(tool)) return 'reading';
  if (/write|edit|patch|replace|notebook/i.test(tool)) return 'writing';
  if (/exec|shell|bash|terminal|command/i.test(tool)) return 'executing';
  return 'working';
}

export class CrewStore {
  constructor(roots, clock = Date.now) { this.roots = roots; this.clock = clock; this.sessions = new Map(); this.seen = new Set(); }
  rootFor(cwd) { return typeof cwd==='string'?this.roots.filter(r => within(cwd, r)).sort((a,b) => b.length-a.length)[0]:undefined; }
  accept(event) {
    const project = this.rootFor(event.cwd || '');
    const kinds=['session-start','session-end','turn-start','turn-end','tool-start','tool-end','permission','input','interrupted','activity','unknown','role','observation'];
    if (!project || !['claude','codex','cursor'].includes(event.provider) || typeof event.sessionId!=='string' || !event.sessionId || typeof event.id!=='string' || !event.id || !kinds.includes(event.kind)) return false;
    const dedup = `${event.provider}:${event.id}`;
    if (this.seen.has(dedup)) return false;
    this.seen.add(dedup); if (this.seen.size > 4000) this.seen.delete(this.seen.values().next().value);
    const at = Number(event.at) || this.clock();
    if (at > this.clock()+60_000 || at < this.clock()-24*3600_000) return false;
    const id = `${event.provider}:${clean(event.sessionId,200)}`;
    let s = this.sessions.get(id);
    if(event.kind==='role'&&(!s||s.project!==project||at<(s.roleBindingAt||0)))return false;
    if (!s) {
      s = { id, sessionId: clean(event.sessionId,200), provider:event.provider, project, cwd:event.cwd, startedAt:at, lastEventAt:0, state:'unknown', source:event.source, parentId:event.parentId ? `${event.provider}:${clean(event.parentId,200)}` : null, recent:[], tools:new Map(), retiredTurns:new Set(), tool:'', file:null, fileAt:null, currentFile:null, turnId:null, ended:false };
      this.sessions.set(id,s);
    }
    // Events can arrive through a replay or a second observer. Older evidence must not rewind the crew.
    if (at < s.lastEventAt&&event.kind!=='observation') return false;
    if (s.source === 'hook' && event.source !== 'hook' && at - s.lastEventAt < 30_000) return false;
    if(event.turnId&&s.retiredTurns.has(event.turnId))return false;
    const recordWork=()=>{
      const w=event.work;if(!w||!['coordinate','research','build','simulation','review','publish','execute'].includes(w.category))return;
      const f=typeof w.file==='string'?path.resolve(event.cwd,w.file):null;
      const file=f&&within(f,project)?path.relative(project,f):null,label=w.label==='Read a file'&&file?'Read '+path.basename(file):w.label;
      s.workContext={category:w.category,label:clean(label,120),file,at,completed:!!w.completed,toolId:event.toolId||null};
      return true;
    };
    if(event.kind==='observation'){
      if(s.workContext?.at>at||at<(s.turnStartedAt||s.startedAt))return false;
      if(!recordWork())return false;
      if(!s.lastEventAt)s.lastEventAt=at;
      s.workHistory=[s.workContext,...(s.workHistory||[])].slice(0,24);
      s.recent.unshift({id:dedup,at,kind:'observation',tool:s.workContext.label,file:s.workContext.file,source:event.source});s.recent=s.recent.slice(0,12);
      this.onChange?.(this.snapshot().find(item=>item.id===id));return true;
    }
    if(event.kind==='role'){
      if(event.roleId===null)s.roleBinding=null;
      else if(typeof event.roleId==='string'&&/^[\w-]{1,100}$/.test(event.roleId))s.roleBinding={roleId:event.roleId,workflowId:clean(event.workflowId,100)||null,runId:clean(event.runId,100)||null,itemId:clean(event.itemId,180)||null,orderId:clean(event.orderId,100)||null,at};
      else return false;
      s.roleBindingAt=at;
      this.onChange?.(this.snapshot().find(item=>item.id===id));
      return true;
    }
    s.source = event.source; s.lastEventAt = at; s.project = project;
    if (event.turnId && s.turnId !== event.turnId) { if(s.turnId)s.retiredTurns.add(s.turnId);if(s.retiredTurns.size>100)s.retiredTurns.delete(s.retiredTurns.values().next().value);s.tools.clear(); s.turnId = event.turnId; }
    if (event.parentId) s.parentId = `${event.provider}:${clean(event.parentId,200)}`;
    if(Array.isArray(event.tasks)){if(event.tasksPartial){const incomingIds=new Set(event.tasks.map(t=>t?.id).filter(Boolean));event={...event,tasks:[...(s.sessionTasks||[]).filter(t=>!incomingIds.has(t.id)),...event.tasks.filter(t=>t?.id)]};}if(event.planId&&event.planId!==s.planId){s.outcomeId=null;s.outcomeTitle=null;}s.sessionTasks=event.tasks.slice(0,24).filter(t=>typeof t?.title==='string'&&['pending','in_progress','completed'].includes(t.status)).map(t=>({...((typeof t.id==='string'||typeof t.id==='number')?{id:clean(String(t.id),100)}:{}),title:clean(t.title,180),status:t.status}));s.taskContextAt=at;s.planId=clean(event.planId,100)||s.planId||null;s.outcomeId=clean(event.outcomeId,100)||s.outcomeId||null;s.outcomeTitle=clean(event.outcomeTitle,180)||s.outcomeTitle||null;}
    if(event.taskChange&&typeof event.taskChange.id==='string'){
      const change=event.taskChange,id=clean(change.id,100),prior=s.sessionTasks?.find(t=>t.id===id),title=clean(change.title,180)||prior?.title;
      if(id&&['pending','in_progress','completed','deleted'].includes(change.status)&&(prior||title)){
        const next={id,title,status:change.status};
        s.sessionTasks=change.status==='deleted'?(s.sessionTasks||[]).filter(t=>t.id!==id):prior?s.sessionTasks.map(t=>t.id===id?next:t):[...(s.sessionTasks||[]),next].slice(-24);s.taskContextAt=at;
      }
    }
    let observedFile=null;
    if(event.file){const f=path.resolve(event.cwd,event.file);if(within(f,project)){observedFile=path.relative(project,f);s.file=observedFile;s.fileAt=at;}}
    if (event.kind === 'session-start' || event.kind === 'turn-start') { s.state='working'; s.ended=false;s.workContext=null;s.turnStartedAt=at; }
    else if (event.kind === 'tool-start') {
      s.ended=false; s.tools.set(event.toolId || event.id, {name:clean(event.tool,80),file:observedFile});s.currentFile=observedFile; s.state=activityFor(event.tool); s.tool=clean(event.tool,80);
    } else if (event.kind === 'tool-end') {
      s.tools.delete(event.toolId); const current=[...s.tools.values()].at(-1);
      s.state=event.error ? 'error' : current ? activityFor(current.name) : 'working'; s.tool=current?.name || clean(event.tool,80) || s.tool;s.currentFile=current?.file||null;
    } else if (event.kind === 'permission') { s.state='permission'; }
    else if (event.kind === 'input') { s.state='input'; }
    else if (event.kind === 'turn-end') { s.tools.clear(); s.state=event.error ? 'error' : 'complete'; }
    else if (event.kind === 'interrupted') { s.tools.clear(); s.state='interrupted'; }
    else if (event.kind === 'session-end') { s.tools.clear(); s.state='offline'; s.ended=true; }
    else if (event.kind === 'activity') { s.ended=false;s.state=activityFor(event.tool); s.tool=clean(event.tool,80);s.currentFile=observedFile; }
    else if (event.kind === 'unknown') { s.state='unknown'; }
    recordWork();
    if(event.kind==='tool-end'&&s.workContext&&s.workContext.toolId===event.toolId&&!s.workContext.completed)s.workContext={...s.workContext,completed:true};
    if(['session-start','turn-start','turn-end','session-end','interrupted','unknown'].includes(event.kind))s.currentFile=null;
    s.recent.unshift({id:dedup,at,kind:event.kind,tool:clean(event.tool,80),file:event.file && s.file,source:event.source});
    s.recent=s.recent.slice(0,12);
    if(this.sessions.size>160) this.sessions.delete([...this.sessions.values()].sort((a,b)=>a.lastEventAt-b.lastEventAt)[0].id);
    this.onChange?.(this.snapshot().find(item=>item.id===id));
    return true;
  }
  snapshot() {
    const now=this.clock();
    for(const [id,s] of this.sessions) if(now-s.lastEventAt>24*3600_000) this.sessions.delete(id);
    return [...this.sessions.values()].map(({tools,retiredTurns,...s})=>({...s, activeToolCount:tools.size, freshness:now-s.lastEventAt > 120_000 ? 'quiet' : 'recent'})).sort((a,b)=>b.lastEventAt-a.lastEventAt);
  }
}
