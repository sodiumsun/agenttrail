import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {animateChef} from '../public/src/chefs.js';
import {KitchenWorld} from '../public/src/world.js';
import {workPose,nextWorkBeat,approachPoint} from '../public/src/motion.js';
import {stationLayout} from '../public/src/layout.js';
import {routeBetween,walkable} from '../public/src/routes.js';
import {batchMeshes} from '../public/src/batch.js';

// Real Three transforms with no renderer or canvas dependency.
function rig(id='chef'){
 const root=new T.Group(),body=new T.Group(),head=new T.Group();root.add(body);body.add(head);
 const arms=[new T.Group(),new T.Group()];arms.forEach((a,i)=>{a.position.set(i? .295:-.295,.66,0);body.add(a);});
 return {id,root,body,head,arms,hat:new T.Group(),legs:[new T.Group(),new T.Group()],ring:new T.Group(),carried:new T.Group(),utensil:new T.Group(),spoon:new T.Group(),attention:new T.Group(),color:0xdf5949,phase:0,state:'working',pose:'working',target:new T.Vector3(),home:new T.Vector3(),facing:0,atWorktop:true,walkRoute:[]};
}
function transforms(c){return [c.root,c.body,c.head,...c.arms,...c.legs,c.hat,c.ring,c.utensil,c.spoon].flatMap(o=>[...o.position,...o.quaternion,...o.scale]);}
const working={state:'working',freshness:'recent',lastEventAt:100_000};

test('generic live work makes readable hand movements; idle chefs do not cook',()=>{
 const c=rig();animateChef(c,0,.016);const a=c.utensil.position.clone();animateChef(c,.6,.016);
 assert.ok(a.distanceTo(c.utensil.position)>.2);assert.equal(c.utensil.visible,false);
 c.state='idle';c.pose='idle';c.atWorktop=false;animateChef(c,1,.016);const q=c.arms[1].quaternion.clone();animateChef(c,2,.016);
 assert.ok(q.equals(c.arms[1].quaternion));assert.equal(c.spoon.visible,false);assert.equal(c.carried.visible,false);
});
test('observed command gestures stir visibly without changing the reported source state',()=>{
 const c=rig();c.pose=workPose({...working,workContext:{at:99_000,category:'execute'}});
 animateChef(c,0,.016);const p=c.spoon.position.clone();animateChef(c,.5,.016);
 assert.equal(c.state,'working');assert.equal(c.spoon.visible,true);assert.ok(p.distanceTo(c.spoon.position)>.2);
 assert.equal(workPose({...working,workContext:{at:1,category:'execute'}}),'working');
 assert.equal(workPose({...working,state:'idle',workContext:{at:99_000,category:'execute'}}),'idle');
});
test('pause freezes the current joints and walking position; reduced motion gives a static pose',()=>{
 const c=rig();c.target.set(2,0,0);animateChef(c,.5,.016);const frame=transforms(c);
 animateChef(c,20,.5,false,true);assert.deepEqual(transforms(c),frame);
 animateChef(c,21,.016,true);assert.ok(c.root.position.equals(c.target));const still=transforms(c);
 animateChef(c,22,.016,true);assert.deepEqual(transforms(c),still);
});
test('walking beats require fresh new work, respect pause and do not replay reconnect history',()=>{
 const memory={};assert.equal(nextWorkBeat(memory,working,0,100_100,{newRoom:true}),false);
 assert.equal(nextWorkBeat(memory,working,10,100_100),false);
 assert.equal(nextWorkBeat(memory,{...working,lastEventAt:110_000},10,110_100),true);
 assert.equal(nextWorkBeat(memory,{...working,lastEventAt:111_000},11,111_100),false);
 assert.equal(nextWorkBeat(memory,{...working,lastEventAt:130_000},30,130_100,{paused:true}),false);
 assert.equal(nextWorkBeat(memory,{...working,lastEventAt:130_000},31,130_100),false);
 assert.equal(nextWorkBeat(memory,{...working,lastEventAt:150_000},50,150_100,{reduced:true}),false);
 assert.equal(nextWorkBeat(memory,{...working,lastEventAt:160_000},60,180_100),false);
 assert.equal(nextWorkBeat(memory,{...working,state:'idle',lastEventAt:181_000},81,181_100),false);
});
test('an active chef keeps a worktop even when idle chefs were listed there first',()=>{
 const components=Array.from({length:6},(_,i)=>({id:String(i),title:'Station '+i})),crew=Array.from({length:5},(_,i)=>({id:String(i),visualIndex:i,state:i===4?'working':'idle',freshness:'recent',lastEventAt:Date.now()}));
 const rigs=new Map(crew.map(s=>[s.id,Object.assign(rig(s.id),{visualIndex:s.visualIndex})]));
 const layout=stationLayout(6),world=Object.assign(Object.create(KitchenWorld.prototype),{layout,crew:rigs,characters:new T.Group(),plates:new Map(),roomKey:JSON.stringify(components.map(c=>[c.id,c.title])),time:0,paused:false,reduced:false,setOrders(){},workSlots:layout.positions.flatMap(([x,z],station)=>Array.from({length:3},(_,seat)=>({station,seat,x:x+(seat-1)*1.3,z,kits:{reading:{},writing:{},executing:{}}})))});
 world.setData({components,crew,artifacts:[],transfers:[],demo:false,kitchenId:'shared',projectId:'/repo'});
 const active=rigs.get('4');assert.equal(active.atWorktop,true);assert.equal(active.home.z,2.42);assert.ok(active.walkRoute.length);
 for(const [id,idle] of rigs)if(id!=='4'){
  assert.equal(idle.atWorktop,false);assert.ok(idle.home.distanceTo(active.home)>=1.06);
  assert.ok(Math.hypot(idle.home.x-approachPoint(active.home)[0],idle.home.z-approachPoint(active.home)[1])>=1.06);
 }
});
test('short work trips stay in the aisle for both kitchen sizes',()=>{
 for(const count of [4,6]){
  const {positions,walkWidth}=stationLayout(count);
  for(const [x,z] of positions){
   const home={x,z:z<0?-2.32:2.42},start=[home.x,home.z],approach=approachPoint(home),route=[...routeBetween(start,approach,walkWidth),...routeBetween(approach,start,walkWidth)];
   assert.ok(route.length>=4);
   for(let i=1;i<route.length;i++)for(let t=0;t<=1;t+=.05)assert.ok(walkable(route[i-1][0]+(route[i][0]-route[i-1][0])*t,route[i-1][1]+(route[i][1]-route[i-1][1])*t,walkWidth));
  }
 }
});
test('batching preserves world geometry and independently animated joints',()=>{
 const root=new T.Group();root.position.set(2,1,-3);root.rotation.y=.5;
 const joint=new T.Group(),mat=new T.MeshStandardMaterial();joint.position.set(0,2,0);root.add(joint);
 for(const parent of [root,joint])for(const x of [-1,1]){const m=new T.Mesh(new T.BoxGeometry(.5,.7,.9),mat);m.position.set(x,.3,.5);parent.add(m);}
 const before=new T.Box3().setFromObject(root);batchMeshes(root,false);
 assert.equal(root.children.length,2);assert.equal(joint.children.length,2);
 const after=new T.Box3().setFromObject(root);assert.ok(before.min.distanceTo(after.min)<1e-6);assert.ok(before.max.distanceTo(after.max)<1e-6);
 joint.rotation.z=.8;assert.ok(new T.Box3().setFromObject(root).max.distanceTo(after.max)>.1);
});
