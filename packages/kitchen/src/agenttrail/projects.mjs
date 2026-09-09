import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { clean } from '../runtime/crew.mjs';
import { kitchenMap } from './kitchens.mjs';
import {workflowConfig,workflowStations,WorkflowQueues} from './workflows.mjs';
import {CrewProfiles} from './crew-profile.mjs';

export function parsePlan(text) {
  const components=[];let current=null,currentTask=null;
  for(const line of text.split('\n')) {
    const heading=line.match(/^##\s+(.+?)\s*\{#([\w-]+)\}\s*$/);
    if(heading){current={id:heading[2],title:clean(heading[1]),files:[],tasks:[],needs:[],links:[]};currentTask=null;components.push(current);continue;}
    if(/^##\s/.test(line)){current=null;currentTask=null;continue;}
    if(!current)continue;
    const kind=line.match(/^kind:\s*(human|knowledge)\s*$/);if(kind)current.kind=kind[1];
    const url=line.match(/^url:\s*(https?:\/\/\S+)\s*$/);if(url)current.url=clean(url[1],400);
    const files=line.match(/^files:\s*\[(.*?)\]/);if(files)current.files=files[1].split(',').map(s=>s.trim());
    const edges=line.match(/^(needs|links):\s*\[(.*?)\]/);if(edges)current[edges[1]]=edges[2].split(',').map(s=>s.trim()).filter(Boolean);
    const task=line.match(/^\s*-\s*\[([ x~!])\]\s+(.+?)(?:\s*\{#([\w-]+)\})?\s*$/);
    if(task){currentTask={id:task[3]||null,title:clean(task[2]),state:task[1]};current.tasks.push(currentTask);continue;}
    const meta=line.match(/^\s+(by|from):\s*(.+)/);if(meta&&currentTask)currentTask[meta[1]]=clean(meta[2]);
  }
  return components;
}
export function matchesGlob(file,glob) {
  let p='';for(let i=0;i<glob.length;i++){
    if(glob[i]==='*'&&glob[i+1]==='*'){i++;if(glob[i+1]==='/'){i++;p+='(?:.*/)?';}else p+='.*';}
    else if(glob[i]==='*')p+='[^/]*';else if(glob[i]==='?')p+='[^/]';else p+=glob[i].replace(/[.+^${}()|[\]\\]/g,'\\$&');
  }
  try{return new RegExp('^'+p+'$').test(file);}catch{return false;}
}
const ignored=f=>/(^|\/)(\.git|node_modules|\.office|\.agenttrail|dist|coverage)(\/|$)|\.DS_Store|\.(swp|tmp)$/.test(f);
export class Projects {
  constructor(roots,home,store){this.roots=roots;this.home=home;this.store=store;this.data=new Map();this.watchers=[];this.runContext=new Map();this.queues=new WorkflowQueues();this.profiles=new CrewProfiles();}
  watch(root){
    if(this.data.has(root))return;
    const project={id:root,name:path.basename(root),components:[],activity:[],boardUrl:null,contextSource:'plan',watchStatus:'watching',planStamp:-1};this.data.set(root,project);
    try{this.watchers.push(fs.watch(root,{recursive:true},(_,file)=>{
      const f=String(file||'').split(path.sep).join('/');if(!f||ignored(f))return;
      const at=Date.now();project.activity=[{file:clean(f,300),at},...project.activity.filter(a=>a.file!==f)].slice(0,10);
    }));}catch{project.watchStatus='plan only';}
  }
  async poll(){
    await Promise.all(this.roots.map(async root=>{
      this.watch(root);const p=this.data.get(root);
      try{const stat=await fsp.stat(path.join(root,'PLAN.md'));if(stat.mtimeMs!==p.planStamp){p.components=parsePlan((await fsp.readFile(path.join(root,'PLAN.md'),'utf8')).slice(0,512_000));p.planStamp=stat.mtimeMs;}}catch{p.components=[];}
      let config=null,configError=null;
      try{const text=await fsp.readFile(path.join(root,'.office/kitchen.json'),'utf8');if(text.length>64_000)throw new Error('Kitchen configuration is too large.');config=JSON.parse(text);}catch(e){if(e.code!=='ENOENT')configError='Kitchen configuration could not be read. Showing the full project map.';}
      config=workflowConfig(p.components,config,p.name);
      Object.assign(p,kitchenMap(p.components,config));p.workflow=config?.version===1&&Array.isArray(config.kitchens)&&Array.isArray(config.deliverables)&&Array.isArray(config.workflow?.roles)?config.workflow:null;
      if(!p.workflow&&!p.components.length&&config?.workflow!==false)p.workflow=await this.profiles.get(root,p.name);
      if(p.workflow){p.workflow.stations=workflowStations(p.components,p.workflow.roles);if(p.workflow.adapter==='reddit-loop')p.workflow.queue=await this.queues.snapshot(root);}
      if(configError)p.warnings.push(configError);
      p.boardUrl=null;p.contextSource='plan';
      try{
        const hash=crypto.createHash('sha1').update(root).digest('hex').slice(0,12);
        const saved=JSON.parse(await fsp.readFile(path.join(this.home,'.agenttrail',hash+'.json'),'utf8'));
        if(saved.repoPath!==root||!Number.isInteger(saved.port)||saved.port<1024||saved.port>65535)return;
        const base=`http://127.0.0.1:${saved.port}`;
        const who=await fetch(base+'/whoami',{signal:AbortSignal.timeout(400)}).then(r=>r.json());
        if(who.repoPath!==root)return;
        const model=await fetch(base+'/board-lite',{signal:AbortSignal.timeout(700)}).then(r=>r.json());
        if(!Array.isArray(model.plan))return;
        p.boardUrl=base;p.contextSource='agenttrail';
        this.applyBoard(root,model);
      }catch{p.boardUrl=null;p.contextSource='plan';}
    }));
  }
  applyBoard(root,model){
    const components=this.data.get(root)?.components||[];
    for(const run of (model.runs||[]).slice(0,160)){
      if(typeof run.id!=='string'||!['claude','codex','cursor'].includes(run.agent))continue;
      const at=Number(run.lastEventAt);if(!Number.isFinite(at)||at<=0||at>Date.now()+60_000)continue;
      const id=`${run.agent}:${clean(run.id,200)}`,old=this.runContext.get(id);
      if(old&&old.at>at)continue;
      const component=components.find(c=>c.id===run.componentId);
      const todos=(Array.isArray(run.todos)?run.todos:[]).slice(0,24).filter(t=>typeof t?.content==='string'&&['pending','in_progress','completed'].includes(t.status)).map(t=>({...((typeof t.id==='string'||typeof t.id==='number')?{id:clean(String(t.id),100)}:{}),title:clean(t.content,180),status:t.status}));
      this.runContext.set(id,{project:root,at,componentId:component?.id||null,todos,hasPlan:Array.isArray(run.todos),ended:!!run.ended});
      const existing=this.store.sessions.get(id);
      // Board context augments native observations; it cannot overwrite their lifecycle.
      if(!existing||existing.source==='agenttrail')this.store.accept({id:`board:${run.id}:${at}:${!!run.ended}:${clean(run.currentTool?.name,80)}`,provider:run.agent,sessionId:run.id,cwd:root,at,source:'agenttrail',kind:run.ended?'session-end':run.currentTool?'activity':'unknown',tool:clean(run.currentTool?.name,80)});
    }
    for(const [id,c] of this.runContext)if(Date.now()-c.at>24*3600_000)this.runContext.delete(id);
  }
  snapshot(){return [...this.data.values()].map(({planStamp,...p})=>p);}
  enrich(crew){return crew.map(s=>{
    const components=this.data.get(s.project)?.components||[];
    const context=this.runContext.get(s.id),board=context?.project===s.project&&Date.now()-context.at<15*60_000?context:null;
    const matches=s.file?components.filter(c=>c.files.some(g=>matchesGlob(s.file,g))):[];
    const fileComponent=matches.length===1?matches[0]:null,boardComponent=components.find(c=>c.id===board?.componentId);
    const conflict=!!(fileComponent&&boardComponent&&fileComponent.id!==boardComponent.id);
    let component=null,association={kind:'unknown',source:null,reason:matches.length>1?'File belongs to several goals':'No goal link reported'};
    if(fileComponent&&(!boardComponent||!conflict||(s.fileAt||0)>board.at)){
      component=fileComponent;association={kind:'inferred',source:'file',reason:'Based on the last observed file'};
    }else if(boardComponent&&!conflict){
      component=boardComponent;association={kind:'inferred',source:'agenttrail',reason:'Agenttrail matched this session to a component'};
    }else if(conflict){association.reason='File and Agenttrail associations disagree';}
    const useNative=s.sessionTasks&&(!board||(s.taskContextAt||0)>=board.at),sessionTasks=useNative?s.sessionTasks:board?.todos||[];
    return {...s,component:component?{id:component.id,title:component.title}:null,componentCandidates:[...new Set([...matches.map(c=>c.id),...(boardComponent?[boardComponent.id]:[])])],association,sessionTasks,planAvailable:!!(useNative||board?.hasPlan),taskSource:useNative?'native plan':board?.hasPlan?'Agenttrail run':null,currentTask:sessionTasks.find(t=>t.status==='in_progress')||null,contextAt:useNative?s.taskContextAt:board?.at||null};
  });}
  close(){for(const watcher of this.watchers)watcher.close();}
}
