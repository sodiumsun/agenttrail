import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHook,claudeEvents} from '../src/connectors/events.mjs';
import {CrewStore} from '../src/runtime/crew.mjs';

const subject='Write implementable game-rules brief in research/RULES.md';
const created=`Task #1 created successfully: ${subject}`;
const hook=(tool,input,output,extra={})=>normalizeHook('claude',{session_id:'one',cwd:'/repo',hook_event_name:'PostToolUse',tool_name:tool,tool_input:input,tool_response:output,...extra});
function fromLog(tool,input,output,is_error=false){
  const context={pending:new Map()},base={sessionId:'one',cwd:'/repo',timestamp:new Date().toISOString()};
  const start=claudeEvents({...base,uuid:'start',type:'assistant',message:{content:[{type:'tool_use',id:'call',name:tool,input}]}},'log',context);
  const retained=JSON.stringify([...context.pending.values()]);
  const end=claudeEvents({...base,uuid:'end',type:'user',message:{content:[{type:'tool_result',tool_use_id:'call',content:output,is_error}]}},'log',context);
  return {start,event:end[0],retained,context};
}

test('Claude native text receipts create and update a dish through hooks without private fields',()=>{
  const input={subject,description:'PRIVATE DESCRIPTION',activeForm:'PRIVATE ACTIVE FORM',status:'completed'};
  const create=hook('TaskCreate',input,created,{office_event_id:'create'});
  assert.deepEqual(create.taskChange,{id:'1',title:subject,status:'pending'});
  const update=hook('TaskUpdate',{taskId:'1',status:'in_progress',owner:'PRIVATE OWNER'},'Updated task #1 owner, status',{office_event_id:'update'});
  assert.deepEqual(update.taskChange,{id:'1',status:'in_progress'});
  const store=new CrewStore(['/repo']);store.accept(create);store.accept(update);
  assert.equal(store.snapshot()[0].sessionTasks[0].status,'in_progress');
  assert.ok(!JSON.stringify({create,update,snapshot:store.snapshot()}).includes('PRIVATE'));
});

test('Claude logs match successful native acknowledgements to their pending calls',()=>{
  const create=fromLog('TaskCreate',{subject,description:'PRIVATE DESCRIPTION',activeForm:'PRIVATE ACTIVE FORM'},[{type:'text',text:created}]);
  assert.equal(create.start[0].taskChange,undefined);
  assert.deepEqual(create.event.taskChange,{id:'1',title:subject,status:'pending'});
  assert.equal(create.context.pending.size,0);assert.ok(!JSON.stringify(create).includes('PRIVATE'));
  const update=fromLog('TaskUpdate',{taskId:'1',status:'completed'},[{type:'text',text:'Updated task #1 owner, status'}]);
  assert.deepEqual(update.event.taskChange,{id:'1',status:'completed'});
  assert.deepEqual(hook('TaskCreate',{subject},{content:[{type:'text',text:created}]}).taskChange,create.event.taskChange);
});

test('plain acknowledgements reject mismatches, failure text, and unconfirmed status changes',()=>{
  const invalid=[
    ['TaskCreate',{subject},'Task #1 failed to create: '+subject],
    ['TaskCreate',{subject},'I think '+created],
    ['TaskCreate',{subject},created+'\nBut it failed'],
    ['TaskUpdate',{taskId:'1',status:'completed'},'Updated task #2 owner, status'],
    ['TaskUpdate',{taskId:'1',status:'completed'},'Failed to update task #1 status'],
    ['TaskUpdate',{taskId:'1',status:'completed'},'Updated task #1 owner'],
    ['TaskUpdate',{taskId:'1',status:'completed'},'Updated task #1 status failed'],
    ['TaskUpdate',{taskId:'1',status:'completed'},'Updated task #1 status\nReasoning: done'],
    ['TaskUpdate',{taskId:'1',status:'completed'},'"failed"'],
    ['TaskUpdate',{taskId:'1',status:'completed'},[{type:'text',text:'Updated task #1 status'},{type:'text',text:'Actually failed'}]],
  ];
  for(const [tool,input,output] of invalid){
    assert.equal(hook(tool,input,output).taskChange,undefined,JSON.stringify(output));
    assert.equal(fromLog(tool,input,output).event.taskChange,undefined,JSON.stringify(output));
  }
});

test('failure flags override acknowledgements and existing structured results remain supported',()=>{
  assert.equal(hook('TaskCreate',{subject},created,{hook_event_name:'PostToolUseFailure'}).taskChange,undefined);
  assert.equal(hook('TaskCreate',{subject},{content:created,is_error:true}).taskChange,undefined);
  assert.equal(fromLog('TaskCreate',{subject},created,true).event.taskChange,undefined);
  assert.deepEqual(hook('TaskCreate',{subject,description:'PRIVATE'},{task:{id:'1',subject,status:'pending'}}).taskChange,{id:'1',title:subject,status:'pending'});
  assert.deepEqual(fromLog('TaskUpdate',{taskId:'1',status:'completed'},'{}').event.taskChange,{id:'1',status:'completed'});
});
