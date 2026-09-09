import { clean } from '../runtime/crew.mjs';
import path from 'node:path';
import {desktopWork,directWork} from './desktop-events.mjs';

export const taskList=items=>Array.isArray(items)?items.slice(0,24).filter(t=>t&&typeof(t.content||t.step||t.subject||t.title)==='string'&&['pending','in_progress','completed'].includes(t.status)).map(t=>({...((typeof t.id==='string'||typeof t.id==='number')?{id:clean(String(t.id),100)}:{}),title:clean(t.content||t.step||t.subject||t.title,180),status:t.status})):undefined;

// Only successful tool results update native tasks. No prompt/description fields survive.
function taskAcknowledgement(tool,input,text){
  if(tool==='TaskCreate'){
    const match=/^Task #(\d+) created successfully: [^\r\n]+$/.exec(text),title=clean(input.subject,180);
    return match&&title?{taskChange:{id:match[1],title,status:'pending'}}:{};
  }
  if(tool==='TaskUpdate'){
    const match=/^Updated task #(\d+) ((?:owner|status|subject|description|activeForm|metadata|blocks|blockedBy)(?:, (?:owner|status|subject|description|activeForm|metadata|blocks|blockedBy))*)$/.exec(text);
    if(match&&match[1]===String(input.taskId)&&match[2].split(', ').includes('status')&&['pending','in_progress','completed','deleted'].includes(input.status))return {taskChange:{id:match[1],status:input.status,...(input.subject&&match[2].split(', ').includes('subject')?{title:clean(input.subject,180)}:{})}};
  }
  return {};
}
function taskResult(tool,input={},output={}){
  if(/^(TodoWrite|todo_write|write_todos)$/.test(tool||''))return {tasks:taskList(input.todos),tasksPartial:input.merge===true};
  if(output?.is_error||output?.isError||output?.error)return {};
  if(Array.isArray(output)||typeof output?.content==='string'||Array.isArray(output?.content)){
    output=Array.isArray(output)?output:output.content;
    if(Array.isArray(output))output=output.length===1&&output[0]?.type==='text'?output[0].text:null;
  }
  if(typeof output==='string'){try{output=JSON.parse(output);}catch{return taskAcknowledgement(tool,input,output.trim());}}
  if(!output||typeof output!=='object'||Array.isArray(output)||output.is_error||output.isError||output.error)return {};
  if(tool==='TaskList'&&Array.isArray(output.tasks))return {tasks:taskList(output.tasks)};
  const task=output.task||output,id=task.id||task.taskId||input.taskId;
  if(!['TaskCreate','TaskUpdate','TaskGet'].includes(tool)||!['string','number'].includes(typeof id))return {};
  const title=clean(task.subject||input.subject||task.title,180),status=task.status||input.status||(tool==='TaskCreate'?'pending':undefined);
  if(!['pending','in_progress','completed','deleted'].includes(status))return {};
  return {taskChange:{id:clean(String(id),100),...(title?{title}:{}),status}};
}
export function normalizeHook(provider, raw, at=Date.now()) {
  const name=raw.hook_event_name || '';
  const parent=provider==='cursor' ? raw.parent_conversation_id || raw.conversation_id || raw.session_id : raw.session_id;
  const child=provider==='cursor' ? raw.subagent_id : raw.agent_id;
  const sessionId=child || parent;
  if(['subagentstart','subagentstop'].includes(name.toLowerCase())&&!child)return null; // Missing child identity must not end its parent.
  const cwd=raw.cwd || raw.workspace_roots?.[0];
  if(typeof sessionId!=='string' || typeof cwd!=='string') return null;
  const key=name.toLowerCase();
  const kind=({sessionstart:'session-start',sessionend:'session-end',userpromptsubmit:'turn-start',beforesubmitprompt:'turn-start',pretooluse:'tool-start',posttooluse:'tool-end',posttoolusefailure:'tool-end',permissionrequest:'permission',stop:'turn-end',subagentstart:'session-start',subagentstop:'turn-end',beforefileread:'tool-start',beforereadfile:'activity',afterfileedit:'activity',beforeshellexecution:'activity',aftershellexecution:'tool-end',aftermcpexecution:'activity'})[key];
  let notification=key==='notification' ? (raw.notification_type==='permission_prompt' ? 'permission' : raw.notification_type==='idle_prompt' ? 'input' : null) : null;
  if(!kind&&!notification) return null;
  return {provider,sessionId:clean(sessionId,200),parentId:child?clean(parent,200):null,cwd,at,source:'hook',kind:kind||notification,turnId:raw.generation_id || raw.turn_id,toolId:raw.tool_use_id || raw.tool_call_id,tool:clean(raw.tool_name || (key==='afterfileedit'?'Write':['beforefileread','beforereadfile'].includes(key)?'Read':['beforeshellexecution','aftershellexecution'].includes(key)?'Shell':''),80),file:clean(raw.tool_input?.file_path || raw.tool_input?.path || raw.file_path,500),...(key==='posttooluse'&&!['error','failed'].includes(raw.status)?taskResult(raw.tool_name,raw.tool_input,raw.tool_response??raw.tool_output):{}),error:key==='posttoolusefailure'||raw.status==='error'||raw.status==='failed',id:clean(raw.office_event_id,200)};
}

export function codexEvents(row, meta, fileId) {
  const p=row.payload || {}, at=Date.parse(row.timestamp), id=`${fileId}:${row.ordinal ?? row.timestamp}:${p.type||row.type}:${p.id||p.call_id||''}`;
  if(row.type==='event_msg'&&p.type==='task_started')meta.turnId=p.turn_id;
  const base={provider:'codex',sessionId:meta.id,cwd:meta.cwd,parentId:meta.parentId,source:'log',at,id,turnId:p.turn_id||meta.turnId};
  if(row.type==='event_msg') {
    if(p.type==='item_completed'){
      if(typeof p.item?.id!=='string'||(p.thread_id&&p.thread_id!==meta.id))return [];
      const work=desktopWork(p.item);if(!work)return [];
      if(work.file&&typeof p.item.cwd==='string'&&path.isAbsolute(p.item.cwd))work.file=path.resolve(p.item.cwd,work.file);
      return [{...base,id:`${fileId}:item:${p.item.id}`,kind:'observation',work:{...work,completed:true},at:Number(p.completed_at_ms)||at}];
    }
    const kind=({task_started:'turn-start',task_complete:'turn-end',turn_aborted:'interrupted'})[p.type];
    if(kind) return [{...base,kind}];
  }
  if(row.type==='response_item') {
    if(['function_call','custom_tool_call'].includes(p.type)) {
      let args={}; try {args=JSON.parse(p.arguments || '{}');}catch{}
      const patchFiles=typeof p.input==='string'&&/apply_patch$/.test(p.name||'')?[...p.input.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map(m=>m[1]):[];
      return [{...base,kind:'tool-start',tool:p.name,toolId:p.call_id,work:directWork(p.name,p.namespace),file:args.file_path || args.path || (patchFiles.length===1?patchFiles[0]:undefined),tasks:/update_plan$/.test(p.name||'')?taskList(args.plan):undefined}];
    }
    if(['function_call_output','custom_tool_call_output'].includes(p.type)) return [{...base,kind:'tool-end',toolId:p.call_id}];
  }
  return [];
}

export function claudeEvents(row,fileId,context={pending:new Map()}) {
  if(row.isSidechain) return []; // child identity is supplied by hooks; never guess it from the parent log.
  const base={provider:'claude',sessionId:row.sessionId || row.session_id,cwd:row.cwd,source:'log',at:Date.parse(row.timestamp),id:`${fileId}:${row.uuid}`};
  if(!base.sessionId || !base.cwd || !row.uuid) return [];
  if(row.type==='system' && row.subtype==='turn_duration') return [{...base,kind:'turn-end'}];
  const content=row.message?.content;
  if(row.type==='user' && typeof content==='string') return [{...base,kind:'turn-start'}];
  if(!Array.isArray(content)) return [];
  const events=[];
  content.forEach((c,i)=>{
    const e={...base,id:`${base.id}:${i}`};
    if(c.type==='tool_use') events.push({...e,kind:'tool-start',tool:c.name,toolId:c.id,file:c.input?.file_path || c.input?.path,tasks:c.name==='TodoWrite'?taskList(c.input?.todos):undefined});
    if(c.type==='tool_use'&&['TaskCreate','TaskUpdate','TaskGet','TaskList'].includes(c.name)){context.pending.set(c.id,{name:c.name,input:{taskId:c.input?.taskId,subject:clean(c.input?.subject,180),status:c.input?.status}});if(context.pending.size>64)context.pending.delete(context.pending.keys().next().value);}
    if(c.type==='tool_result'){const pending=context.pending.get(c.tool_use_id);context.pending.delete(c.tool_use_id);events.push({...e,kind:'tool-end',toolId:c.tool_use_id,error:!!c.is_error,...(pending&&!c.is_error?taskResult(pending.name,pending.input,c.content):{})});}
  });
  if(row.type==='user' && content.some(c=>c.type==='text') && !content.some(c=>c.type==='tool_result')) events.push({...base,kind:'turn-start'});
  if(row.type==='assistant' && row.message?.stop_reason==='end_turn') events.push({...base,id:base.id+':end',kind:'turn-end'});
  return events;
}
