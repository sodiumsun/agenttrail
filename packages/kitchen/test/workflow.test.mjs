import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {workflowCrew,workflowPlates,roleForSession} from '../src/runtime/workflow-crew.mjs';
import {workflowConfig,workflowStations,WorkflowQueues} from '../src/agenttrail/workflows.mjs';
import {parsePlan} from '../src/agenttrail/projects.mjs';
import {kitchenMap} from '../src/agenttrail/kitchens.mjs';
import {CrewStore} from '../src/runtime/crew.mjs';
import {startOffice} from '../src/server.mjs';
import {activityText,goalCards,rankedGoals,IdentityBook} from '../public/src/activity.js';
import {stationLayout} from '../public/src/layout.js';
import {routeBetween,walkable} from '../public/src/routes.js';

const components=['research','radar','write','evaluate','queue','publisher','distill','manager'].map(id=>({id,title:id,files:[],tasks:[{id:id+'-task',title:'Work on '+id,state:'x'}],kind:id==='queue'?'human':id==='distill'?'knowledge':undefined}));
const config=workflowConfig(components,null,'Reddit loop'),p={id:'/project',components,...kitchenMap(components,config),workflow:config.workflow};
const session=(extra={})=>({id:'codex:one',sessionId:'one',provider:'codex',project:p.id,state:'writing',freshness:'recent',lastEventAt:Date.now(),recent:[],...extra});

test('a coherent Reddit workflow gets five persistent roles and distinct human and knowledge stations',()=>{
  assert.deepEqual(p.workflow.roles.map(r=>r.id),['researcher','writer','evaluator','publisher','head-chef']);
  assert.equal(p.kitchens.length,1);assert.equal(p.kitchens[0].components.length,8);
  assert.equal(workflowStations(components,p.workflow.roles).length,7);
  const crew=workflowCrew([p],[]);assert.equal(crew.length,5);assert.ok(crew.every(c=>c.state==='idle'&&c.executors.length===0));
  const cards=goalCards(p,crew);assert.equal(rankedGoals(cards,{kitchenId:p.kitchens[0].id}).length,8);
  assert.equal(cards.find(c=>c.id==='queue').chefs.length,0);assert.equal(cards.find(c=>c.id==='distill').chefs[0].roleId,'head-chef');
  const activeCards=goalCards(p,workflowCrew([p],[session({component:{id:'research'}})]));
  assert.equal(activeCards.find(c=>c.id==='research').chefs[0].state,'writing');
  assert.equal(activeCards.find(c=>c.id==='radar').chefs[0].state,'idle');
  assert.match(activeCards.find(c=>c.id==='radar').chefs[0].roleStatus,/Working on research/);
});
test('generic projects adapt roles to components and configuration remains optional and compatible',()=>{
  const nodes=parsePlan('## Draw things {#draw}\n- [x] Paint {#paint}\n## Review {#review}\nkind: human\nurl: http://localhost:5350\n## Store context {#context}\nkind: knowledge');
  assert.equal(nodes[1].kind,'human');assert.equal(nodes[1].url,'http://localhost:5350');
  const generated=workflowConfig(nodes,null,'Canvas');assert.deepEqual(generated.workflow.roles.map(r=>r.id),['draw']);assert.equal(generated.workflow.id,'project');
  assert.equal(workflowConfig(nodes,{version:1,kitchens:[],deliverables:[],workflow:false},'Canvas').workflow,false);
  assert.equal(workflowConfig([],null,'Empty'),null);
});
test('one session changes roles without changing the lineup or its visual identities',()=>{
  const book=new IdentityBook(),first=book.assign(workflowCrew([p],[session({component:{id:'write'}})]));
  const second=book.assign(workflowCrew([p],[session({component:{id:'evaluate'},state:'reading'})]));
  assert.equal(first.length,5);assert.equal(second.length,5);
  assert.deepEqual(first.map(c=>[c.id,c.visualIndex,c.badge]),second.map(c=>[c.id,c.visualIndex,c.badge]));
  assert.equal(second.find(c=>c.roleId==='writer').state,'idle');assert.equal(second.find(c=>c.roleId==='evaluator').state,'reading');
  assert.match(activityText(second.find(c=>c.roleId==='evaluator')),/Codex/);
});
test('explicit role wins over reading another role input, with concurrency and unknown links kept visible',()=>{
  const writer=session({roleBinding:{roleId:'writer',workflowId:'project'},component:{id:'research'},currentTask:{title:'Work on research'}});
  assert.equal(roleForSession(p,writer).role.id,'writer');
  const crew=workflowCrew([p],[writer,session({id:'claude:two',sessionId:'two',provider:'claude',component:{id:'write'}}),session({id:'cursor:unknown',roleBinding:{roleId:'missing'},component:{id:'write'}})]);
  const chef=crew.find(c=>c.roleId==='writer');assert.equal(chef.executors.length,2);assert.equal(chef.workingCount,2);assert.equal(crew.filter(c=>c.unlinkedRole).length,1);
  assert.equal(roleForSession(p,session({currentTask:{title:'Work on evaluate'}})).role.id,'evaluator');
  const quiet=workflowCrew([p],[session({component:{id:'write'},freshness:'quiet'})]).find(c=>c.roleId==='writer');assert.equal(quiet.workingCount,0);assert.match(activityText(quiet),/Last seen/);
});
test('binding events cannot invent work, revive stale observations, cross projects or rewind bindings',()=>{
  const now=Date.now(),store=new CrewStore([p.id,'/another'],()=>now);
  const base={provider:'codex',sessionId:'one',cwd:p.id,source:'hook',at:now-200_000};
  assert.equal(store.accept({...base,id:'no-session',kind:'role',roleId:'writer'}),false);
  store.accept({...base,id:'start',kind:'turn-start'});
  store.accept({...base,id:'binding',at:now-10,kind:'role',roleId:'writer'});
  assert.equal(store.snapshot()[0].freshness,'quiet');
  assert.equal(store.accept({...base,id:'old-binding',at:now-20,kind:'role',roleId:'evaluator'}),false);
  assert.equal(store.accept({...base,id:'cross-project',at:now,kind:'role',cwd:'/another',roleId:'evaluator'}),false);
  store.accept({...base,id:'clear',at:now,kind:'role',roleId:null});assert.equal(store.snapshot()[0].roleBinding,null);
});
test('expanded station positions retain reachable counter routes without crossing the pass',()=>{
  const layout=stationLayout(7);assert.equal(layout.columns,4);assert.equal(layout.positions.length,8);
  const route=routeBetween([-8.1,-2.32],[8.1,2.42],layout.walkWidth);assert.ok(route.length>2);
  for(let i=1;i<route.length;i++)for(let t=0;t<1;t+=.05)assert.ok(walkable(route[i-1][0]+(route[i][0]-route[i-1][0])*t,route[i-1][1]+(route[i][1]-route[i-1][1])*t,layout.walkWidth));
});
test('workflow queues use recorded item state, keep bodies private and invalidate observed stale evaluations',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kitchen-queue-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await Promise.all(['drafts','evals','publisher'].map(d=>fs.mkdir(path.join(root,d))));
  const draft=(approved,body)=>`---\ntitle_a: Test item\nstatus: draft\napproved: ${approved}\ncreated_at: 2026-09-08T12:00:00Z\n---\n${body}`;
  await fs.writeFile(path.join(root,'drafts/one.md'),draft('no','PRIVATE BODY'));await fs.writeFile(path.join(root,'evals/one.md'),'Verdict: SHIP');
  const adapter=new WorkflowQueues();let queue=await adapter.snapshot(root);assert.equal(queue.counts.queue,1);assert.ok(!JSON.stringify(queue).includes('PRIVATE BODY'));
  await fs.writeFile(path.join(root,'drafts/one.md'),draft('yes','PRIVATE BODY'));queue=await adapter.snapshot(root);assert.equal(queue.counts.publisher,1);assert.equal(queue.items[0].stale,false);
  await fs.writeFile(path.join(root,'drafts/one.md'),draft('yes','CHANGED PRIVATE BODY'));queue=await adapter.snapshot(root);assert.equal(queue.counts.evaluate,1);assert.equal(queue.items[0].stale,true);
  await fs.writeFile(path.join(root,'evals/one.md'),'New review\nVerdict: REVISE');queue=await adapter.snapshot(root);assert.equal(queue.counts.write,1);
  await fs.writeFile(path.join(root,'drafts/closed.md'),'---\nstatus: abandoned\n---\nPRIVATE');queue=await adapter.snapshot(root);assert.equal(queue.counts.history,1);
  assert.equal(workflowPlates([{...p,workflow:{...p.workflow,queue}}]).length,2);
  await fs.writeFile(path.join(root,'drafts/unknown.md'),'incomplete draft');queue=await adapter.snapshot(root);assert.equal(queue.counts.unknown,1);
});
test('the server exposes several role chefs with one real execution stream',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'kitchen-workflow-http-')),root=path.join(home,'project'),stateDir=path.join(home,'state');await fs.mkdir(root);
  await fs.writeFile(path.join(root,'PLAN.md'),'## Research {#research}\nfiles: [research/**]\n## Write {#write}\nfiles: [drafts/**]\n## Evaluate {#evaluate}\nfiles: [evals/**]');
  const office=await startOffice({roots:[root],home,stateDir,port:0,observe:false});t.after(async()=>{await office.close();await fs.rm(home,{recursive:true,force:true});});
  const registration=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8')),headers={'content-type':'application/json',authorization:`Bearer ${registration.hookToken}`};
  const send=async e=>fetch(office.url+'/api/hook',{method:'POST',headers,body:JSON.stringify({provider:'codex',sessionId:'one',cwd:root,...e})}).then(r=>r.json());
  assert.equal(office.snapshot().crew.length,3);
  await send({id:'read',kind:'tool-start',tool:'Read',file:'research/notes.md'});assert.equal(office.snapshot().crew.find(c=>c.roleId==='research').state,'reading');
  await send({id:'role',kind:'role',roleId:'write'});assert.equal(office.snapshot().crew.find(c=>c.roleId==='write').state,'reading');assert.equal(office.snapshot().crew.find(c=>c.roleId==='research').state,'idle');
  await send({id:'finish',kind:'turn-end'});assert.equal(office.snapshot().crew.length,3);assert.equal(office.snapshot().executors.length,1);
});
