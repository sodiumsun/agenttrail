// A clearly labeled example of one session contributing through several roles.
const project='example-weekly-post',names=['Researcher','Writer','Evaluator','Publisher','Head chef'];
const roles=['researcher','writer','evaluator','publisher','head-chef'];
const components=roles.map((id,i)=>({id,title:names[i],files:[],tasks:[],needs:[],links:[]}));
const chefId=id=>`role:${project}:project:${id}`;
const nativeTitles=['Prepare the weekly post','Check the references and final copy','Package the approved draft for review'];
const steps=[{order:0,role:0,state:'reading'},{order:0,role:1,state:'writing'},{order:0,role:2,state:'reading'},{order:1,role:1,state:'writing'},{order:1,role:2,state:'reading'},{order:2,role:0,state:'reading'},{order:2,role:1,state:'writing'},{order:2,role:2,state:'reading'},{order:3,role:4,state:'complete'}];
export function demoState(step=0){
 const now=Date.now(),beat=steps[Math.min(step,steps.length-1)],p={id:project,name:'Weekly post · example',components,kitchens:[{id:'shared',title:'One shared kitchen',components:roles,counts:{total:0,done:0,active:0,blocked:0}}],deliverables:[],workflow:{id:'project',roles:roles.map((id,i)=>({id,title:names[i],components:[id]}))},warnings:[],boardUrl:null,contextSource:'example',activity:[]};
 const exec={id:'codex:example',sessionId:'example',provider:'codex',project,state:beat.state,source:'example',freshness:'recent',lastEventAt:now,currentFile:['research/references.md','drafts/weekly-post.md','evals/weekly-post.md'][beat.role%3],currentTask:beat.order<3?{title:nativeTitles[beat.order],status:'in_progress'}:null,recent:[],tool:beat.state==='writing'?'Edit':'Read'};
 const crew=roles.map((roleId,index)=>({...exec,id:chefId(roleId),roleId,name:names[index],roleComponents:[roleId],component:{id:roleId,title:names[index]},activityComponentId:roleId,startedAt:0,state:index===beat.role&&beat.state!=='complete'?beat.state:'idle',workingCount:index===beat.role&&beat.state!=='complete'?1:0,executors:index===beat.role?[exec]:[],roleStatus:'Ready for the next order',association:{kind:'explicit',reason:'Example role assignment'},currentTask:index===beat.role?exec.currentTask:null}));
 const orders=nativeTitles.slice(0,step<5?2:3).map((title,index)=>{
   const contributions=[...new Set(steps.slice(0,step+1).filter(b=>b.order===index).map(b=>b.role))];
   const completed=beat.order>index,status=completed?'completed':beat.order===index?'in_progress':'pending';
   return {id:'example-order-'+index,number:index+1,scope:'example-plan',index,title,project,sessionId:exec.id,provider:'codex',source:'example',status,withdrawn:false,completionVersion:completed?1:0,completedAt:completed?now:null,tableId:'example-table',outcomeTitle:'A weekly post ready for review',activeChefIds:beat.order===index?[chefId(roles[beat.role])]:[],activeSessionIds:beat.order===index?[exec.id]:[],contributors:contributions.map(role=>({identity:roles[role],chefId:chefId(roles[role]),roleId:roles[role],name:names[role],sessionId:exec.id,provider:'codex',association:{kind:'explicit',reason:'Simulated contribution to this shared order'},firstAt:now,lastAt:now})),history:[{title,status,at:now,revision:step+1}]};
 });
 return {version:2,projects:[p],crew,executors:[exec],orders,tables:[{id:'example-table',project,title:'A weekly post ready for review',reported:true,orderIds:orders.map(o=>o.id),completedIds:orders.filter(o=>o.status==='completed').map(o=>o.id)}],unplanned:[],artifacts:[],transfers:[],installed:{},observers:{},observing:false};
}
