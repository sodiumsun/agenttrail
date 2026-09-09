// Shared presentation rules. These never assign or complete real work.
export const providerName={codex:'Codex',claude:'Claude',cursor:'Cursor'};
export const needsAttention=s=>['permission','input','error'].includes(s.state)&&!s.ended;
export const isWorking=s=>s.roleId?s.workingCount>0:!s.ended&&s.freshness!=='quiet'&&['reading','writing','executing','working'].includes(s.state);
export const isCurrent=s=>needsAttention(s)||isWorking(s);
export const kitchenForSession=(s,p)=>p.kitchens.find(k=>k.components.includes(s?.component?.id))||p.kitchens[0];
export function activityText(s,connected=true){
  if(!connected)return 'Connection lost';
  if(s.roleId&&s.state==='idle')return s.roleStatus||'Not running';
  const file=s.currentFile||(s.source==='example'?s.file:null),leaf=file?.split('/').at(-1);
  const labels={reading:leaf?`Reading ${leaf}`:/search|grep|glob|find/i.test(s.tool||'')?'Searching files':'Reading',writing:leaf?`Editing ${leaf}`:'Editing files',executing:'Running a command',working:'Working',permission:'Needs permission',input:'Needs your input',error:'Tool failed',complete:'Turn complete',interrupted:'Interrupted',offline:'Session ended',unknown:'Action unavailable'};
  let text=s.state==='working'&&/(?:^|\.)(?:update_plan|TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|todo_write|write_todos)$/i.test(s.tool||'')?(s.activeToolCount?'Updating the plan':'Plan updated'):labels[s.state]||'Action unavailable';
  if(s.workContext?.label&&['working','unknown'].includes(s.state)&&!/(?:update_plan|TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|todo_write|write_todos)$/i.test(s.tool||''))text=(s.workContext.completed&&s.freshness!=='quiet'?'Last: ':'')+s.workContext.label;
  if(s.freshness==='quiet'&&!needsAttention(s))text=`Last seen: ${text.toLowerCase()}`;
  if(s.activeToolCount>1)text+=` · +${s.activeToolCount-1} actions`;
  if(s.roleId&&s.executors?.length)text+=` · ${providerName[s.provider]||'Agent'}${s.executors.length>1?` +${s.executors.length-1}`:''}`;
  return text;
}
export class IdentityBook {
  constructor(saved=[]){this.records=new Map((Array.isArray(saved)?saved:[]).filter(r=>typeof r?.key==='string'&&Number.isInteger(r.index)&&r.index>=0&&r.index<12&&typeof r.badge==='string').slice(-256).map(r=>[r.key,r]));}
  assign(crew){
    const ordered=[...crew].sort((a,b)=>(a.startedAt||0)-(b.startedAt||0)||a.id.localeCompare(b.id));
    const used=new Map();
    for(const s of ordered){const record=this.records.get(s.project+'|'+s.id);if(record&&!s.ended){if(!used.has(s.project))used.set(s.project,new Set());const colors=used.get(s.project);if(colors.has(record.index)){record.index=Array.from({length:12},(_,i)=>i).find(i=>!colors.has(i))??record.index;}colors.add(record.index);}}
    for(const s of ordered){const key=s.project+'|'+s.id;if(this.records.has(key))continue;
      const colors=used.get(s.project)||new Set(),count=[...this.records.keys()].filter(k=>k.startsWith(s.project+'|')).length;
      const index=Array.from({length:12},(_,i)=>i).find(i=>!colors.has(i))??count%12;
      const badge=count<26?String.fromCharCode(65+count):String(count+1);
      this.records.set(key,{key,index,badge});if(!s.ended)colors.add(index);used.set(s.project,colors);
    }
    while(this.records.size>256)this.records.delete(this.records.keys().next().value);
    return crew.map(s=>{const r=this.records.get(s.project+'|'+s.id);return {...s,visualIndex:r.index,badge:r.badge,displayName:s.name||`${providerName[s.provider]||'Agent'} ${r.badge}`};});
  }
  save(){return [...this.records.values()];}
}
export function goalCards(p,crew){
  const sessions=crew.filter(s=>s.project===p.id&&!s.ended);
  const cards=p.components.map(c=>{
    const chefs=sessions.filter(s=>s.roleComponents?s.roleComponents.includes(c.id):s.component?.id===c.id).map(s=>s.roleId&&isCurrent(s)&&s.activityComponentId!==c.id?{...s,state:'idle',workingCount:0,currentTask:null,roleStatus:s.activityComponentId?'Working on '+(p.components.find(n=>n.id===s.activityComponentId)?.title||'another goal'):'Working · goal not linked'}:s),tasks=c.tasks||[];
    return {...c,chefs,counts:{total:tasks.length,done:tasks.filter(t=>t.state==='x').length,active:tasks.filter(t=>t.state==='~').length,blocked:tasks.filter(t=>t.state==='!').length},currentTask:tasks.find(t=>t.state==='~')?.title||null,kitchenId:p.kitchens.find(k=>k.components.includes(c.id))?.id};
  });
  const unlinked=sessions.filter(s=>!s.component&&!s.roleId);
  if(unlinked.length)cards.push({id:'__unlinked',title:p.workflow?'Role not linked':'Goal not linked',tasks:[],chefs:unlinked,counts:{total:0,done:0,active:0,blocked:0},currentTask:null,kitchenId:p.kitchens[0]?.id});
  return cards;
}
export function rankedGoals(cards,{kitchenId,pinned=[],order=[]}={}){
  const rank=c=>pinned.includes(c.id)?0:c.chefs.some(needsAttention)||c.counts.blocked?1:c.chefs.some(isCurrent)?2:c.counts.active?3:4;
  return cards.filter(c=>pinned.includes(c.id)||c.kitchenId===kitchenId)
    .filter(c=>pinned.includes(c.id)||rank(c)<4||c.id==='__unlinked'||c.counts.done<c.counts.total||c.chefs.some(s=>s.roleId)||c.kind)
    .sort((a,b)=>rank(a)-rank(b)||(order.includes(a.id)?order.indexOf(a.id):999)-(order.includes(b.id)?order.indexOf(b.id):999));
}
