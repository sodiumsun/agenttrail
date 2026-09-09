import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {batchMeshes,disposeBatches} from './batch.js';
import {group,box,ball,cylinder,torus,rod,tube,material,colors,ground,wood,random,counter,plate,ingredient,board,stove,pot,sink,bell,recipe,barrel,plant,crate,wheel,bunting,balloonBunch,plaque} from './art.js';
import {createChef,animateChef,hash} from './chefs.js';
import {routeBetween,walkable} from './routes.js';
import {needsAttention,isWorking} from './activity.js';
import {workingFirst,workPose,approachPoint,nextWorkBeat} from './motion.js';
import {stationForChef,orderForChef,orderColor} from './orders.js';
import {stationLayout} from './layout.js';


export class KitchenWorld {
  constructor(canvas,onSelect,onLabels){
    this.layout=stationLayout(4);this.canvas=canvas;this.onSelect=onSelect;this.onLabels=onLabels;this.crew=new Map();this.plates=new Map();this.dishes=new Map();this.selected=null;this.zoom=1;this.time=0;this.paused=false;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.demo=false;this.roomKey='';this.components=[];this.hovered=null;this.pan=new T.Vector3();
    this.renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFShadowMap;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.83;
    this.scene=new T.Scene();this.scene.background=null;this.renderer.setClearColor(0x000000,0);
    this.camera=new T.OrthographicCamera(-10,10,8,-8,.1,80);this.camera.position.set(0,22,14);this.target=new T.Vector3(0,.05,.25);this.camera.lookAt(this.target);
    const env=new T.PMREMGenerator(this.renderer);this.scene.environment=env.fromScene(new RoomEnvironment(),.06).texture;this.scene.environmentIntensity=.28;env.dispose();
    this.scene.add(new T.HemisphereLight(0xfff3df,0x8c7150,.5));
    const sun=new T.DirectionalLight(0xffe3b5,2.8);sun.position.set(-5,14,7);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-18;sun.shadow.camera.right=18;sun.shadow.camera.top=12;sun.shadow.camera.bottom=-12;sun.shadow.camera.near=.5;sun.shadow.camera.far=36;sun.shadow.normalBias=.025;sun.shadow.bias=-.0002;sun.shadow.radius=4;this.scene.add(sun);
    const fill=new T.DirectionalLight(0xcde8ff,.4);fill.position.set(7,9,-5);this.scene.add(fill);
    this.room=group(this.scene);this.characters=group(this.scene);this.characters.position.y=.07;this.outputs=group(this.scene);this.signs=group(this.scene);this.effects=[];this.worktops=group(this.scene);this.workSlots=[];this.beltMotion=group(this.scene);
    this.buildRoom();this.batchRoom();
    this.composer=new EffectComposer(this.renderer);this.composer.addPass(new RenderPass(this.scene,this.camera));
    this.ao=new SSAOPass(this.scene,this.camera,600,400,16);this.ao.kernelRadius=.28;this.ao.minDistance=.0005;this.ao.maxDistance=.045;this.composer.addPass(this.ao);this.composer.addPass(new OutputPass());
    this.renderer.info.autoReset=false;this.raycaster=new T.Raycaster();this.pointer=new T.Vector2();this.bind();this.resize();
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas.parentElement);
    let last=performance.now(),frames=0,measure=last;this.renderer.setAnimationLoop(now=>{if(now-last<1000/30)return;const dt=Math.min(.1,(now-last)/1000);last=now;if(!this.paused&&!document.hidden)this.time+=dt;if(!document.hidden){this.update(dt);this.renderer.info.reset();this.composer.render();frames++;if(now-measure>2000){const fps=Math.round(frames*1000/(now-measure));canvas.dataset.fps=String(fps);canvas.dataset.drawCalls=String(this.renderer.info.render.calls);canvas.dataset.chefs=String(this.crew.size);canvas.dataset.geometries=String(this.renderer.info.memory.geometries);if(fps<22&&!this.performanceMode){this.performanceMode=true;this.ao.enabled=false;this.renderer.setPixelRatio(1);this.composer.setPixelRatio(1);this.resize();canvas.dataset.quality='performance';}frames=0;measure=now;}}else{frames=0;measure=now;}});
  }
  batchRoom(){batchMeshes(this.room);}
  buildRoom(){
    const {width,extra,positions,columns}=this.layout,edge=x=>x+Math.sign(x)*extra;
    box(this.room,width,.32,12.6,0x9e653d,0,-.16,0,.24);box(this.room,width-.3,.07,12.3,ground(),0,.035,0,.17);
    for(const z of [-6.05,6.05])box(this.room,width-.1,.13,.17,wood(),0,.05,z);
    for(const x of [edge(-8.25),edge(8.25)])box(this.room,.16,.13,12.3,wood(),x,.05,0);
    // The perimeter stays low at the front so it never hides the working chefs.
    for(let x=edge(-8);x<=edge(8);x+=1.35){for(const z of [-5.8,5.75]){if(z>0&&Math.abs(x)<3.5)continue;box(this.room,.17,z<0?1.55:.65,.17,wood(),x,z<0?.78:.33,z);ball(this.room,.115,.055,.115,colors.trim,x,z<0?1.57:.70,z);}}
    for(const z of [-5.8,5.75])for(const y of z<0?[.5,1.12]:[.28,.55]){if(z<0)box(this.room,width-.6,.18,.12,wood(),0,y,z);else for(const s of [-1,1])box(this.room,4.6+extra,.14,.10,wood(),s*(5.8+extra/2),y,z);}
    for(const x of [edge(-8.0),edge(8.0)]){for(let z=-4.7;z<=4.8;z+=1.35)box(this.room,.17,.9,.17,wood(),x,.45,z);for(const y of [.30,.72])box(this.room,.12,.16,10.4,wood(),x,y,0);}
    // Whole counters are added without stretching characters or furniture.
    for(let i=0;i<positions.length;i++){
      const [x,z]=positions[i];counter(this.room,x,z,4.15,1.32);
      for(let seat=0;seat<3;seat++){
        const cx=x+(seat-1)*1.30,cz=z+(i<columns?.27:-.27),root=group(this.worktops),kits={};
        kits.writing=group(root);board(kits.writing,cx,cz);ingredient(kits.writing,'json',cx,1.24,cz,.75);
        kits.reading=group(root);recipe(kits.reading,cx,1.19,cz);kits.review=group(root);if(seat===1)bell(kits.review,cx,1.20,cz);
        kits.executing=group(root);const cook=stove(kits.executing,cx,cz),p=pot(cook,0,.14,0);this.addSteam(p,0,.5,0,i*3+seat);
        for(const kit of Object.values(kits))batchMeshes(kit);
        this.workSlots.push({root,kits,station:i,seat,x:cx,z:cz});
      }
    }
    for(const x of [edge(-6.16),edge(6.16)]){for(const z of [-2.2,-.8,.6,2])counter(this.room,x,z,1.32,1.4);}
    const wash=counter(this.room,edge(6.16),3.5,1.32,1.45);sink(wash);
    const spare=counter(this.room,edge(-6.16),3.5,1.32,1.45);for(let i=0;i<4;i++)plate(spare,0,1.17+i*.05,0);
    if(columns===2){counter(this.room,0,-3.45,2.45,1.32);const serve=group(this.room,0,1.15,-3.45);box(serve,1.38,.11,.94,colors.cream);for(let i=0;i<3;i++){box(serve,1.05,.035,.04,0xc3af87,0,.08,-.3+i*.3);}bell(serve,.80,.03,.05);}
    counter(this.room,0,.30,3.5,1.24);this.pass=group(this.room,0,1.17,.30);
    const passSign=plaque(this.pass,'SHARED DISHES',2.1,.28,0,.08,.58);passSign.rotation.x=-Math.PI/2;
    this.buildConveyor();
    // Timber pantry with open cubbies, bags, crates, and a little striped roof.
    const pantry=group(this.room,edge(-7.15),0,-4.0);pantry.rotation.y=.08;
    box(pantry,2.05,2.8,.22,wood(),0,1.42,-.38);for(const x of [-1,0,1])box(pantry,.12,2.85,.8,wood(),x,1.42,0);for(const y of [.15,.93,1.72,2.55])box(pantry,2.08,.10,.92,wood(),0,y,0);
    for(let i=0;i<3;i++)for(const s of [-1,1]){const c=crate(pantry,s*.5,.17+i*.8,.05);c.scale.set(.84,.8,.8);for(let j=0;j<3;j++)ingredient(c,['json','image','text','code'][(i+(s>0?1:0))%4],(j-1)*.23,.22,.02,.78);}
    box(pantry,2.16,.49,.14,wood(),0,2.78,.18);plaque(pantry,'PANTRY',1.80,.30,0,2.79,.265,'#9e602f','#fff0c9');
    const hatch=group(this.room,edge(7.23),0,-2.15);hatch.rotation.y=-.28;box(hatch,1.25,1.25,1.1,wood(),0,.63,0);box(hatch,1.44,.13,1.22,colors.trim,0,1.32,0);for(const s of [-1,1])box(hatch,.11,2.7,.11,wood(),s*.66,1.36,-.38);
    this.awning(hatch,0,2.69,-.10,1.75,1.55);box(hatch,1.30,.5,.12,wood(),0,1.95,-.27);plaque(hatch,'SERVE',1.12,.34,0,1.96,-.19,'#744229','#fff0d2');bell(hatch,0,1.4,.3);
    for(const [x,z,s] of [[-7.2,2.7,.9],[-7.15,4.05,1],[-5.85,5.25,.83],[7.1,3.4,.85],[5.95,-5.1,.8]]){barrel(this.room,edge(x),z,s);}
    const herbs=plant(this.room,edge(-7.2),2.7,.8);herbs.position.y=.85;plant(this.room,edge(7.1),3.4,.75,true).position.y=.8;
    for(const [x,z,s] of [[-6,-5.1,1.05],[6.95,-4.5,.9],[-4.8,5.3,.8],[2.5,-5.15,.75]])plant(this.room,edge(x),z,s,true);
    for(const [x,z] of [[-7.2,.75],[7.15,4.85]]){const c=crate(this.room,edge(x),0,z);c.rotation.y=.16;ingredient(c,'image',.05,.28,0,1.4);ingredient(c,'code',-.2,.28,.04,1.15);}
    const cart=group(this.room,edge(-7.3),0,4.9);box(cart,1.8,.48,1.15,wood(),0,.65,0);wheel(cart,-.53,.47,.64);wheel(cart,.58,.47,.64);this.awning(cart,0,2.0,0,2.15,1.65);for(const x of [-.87,.87])box(cart,.07,1.5,.07,colors.trim,x,1.2,0);
    balloonBunch(this.room,edge(7.4),-4.85);balloonBunch(this.room,edge(-6.2),5.4);
    for(const x of [edge(-7.8),edge(7.8)]){box(this.room,.12,3.4,.12,wood(),x,1.7,-5.8);ball(this.room,.12,.12,.12,colors.gold,x,3.43,-5.8);}
    bunting(this.room,[edge(-7.8),3.35,-5.8],[edge(7.8),3.35,-5.8]);bunting(this.room,[edge(-7.9),2.7,-4.7],[edge(-7.9),1.65,4.3]);bunting(this.room,[edge(7.9),2.7,-4.7],[edge(7.9),1.6,4.3]);
    for(let i=0;i<80;i++){const x=(random()-.5)*(width-1.2),z=(random()-.5)*11.5;if(Math.abs(x)<6.7+extra&&Math.abs(z)<4.6)continue;const straw=box(this.room,.018,.012,.18+random()*.25,0xf5c567,x,.092,z,.004);straw.rotation.y=random()*Math.PI;}
  }
  buildConveyor(){
    const extra=this.layout.extra;this.tableX=4.7+extra*.35;this.beltStart=-4.4-extra*.3;this.beltEnd=this.tableX-1.65;this.beltZ=5.05;
    const width=this.beltEnd-this.beltStart,center=(this.beltStart+this.beltEnd)/2;
    box(this.room,width+.35,.30,1.1,0x435855,center,.77,this.beltZ,.12);
    box(this.room,width,.08,.80,0x526a63,center,.96,this.beltZ,.035);
    for(const z of [-.51,.51])box(this.room,width+.4,.12,.09,0xc7aa67,center,1.0,this.beltZ+z,.025);
    for(const x of [this.beltStart,this.beltEnd]){
      for(const z of [-.36,.36])box(this.room,.15,.66,.15,wood(),x,.38,this.beltZ+z);
      const roller=cylinder(this.room,.18,.18,.90,0x83aaa3,x,.82,this.beltZ);roller.rotation.x=Math.PI/2;
    }
    this.beltMotion.clear();this.beltSlats=[];
    for(let i=0;i<18;i++){const mesh=box(this.beltMotion,.05,.025,.77,0x92a398,this.beltStart+width*i/18,1.02,this.beltZ,.006);this.beltSlats.push(mesh);}
    for(let i=0;i<3;i++){const sign=plaque(this.room,'›',.28,.22,this.beltStart+width*(i+.5)/3,1.04,this.beltZ,'#536e65','#f3d28a');sign.rotation.x=-Math.PI/2;}
    // A shared table collects completed work. It does not declare the outcome shipped.
    for(const x of [-1.25,1.25])for(const z of [-.52,.52])box(this.room,.16,.9,.16,wood(),this.tableX+x,.5,this.beltZ+z);
    box(this.room,3.25,.18,1.62,wood(),this.tableX,1.0,this.beltZ,.14);
    box(this.room,2.95,.04,1.38,colors.cream,this.tableX,1.12,this.beltZ,.10);
    const label=plaque(this.room,'DELIVERABLE TABLE',2.7,.32,this.tableX,1.14,this.beltZ+.82,'#faf0d2','#4a624e');label.rotation.x=-Math.PI/4;
  }
  clearDish(mesh){mesh.traverse(o=>{if(o.material?.isMeshBasicMaterial&&o.material.map){o.material.map.dispose();o.material.dispose();o.geometry.dispose();}});mesh.removeFromParent();}
  setOrders(orders,tables,newRoom){
    if(newRoom){for(const mesh of this.dishes.values())this.clearDish(mesh);this.dishes.clear();}
    this.orders=orders;this.tables=tables;
    const completed=orders.filter(o=>!o.withdrawn&&o.status==='completed').slice(-8),open=orders.filter(o=>!o.withdrawn&&o.status!=='completed').sort((a,b)=>b.activeChefIds.length-a.activeChefIds.length||a.index-b.index).slice(0,8),visible=[...open,...completed],keep=new Set();
    visible.forEach((order,index)=>{
      keep.add(order.id);let dish=this.dishes.get(order.id),created=!dish;
      if(!dish){dish=plate(this.outputs);dish.userData={kind:'order',id:order.id,version:order.completionVersion};
        ingredient(dish,'text',-.07,.08,0,.60);ingredient(dish,'json',.10,.10,.06,.62);
        const rim=torus(dish,.385,.025,orderColor(order),0,.13,0);rim.rotation.x=Math.PI/2;
        const badge=plaque(dish,'#'+order.number,.40,.22,0,.16,.43,orderColor(order),'#fff7e3');badge.rotation.x=-Math.PI/3;
        this.dishes.set(order.id,dish);
      }
      const done=order.status==='completed',wasDone=dish.userData.order?.status==='completed',chef=this.crew.get(order.activeChefIds.find(id=>this.crew.has(id))),slot=chef&&this.workSlots[chef.workSlot];
      const j=completed.indexOf(order),target=done?new T.Vector3(this.tableX+(j%4-1.5)*.68,1.17,this.beltZ+(Math.floor(j/4)-.5)*.65):slot?new T.Vector3(slot.x+.42,1.30,slot.z):new T.Vector3((index%4-1.5)*.76,1.23,.22+Math.floor(index/4)*.35);
      if(!done){delete dish.userData.delivery;if(!created&&!this.reduced&&!this.paused&&dish.position.distanceTo(target)>.15&&!dish.userData.move)dish.userData.move={from:dish.position.clone(),to:target,start:this.time};}
      if(done&&!newRoom&&!this.reduced&&!this.paused&&((!created&&!wasDone)||dish.userData.version!==order.completionVersion)){
        dish.userData.delivery={start:this.time,from:dish.position.clone(),target};delete dish.userData.move;
      }
      if(done)delete dish.userData.move;
      if(done&&dish.userData.delivery)dish.userData.delivery.target=target;
      if(!dish.userData.delivery&&!dish.userData.move)dish.position.copy(target);
      if(dish.userData.move){dish.userData.move.to=target;if(this.reduced||this.paused){dish.position.copy(target);delete dish.userData.move;}}
      dish.userData.order=order;dish.userData.version=order.completionVersion;dish.userData.target=target;
    });
    for(const [id,mesh] of this.dishes)if(!keep.has(id)){this.clearDish(mesh);this.dishes.delete(id);}
    if(!this.tableHit){this.tableHit=box(this.outputs,3.3,.12,1.65,new T.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}),this.tableX,1.13,this.beltZ);this.tableHit.userData={kind:'table',id:'all'};}this.tableHit.position.set(this.tableX,1.13,this.beltZ);
  }
  awning(parent,x,y,z,w,d){const g=group(parent,x,y,z);for(let i=0;i<7;i++){const color=i%2?colors.cream:colors.coral;const roof=box(g,w/7+.012,.07,d,color,-w/2+(i+.5)*w/7,0,0,.04);roof.rotation.x=.18;ball(g,w/14,.15,.048,color,-w/2+(i+.5)*w/7,-.18,d/2-.04);}}
  addSteam(parent,x,y,z,station){for(let i=0;i<3;i++){const puff=ball(parent,.07,.1,.07,new T.MeshBasicMaterial({color:0xfff9db,transparent:true,opacity:.16,depthWrite:false}),x,y,z);puff.castShadow=false;this.effects.push({puff,origin:new T.Vector3(x,y,z),phase:i/3,station});}}
  bind(){let down=null,drag=false;this.canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,px:this.pan.x,pz:this.pan.z};drag=false;this.canvas.setPointerCapture(e.pointerId);});
    this.canvas.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>5){drag=true;this.pan.x=T.MathUtils.clamp(down.px-(e.clientX-down.x)*.013/this.zoom,-3,3);this.pan.z=T.MathUtils.clamp(down.pz-(e.clientY-down.y)*.018/this.zoom,-2,2);this.updateCamera();}else if(!down)this.hit(e,false);});
    this.canvas.addEventListener('pointerup',e=>{if(!drag)this.hit(e,true);down=null;});this.canvas.addEventListener('pointercancel',()=>{down=null;});
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=T.MathUtils.clamp(this.zoom*Math.exp(-e.deltaY*.0006),.8,1.65);this.resize();},{passive:false});
    this.canvas.addEventListener('keydown',e=>{if(e.key==='0'){this.fit();e.preventDefault();}if(['+','=','-'].includes(e.key)){this.changeZoom(e.key==='-'?-.12:.12);e.preventDefault();}});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{this.reduced=e.matches;});
  }
  hit(e,select){const rect=this.canvas.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);const hits=this.raycaster.intersectObjects([this.characters,this.outputs,this.signs],true);let object=null;for(const h of hits){let p=h.object;while(p&&!p.userData.kind)p=p.parent;if(p?.userData.kind){object=p.userData;break;}}
    this.canvas.style.cursor=object?'pointer':'grab';if(select&&object)this.onSelect(object);}
  resize(){const rect=this.canvas.parentElement.getBoundingClientRect();this.width=rect.width;this.height=rect.height;this.renderer.setSize(rect.width,rect.height,false);this.composer?.setSize(rect.width,rect.height);const aspect=rect.width/Math.max(1,rect.height),span=Math.max(13.4,(this.layout.width+1.7)/aspect)/this.zoom,offset=0;this.camera.left=-span*aspect/2;this.camera.right=span*aspect/2;this.camera.top=span/2+offset;this.camera.bottom=-span/2+offset;this.camera.updateProjectionMatrix();this.updateCamera();}
  updateCamera(){this.camera.position.set(this.pan.x,22,14+this.pan.z);this.camera.lookAt(this.target.clone().add(this.pan));}
  fit(){this.zoom=1;this.pan.set(0,0,0);this.resize();}
  changeZoom(delta){this.zoom=T.MathUtils.clamp(this.zoom+delta,.8,1.65);this.resize();}
  setData({components,crew,artifacts,transfers,demo,kitchenId,projectId,connected=true,orders=[],tables=[]}){
    const layout=stationLayout(components.length);
    if(layout.columns!==this.layout.columns){
      this.layout=layout;this.room.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(o.material.isMeshBasicMaterial&&!o.material.transparent&&o.material.map){o.material.map.dispose();o.material.dispose();}}});for(const e of this.effects)e.puff.material.dispose();this.room.clear();disposeBatches(this.worktops);this.worktops.clear();this.effects=[];this.workSlots=[];this.buildRoom();this.batchRoom();this.resize();this.roomKey='';
    }
    const {positions,columns,walkWidth}=this.layout;
    const scope=`${demo}:${projectId}:${kitchenId}`,newRoom=scope!==this.scope;if(newRoom){this.scope=scope;this.seenTransfers=new Set(transfers.map(t=>t.id+':'+t.state));for(const p of this.plates.values()){delete p.userData.flight;delete p.userData.receivedAt;}}
    this.demo=demo;this.projectId=projectId;this.kitchenId=kitchenId;this.components=components;this.transfers=transfers;
    const key=JSON.stringify(components.map(c=>[c.id,c.title]));if(key!==this.roomKey){this.roomKey=key;while(this.signs.children.length){const s=this.signs.children[0];s.traverse(o=>{if(o.material?.map){o.material.map.dispose();o.material.dispose();o.geometry.dispose();}});this.signs.remove(s);}components.slice(0,8).forEach((c,i)=>{const [x,z]=positions[i],sign=group(this.signs,x,1.28,z+(z<0?-.35:.3));sign.userData={kind:'workstation',id:c.id};box(sign,2.3,.34,.06,colors.wood);plaque(sign,c.title,2.18,.28,0,0,.04);sign.rotation.x=-.45;});}
    const occupied=[],incoming=new Set(),seats=new Set();this.activeStoves=new Set();
    for(const slot of this.workSlots){for(const [kind,kit] of Object.entries(slot.kits))kit.visible=kind===['executing','writing','reading'][slot.seat];}
    components.forEach((c,i)=>{if(c.kind)for(const slot of this.workSlots.filter(s=>s.station===i)){for(const kit of Object.values(slot.kits))kit.visible=false;slot.kits.reading.visible=c.kind==='knowledge';slot.kits.review.visible=c.kind==='human';}});
    workingFirst(crew.slice(0,12)).forEach(({data:s,index})=>{
      incoming.add(s.id);let c=this.crew.get(s.id);
      if(c&&c.visualIndex!==s.visualIndex){disposeBatches(c.root);this.characters.remove(c.root);this.crew.delete(s.id);c=null;}if(!c){c=createChef(this.characters,s.id,s.visualIndex??hash(s.id)%12);c.visualIndex=s.visualIndex;c.root.scale.setScalar(1.3);this.crew.set(s.id,c);}
      c.data=s;c.state=!connected?'quiet':s.freshness==='quiet'&&!needsAttention(s)?'quiet':s.state;c.pose=c.state==='quiet'?'quiet':workPose(s);
      const active=connected&&isWorking(s),ci=stationForChef({...s,state:c.pose},index,components.length),prefer={executing:0,writing:1,reading:2}[c.pose]??1;
      let seat=active&&ci>=0?[prefer,...[0,1,2].filter(i=>i!==prefer)].find(i=>!seats.has(ci+':'+i)):undefined;
      c.atWorktop=seat!==undefined;c.workSlot=seat===undefined?null:ci*3+seat;
      let desired;
      if(c.atWorktop){seats.add(ci+':'+seat);const slot=this.workSlots[c.workSlot];desired=[slot.x,ci<columns?-2.32:2.42];for(const [kind,kit] of Object.entries(slot.kits))kit.visible=kind===(['reading','writing','executing'].includes(c.pose)?c.pose:['executing','writing','reading'][seat]);}
      else desired=ci>=0?[positions[ci][0],ci<columns?-1.25:1.65]:[index%2===0?-3.2:3.2,0];
      const options=[desired,...[-1.55,1.75].flatMap(z=>[-4.7,-3.4,-2.1,2.1,3.4,4.7].map(x=>[x,z])),...[-4.7,-3.4,3.4,4.7].map(x=>[x,0])].filter(p=>walkable(...p,walkWidth)&&!occupied.some(o=>Math.hypot(o[0]-p[0],o[1]-p[1])<1.06));
      options.sort((a,b)=>Math.hypot(a[0]-desired[0],a[1]-desired[1])-Math.hypot(b[0]-desired[0],b[1]-desired[1]));const chosen=options[0]||desired;occupied.push(chosen);
      if(Math.hypot(chosen[0]-desired[0],chosen[1]-desired[1])>.1){c.atWorktop=false;this.activeStoves.delete(c.workSlot);}
      const home=new T.Vector3(chosen[0],0,chosen[1]);c.baseFacing=ci>=0?(ci<columns?Math.PI:0):0;
      const approach=approachPoint(home),beat=nextWorkBeat(c,s,this.time,Date.now(),{newRoom,paused:this.paused,reduced:this.reduced});
      if(c.atWorktop)occupied.push(approach);
      if(!c.initialized||newRoom){c.root.position.copy(home);c.initialized=true;c.walkRoute=[];if(active&&c.atWorktop&&!this.paused&&!this.reduced){c.root.position.set(approach[0],0,approach[1]);c.walkRoute=routeBetween(approach,chosen,walkWidth).slice(1);}}
      else if(!c.home||c.home.distanceTo(home)>.1){c.walkRoute=routeBetween([c.root.position.x,c.root.position.z],chosen,walkWidth).slice(1);}
      else if(beat&&c.atWorktop){c.walkRoute=[...routeBetween([c.root.position.x,c.root.position.z],approach,walkWidth).slice(1),...routeBetween(approach,chosen,walkWidth).slice(1)];}
      c.home=home;c.facing=c.baseFacing;c.target.copy(home);
    });
    for(const [id,c] of this.crew)if(!incoming.has(id)){disposeBatches(c.root);this.characters.remove(c.root);this.crew.delete(id);}
    const outputIds=new Set();artifacts.slice(0,8).forEach((a,i)=>{outputIds.add(a.id);let p=this.plates.get(a.id);if(!p){p=plate(this.outputs);ingredient(p,a.kind,0,.07,0,.83);p.userData={kind:'plate',id:a.id};this.plates.set(a.id,p);}p.userData.artifact=a;const receipt=[...transfers].reverse().find(t=>t.artifactKey===a.id&&t.state==='received'),recipient=receipt&&crew.find(c=>receipt.recipientRoleId?c.roleId===receipt.recipientRoleId:c.id===receipt.recipient),ci=components.findIndex(c=>c.id===(a.componentId||recipient?.component?.id));const spot=ci>=0?positions[ci]:[0,-3.45];const order=orders.find(o=>o.id===a.orderId),orderChef=order&&this.crew.get(order.activeChefIds.find(id=>this.crew.has(id))),actor=orderChef||(recipient&&this.crew.get(recipient.id)),slot=actor&&this.workSlots[actor.workSlot];p.position.set(slot?slot.x-.43:spot[0]+(i%3-1)*.60,1.2,slot?slot.z:spot[1]);});for(const [id,p] of this.plates)if(!outputIds.has(id)){this.outputs.remove(p);this.plates.delete(id);}
    // Receipts belong at the pass; they must not commandeer a chef's newer action.
    if(!newRoom)for(const transfer of transfers){const key=transfer.id+':'+transfer.state;if(this.seenTransfers.has(key))continue;this.seenTransfers.add(key);if(transfer.state==='received'){const p=this.plates.get(transfer.artifactKey),sender=transfer.senderRoleId?[...this.crew.values()].find(c=>c.data.roleId===transfer.senderRoleId):this.crew.get(transfer.sender),recipient=transfer.recipientRoleId?[...this.crew.values()].find(c=>c.data.roleId===transfer.recipientRoleId):this.crew.get(transfer.recipient);if(p){p.userData.receivedAt=this.time;if(recipient&&!this.reduced&&!this.paused)p.userData.flight={from:sender?new T.Vector3(sender.home.x,1.35,sender.home.z):new T.Vector3(0,1.35,.3),to:p.position.clone(),start:this.time};}}}
    this.setOrders(orders,tables,newRoom);
  }
  select(selection){
    this.selected=selection;const selectedChef=selection?.kind==='chef'?this.crew.get(selection.id):null;
    const selectedOrder=selection?.kind==='order'?this.orders?.find(o=>o.id===selection.id):selectedChef?orderForChef(this.orders||[],selectedChef.data.id):null;
    const component=selectedChef?(selectedChef.data.component?.id||'__unlinked'):['goal','station'].includes(selection?.kind)?selection.id:null;
    for(const c of this.crew.values()){c.selected=selection?.kind==='chef'&&selection.id===c.id;c.related=selectedOrder?selectedOrder.contributors.some(person=>person.chefId===c.data.id):!!component&&(c.data.component?.id||'__unlinked')===component;}
    for(const dish of this.dishes.values())dish.scale.setScalar(selectedOrder?.id===dish.userData.id?1.12:1);
    for(const sign of this.signs.children){const active=sign.userData.id===component;sign.scale.setScalar(active?1.06:1);}
  }
  update(dt){
    const t=this.time;
    this.activeStoves=new Set();let walkers=0,workers=0;
    for(const c of this.crew.values()){
      c.carrying=false;
      if(this.reduced&&!this.paused)c.walkRoute=[];
      const point=c.walkRoute?.[0];
      c.target.copy(point?new T.Vector3(point[0],0,point[1]):c.home);
      if(point&&c.root.position.distanceTo(c.target)<.08)c.walkRoute.shift();
      if(!point&&c.root.position.distanceTo(c.target)<.04)c.facing=c.baseFacing;
      animateChef(c,t,dt,this.reduced,this.paused);
      if(c.root.position.distanceTo(c.home)>.08||c.walkRoute?.length){if(!this.paused&&!this.reduced)walkers++;}
      else if(c.atWorktop&&isWorking(c.data)){workers++;if(c.pose==='executing')this.activeStoves.add(c.workSlot);}
    }
    this.canvas.dataset.walking=String(walkers);this.canvas.dataset.working=String(workers);this.canvas.dataset.motion=this.paused?'paused':this.reduced?'reduced':'playing';
    for(const p of this.plates.values()){
      const flight=p.userData.flight;if(flight){const progress=T.MathUtils.clamp((t-flight.start)/.7,0,1);p.position.lerpVectors(flight.from,flight.to,progress);p.position.y+=Math.sin(progress*Math.PI)*.5;if(progress===1||this.reduced){p.position.copy(flight.to);delete p.userData.flight;}}
      const since=t-(p.userData.receivedAt??-100);p.scale.setScalar(!this.reduced&&!this.paused&&since<.7?1+Math.sin(since/.7*Math.PI)*.12:1);
    }
    let delivering=false;
    for(const dish of this.dishes.values()){
      const delivery=dish.userData.delivery,move=dish.userData.move;
      if(delivery){
        const elapsed=t-delivery.start;delivering=true;
        if(elapsed<.6){const progress=elapsed/.6;dish.position.lerpVectors(delivery.from,new T.Vector3(this.beltStart,1.09,this.beltZ),progress);dish.position.y+=Math.sin(progress*Math.PI)*.6;}
        else if(elapsed<3.6)dish.position.set(T.MathUtils.lerp(this.beltStart,this.beltEnd,(elapsed-.6)/3),1.09,this.beltZ);
        else{const progress=Math.min(1,(elapsed-3.6)/.5);dish.position.lerpVectors(new T.Vector3(this.beltEnd,1.09,this.beltZ),delivery.target,progress);if(progress===1)delete dish.userData.delivery;}
        if(this.reduced){dish.position.copy(delivery.target);delete dish.userData.delivery;}
      }else if(move){const progress=Math.min(1,(t-move.start)/.8);dish.position.lerpVectors(move.from,move.to,progress);dish.position.y+=Math.sin(progress*Math.PI)*.25;if(progress===1||this.reduced){dish.position.copy(move.to);delete dish.userData.move;}}
    }
    if(delivering&&!this.paused&&!this.reduced)for(let i=0;i<this.beltSlats.length;i++)this.beltSlats[i].position.x=this.beltStart+((i/18+t/3)%1)*(this.beltEnd-this.beltStart);
    this.canvas.dataset.dishes=String(this.dishes.size);this.canvas.dataset.delivering=String([...this.dishes.values()].filter(d=>d.userData.delivery).length);
    for(const e of this.effects){e.puff.visible=!this.paused&&!this.reduced&&this.activeStoves?.has(e.station);const phase=(t*.35+e.phase)%1;e.puff.position.copy(e.origin).add(new T.Vector3(Math.sin(t+e.phase)*.06,phase*.7,0));const size=.6+phase*1.2;e.puff.scale.set(.07*size,.1*size,.07*size);e.puff.material.opacity=(1-phase)*.15;}
    if(this.onLabels){
      const labels=[],placed=[];
      for(const c of this.crew.values()){
        const p=c.root.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,0,c.baseFacing===Math.PI?.5:-.12)).project(this.camera);
        const visible=Math.abs(p.x)<1.15&&Math.abs(p.y)<1.1;
        const compact=this.width<1000||this.height<450,w=compact?144:176,h=compact&&!c.selected&&!needsAttention(c.data)&&!isWorking(c.data)?24:46;
        const fx=(p.x*.5+.5)*this.width,fy=(-p.y*.5+.5)*this.height;
        const candidates=[0,1,-1,2,-2,3].flatMap(row=>[0,-1,1].map(col=>({x:T.MathUtils.clamp(fx+col*w,w/2,this.width-w/2),y:T.MathUtils.clamp(fy+row*h,4,Math.max(4,this.height-h-4))})));
        const score=a=>placed.reduce((n,b)=>n+(Math.abs(a.x-b.x)<(w+b.w)/2&&a.y<b.y+b.h&&a.y+h>b.y?10000:0),0)+Math.hypot(a.x-fx,(a.y-fy)*1.2);
        candidates.sort((a,b)=>score(a)-score(b));const {x,y}=candidates[0];
        placed.push({x,y,w,h});labels.push({id:c.id,x,y,visible,compact,color:'#'+c.color.toString(16).padStart(6,'0')});
      }
      this.onLabels(labels);
    }
  }
  stats(){return {...this.renderer.info.render,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures,chefs:this.crew.size};}
}
