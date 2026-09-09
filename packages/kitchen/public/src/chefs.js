import * as T from 'three';
import {group,ball,box,cylinder,torus,rod,material,colors,contact,plate,ingredient} from './art.js';
import {batchMeshes} from './batch.js';

export const apronColors=[0xdf5949,0x489bcc,0x64a14b,0xeab73f,0xa079bf,0xe58e36,0xb75e8c,0x4ca394,0x81694f,0x7987bd,0xb9a840,0x548572];
export const hash=s=>[...s].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,0);
let sharedHat;

export function createChef(parent,id,index=0){
  const root=group(parent),body=group(root),color=apronColors[index%apronColors.length],skin=[0xecc494,0xc78551,0xf2cfaa,0x986144][index%4];
  root.userData={kind:'chef',id};contact(root,0,0,1.35,1.1);
  const ring=torus(root,.49,.034,color,0,.035,0);ring.rotation.x=-Math.PI/2;
  for(let j=0;j<3;j++){const dot=ball(root,.04,.016,.04,colors.cream,Math.sin(j*.2)*.5,.048,Math.cos(j*.2)*.5);dot.castShadow=false;}
  const legs=[];for(const s of [-1,1]){
    const leg=group(body,s*.14,.19,0);cylinder(leg,.09,.10,.18,0x3a464c,0,0,0);ball(leg,.125,.085,.18,material(0x33424b,{roughness:.45}),0,-.10,.045);legs.push(leg);
  }
  ball(body,.31,.29,.25,colors.white,0,.47,0);ball(body,.317,.225,.257,color,0,.405,0);ball(body,.24,.25,.064,color,0,.45,.214);
  box(body,.26,.13,.035,material(color),0,.44,.275,.035);rod(body,[-.24,.65,.19],[-.17,.3,.23],.022,color);rod(body,[.24,.65,.19],[.17,.3,.23],.022,color);
  for(const s of [-1,1]){ball(body,.085,.042,.033,colors.white,s*.07,.42,.289);ball(body,.022,.022,.015,colors.gold,s*.11,.64,.226);}
  cylinder(body,.16,.17,.07,color,0,.735,0);
  const scarf=box(body,.13,.15,.055,color,.07,.66,.235,.03);scarf.rotation.z=-.35;
  const head=group(body,0,.99,0);ball(head,.31,.295,.29,material(skin,{roughness:.78}));
  for(const s of [-1,1]){
    ball(head,.075,.08,.057,skin,s*.295,-.015,0);ball(head,.026,.04,.023,0xcf8f6d,s*.323,-.006,.043);
    ball(head,.043,.064,.022,0x252d31,s*.112,.035,.265);ball(head,.012,.019,.007,colors.white,s*.102,.057,.286);
    ball(head,.05,.025,.010,0xe69677,s*.187,-.045,.222);const brow=ball(head,.057,.017,.017,0x825437,s*.117,.13,.25);brow.rotation.z=s*-.09;
  }
  ball(head,.071,.065,.073,skin,0,-.005,.304);ball(head,.043,.016,.018,0x824c35,0,-.125,.255);
  if(index%4===1){for(const s of [-1,1]){const m=ball(head,.079,.036,.031,0x624133,s*.052,-.077,.291);m.rotation.z=s*.2;}for(const s of [-1,1]){torus(head,.075,.012,0x374a47,s*.116,.038,.296);rod(head,[s*.18,.04,.29],[s*.28,.025,.09],.011,0x374a47);}rod(head,[-.04,.05,.31],[.04,.05,.31],.012,0x374a47);}
  if(index%4===2){for(const s of [-1,1]){const ear=meshEar(head,s);ear.rotation.z=-s*.26;}ball(head,.17,.11,.085,0xffd9a3,0,-.09,.245);ball(head,.05,.035,.035,0x3c382f,0,-.03,.338);}
  cylinder(head,.28,.267,.19,colors.white,0,.28,-.025);torus(head,.269,.025,0xe9e4d4,0,.19,-.025).rotation.x=Math.PI/2;
  const hat=group(head,0,.46,-.03);
  if(!sharedHat){sharedHat=new T.SphereGeometry(1,40,24);const vertices=sharedHat.attributes.position;for(let i=0;i<vertices.count;i++){const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i),theta=Math.atan2(z,x),fold=1+.11*Math.cos(theta*5)*Math.pow(1-y*y,.6);vertices.setXYZ(i,x*.365*fold,y*.25+Math.cos(theta*5)*.018*(1-y*y),z*.325*fold);}sharedHat.computeVertexNormals();}
  const hatMesh=new T.Mesh(sharedHat,material(colors.white,{roughness:.78}));hatMesh.castShadow=true;hatMesh.receiveShadow=true;hat.add(hatMesh);
  const arms=[];for(const s of [-1,1]){
    const a=group(body,s*.295,.66,0);ball(a,.102,.15,.11,colors.white,s*.012,-.055,0);cylinder(a,.087,.075,.1,color,0,-.20,0);ball(a,.086,.082,.09,colors.white,0,-.285,0);arms.push(a);
  }
  const carried=plate(body,0,.61,.58);ingredient(carried,'json',0,.08,0,.90);carried.visible=false;
  const utensil=group(body);rod(utensil,[0,0,-.1],[0,0,.03],.025,0x80512d);box(utensil,.028,.12,.22,material(0xc7d4d3,{metalness:.4,roughness:.3}),0,.05,.14,.012);utensil.visible=false;
  const spoon=group(body);rod(spoon,[0,0,0],[0,-.20,.25],.023,0x80512d);ball(spoon,.05,.02,.07,0x9d703e,0,-.20,.25);spoon.visible=false;
  const attention=group(root,0,1.98,0);ball(attention,.14,.14,.05,0xf1bb4d);box(attention,.025,.1,.018,colors.dark,0,.02,.051,.005);ball(attention,.018,.018,.013,colors.dark,0,-.07,.055);attention.visible=false;
  for(const part of [body,head,...arms,...legs])batchMeshes(part,false);
  return {id,root,body,head,hat,arms,legs,ring,carried,utensil,spoon,attention,color,state:'working',target:new T.Vector3(),facing:0,phase:index*1.8,selected:false,carryType:'json',route:[],home:null};
}
function meshEar(parent,s){const g=group(parent,s*.23,.18,.005);const ear=cylinder(g,.012,.095,.23,0xda9051,0,0,0);ball(g,.041,.067,.019,0xe8b49a,0,-.02,.07);return ear;}
export function setCarriedType(chef,type){if(chef.carryType===type)return;chef.carryType=type;while(chef.carried.children.length>2)chef.carried.remove(chef.carried.children.at(-1));ingredient(chef.carried,type,0,.08,0,.9);}
export function animateChef(c,time,dt,reduced=false,paused=false){
  c.ring.material=material(c.selected?0xffe9a0:c.color,{roughness:.65});
  c.attention.visible=['permission','input','error'].includes(c.state);
  // Pause freezes the current pose instead of resetting every joint to rest.
  if(paused)return;
  const motion=!reduced,pose=c.pose||c.state,phase=time*5+c.phase,distance=c.root.position.distanceTo(c.target),walking=distance>.035&&!reduced;
  if(reduced)c.root.position.copy(c.target);
  if(walking){const delta=c.target.clone().sub(c.root.position);c.facing=Math.atan2(delta.x,delta.z);if(motion)c.root.position.addScaledVector(delta.normalize(),Math.min(distance,dt*2.0));else if(!paused)c.root.position.copy(c.target);}
  let angle=c.facing-c.root.rotation.y;angle=Math.atan2(Math.sin(angle),Math.cos(angle));c.root.rotation.y+=angle*(motion?Math.min(1,dt*10):1);
  c.body.position.y=motion?(walking?Math.abs(Math.sin(phase*1.6))*.047:Math.sin(phase*.35)*.013):0;
  c.body.rotation.z=motion?(walking?Math.sin(phase*1.6)*.045:Math.sin(phase*.23)*.024):0;
  c.head.rotation.z=motion&&pose==='reading'?Math.sin(phase*.45)*.12:0;
  c.head.rotation.y=motion&&!walking?Math.sin(phase*(c.atWorktop?.35:.18))*(c.atWorktop?.12:.22):0;
  c.head.rotation.x=c.atWorktop?.10:0;
  c.hat.rotation.z=motion&&walking?Math.sin(phase*1.6+.7)*.055:0;
  c.legs.forEach((l,i)=>{l.rotation.x=motion&&walking?Math.sin(phase*1.6+i*Math.PI)*.5:0;});
  const carry=c.carrying;c.carried.visible=!!carry;
  const working=c.atWorktop&&!walking&&!carry&&['writing','executing','reading','working'].includes(pose);
  const hands=[new T.Vector3(-.20,.91,.44),new T.Vector3(.20,.95,.46)];
  if(working&&pose==='working'){
    hands[0].set(-.22,1.04+(motion?Math.sin(phase*.65)*.14:0),.44);
    hands[1].set(.18+(motion?Math.sin(phase*.65)*.10:0),1.08+(motion?Math.cos(phase*.65)*.16:0),.48);
  }
  if(working&&pose==='reading'){
    hands[0].set(-.20,1.0,.48);hands[1].set(.14+(motion?Math.sin(phase*.45)*.15:0),1.03+(motion?Math.max(0,Math.sin(phase*.9))*.13:0),.54);
  }
  if(working&&pose==='writing')hands[1].y+=motion?Math.abs(Math.sin(phase*1.4))*.24:0;
  if(working&&pose==='executing'){hands[1].set((motion?Math.sin(phase*.9)*.17:0),1.22,.43+(motion?Math.cos(phase*.9)*.15:0));hands[0].set(-.22,1.05,.40);}
  c.arms.forEach((a,i)=>{
    a.scale.set(1,1,1);a.rotation.set(0,0,(i===0?1:-1)*.15);
    if(working){const direction=hands[i].clone().sub(a.position);a.quaternion.setFromUnitVectors(new T.Vector3(0,-1,0),direction.clone().normalize());a.scale.y=direction.length()/.285;}
    else if(carry){a.rotation.x=-1.72;a.rotation.z=(i===0?-1:1)*.07;}
    else if(walking&&motion)a.rotation.x=Math.sin(phase*1.6+i*Math.PI)*.45;
    else if((c.state==='permission'||c.state==='input')&&i===1){a.rotation.z=-2.4;a.rotation.x=motion?Math.sin(phase*.5)*.10:0;}
  });
  c.utensil.visible=working&&pose==='writing';c.utensil.position.copy(hands[1]);
  c.spoon.visible=working&&pose==='executing';c.spoon.position.copy(hands[1]);
  c.attention.rotation.y=-c.root.rotation.y;c.attention.position.y=1.98+(motion?Math.sin(phase)*.035:0);
  c.ring.scale.setScalar((c.selected?1.18:c.related?1.12:1)+(motion&&working?.05*(1+Math.sin(phase*.6)):0));
}
