import crypto from 'node:crypto';
import {roleForSession} from './workflow-crew.mjs';

const key=value=>crypto.createHash('sha256').update(value).digest('hex').slice(0,20);
const active=s=>!/(?:^|\.)(?:update_plan|TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|todo_write|write_todos)$/i.test(s.tool||'')&&!s.ended&&s.freshness!=='quiet'&&['reading','writing','executing','working','permission','input','error'].includes(s.state);
const chefId=(p,s,match)=>match?`role:${p.id}:${p.workflow.id}:${match.role.id}`:s.id;

// A native todo is a work order. This store observes source plans, never writes one.
export class OrderStore {
  constructor(){this.plans=new Map();this.orders=new Map();this.serial=0;}
  observe(projects,sessions){
    for(const s of sessions){
      const p=projects.find(p=>p.id===s.project);if(!p)continue;
      const scope=JSON.stringify([s.project,s.id,s.planId||'current',s.taskSource||s.source]);
      let plan=this.plans.get(scope);
      if(s.planAvailable){
        const tasks=s.sessionTasks||[],signature=JSON.stringify(tasks);
        if(!plan){plan={scope,project:p.id,sessionId:s.id,signature:null,orderIds:[],revision:0,serial:0};this.plans.set(scope,plan);}
        if(plan.signature!==signature){
          const at=s.contextAt||s.taskContextAt||s.lastEventAt;
          plan.signature=signature;plan.revision++;plan.at=at;
          // Only explicit native IDs or unique unchanged titles can preserve identity.
          const titleCounts=new Map(),idCounts=new Map();for(const t of tasks){titleCounts.set(t.title,(titleCounts.get(t.title)||0)+1);if(t.id)idCounts.set(t.id,(idCounts.get(t.id)||0)+1);}
          const prior=plan.orderIds.map(id=>this.orders.get(id)).filter(Boolean),next=[];
          tasks.forEach((t,index)=>{
            const nativeId=t.id&&idCounts.get(t.id)===1?t.id:null;
            const candidates=(nativeId?[...this.orders.values()].filter(o=>o.scope===scope):prior).filter(o=>nativeId?o.nativeId===nativeId:!o.nativeId&&o.title===t.title&&titleCounts.get(t.title)===1);
            let o=candidates.length===1?candidates[0]:null;
            if(!o){const id='order-'+key(scope+':'+(++plan.serial));o={id,number:++this.serial,project:p.id,sessionId:s.id,provider:s.provider,scope,nativeId,title:t.title,status:t.status,createdAt:at,completedAt:null,completionVersion:0,contributors:[],history:[],source:s.taskSource||s.source};this.orders.set(id,o);}
            const changed=o.title!==t.title||o.status!==t.status||o.withdrawn||!o.history.length;
            if(changed){o.history.push({revision:plan.revision,at,title:t.title,status:t.status});o.history=o.history.slice(-24);}
            if(t.status==='completed'&&(o.status!=='completed'||!o.completedAt)){o.completedAt=at;o.completionVersion++;}
            if(t.status!=='completed')o.completedAt=null;
            Object.assign(o,{title:t.title,status:t.status,withdrawn:false,index,revision:plan.revision,updatedAt:at,outcomeId:s.outcomeId||null,outcomeTitle:s.outcomeTitle||null});next.push(o.id);
          });
          for(const o of prior)if(!next.includes(o.id)&&!o.withdrawn){o.withdrawn=true;o.updatedAt=at;o.history.push({revision:plan.revision,at,title:o.title,status:'withdrawn'});o.history=o.history.slice(-24);}
          plan.orderIds=next;
          // An explicitly replaced plan retires its remaining tickets, never serves them.
          for(const old of this.plans.values())if(old!==plan&&old.project===p.id&&old.sessionId===s.id){for(const id of old.orderIds){const o=this.orders.get(id);if(o&&!o.withdrawn){o.withdrawn=true;o.history.push({at,status:'withdrawn',title:o.title,revision:o.revision});o.history=o.history.slice(-24);}}old.orderIds=[];}
        }
      }
      if(!active(s))continue;
      const bound=s.roleBinding?.orderId;
      let order=bound?this.orders.get(bound):null;
      if(bound&&(!order||order.project!==p.id))continue;
      if(!bound){const current=(plan?.orderIds||[]).map(id=>this.orders.get(id)).filter(o=>o&&!o.withdrawn&&o.status==='in_progress');if(current.length===1)order=current[0];}
      if(!order||order.withdrawn||order.status==='completed')continue;
      const match=roleForSession(p,s),id=chefId(p,s,match),at=Math.max(s.lastEventAt||0,s.roleBinding?.at||0);
      const identity=id+'|'+s.id,prior=order.contributors.find(c=>c.identity===identity);
      const entry={identity,chefId:id,roleId:match?.role.id||null,name:match?.role.title||s.provider,sessionId:s.id,provider:s.provider,association:match?.association||{kind:'unknown',reason:'Workflow role not linked'},firstAt:prior?.firstAt||at,lastAt:at};
      if(prior)Object.assign(prior,entry);else order.contributors.push(entry);
      order.contributors=order.contributors.slice(-24);
    }
    while(this.orders.size>600)this.orders.delete(this.orders.keys().next().value);
    while(this.plans.size>160)this.plans.delete(this.plans.keys().next().value);
  }
  snapshot(projects,sessions){
    this.observe(projects,sessions);
    const orders=[...this.orders.values()].map(o=>({...o,contributors:o.contributors.map(c=>({...c})),history:[...o.history],activeChefIds:[],activeSessionIds:[]}));
    const byId=new Map(orders.map(o=>[o.id,o])),unplanned=[];
    for(const s of sessions){
      const p=projects.find(p=>p.id===s.project);if(!p)continue;
      const candidates=orders.filter(o=>o.project===s.project&&o.sessionId===s.id&&!o.withdrawn&&o.status==='in_progress');
      const order=s.roleBinding?.orderId?byId.get(s.roleBinding.orderId):candidates.length===1?candidates[0]:null;
      if(active(s)&&order&&order.project===p.id&&!order.withdrawn&&order.status!=='completed'){
        const match=roleForSession(p,s);order.activeChefIds.push(chefId(p,s,match));order.activeSessionIds.push(s.id);if(['permission','input','error'].includes(s.state))order.attention=true;
      }
      if(!s.ended&&(!s.planAvailable||!(s.sessionTasks||[]).length))unplanned.push({id:'unplanned-'+key(s.id+s.project),project:p.id,sessionId:s.id,title:s.outcomeTitle||'Current work',state:s.state,source:s.taskSource||s.source,progress:null});
    }
    const tables=[];
    for(const p of projects){
      const local=orders.filter(o=>o.project===p.id);
      const groups=new Map();for(const o of local){const id=o.outcomeId?'table-'+key(p.id+o.outcomeId):o.outcomeTitle?'table-'+key(o.scope+o.outcomeTitle):'table-'+key(p.id);o.tableId=id;if(!groups.has(id))groups.set(id,{id,project:p.id,title:o.outcomeTitle||p.name,reported:!!o.outcomeTitle,orderIds:[],completedIds:[]});const table=groups.get(id);table.orderIds.push(o.id);if(o.status==='completed'&&!o.withdrawn)table.completedIds.push(o.id);}
      if(!groups.size)groups.set('table-'+key(p.id),{id:'table-'+key(p.id),project:p.id,title:p.name,reported:false,orderIds:[],completedIds:[]});tables.push(...groups.values());
    }
    return {orders,tables,unplanned};
  }
}
