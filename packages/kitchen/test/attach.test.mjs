import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startOffice} from '../src/server.mjs';
import {CrewStore} from '../src/runtime/crew.mjs';
import {LogObserver} from '../src/connectors/logs.mjs';
import {normalizeHook,claudeEvents,codexEvents} from '../src/connectors/events.mjs';
import {parseArgs,liveUrl} from '../bin/office.mjs';
const run=promisify(execFile),cli=path.resolve('bin/office.mjs');
async function fixture(t){const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'kitchen-attach-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));const a=path.join(home,'first'),b=path.join(home,"repo with spaces ' and $(literal)"),dir=path.join(home,'.codex/sessions/2024/01/02');await Promise.all([a,b,dir].map(d=>fs.mkdir(d,{recursive:true})));return {home,a,b,dir};}
const line=(payload,at,type='response_item')=>JSON.stringify({type,timestamp:new Date(at).toISOString(),payload})+'\n';
async function log(dir,root){const now=Date.now(),file=path.join(dir,'resumed.jsonl');await fs.writeFile(file,JSON.stringify({type:'session_meta',payload:{id:'resumed',cwd:root}})+'\n'+line({type:'task_started',turn_id:'one'},now-4,'event_msg')+line({type:'function_call',name:'update_plan',call_id:'plan',arguments:JSON.stringify({plan:[{step:'Check the current change',status:'in_progress'}]})},now-3)+line({type:'function_call_output',call_id:'plan',output:'Plan updated'},now-2)+line({type:'function_call',name:'Read',call_id:'read',arguments:JSON.stringify({file_path:'app.js',private:'do-not-show'})},now-1));return file;}

test('discovers an old resumed session and replays it only after its repo is selected',async t=>{
 const {home,a,b,dir}=await fixture(t);await log(dir,b);const roots=[a],store=new CrewStore(roots),observer=new LogObserver(home,store);await observer.poll();
 assert.equal(store.snapshot().length,0);assert.equal(observer.recentProjects[0].path,b);assert.ok(!JSON.stringify(observer.recentProjects).includes('do-not-show'));
 roots.push(b);await observer.poll();assert.equal(store.snapshot().length,1);assert.equal(store.snapshot()[0].state,'reading');assert.equal(store.snapshot()[0].sessionTasks[0].title,'Check the current change');
});
test('the CLI attaches a planless repo to the existing service and replays real log events',async t=>{
 const {home,a,b,dir}=await fixture(t);await log(dir,b);const stateDir=path.join(home,'state'),office=await startOffice({roots:[a],home,stateDir,port:0});t.after(()=>office.close());
 const before=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8'));
 const {stdout}=await run(process.execPath,[cli,b,'--state-dir',stateDir,'--no-open'],{timeout:10000});assert.match(stdout,/Kitchen updated:/);
 const printed=new URL(stdout.split('\n')[0].replace('Kitchen updated: ',''));assert.equal(printed.searchParams.get('project'),b);assert.equal(printed.searchParams.get('mode'),'live');
 const after=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8'));assert.equal(after.pid,before.pid);assert.equal(after.hookToken,before.hookToken);
 const state=await fetch(office.url+'/api/state').then(r=>r.json()),project=state.projects.find(p=>p.id===b);assert.equal(project.components.length,0);assert.equal(state.crew.filter(c=>c.project===b).length,4);assert.equal(state.executors.filter(c=>c.project===b).length,1);assert.equal(state.crew.find(c=>c.project===b&&c.workingCount).state,'reading');assert.equal(state.orders.filter(o=>o.project===b).length,1);assert.deepEqual(await fs.readdir(b),[]);
 await run(process.execPath,[cli,'--state-dir',stateDir,'--no-open'],{cwd:b,timeout:10000});assert.equal(office.snapshot().projects.length,2);
 const denied=await fetch(office.url+'/api/attach',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projects:[b]})});assert.equal(denied.status,403);
});
test('CLI arguments accept current/relative repos without shell interpretation and reject missing values',()=>{
 assert.deepEqual(parseArgs(['.','../other'], '/projects/one').roots,['/projects/one','/projects/other']);assert.throws(()=>parseArgs(['--project']),/Provide a value/);assert.throws(()=>parseArgs(['--port','no']),/Choose a port/);
 assert.equal(new URL(liveUrl('http://127.0.0.1:4780',"/repo/'literal' $(safe)")).searchParams.get('project'),"/repo/'literal' $(safe)");
});
test('a Codex call and result in the same millisecond cannot leave a phantom active tool',()=>{
 const store=new CrewStore(['/repo']),meta={id:'one',cwd:'/repo'},timestamp=new Date().toISOString();
 for(const payload of [{type:'function_call',call_id:'fast',name:'Read'},{type:'function_call_output',call_id:'fast'}])for(const event of codexEvents({type:'response_item',timestamp,payload},meta,'log'))store.accept(event);
 assert.equal(store.snapshot()[0].activeToolCount,0);
});
test('modern Claude tasks change only on confirmed tool results and keep native ordering',()=>{
 const store=new CrewStore(['/repo']);let count=0;
 const send=(tool,input,output,hook_event_name='PostToolUse')=>{const event=normalizeHook('claude',{session_id:'one',cwd:'/repo',hook_event_name,tool_name:tool,tool_input:input,tool_response:output,office_event_id:String(++count)});if(event)store.accept(event);};
 send('TaskCreate',{subject:'First',description:'private details'},{task:{id:'1',subject:'First',status:'pending'}});send('TaskCreate',{subject:'Second'},{task:{id:'2',subject:'Second',status:'pending'}});
 send('TaskUpdate',{taskId:'1',status:'completed'},{},'PostToolUseFailure');assert.equal(store.snapshot()[0].sessionTasks[0].status,'pending');
 send('TaskUpdate',{taskId:'1',status:'in_progress'},{});assert.deepEqual(store.snapshot()[0].sessionTasks.map(t=>t.id),['1','2']);assert.equal(store.snapshot()[0].sessionTasks[0].status,'in_progress');
 send('TaskUpdate',{taskId:'1',status:'completed'},{});assert.equal(store.snapshot()[0].sessionTasks[0].status,'completed');assert.ok(!JSON.stringify(store.snapshot()).includes('private details'));
 send('TaskUpdate',{taskId:'2',status:'deleted'},{});assert.equal(store.snapshot()[0].sessionTasks.length,1);
});
test('Claude log TaskUpdate waits for successful result and Cursor partial todos retain other items',()=>{
 const context={pending:new Map()},base={sessionId:'one',cwd:'/repo',timestamp:new Date().toISOString()},start=claudeEvents({...base,uuid:'start',type:'assistant',message:{content:[{type:'tool_use',id:'call',name:'TaskUpdate',input:{taskId:'1',status:'completed'}}]}},'log',context);assert.equal(start[0].taskChange,undefined);
 const end=claudeEvents({...base,uuid:'end',type:'user',message:{content:[{type:'tool_result',tool_use_id:'call',content:'{}'}]}},'log',context);assert.equal(end[0].taskChange.status,'completed');
 const store=new CrewStore(['/repo']);for(const [id,todos,merge] of [['one',[{id:'1',content:'First',status:'pending'},{id:'2',content:'Second',status:'pending'}],false],['two',[{id:'1',content:'First',status:'in_progress'}],true]])store.accept(normalizeHook('cursor',{hook_event_name:'postToolUse',conversation_id:'cursor-session',cwd:'/repo',office_event_id:id,tool_name:'TodoWrite',tool_input:{todos,merge}}));
 assert.equal(store.snapshot()[0].sessionTasks.length,2);assert.equal(store.snapshot()[0].sessionTasks.find(t=>t.id==='1').status,'in_progress');
 assert.equal(normalizeHook('cursor',{hook_event_name:'subagentStop',conversation_id:'parent',cwd:'/repo'}),null);
});
