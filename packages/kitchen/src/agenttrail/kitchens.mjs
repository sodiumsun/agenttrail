import { clean } from '../runtime/crew.mjs';

const idPattern=/^[\w-]{1,100}$/;
export function taskCounts(tasks) {
  return {total:tasks.length,done:tasks.filter(t=>t.state==='x').length,active:tasks.filter(t=>t.state==='~').length,blocked:tasks.filter(t=>t.state==='!').length};
}

// Kitchens only group the project map. They never create, assign, or complete work.
export function kitchenMap(components,config=null) {
  const warnings=[],kitchens=[],deliverables=[],owned=new Set(),ids=new Set(),capacity=config?.workflow?8:4;
  const byId=new Map(components.map(c=>[c.id,c]));
  if(config&&(config.version!==1||!Array.isArray(config.kitchens)||!Array.isArray(config.deliverables))){warnings.push('Kitchen configuration must have version 1, kitchens, and deliverables. Using the project map.');config=null;}
  for(const k of (config?.kitchens||[]).slice(0,24)){
    if(!k||!idPattern.test(k.id)||ids.has(k.id)||!Array.isArray(k.components)){warnings.push('Skipped a kitchen with missing or repeated identity.');continue;}
    const members=[];
    for(const id of k.components){if(!byId.has(id)){warnings.push(`Unknown component: ${clean(id)}`);continue;}if(owned.has(id)){warnings.push(`Component appears in multiple kitchens: ${id}`);continue;}owned.add(id);members.push(id);}
    if(members.length){for(let offset=0;offset<members.length;offset+=capacity){let id=offset?`${k.id}-${offset/capacity+1}`:k.id;while(ids.has(id))id+='-extra';ids.add(id);kitchens.push({id,title:(clean(k.title)||'Kitchen')+(offset?` ${offset/capacity+1}`:''),components:members.slice(offset,offset+capacity)});}}
  }
  const rest=components.filter(c=>!owned.has(c.id));
  for(let i=0;i<rest.length;i+=capacity){const group=rest.slice(i,i+capacity);let id='room-'+group[0].id;while(ids.has(id))id+='-extra';ids.add(id);kitchens.push({id,title:kitchens.length===0&&rest.length<=capacity?'Main kitchen':`Kitchen ${kitchens.length+1}`,components:group.map(c=>c.id)});}
  if(!kitchens.length)kitchens.push({id:'shared',title:'Main kitchen',components:[]});
  const tasks=components.flatMap(c=>c.tasks.map((t,index)=>({...t,componentId:c.id,key:`${c.id}:${t.id||'row-'+index}`})));
  const taskIds=new Map();for(const t of tasks){if(t.id)taskIds.set(t.id,[...(taskIds.get(t.id)||[]),t]);}
  const usedDeliverables=new Set();
  for(const d of (config?.deliverables||[]).slice(0,32)){
    if(!d||!idPattern.test(d.id)||usedDeliverables.has(d.id)||!Array.isArray(d.tasks)){warnings.push('Skipped a deliverable with missing or repeated identity.');continue;}
    const refs=[],seen=new Set(),missing=[];
    for(const id of d.tasks){const matches=taskIds.get(id)||[];if(matches.length!==1){missing.push(clean(id));continue;}if(!seen.has(id)){refs.push(matches[0]);seen.add(id);}}
    usedDeliverables.add(d.id);
    deliverables.push({id:d.id,title:clean(d.title)||'Untitled deliverable',icon:['map','image','gear','box','network'].includes(d.icon)?d.icon:'box',tasks:refs,missing,source:'configured'});
    if(missing.length)warnings.push(`Deliverable “${clean(d.title)}” has missing or ambiguous task references.`);
  }
  if(!deliverables.length){for(const c of components)deliverables.push({id:'component-'+c.id,title:c.title,icon:'gear',tasks:tasks.filter(t=>t.componentId===c.id),missing:[],source:'component'});}
  for(const d of deliverables){d.counts=taskCounts(d.tasks);d.kitchenIds=kitchens.filter(k=>d.tasks.some(t=>k.components.includes(t.componentId))).map(k=>k.id);d.status=d.missing.length?'unknown':d.counts.blocked?'blocked':d.counts.total&&d.counts.done===d.counts.total?'complete':d.counts.active?'active':'planned';}
  for(const k of kitchens)k.counts=taskCounts(tasks.filter(t=>k.components.includes(t.componentId)));
  return {kitchens,deliverables,warnings};
}
