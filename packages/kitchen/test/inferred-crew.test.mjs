import test from 'node:test';
import assert from 'node:assert/strict';
import {inferCrew} from '../src/agenttrail/crew-profile.mjs';
import {workflowConfig} from '../src/agenttrail/workflows.mjs';
import {workflowCrew,roleForSession} from '../src/runtime/workflow-crew.mjs';
import {CrewStore} from '../src/runtime/crew.mjs';
import {OrderStore} from '../src/runtime/orders.mjs';
import {codexEvents} from '../src/connectors/events.mjs';
import {desktopWork} from '../src/connectors/desktop-events.mjs';
import {IdentityBook} from '../public/src/activity.js';

const project={id:'/repo',name:'Simulation',components:[],kitchens:[{id:'shared',components:[]}],workflow:inferCrew(['src/world.js','sim/engine.js','research/notes.md','tests/engine.test.js'],'Simulation')};
const now=Date.now(),base={provider:'codex',sessionId:'one',cwd:'/repo',source:'log',turnId:'turn'};
const enriched=store=>store.snapshot().map(s=>({...s,planAvailable:!!s.sessionTasks,taskSource:'native plan',currentTask:s.sessionTasks?.find(t=>t.status==='in_progress')}));

test('ordinary repos get stable crews adapted to their actual responsibilities',()=>{
 assert.deepEqual(project.workflow.roles.map(r=>r.title),['Head chef','Researcher','World builder','Simulation engineer','Reviewer']);
 assert.deepEqual(inferCrew(['drafts/','publisher/'],'Posts').roles.map(r=>r.title),['Head chef','Researcher','Writer','Evaluator','Publisher']);
 const empty=inferCrew([],'Empty');assert.equal(empty.roles.length,4);assert.ok(empty.roles.every(r=>r.origin==='inferred'&&!r.components.length));
 const config=workflowConfig([],{version:1,kitchens:[],deliverables:[],workflow:{roles:[{id:'writer',title:'Copy editor',files:['copy/**'],category:'build'}]}},'Custom');
 assert.equal(config.workflow.roles[0].title,'Copy editor');assert.equal(config.workflow.origin,'configured');
 assert.equal(workflowConfig([],{workflow:false},'Opt out').workflow,false);
});
test('one session moves across five persistent chefs with only one current executor',()=>{
 const store=new CrewStore(['/repo'],()=>now+100),book=new IdentityBook();
 store.accept({...base,id:'start',at:now,kind:'turn-start'});
 const first=book.assign(workflowCrew([project],enriched(store)));
 store.accept({...base,id:'read',at:now+1,kind:'tool-start',tool:'Read',toolId:'read',file:'sim/engine.js'});
 const reading=book.assign(workflowCrew([project],enriched(store)));assert.equal(reading.find(r=>r.workingCount).roleId,'simulation-engineer');
 store.accept({...base,id:'read-end',at:now+2,kind:'tool-end',toolId:'read'});
 store.accept({...base,id:'read-meta',at:now+2,kind:'observation',work:{category:'research',label:'Read a file',file:'sim/engine.js',completed:true}});
 store.accept({...base,id:'browser',at:now+3,kind:'tool-start',tool:'js',toolId:'browser',work:{category:'review',label:'Inspecting the preview'}});
 const reviewing=book.assign(workflowCrew([project],enriched(store)));assert.equal(reviewing.find(r=>r.workingCount).roleId,'reviewer');
 assert.equal(reviewing.filter(r=>r.workingCount).length,1);assert.equal(reviewing.reduce((n,r)=>n+r.executors.length,0),1);
 assert.deepEqual(first.map(r=>[r.id,r.badge,r.visualIndex]),reviewing.map(r=>[r.id,r.badge,r.visualIndex]));
 assert.equal(reviewing.find(r=>r.roleId==='simulation-engineer').recentWork.file,'sim/engine.js');
 store.accept({...base,id:'end',at:now+4,kind:'turn-end'});assert.equal(workflowCrew([project],enriched(store)).filter(r=>r.workingCount).length,0);
 assert.equal(workflowCrew([project],enriched(store)).length,5);
});
test('completed desktop metadata enriches context without reviving a finished session or creating todos',()=>{
 const store=new CrewStore(['/repo'],()=>now+100);
 store.accept({...base,id:'start',at:now,kind:'turn-start'});store.accept({...base,id:'end',at:now+8,kind:'turn-end'});
 const row={type:'event_msg',timestamp:new Date(now+10).toISOString(),payload:{type:'item_completed',thread_id:'one',turn_id:'turn',completed_at_ms:now+7,item:{type:'CommandExecution',id:'read-result',status:'completed',parsed_cmd:[{type:'read',path:'sim/engine.js',cmd:'PRIVATE COMMAND'}],stdout:'PRIVATE OUTPUT'}}};
 for(const e of codexEvents(row,{id:'one',cwd:'/repo'},'file'))assert.equal(store.accept(e),true);
 const s=store.snapshot()[0];assert.equal(s.state,'complete');assert.equal(s.lastEventAt,now+8);assert.equal(s.workContext.file,'sim/engine.js');assert.equal(s.sessionTasks,undefined);assert.ok(!JSON.stringify(s).includes('PRIVATE'));
 row.payload.thread_id='other';assert.deepEqual(codexEvents(row,{id:'one',cwd:'/repo'},'file'),[]);
 store.accept({...base,turnId:'new',id:'new-turn',at:now+9,kind:'turn-start'});assert.equal(store.snapshot()[0].workContext,null);
});
test('desktop work accepts parsed operations and only gives compound commands a generic label',()=>{
 assert.equal(desktopWork({type:'CommandExecution',command:['/bin/zsh','-lc','npm test'],exit_code:0}).category,'review');
 assert.deepEqual(desktopWork({type:'CommandExecution',command:['sh','-c','echo "npm test"; PRIVATE BODY']}),{category:'execute',label:'Ran a command'});
 assert.equal(desktopWork({type:'CommandExecution',status:'failed',parsed_cmd:[{type:'read',path:'missing.js'}]}).label,'Tried reading a file');
 assert.equal(desktopWork({type:'Reasoning',summary_text:'I am reviewing'}),null);
 assert.equal(desktopWork({type:'AgentMessage',content:'Task complete'}),null);
 assert.equal(desktopWork({type:'McpToolCall',server:'cua_repl',arguments:{code:'PRIVATE'}}).label,'Inspected the preview');
});
test('a fresh generic command replaces stale preview context without inventing its intent',()=>{
 const store=new CrewStore(['/repo'],()=>now+100);
 store.accept({...base,id:'start',at:now,kind:'turn-start'});
 store.accept({...base,id:'preview',at:now+1,kind:'observation',work:{category:'review',label:'Inspected the preview',completed:true}});
 assert.equal(workflowCrew([project],enriched(store)).find(r=>r.workingCount).roleId,'reviewer');
 store.accept({...base,id:'command',at:now+2,kind:'observation',work:{...desktopWork({type:'CommandExecution',command:['sh','-c','PRIVATE BODY']}),completed:true}});
 const roles=workflowCrew([project],enriched(store)),active=roles.find(r=>r.workingCount);
 assert.equal(active.workContext.label,'Ran a command');assert.equal(active.roleId,'coordinator');
 assert.equal(roles.find(r=>r.roleId==='reviewer').workingCount,0);
 assert.ok(!JSON.stringify(roles).includes('PRIVATE'));assert.equal(active.sessionTasks,undefined);
});
test('inferred chefs contribute to the same native dish without copying its task or completing it',()=>{
 const store=new CrewStore(['/repo'],()=>now+100),orders=new OrderStore();store.onChange=()=>orders.observe([project],enriched(store));
 store.accept({...base,id:'start',at:now,kind:'turn-start'});
 store.accept({...base,id:'plan',at:now+1,kind:'tool-start',tool:'update_plan',toolId:'plan',tasks:[{id:'dish',title:'Make the crew visible',status:'in_progress'}]});
 store.accept({...base,id:'plan-end',at:now+2,kind:'tool-end',toolId:'plan'});
 for(const [index,file] of ['research/notes.md','src/world.js','tests/engine.test.js'].entries()){
  store.accept({...base,id:'r'+index,at:now+3+index*2,kind:'tool-start',tool:'Read',toolId:'r'+index,file});
  store.accept({...base,id:'e'+index,at:now+4+index*2,kind:'tool-end',toolId:'r'+index});
 }
 const state=orders.snapshot([project],enriched(store));assert.equal(state.orders.length,1);assert.equal(state.orders[0].status,'in_progress');
 assert.ok(['researcher','world-builder','reviewer'].every(id=>state.orders[0].contributors.some(c=>c.roleId===id)));
 assert.ok(state.orders[0].activeChefIds.length<=1);assert.equal(state.tables[0].completedIds.length,0);
});
test('explicit bindings win and an unrecognized binding never silently changes roles',()=>{
 const s={id:'codex:one',sessionId:'one',state:'working',project:'/repo',workContext:{category:'review'},roleBinding:{roleId:'world-builder'}};
 assert.equal(roleForSession(project,s).role.id,'world-builder');
 assert.equal(roleForSession(project,{...s,roleBinding:{roleId:'missing'}}),null);
});
