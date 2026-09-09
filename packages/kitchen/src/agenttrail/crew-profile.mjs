import fs from 'node:fs/promises';
import path from 'node:path';

// A crew is a set of responsibilities, not a generated plan or extra executors.
export function inferCrew(files,name){
  const has=pattern=>files.some(f=>pattern.test(f)),roles=[];
  const add=(id,title,category,description,paths=[])=>roles.push({id,title,category,description,files:paths,components:[],origin:'inferred'});
  add('coordinator','Head chef','coordinate','Keeps the shared request moving and coordinates the next piece of work.');
  add('researcher','Researcher','research','Reads references, explores the repo, and gathers inputs for the same request.',['research/**','docs/**','references/**','notes/**']);
  const simulation=has(/^(sim|simulation)\//),world=has(/(^|\/)(world|characters|interior)\.[^/]+$|\.blend$|^unreal\//),content=has(/^(drafts|articles|posts|content)\//);
  if(world)add('world-builder','World builder','build','Builds the scene, characters, and their visual interactions.',['src/**','unreal/**','assets/**','public/**','scripts/*world*','scripts/*assets*']);
  if(simulation)add('simulation-engineer','Simulation engineer','simulation','Builds and checks the rules, state, and runtime of the simulation.',['sim/**','simulation/**']);
  if(content)add('writer','Writer','build','Turns research and inputs into the shared draft.',['drafts/**','articles/**','posts/**','content/**']);
  if(!world&&!content)add('builder',simulation?'App builder':'Builder','build','Implements the request using the inputs prepared by the crew.',['src/**','app/**','lib/**','scripts/**','server.*']);
  add('reviewer',content?'Evaluator':'Reviewer','review','Checks the result, exercises the preview, and catches issues before delivery.',['test/**','tests/**','evals/**','evaluations/**','**/*.test.*','**/*.spec.*']);
  if(content&&has(/^publisher\//))add('publisher','Publisher','publish','Handles delivery when the source workflow explicitly runs it.',['publisher/**']);
  return {id:'project',title:`${name} workflow`,origin:'inferred',roles,adapter:null,evidence:files.filter(f=>/^(src|sim|simulation|research|docs|drafts|articles|posts|content|tests|evals|publisher|unreal)\//.test(f)||/\.blend$/.test(f)).slice(0,12)};
}

export class CrewProfiles {
  constructor(){this.cache=new Map();}
  async get(root,name){
    const old=this.cache.get(root);if(old&&Date.now()-old.at<30_000)return old.workflow;
    const files=[],skip=/^(\.|node_modules$|dist$|build$|coverage$|runtime$|vendor$)/;
    async function read(relative,depth){
      if(files.length>=300)return;
      let entries;try{entries=await fs.readdir(path.join(root,relative),{withFileTypes:true});}catch{return;}
      const folders=[];
      for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
        if(skip.test(entry.name)||entry.isSymbolicLink())continue;
        const file=relative+entry.name;if(entry.isDirectory()){files.push(file+'/');if(depth<1)folders.push(file+'/');}else if(entry.isFile())files.push(file);
        if(files.length>=300)break;
      }
      for(const folder of folders)await read(folder,depth+1);
    }
    await read('',0);const workflow=inferCrew(files,name);this.cache.set(root,{at:Date.now(),workflow});return workflow;
  }
}
