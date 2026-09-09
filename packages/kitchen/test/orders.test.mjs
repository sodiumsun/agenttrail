import test from 'node:test';
import assert from 'node:assert/strict';
import {OrderStore} from '../src/runtime/orders.mjs';
import {CrewStore} from '../src/runtime/crew.mjs';
import {codexEvents,normalizeHook} from '../src/connectors/events.mjs';

const p={id:'/repo',name:'Weekly posts',components:[{id:'research',tasks:[]},{id:'write',tasks:[]}],workflow:{id:'project',roles:[{id:'researcher',title:'Researcher',components:['research']},{id:'writer',title:'Writer',components:['write']}]}};
const task=(title,status='in_progress',id)=>({...id?{id}:{},title,status});
const session=(extra={})=>({id:'codex:a',sessionId:'a',provider:'codex',project:p.id,planAvailable:true,taskSource:'native plan',sessionTasks:[task('Prepare weekly post')],contextAt:100,lastEventAt:100,state:'reading',freshness:'recent',component:{id:'research'},...extra});

test('a native todo keeps the same dish through sequential roles; only the current chef is active',()=>{
 const store=new OrderStore();let state=store.snapshot([p],[session()]),id=state.orders[0].id;
 state=store.snapshot([p],[session({component:{id:'write'},state:'writing',lastEventAt:200})]);
 assert.equal(state.orders[0].id,id);assert.deepEqual(state.orders[0].contributors.map(c=>c.roleId),['researcher','writer']);assert.deepEqual(state.orders[0].activeChefIds,['role:/repo:project:writer']);
 state=store.snapshot([p],[session({state:'complete',lastEventAt:300})]);assert.equal(state.orders[0].status,'in_progress');assert.equal(state.tables[0].completedIds.length,0);assert.equal(state.orders[0].activeChefIds.length,0);
});
test('completion, reopening and withdrawal are distinct from turn completion',()=>{
 const store=new OrderStore();store.snapshot([p],[session()]);
 let state=store.snapshot([p],[session({sessionTasks:[task('Prepare weekly post','completed')],contextAt:200})]);
 assert.equal(state.tables[0].completedIds.length,1);assert.equal(state.orders[0].completionVersion,1);
 state=store.snapshot([p],[session({sessionTasks:[task('Prepare weekly post','in_progress')],contextAt:300})]);assert.equal(state.tables[0].completedIds.length,0);assert.equal(state.orders[0].completedAt,null);
 state=store.snapshot([p],[session({sessionTasks:[],contextAt:400})]);assert.equal(state.orders[0].withdrawn,true);assert.equal(state.tables[0].completedIds.length,0);
});
test('native IDs preserve renamed and reordered tasks; ambiguous title edits never merge work',()=>{
 const store=new OrderStore();let state=store.snapshot([p],[session({sessionTasks:[task('First','pending','a'),task('Second','pending','b')]})]);const ids=Object.fromEntries(state.orders.map(o=>[o.nativeId,o.id]));
 state=store.snapshot([p],[session({sessionTasks:[task('Renamed second','pending','b'),task('First','pending','a')],contextAt:200})]);assert.equal(state.orders.find(o=>o.nativeId==='b').id,ids.b);assert.equal(state.orders.find(o=>o.nativeId==='b').index,0);
 const ambiguous=new OrderStore();state=ambiguous.snapshot([p],[session({sessionTasks:[task('Read'),task('Read')]})]);const old=state.orders.map(o=>o.id);
 state=ambiguous.snapshot([p],[session({sessionTasks:[task('Read')],contextAt:200})]);assert.equal(state.orders.filter(o=>!o.withdrawn).length,1);assert.ok(!old.includes(state.orders.find(o=>!o.withdrawn).id));
});
test('same text in different sessions stays separate unless another executor explicitly binds to the dish',()=>{
 const store=new OrderStore(),a=session(),b=session({id:'claude:b',provider:'claude',sessionId:'b',component:{id:'write'}});
 let state=store.snapshot([p],[a,b]);assert.equal(state.orders.length,2);
 const id=state.orders.find(o=>o.sessionId===a.id).id;
 state=store.snapshot([p],[a,{...b,roleBinding:{roleId:'writer',orderId:id,at:200}}]);const shared=state.orders.find(o=>o.id===id);assert.equal(shared.activeChefIds.length,2);assert.equal(shared.contributors.length,2);
 const foreign={...p,id:'/foreign'};state=store.snapshot([p,foreign],[a,{...b,project:foreign.id,roleBinding:{roleId:'writer',orderId:id}}]);assert.equal(state.orders.find(o=>o.id===id).activeChefIds.length,1);
});
test('no native plan yields unknown progress without turning project components into orders',()=>{
 const store=new OrderStore();const state=store.snapshot([p],[session({planAvailable:false,sessionTasks:[]})]);assert.equal(state.orders.length,0);assert.equal(state.unplanned[0].progress,null);assert.equal(state.tables[0].reported,false);
});
test('event observation retains intermediate role contributions even before the next browser snapshot',()=>{
 let now=1000;const crew=new CrewStore([p.id],()=>now),orders=new OrderStore();
 crew.onChange=s=>orders.observe([p],[{...s,planAvailable:!!s.sessionTasks,contextAt:s.taskContextAt,taskSource:'native plan'}]);
 const send=e=>crew.accept({provider:'codex',sessionId:'a',cwd:p.id,id:String(++now),at:now,source:'hook',...e});
 send({kind:'turn-start'});send({kind:'role',roleId:'researcher'});send({kind:'activity',tool:'Read',tasks:[task('Shared order')]});send({kind:'role',roleId:'writer'});send({kind:'activity',tool:'Edit'});send({kind:'turn-end'});
 const state=orders.snapshot([p],crew.snapshot().map(s=>({...s,planAvailable:!!s.sessionTasks,contextAt:s.taskContextAt,taskSource:'native plan'})));assert.deepEqual(state.orders[0].contributors.map(c=>c.roleId),['researcher','writer']);assert.equal(state.orders[0].activeChefIds.length,0);
});
test('native adapters retain task IDs and do not expose unrelated fields',()=>{
 const input={todos:[{id:'native-1',content:'Read notes',status:'in_progress',private:'secret'}]};
 const event=normalizeHook('claude',{hook_event_name:'PostToolUse',session_id:'s',cwd:p.id,tool_name:'TodoWrite',tool_input:input});assert.deepEqual(event.tasks,[task('Read notes','in_progress','native-1')]);
 const [e]=codexEvents({timestamp:new Date().toISOString(),type:'response_item',payload:{type:'function_call',name:'update_plan',arguments:JSON.stringify({plan:[{id:'x',step:'Cook',status:'pending'}]})}},{id:'s',cwd:p.id},'file');assert.deepEqual(e.tasks,[task('Cook','pending','x')]);
});

test('plan bookkeeping does not invent cooking on the newly marked in-progress task',()=>{
 const store=new OrderStore();const state=store.snapshot([p],[session({tool:'TodoWrite',state:'working'})]);assert.equal(state.orders[0].contributors.length,0);assert.equal(state.orders[0].activeChefIds.length,0);
});
test('a returning native task ID retains history and changing plan scope retires earlier tickets',()=>{
 const store=new OrderStore();let state=store.snapshot([p],[session({planId:'one',sessionTasks:[task('First','in_progress','a')]})]);const id=state.orders[0].id;
 store.snapshot([p],[session({planId:'one',sessionTasks:[],contextAt:200})]);state=store.snapshot([p],[session({planId:'one',sessionTasks:[task('First again','in_progress','a')],contextAt:300})]);assert.equal(state.orders.filter(o=>!o.withdrawn)[0].id,id);
 state=store.snapshot([p],[session({planId:'two',sessionTasks:[task('Other work','in_progress','a')],contextAt:400})]);assert.equal(state.orders.filter(o=>!o.withdrawn).length,1);assert.notEqual(state.orders.find(o=>!o.withdrawn).id,id);
});
