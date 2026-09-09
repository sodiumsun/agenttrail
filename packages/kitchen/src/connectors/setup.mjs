import fs from 'node:fs/promises';
import path from 'node:path';

export const hookNames={claude:['SessionStart','SessionEnd','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','SubagentStart','SubagentStop'],cursor:['sessionStart','sessionEnd','beforeSubmitPrompt','preToolUse','postToolUse','postToolUseFailure','stop','subagentStart','subagentStop','beforeReadFile','afterFileEdit','beforeShellExecution','afterShellExecution','afterMCPExecution']};
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
export function configPath(root,provider){return path.join(root,provider==='claude'?'.claude/settings.local.json':'.cursor/hooks.json');}
export function commandFor(node,relay,provider,stateDir){return `${quote(node)} ${quote(relay)} ${provider} ${quote(stateDir)}`;}
export async function hookConfig(root,provider,command,remove=false){
  if(!hookNames[provider])throw new Error('Choose Claude or Cursor.');
  const file=configPath(root,provider);let config={};
  try{config=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('The existing settings file is not valid JSON. Repair it before connecting.');}
  if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('The existing settings must be a JSON object.');
  const before=JSON.stringify(config,null,2);config=structuredClone(config);
  if(config.hooks && (typeof config.hooks!=='object'||Array.isArray(config.hooks)))throw new Error('The existing hooks configuration is invalid.');
  config.hooks ||= {};
  for(const event of hookNames[provider]){
    const values=config.hooks[event]||[];if(!Array.isArray(values))throw new Error('The existing hook list is invalid.');
    const next=values.map(v=>provider==='claude'&&Array.isArray(v.hooks)?{...v,hooks:v.hooks.filter(h=>h.command!==command)}:v)
      .filter(v=>provider==='claude' ? !Array.isArray(v.hooks)||v.hooks.length>0 : v.command!==command);
    if(!remove)next.push(provider==='claude'?{hooks:[{type:'command',command,timeout:2}]}:{command,timeout:2});
    if(next.length)config.hooks[event]=next;else delete config.hooks[event];
  }
  if(provider==='cursor'&&!remove)config.version ||= 1;
  return {file,before,after:JSON.stringify(config,null,2)+'\n',events:hookNames[provider],remove};
}
export async function installConfig(change){
  await fs.mkdir(path.dirname(change.file),{recursive:true});
  const tmp=change.file+'.office-tmp';
  await fs.writeFile(tmp,change.after,{mode:0o600});await fs.rename(tmp,change.file);
}
