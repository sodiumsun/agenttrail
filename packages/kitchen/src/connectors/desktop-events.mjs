// Consume structured observations, never evaluate orchestration code or read reasoning.
export function desktopWork(item){
  if(!item||typeof item!=='object')return null;
  const type=String(item.type||'').toLowerCase();
  if(type==='commandexecution'){
    const parsed=Array.isArray(item.parsed_cmd)?item.parsed_cmd:[],last=parsed.at(-1);
    const failed=item.status==='failed'||(typeof item.exit_code==='number'&&item.exit_code!==0);
    if(last&&['read','search','list_files'].includes(last.type))return {category:'research',label:last.type==='read'?(failed?'Tried reading a file':'Read a file'):last.type==='search'?(failed?'Tried searching files':'Searched files'):(failed?'Tried exploring the repo':'Explored the repo'),file:last.type==='read'?last.path:undefined};
    // Only recognize complete, simple check commands; compound scripts remain unknown.
    const command=Array.isArray(item.command)?item.command.at(-1):null;
    if(typeof command==='string'&&command.length<180&&!/[\n;&|<>`$]/.test(command)&&/^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck)(?:\s|$)|node\s+--(?:test|check)(?:\s|$)|(?:pytest|cargo test|go test)(?:\s|$))/.test(command.trim()))return {category:'review',label:item.exit_code===0?'Checks passed':'Ran checks'};
    return {category:'execute',label:failed?'Command failed':'Ran a command'};
  }
  if(type==='mcptoolcall'&&item.server==='cua_repl')return {category:'review',label:'Inspected the preview'};
  if(type==='subagentactivity')return {category:'coordinate',label:'Coordinated with an agent'};
  if(type==='imageview')return {category:'review',label:'Inspected an image',file:item.path};
  if(type==='extension'&&/web.?search/i.test(item.kind||''))return {category:'research',label:'Researched references'};
  if(type==='filechange'&&Array.isArray(item.changes)){
    const files=item.changes.map(c=>c?.path).filter(f=>typeof f==='string');return {category:'build',label:'Changed files',file:files.length===1?files[0]:undefined};
  }
  return null;
}

export function directWork(name,namespace){
  if(namespace==='mcp__cua_repl'&&name==='js')return {category:'review',label:'Inspecting the preview',completed:false};
  if(namespace==='collaboration'&&['send_message','followup_task','spawn_agent','list_agents','wait_agent'].includes(name))return {category:'coordinate',label:'Coordinating the work',completed:false};
  if(name==='apply_patch')return {category:'build',label:'Editing files',completed:false};
  return null;
}
