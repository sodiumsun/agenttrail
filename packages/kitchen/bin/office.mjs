#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startOffice} from '../src/server.mjs';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function parseArgs(args,cwd=process.cwd()){
  const options={roots:[],port:4780,open:true,saved:false,stateDir:path.join(os.homedir(),'.agent-office')};
  const value=i=>{if(!args[i]||args[i].startsWith('--'))throw new Error('Provide a value for '+args[i-1]+'.');return args[i];};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--project')options.roots.push(path.resolve(cwd,value(++i)));
    else if(args[i]==='--port')options.port=Number(value(++i));
    else if(args[i]==='--state-dir')options.stateDir=path.resolve(cwd,value(++i));
    else if(args[i]==='--no-open')options.open=false;
    else if(args[i]==='--saved')options.saved=true;
    else if(args[i]==='--example')options.example=true;
    else if(args[i]==='--help')options.help=true;
    else if(!args[i].startsWith('-'))options.roots.push(path.resolve(cwd,args[i]));
    else throw new Error('Unknown option: '+args[i]);
  }
  if(!Number.isInteger(options.port)||options.port<1024||options.port>65515)throw new Error('Choose a port from 1024 through 65515.');
  return options;
}
export function liveUrl(base,project){const url=new URL(base);url.searchParams.set('project',project);url.searchParams.set('mode','live');return url.href;}
function launchUrl(base,project,example){const url=new URL(liveUrl(base,project));if(example){url.searchParams.set('mode','demo');url.searchParams.delete('project');}return url.href;}
function openBrowser(url){const bin=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open',params=process.platform==='win32'?['/c','start','',url]:[url];const child=spawn(bin,params,{stdio:'ignore',detached:true});child.on('error',()=>{});child.unref();}
export async function main(args=process.argv.slice(2)){
  const options=parseArgs(args);
  if(options.help){console.log('Agenttrail Kitchen (experimental)\n  agenttrail-kitchen .             Watch the current repo\n  agenttrail-kitchen /path/to/repo  Open any working folder\n  --example                       Open the labeled example view\n  --project /path (repeatable)\n  --saved                         Reopen saved folders\n  --port 4780\n  --no-open\n  --state-dir /absolute/state\n\nNo PLAN.md, Agenttrail install, or repo changes required. A running kitchen is reused and receives the requested folders.');return;}
  const {port,open,stateDir}=options,roots=options.roots;
  if(!roots.length&&(options.saved||process.cwd()===appRoot)){try{const saved=JSON.parse(await fs.readFile(path.join(stateDir,'projects.json'),'utf8'));if(Array.isArray(saved))roots.push(...saved.filter(s=>typeof s==='string'));}catch{}}
  if(!roots.length)roots.push(process.cwd());
  const unique=[];for(const root of roots){let real;try{real=await fs.realpath(root);if(!(await fs.stat(real)).isDirectory())throw 0;}catch{if(options.saved)continue;throw new Error('Project folder does not exist: '+root);}if(!unique.includes(real))unique.push(real);}
  if(!unique.length||unique.length>12)throw new Error('Choose between one and twelve existing project folders.');
  await fs.mkdir(stateDir,{recursive:true,mode:0o700});
  let registration;try{registration=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8'));}catch{}
  if(Number.isInteger(registration?.port)&&registration.port>=1024&&registration.port<=65535){
    const base=`http://127.0.0.1:${registration.port}`;let response;
    try{response=await fetch(base+'/api/state',{signal:AbortSignal.timeout(1500),redirect:'error'});}catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.cause?.code))throw new Error('The existing kitchen is not responding. Retry or restart that service.');}
    if(response){
      const existing=await response.json().catch(()=>null);
      if(existing?.app!=='agenttrail-kitchen')throw new Error('The registered service needs to be restarted with the updated kitchen before attaching a repo.');
      const result=await fetch(base+'/api/attach',{method:'POST',headers:{authorization:`Bearer ${registration.hookToken}`,'content-type':'application/json'},body:JSON.stringify({projects:unique}),signal:AbortSignal.timeout(15000),redirect:'error'});
      const attached=await result.json();if(!result.ok)throw new Error(attached.error||'Could not attach this repo to the kitchen.');
      const url=launchUrl(base,attached.projects[0],options.example);console.log(`Kitchen updated: ${url}\nWatching ${attached.projects.map(p=>path.basename(p)).join(', ')}. Existing agents keep running.`);if(open)openBrowser(url);return;
    }
  }
  await fs.writeFile(path.join(stateDir,'projects.json'),JSON.stringify(unique),{mode:0o600});
  const office=await startOffice({roots:unique,home:os.homedir(),stateDir,port});const url=launchUrl(office.url,unique[0],options.example);
  console.log(`Agenttrail Kitchen is ready: ${url}\nWatching ${unique.map(p=>path.basename(p)).join(', ')}. Local metadata only.\nCodex and Claude observations are automatic when available. Use Connect agents for provider hooks.`);if(open)openBrowser(url);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await office.close();process.exit(0);});
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
