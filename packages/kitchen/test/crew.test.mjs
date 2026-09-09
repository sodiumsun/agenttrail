import test from 'node:test';
import assert from 'node:assert/strict';
import { CrewStore } from '../src/runtime/crew.mjs';
import { normalizeHook,codexEvents } from '../src/connectors/events.mjs';
import { matchesGlob,parsePlan } from '../src/agenttrail/projects.mjs';

const now=Date.now();
const event=(overrides={})=>({id:'event-1',provider:'claude',sessionId:'parent',cwd:'/work/project',at:now,source:'hook',kind:'turn-start',...overrides});
test('duplicates, replay and unrelated projects cannot create or rewind crew',()=>{
  const store=new CrewStore(['/work/project'],()=>now+1000);
  assert.equal(store.accept(event()),true);assert.equal(store.accept(event()),false);
  store.accept(event({id:'write',at:now+100,kind:'tool-start',tool:'Edit',toolId:'a'}));
  store.accept(event({id:'old-stop',at:now-1,kind:'turn-end'}));
  assert.equal(store.snapshot()[0].state,'writing');
  assert.equal(store.accept(event({id:'outside',cwd:'/work/project-other'})),false);
  assert.equal(store.snapshot().length,1);
});
test('concurrent tools and out-of-order child completions preserve exact identities',()=>{
  const store=new CrewStore(['/work/project'],()=>now+1000);
  for(const child of ['a','b'])store.accept(event({id:child,sessionId:child,parentId:'parent',kind:'session-start'}));
  store.accept(event({id:'b-end',sessionId:'b',kind:'turn-end',at:now+2}));
  assert.equal(store.sessions.get('claude:a').state,'working');assert.equal(store.sessions.get('claude:b').state,'complete');
  store.accept(event({id:'a-tool',sessionId:'a',kind:'tool-start',tool:'Read',toolId:'r',at:now+3}));
  store.accept(event({id:'a-tool2',sessionId:'a',kind:'tool-start',tool:'Shell',toolId:'s',at:now+4}));
  store.accept(event({id:'a-toolend',sessionId:'a',kind:'tool-end',toolId:'r',at:now+5}));
  assert.equal(store.sessions.get('claude:a').state,'executing');
});
test('permission persists through quiet observation; a completed turn retains the session',()=>{
  let clock=now;const store=new CrewStore(['/work/project'],()=>clock);
  store.accept(event({kind:'permission'}));clock+=180000;
  assert.equal(store.snapshot()[0].state,'permission');assert.equal(store.snapshot()[0].freshness,'quiet');
  store.accept(event({id:'turn-end',kind:'turn-end',at:clock}));
  assert.equal(store.snapshot()[0].state,'complete');assert.equal(store.snapshot()[0].ended,false);
  store.accept(event({id:'end',kind:'session-end',at:clock+1}));assert.equal(store.snapshot()[0].ended,true);
});
test('native hook shapes preserve children and discard raw user content',()=>{
  const cursor=normalizeHook('cursor',{hook_event_name:'subagentStop',conversation_id:'parent',parent_conversation_id:'parent',subagent_id:'b',workspace_roots:['/work/project'],office_event_id:'x',task:'private prompt',user_email:'private@example.test'},now);
  assert.equal(cursor.sessionId,'b');assert.equal(cursor.parentId,'parent');assert.equal(cursor.kind,'turn-end');
  assert.ok(!JSON.stringify(cursor).includes('private'));
  const claude=normalizeHook('claude',{session_id:'p',agent_id:'c',cwd:'/work/project',hook_event_name:'PreToolUse',office_event_id:'x',tool_name:'Bash',tool_input:{command:'secret command'}},now);
  assert.equal(claude.sessionId,'c');assert.equal(claude.parentId,'p');assert.ok(!JSON.stringify(claude).includes('secret'));
});
test('a delayed completion from an earlier turn cannot finish the current turn',()=>{
  const store=new CrewStore(['/work/project'],()=>now+1000);
  store.accept(event({id:'first',turnId:'one'}));
  store.accept(event({id:'second',turnId:'two',at:now+1}));
  store.accept(event({id:'late-first',turnId:'one',kind:'turn-end',at:now+2}));
  assert.equal(store.snapshot()[0].turnId,'two');assert.equal(store.snapshot()[0].state,'working');
  assert.equal(store.accept(event({id:'bad',sessionId:{malformed:true}})),false);
});
test('Codex uses thread identity and lifecycle evidence without exposing arguments',()=>{
  const meta={id:'thread',cwd:'/work/project'};
  const start=codexEvents({type:'event_msg',timestamp:new Date(now).toISOString(),payload:{type:'task_started',turn_id:'turn'}},meta,'log')[0];
  assert.equal(start.kind,'turn-start');assert.equal(start.sessionId,'thread');
  const tool=codexEvents({type:'response_item',timestamp:new Date(now).toISOString(),payload:{type:'function_call',call_id:'1',name:'exec_command',arguments:'{"cmd":"secret"}'}},meta,'log')[0];
  assert.equal(tool.tool,'exec_command');assert.ok(!JSON.stringify(tool).includes('secret'));
});
test('component matching handles direct, nested and literal filenames',()=>{
  assert.ok(matchesGlob('public/app.js','public/**'));assert.ok(matchesGlob('src/app.js','src/**/*.js'));assert.ok(matchesGlob('src/a/app.js','src/**/*.js'));
  assert.ok(!matchesGlob('src/a/app.js','src/*.js'));assert.ok(matchesGlob('file.test.js','file.test.js'));assert.ok(!matchesGlob('fileXtestXjs','file.test.js'));
  const parsed=parsePlan('## Show work {#work}\nfiles: [public/**]\n- [~] Draw the crew {#crew}\n  by: codex\n## decisions\n- anything');
  assert.equal(parsed[0].tasks[0].title,'Draw the crew');assert.equal(parsed[0].files[0],'public/**');
});

test('current files follow active parallel tools while the last touched file remains context',()=>{
 const store=new CrewStore(['/work/project'],()=>now+1000);
 store.accept(event({id:'read',kind:'tool-start',tool:'Read',toolId:'r',file:'src/a.js'}));
 store.accept(event({id:'shell',kind:'tool-start',tool:'Bash',toolId:'b',at:now+1}));
 assert.equal(store.snapshot()[0].currentFile,null);assert.equal(store.snapshot()[0].file,'src/a.js');assert.equal(store.snapshot()[0].activeToolCount,2);
 store.accept(event({id:'shell-end',kind:'tool-end',toolId:'b',at:now+2}));assert.equal(store.snapshot()[0].currentFile,'src/a.js');
 store.accept(event({id:'read-end',kind:'tool-end',toolId:'r',at:now+3}));assert.equal(store.snapshot()[0].currentFile,null);assert.equal(store.snapshot()[0].activeToolCount,0);
});
test('Codex structured plan steps and patch headers expose useful metadata without patch bodies',()=>{
 const meta={id:'thread',cwd:'/work/project'},base={type:'response_item',timestamp:new Date(now).toISOString()};
 const plan=codexEvents({...base,payload:{type:'function_call',call_id:'p',name:'update_plan',arguments:JSON.stringify({explanation:'PRIVATE EXPLANATION',plan:[{step:'Connect goal cards',status:'in_progress'}]})}},meta,'log')[0];
 assert.equal(plan.tasks[0].title,'Connect goal cards');assert.ok(!JSON.stringify(plan).includes('PRIVATE'));
 const patch=codexEvents({...base,payload:{type:'custom_tool_call',call_id:'patch',name:'apply_patch',input:'*** Begin Patch\n*** Update File: public/app.js\n@@\n+PRIVATE BODY\n*** End Patch'}},meta,'log')[0];
 assert.equal(patch.file,'public/app.js');assert.ok(!JSON.stringify(patch).includes('PRIVATE'));
});
