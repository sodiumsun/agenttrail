import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan } from '../src/agenttrail/projects.mjs';
import { kitchenMap } from '../src/agenttrail/kitchens.mjs';

const components=parsePlan('## Read input {#input}\nneeds: [api]\nlinks: [view]\nfiles: [src/input/**]\n- [x] Read files {#read}\n  by: codex\n  from: agent\n## Build API {#api}\n- [~] Return a response {#response}\n## Draw view {#view}\n- [!] Show the result {#result}');
test('plan relationships and task identity survive parsing',()=>{
  assert.deepEqual(components[0].needs,['api']);assert.deepEqual(components[0].links,['view']);
  assert.equal(components[0].tasks[0].id,'read');assert.equal(components[0].tasks[0].by,'codex');assert.equal(components[0].tasks[0].from,'agent');
});
test('deliverables span kitchens without duplicating task progress',()=>{
  const m=kitchenMap(components,{version:1,kitchens:[{id:'back',title:'Back kitchen',components:['input','api']},{id:'front',title:'Front kitchen',components:['view']}],deliverables:[{id:'ship',title:'Ship the viewer',tasks:['read','read','response','result']}]});
  assert.deepEqual(m.deliverables[0].counts,{total:3,done:1,active:1,blocked:1});assert.deepEqual(m.deliverables[0].kitchenIds,['back','front']);assert.equal(m.deliverables[0].status,'blocked');
});
test('configuration cannot hide components or claim missing work complete',()=>{
  const m=kitchenMap(components,{version:1,kitchens:[{id:'one',components:['input','missing']},{id:'two',components:['input']}],deliverables:[{id:'ship',tasks:['read','unknown']}]});
  assert.deepEqual(m.kitchens.flatMap(k=>k.components).sort(),['api','input','view']);assert.equal(m.deliverables[0].status,'unknown');assert.ok(m.warnings.length>=3);
  assert.equal(kitchenMap(components,{version:9}).deliverables.length,3);
});
test('default kitchens stay stable across activity and handle a planless project',()=>{
  const a=kitchenMap(components),b=kitchenMap(components.map(c=>({...c,tasks:c.tasks.map(t=>({...t,state:'x'}))})));
  assert.deepEqual(a.kitchens.map(k=>[k.id,k.components]),b.kitchens.map(k=>[k.id,k.components]));assert.equal(kitchenMap([]).kitchens.length,1);assert.equal(kitchenMap([]).deliverables.length,0);
});
test('large configured kitchens split into readable rooms without losing components',()=>{
  const many=Array.from({length:9},(_,i)=>({id:'c'+i,title:'Component '+i,files:[],tasks:[]}));
  const result=kitchenMap(many,{version:1,kitchens:[{id:'large',title:'Large kitchen',components:many.map(c=>c.id)}],deliverables:[]});
  assert.deepEqual(result.kitchens.map(k=>k.components.length),[4,4,1]);assert.equal(new Set(result.kitchens.flatMap(k=>k.components)).size,9);
});

import {Projects} from '../src/agenttrail/projects.mjs';
import {CrewStore} from '../src/runtime/crew.mjs';
function bridgeFixture(){const root='/work/project',store=new CrewStore([root]),projects=new Projects([root],'/home',store);projects.data.set(root,{components:[{id:'ui',title:'Draw UI',files:['public/**'],tasks:[]},{id:'api',title:'Build API',files:['src/**'],tasks:[]},{id:'shared',title:'Shared file',files:['shared.js'],tasks:[]},{id:'overlap',title:'Another owner',files:['shared.js'],tasks:[]}]});return {root,store,projects};}
test('board todos augment a native session without replacing its newer action or copying tool payloads',()=>{
 const {root,store,projects}=bridgeFixture(),at=Date.now();
 store.accept({id:'native',provider:'codex',sessionId:'one',cwd:root,at,source:'log',kind:'tool-start',tool:'Read',file:'public/app.js',toolId:'read'});
 projects.applyBoard(root,{runs:[{id:'one',agent:'codex',lastEventAt:at-10,componentId:'ui',ended:true,currentTool:{name:'Bash',detail:'PRIVATE COMMAND'},todos:[{content:'Keep labels readable',status:'in_progress'}],prompt:'PRIVATE PROMPT'}]});
 const s=projects.enrich(store.snapshot())[0];assert.equal(s.state,'reading');assert.equal(s.ended,false);assert.equal(s.currentTask.title,'Keep labels readable');assert.equal(s.component.id,'ui');assert.equal(s.association.kind,'inferred');assert.ok(!JSON.stringify(s).includes('PRIVATE'));
});
test('board lifecycle ends imported runs, and overlapping file ownership stays uncertain',()=>{
 const {root,store,projects}=bridgeFixture(),at=Date.now();
 projects.applyBoard(root,{runs:[{id:'board',agent:'claude',lastEventAt:at-1,componentId:'ui',currentTool:{name:'Edit'}}]});
 assert.equal(projects.enrich(store.snapshot())[0].component.id,'ui');
 projects.applyBoard(root,{runs:[{id:'board',agent:'claude',lastEventAt:at,ended:true}]});assert.equal(store.snapshot()[0].ended,true);
 store.accept({id:'shared',provider:'codex',sessionId:'two',cwd:root,at,source:'log',kind:'tool-start',tool:'Edit',file:'shared.js'});
 const s=projects.enrich(store.snapshot()).find(s=>s.sessionId==='two');assert.equal(s.component,null);assert.equal(s.association.kind,'unknown');assert.deepEqual(s.componentCandidates,['shared','overlap']);
});
test('conflicting associations are not silently converted into a confirmed assignment',()=>{
 const {root,store,projects}=bridgeFixture(),at=Date.now();
 store.accept({id:'native',provider:'codex',sessionId:'one',cwd:root,at:at-100,source:'log',kind:'tool-start',tool:'Read',file:'public/app.js'});
 projects.applyBoard(root,{runs:[{id:'one',agent:'codex',lastEventAt:at-50,componentId:'api',todos:[]}]});
 assert.equal(projects.enrich(store.snapshot())[0].component,null);
 store.accept({id:'new',provider:'codex',sessionId:'one',cwd:root,at,source:'log',kind:'tool-start',tool:'Edit',file:'public/new.js'});
 assert.equal(projects.enrich(store.snapshot())[0].component.id,'ui');
});
