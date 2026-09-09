import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CrewStore } from './runtime/crew.mjs';
import {OrderStore} from './runtime/orders.mjs';
import { PlateStore } from './runtime/plates.mjs';
import { LogObserver } from './connectors/logs.mjs';
import { Projects } from './agenttrail/projects.mjs';
import {workflowCrew,workflowPlates} from './runtime/workflow-crew.mjs';
import { hookConfig,installConfig,commandFor,configPath } from './connectors/setup.mjs';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export async function startOffice({roots,home,stateDir,port=4780,observe=true}) {
  await fs.mkdir(stateDir,{recursive:true,mode:0o700});
  const csrf=crypto.randomBytes(24).toString('hex'),hookToken=crypto.randomBytes(24).toString('hex');
  const store=new CrewStore(roots),logs=new LogObserver(home,store,home===os.homedir()?{codexHome:process.env.CODEX_HOME||undefined,claudeHome:process.env.CLAUDE_CONFIG_DIR||undefined}:{}),projects=new Projects(roots,home,store);
  const orders=new OrderStore(),plates=new PlateStore(store,Date.now,id=>orders.orders.get(id));
  store.onChange=s=>{if(s)orders.observe(projects.snapshot(),projects.enrich([s]));};
  let actualPort=port,closing=false,busy=false,lastProjects=0,lastMessage='';const clients=new Set();
  const setupCommands=Object.fromEntries(['claude','cursor'].map(p=>[p,commandFor(process.execPath,path.join(appRoot,'bin/relay.mjs'),p,stateDir)]));
  let installed={};
  async function refreshInstalled(){
    const next={};for(const root of roots){next[root]={};for(const provider of ['claude','cursor']){try{const config=JSON.parse(await fs.readFile(configPath(root,provider),'utf8'));next[root][provider]=Object.values(config.hooks||{}).flat().some(entry=>entry.command===setupCommands[provider]||entry.hooks?.some(h=>h.command===setupCommands[provider]));}catch{next[root][provider]=false;}}}installed=next;
  }
  const snapshot=()=>{const maps=projects.snapshot(),executors=projects.enrich(store.snapshot()),ledger=plates.snapshot();return {app:'agenttrail-kitchen',version:2,recentProjects:logs.recentProjects,discoveryLimited:logs.limited,projects:maps,crew:workflowCrew(maps,executors),executors,...orders.snapshot(maps,executors),...ledger,artifacts:[...ledger.artifacts,...workflowPlates(maps)],installed,observers:{codex:{available:logs.available.codex,mode:'experimental logs'},claude:{available:logs.available.claude,mode:'hooks or logs'},cursor:{mode:'hooks'}},observing:observe};};
  async function tick(){if(busy||closing)return;busy=true;try{
    if(Date.now()-lastProjects>3000){lastProjects=Date.now();await projects.poll();await refreshInstalled();}
    if(observe)await logs.poll();
    const msg=JSON.stringify(snapshot());if(msg!==lastMessage){lastMessage=msg;for(const c of clients){if(c.writableLength>256_000){c.destroy();clients.delete(c);}else c.write(`data: ${msg}\n\n`);}}
  }finally{busy=false;}}
  async function addProjects(paths){
    if(!Array.isArray(paths)||!paths.length||paths.length>12)throw new Error('Choose one or more project folders.');
    const selected=[];
    for(const value of paths){if(typeof value!=='string'||!path.isAbsolute(value))throw new Error('Use an absolute project folder path.');let root;try{root=await fs.realpath(value);if(!(await fs.stat(root)).isDirectory())throw 0;}catch{throw new Error('That folder could not be found.');}if(!selected.includes(root))selected.push(root);}
    const next=[...new Set([...roots,...selected])];if(next.length>12)throw new Error('Up to 12 project folders can be watched.');
    roots.splice(0,roots.length,...next);await fs.writeFile(path.join(stateDir,'projects.json'),JSON.stringify(roots),{mode:0o600});
    // Replay available recent observations immediately for newly selected roots.
    lastProjects=0;logs.lastDiscovery=0;await projects.poll();await tick();
    return selected;
  }
  const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>32_000)throw new Error('Request is too large.');}return JSON.parse(raw||'{}');}
  const server=http.createServer(async(req,res)=>{
    const origin=`http://127.0.0.1:${actualPort}`;
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    const hosts=[`127.0.0.1:${actualPort}`,`localhost:${actualPort}`];
    if(!hosts.includes(req.headers.host))return json(res,403,{error:'Local connections only.'});
    if(req.headers.origin&&!hosts.map(h=>'http://'+h).includes(req.headers.origin))return json(res,403,{error:'Origin is not allowed.'});
    let u;try{u=new URL(req.url,origin);}catch{return json(res,400,{error:'Invalid URL.'});}
    try{
      if(u.pathname==='/api/attach'){
        if(req.method!=='POST'||req.headers.authorization!==`Bearer ${hookToken}`)return json(res,403,{error:'Invalid connector key.'});
        const data=await body(req),selected=await addProjects(data.projects);return json(res,200,{app:'agenttrail-kitchen',projects:selected});
      }
      if(u.pathname==='/api/hook'||u.pathname==='/api/artifact'){
        if(req.method!=='POST'||req.headers.authorization!==`Bearer ${hookToken}`)return json(res,403,{error:'Invalid connector key.'});
        const event=await body(req);event.source='hook';event.at=Date.now();
        const accepted=u.pathname==='/api/artifact'?plates.accept(event):store.accept(event);await tick();return json(res,200,{accepted});
      }
      if(req.method==='POST'){
        if(req.headers['x-office-token']!==csrf)return json(res,403,{error:'Reload the office before changing settings.'});
        const data=await body(req);
        if(u.pathname==='/api/projects'){
          const [id]=await addProjects([data.path]);return json(res,200,{id});
        }
        if(u.pathname==='/api/setup/preview'||u.pathname==='/api/setup/apply'){
          if(!roots.includes(data.project)||!setupCommands[data.provider])return json(res,400,{error:'Choose a watched project and provider.'});
          const change=await hookConfig(data.project,data.provider,setupCommands[data.provider],!!data.remove);
          if(u.pathname.endsWith('preview'))return json(res,200,{file:change.file,events:change.events,revision:hash(change.before),remove:change.remove});
          if(data.revision!==hash(change.before))return json(res,409,{error:'Settings changed. Review the connection again.'});
          await installConfig(change);await refreshInstalled();await tick();return json(res,200,{ok:true});
        }
        return json(res,404,{error:'Unknown action.'});
      }
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
      if(u.pathname==='/api/bootstrap')return json(res,200,{token:csrf,...snapshot()});
      if(u.pathname==='/api/state')return json(res,200,snapshot());
      if(u.pathname==='/api/events'){
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.write(`data: ${JSON.stringify(snapshot())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;
      }
      const name=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).slice(1);
      const file=path.resolve(appRoot,'public',name);
      if(!file.startsWith(path.join(appRoot,'public')+path.sep))return json(res,404,{error:'Not found.'});
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary'}[path.extname(file)];if(!mime)return json(res,404,{error:'Not found.'});
      const content=await fs.readFile(file);
      res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      res.writeHead(200,{'content-type':mime,'cache-control':'no-cache'});res.end(content);
    }catch(e){json(res,e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'Not found.':e.message||'Request failed.'});}
  });
  await new Promise((resolve,reject)=>{
    let attempts=0;const fail=e=>{if(e.code==='EADDRINUSE'&&++attempts<20){actualPort++;server.listen(actualPort,'127.0.0.1');}else reject(e);};server.on('error',fail);server.once('listening',()=>{server.off('error',fail);actualPort=server.address().port;resolve();});server.listen(actualPort,'127.0.0.1');
  });
  await fs.writeFile(path.join(stateDir,'server.json'),JSON.stringify({port:actualPort,hookToken,pid:process.pid}),{mode:0o600});
  await tick();const timer=setInterval(()=>tick().catch(()=>{}),1000),heartbeat=setInterval(()=>{for(const c of clients)c.write(': heartbeat\n\n');},15000);
  return {url:`http://127.0.0.1:${actualPort}`,store,snapshot,async close(){closing=true;clearInterval(timer);clearInterval(heartbeat);projects.close();for(const c of clients)c.end();await new Promise(r=>server.close(r));try{const reg=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8'));if(reg.hookToken===hookToken)await fs.unlink(path.join(stateDir,'server.json'));}catch{}}};
}
