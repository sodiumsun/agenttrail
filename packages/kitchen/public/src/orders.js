// Source statuses stay authoritative; these helpers only arrange their presentation.
export function projectOrders(data,project){return (data.orders||[]).filter(o=>o.project===project);}
export function orderForChef(orders,id){return orders.find(o=>!o.withdrawn&&o.status!=='completed'&&o.activeChefIds.includes(id));}
export function orderCrew(order,crew){return order.contributors.map(c=>({...c,chef:crew.find(s=>s.id===c.chefId),active:order.activeChefIds.includes(c.chefId)}));}
export const orderState=o=>o.withdrawn?'Withdrawn':o.status==='completed'?'Todo complete':o.attention?'Needs attention':o.activeChefIds.length?'Cooking':o.status==='in_progress'?'In progress · last reported':'Queued';
export const orderColor=o=>['#4b8d9f','#c77745','#8b79b0','#799652','#b85e62','#b79541'][(o.number-1)%6];
export function sharedStations(count){
  const stations=[{id:'shared-prep',title:'Gather & prepare'},{id:'shared-make',title:'Make & assemble'},{id:'shared-cook',title:'Run & cook'},{id:'shared-check',title:'Check & review'}];
  if(count>4)stations.push({id:'shared-prep-2',title:'Shared preparation'},{id:'shared-check-2',title:'Shared review'});
  return stations;
}
export function stationForChef(chef,index,count){
  if(chef.state==='idle'||chef.freshness==='quiet'||['complete','offline','interrupted'].includes(chef.state))return index%count;
  if(/review|eval|check/i.test(chef.name||''))return 3;
  return {reading:0,writing:1,executing:2}[chef.state]??3;
}
