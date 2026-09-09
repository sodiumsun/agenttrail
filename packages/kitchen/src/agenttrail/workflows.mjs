import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {clean,within} from '../runtime/crew.mjs';

const idPattern=/^[\w-]{1,100}$/;
const redditRoles=[
  {id:'researcher',title:'Researcher',components:['research','radar']},
  {id:'writer',title:'Writer',components:['write']},
  {id:'evaluator',title:'Evaluator',components:['evaluate']},
  {id:'publisher',title:'Publisher',components:['publisher']},
  {id:'head-chef',title:'Head chef',components:['manager','distill']}
];

// Roles describe responsibility. They never declare that an executor is running.
export function workflowConfig(components,config,name){
  if(config?.workflow===false)return config;
  if(config&&(config.version!==1||!Array.isArray(config.kitchens)||!Array.isArray(config.deliverables)))return config;
  if(!components.length){
    if(!Array.isArray(config?.workflow?.roles))return config;
    const roles=[];for(const r of config.workflow.roles.slice(0,12)){if(!idPattern.test(r?.id)||roles.some(role=>role.id===r.id))continue;roles.push({id:r.id,title:clean(r.title)||r.id,description:clean(r.description,250),components:[],files:(Array.isArray(r.files)?r.files:[]).filter(f=>typeof f==='string'&&f.length<200).slice(0,24),category:['coordinate','research','build','simulation','review','publish'].includes(r.category)?r.category:null,origin:'configured'});}
    return {...config,workflow:{id:idPattern.test(config.workflow.id)?config.workflow.id:'project',title:clean(config.workflow.title)||`${name} workflow`,roles,origin:'configured',adapter:null}};
  }
  const reddit=['research','write','evaluate','queue','publisher','manager'].every(id=>components.some(c=>c.id===id));
  const requested=config?.workflow,claimed=new Set(),roles=[];
  const candidates=Array.isArray(requested?.roles)?requested.roles:reddit?redditRoles:[];
  for(const role of candidates.slice(0,32)){
    if(typeof role?.id!=='string'||!idPattern.test(role.id)||roles.some(r=>r.id===role.id)||!Array.isArray(role.components))continue;
    const members=role.components.filter(id=>components.some(c=>c.id===id&&c.kind!=='human')&&!claimed.has(id));
    if(!members.length)continue;
    members.forEach(id=>claimed.add(id));roles.push({id:role.id,title:clean(role.title)||role.id,components:members});
  }
  for(const c of components){if(claimed.has(c.id)||['human','knowledge'].includes(c.kind))continue;let id=c.id;while(roles.some(r=>r.id===id))id+='-chef';roles.push({id,title:c.title,components:[c.id]});}
  const workflow={id:typeof requested?.id==='string'&&idPattern.test(requested.id)?requested.id:'project',title:clean(requested?.title)||(reddit?'Reddit loop':`${name} workflow`),roles,adapter:reddit?'reddit-loop':null};
  return {version:1,deliverables:[],...config,kitchens:config?.kitchens?.length?config.kitchens:[{id:'workflow',title:workflow.title,components:components.map(c=>c.id)}],workflow};
}

export function workflowStations(components,roles){
  return roles.map(r=>({id:r.components.find(id=>components.some(c=>c.id===id&&c.kind!=='knowledge'))||r.components[0]||r.id,title:r.title,roleId:r.id,components:r.components})).concat(components.filter(c=>['human','knowledge'].includes(c.kind)).map(c=>({id:c.id,title:c.kind==='human'?'Your review':'Shared pantry',kind:c.kind,components:[c.id],url:c.url})));
}

function frontmatter(text){
  const front=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]||'',fields={};
  for(const key of ['title_a','subreddit','status','approved','approved_at','scheduled_at','created_at','posted_url','posted_at','delivery_status']){
    const value=front.match(new RegExp('^'+key+':\\s*(.*)$','m'))?.[1];if(value)fields[key]=clean(value.trim().replace(/^(['"])(.*)\1$/,'$2'),key==='posted_url'?400:180);
  }
  // Only the digest leaves this function. Draft bodies never enter the snapshot.
  const content=text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'');
  return {fields,revision:crypto.createHash('sha256').update(JSON.stringify([fields.title_a,content])).digest('hex').slice(0,16)};
}

export class WorkflowQueues {
  constructor(){this.cache=new Map();}
  async read(root,relative,max=256_000){
    try{const file=await fs.realpath(path.join(root,relative));if(!within(file,root))return null;const st=await fs.stat(file);if(!st.isFile()||st.size>max)return null;const key=root+'|'+relative,stamp=`${st.mtimeMs}:${st.size}`,old=this.cache.get(key);if(old?.stamp===stamp)return old;
      const text=await fs.readFile(file,'utf8'),entry={stamp,at:st.mtimeMs,text,item:old?.item};this.cache.set(key,entry);if(this.cache.size>1800)this.cache.delete(this.cache.keys().next().value);return entry;
    }catch{return null;}
  }
  async snapshot(root){
    let files,total;try{root=await fs.realpath(root);files=(await fs.readdir(path.join(root,'drafts'))).filter(f=>f.endsWith('.md')).sort();total=files.length;files=files.slice(-500);}catch{return {items:[],available:false,summary:'Draft queue unavailable'};}
    const account=await this.read(root,'publisher/account-state.md',32_000),accountState=account?.text.match(/^status:\s*(\S+)/m)?.[1],blocked=accountState==='distribution_blocked';
    const items=[];
    for(const file of files){const draft=await this.read(root,'drafts/'+file);if(!draft)continue;const {fields:m,revision}=frontmatter(draft.text),evaluation=await this.read(root,'evals/'+file,64_000);
      const verdicts=[...(evaluation?.text||'').matchAll(/\bVerdict:\s*\**\s*(SHIP|HOLD|REVISE|KILL)\b/gi)],verdict=verdicts.at(-1)?.[1].toUpperCase()||null;
      const previous=draft.item;const stale=!!(previous&&previous.revision!==revision&&previous.evaluationStamp===evaluation?.stamp)||!!(previous?.stale&&previous.evaluationStamp===evaluation?.stamp);
      let stage='evaluate',label='Awaiting evaluation';
      if(!['draft','posted','abandoned'].includes(m.status)){stage='unknown';label='Item state unavailable';}
      else if(m.status==='abandoned'||verdict==='KILL'){stage='history';label=m.status==='abandoned'?'Abandoned':'Not proceeding';}
      else if(m.status==='posted'){stage='history';label='Recorded as posted';}
      else if(stale){stage='evaluate';label='Changed since observed evaluation';}
      else if(verdict==='REVISE'){stage='write';label='Needs revision';}
      else if(verdict==='HOLD'){stage='evaluate';label='Evaluation on hold';}
      else if(verdict==='SHIP'&&m.approved!=='yes'){stage='queue';label='Needs your review';}
      else if(verdict==='SHIP'&&m.approved==='yes'){stage='publisher';label=blocked?'Dispatch blocked':Date.parse(m.scheduled_at)>Date.now()?'Waiting for scheduled time':'Approval recorded';}
      const item={id:file,file:'drafts/'+file,title:m.title_a||file,subreddit:m.subreddit||'',createdAt:m.created_at||null,revision,verdict,stage,label,scheduledAt:m.scheduled_at||null,approved:m.approved==='yes',stale};
      draft.item={revision,evaluationStamp:evaluation?.stamp,stale};items.push(item);
    }
    return {available:true,items,blocked,summary:total>500?'Limited view of 500 draft files':items.length<files.length?'Some draft files unavailable':'All recorded drafts',counts:Object.fromEntries(['write','evaluate','queue','publisher','history','unknown'].map(stage=>[stage,items.filter(i=>i.stage===stage).length]))};
  }
}
