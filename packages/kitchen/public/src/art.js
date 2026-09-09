import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

export const colors={cream:0xfff2d7,white:0xfff9e9,wood:0x93502a,trim:0xc47c40,blue:0x52b7d0,dark:0x24344b,gold:0xe6ae48,green:0x509644,coral:0xe66a55};
let seed=24871;export const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const cache=new Map(),materials=new Map();
export function material(color,extra={}){const key=JSON.stringify([color,extra]);if(!materials.has(key))materials.set(key,new T.MeshStandardMaterial({color,roughness:.65,...extra}));return materials.get(key);}
export function mesh(parent,geo,mat,x=0,y=0,z=0){const m=new T.Mesh(geo,typeof mat==='number'?material(mat):mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
export function box(parent,w,h,d,mat,x=0,y=0,z=0,r=.06){const key=`b:${w}:${h}:${d}:${r}`;if(!cache.has(key))cache.set(key,new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)));return mesh(parent,cache.get(key),mat,x,y,z);}
export function ball(parent,sx,sy,sz,mat,x=0,y=0,z=0){if(!cache.has('sphere'))cache.set('sphere',new T.SphereGeometry(1,20,14));const m=mesh(parent,cache.get('sphere'),mat,x,y,z);m.scale.set(sx,sy,sz);return m;}
export function cylinder(parent,rt,rb,h,mat,x=0,y=0,z=0){const key=`c:${rt}:${rb}:${h}`;if(!cache.has(key))cache.set(key,new T.CylinderGeometry(rt,rb,h,24));return mesh(parent,cache.get(key),mat,x,y,z);}
export function torus(parent,r,tube,mat,x=0,y=0,z=0){const key=`t:${r}:${tube}`;if(!cache.has(key))cache.set(key,new T.TorusGeometry(r,tube,8,32));return mesh(parent,cache.get(key),mat,x,y,z);}
export function group(parent,x=0,y=0,z=0){const g=new T.Group();g.position.set(x,y,z);parent.add(g);return g;}
export function rod(parent,a,b,r,mat){const va=new T.Vector3(...a),vb=new T.Vector3(...b),delta=vb.clone().sub(va);const m=cylinder(parent,r,r,delta.length(),mat,...va.clone().add(vb).multiplyScalar(.5).toArray());m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return m;}
export function tube(parent,points,r,mat){return mesh(parent,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),24,r,6,false),mat);}
function canvasTexture(size,draw){const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');draw(ctx,size);const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;return tex;}
const woodTexture=()=>canvasTexture(256,(c,s)=>{c.fillStyle='#ba7940';c.fillRect(0,0,s,s);for(let i=0;i<85;i++){const x=random()*s;c.strokeStyle=`rgba(${random()>.5?'248,192,108':'69,28,8'},${random()*.12})`;c.lineWidth=1+random()*3;c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x+10,80,x-6,180,x+4,s);c.stroke();}for(let i=0;i<4;i++){c.strokeStyle='rgba(74,38,13,.15)';c.beginPath();c.ellipse(random()*s,random()*s,3+random()*4,15+random()*12,0,0,Math.PI*2);c.stroke();}});
let woodMat,tileMat,groundMat;
export function wood(){return woodMat??=new T.MeshStandardMaterial({map:woodTexture(),color:0xe2b78b,roughness:.78});}
export function tile(){return tileMat??=new T.MeshStandardMaterial({map:canvasTexture(256,(c,s)=>{const blue=['#68c8de','#3496b9','#81d4e3','#54b4d1'];[[[0,0],[s,0],[s/2,s/2]],[[s,0],[s,s],[s/2,s/2]],[[s,s],[0,s],[s/2,s/2]],[[0,s],[0,0],[s/2,s/2]]].forEach((pts,i)=>{c.fillStyle=blue[i];c.beginPath();pts.forEach(([x,y])=>c.lineTo(x,y));c.fill();});for(let i=0;i<1600;i++){c.fillStyle=`rgba(255,255,255,${random()*.09})`;c.fillRect(random()*s,random()*s,1+random()*3,1);}c.strokeStyle='#a6dce5';c.lineWidth=5;c.strokeRect(0,0,s,s);}),roughness:.44});}
export function ground(){return groundMat??=new T.MeshStandardMaterial({map:canvasTexture(1024,(c,s)=>{c.fillStyle='#dba152';c.fillRect(0,0,s,s);for(let i=0;i<18000;i++){const x=random()*s,y=random()*s;c.fillStyle=`rgba(${random()>.47?'255,212,126':'166,94,42'},${.02+random()*.1})`;c.beginPath();c.ellipse(x,y,2+random()*12,1+random()*6,random()*3,0,Math.PI*2);c.fill();}for(let i=0;i<2100;i++){const x=random()*s,y=random()*s;if(x>160&&x<860&&y>160&&y<860)continue;c.strokeStyle=`rgba(255,212,93,${.15+random()*.45})`;c.lineWidth=1+random();c.beginPath();c.moveTo(x,y);c.lineTo(x+(random()-.5)*35,y+(random()-.5)*35);c.stroke();}}),roughness:1});}
let shadowMat;
export function contact(parent,x,z,sx,sz,opacity=.3){shadowMat??=new T.MeshBasicMaterial({map:canvasTexture(128,(c,s)=>{const g=c.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'rgba(61,33,17,.65)');g.addColorStop(.45,'rgba(61,33,17,.35)');g.addColorStop(1,'rgba(61,33,17,0)');c.fillStyle=g;c.fillRect(0,0,s,s);}),transparent:true,depthWrite:false,opacity});const key=`shadow:${sx}:${sz}`;if(!cache.has(key))cache.set(key,new T.PlaneGeometry(sx,sz));const m=mesh(parent,cache.get(key),shadowMat,x,.015,z);m.rotation.x=-Math.PI/2;m.castShadow=false;return m;}

export function plaque(parent,text,w=1.5,h=.4,x=0,y=1,z=0,bg='#f7e6bf',fg='#483226'){
  const c=document.createElement('canvas');c.width=768;c.height=Math.round(768*h/w);const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle='#d7b17b';ctx.lineWidth=8;ctx.strokeRect(5,5,c.width-10,c.height-10);ctx.fillStyle=fg;ctx.font=`800 ${Math.min(c.height*.53,68)}px Nunito, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,c.width/2,c.height/2+3,c.width-40);const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;const m=mesh(parent,new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:tex,side:T.DoubleSide}),x,y,z);m.castShadow=false;return m;
}
export function counter(parent,x,z,w=1.45,d=1.35){const g=group(parent,x,0,z);
  contact(g,0,0,w+.55,d+.55);box(g,w,.89,d,colors.wood,0,.49,0,.07);
  const count=Math.max(2,Math.round(w/.42));for(let i=0;i<count;i++)box(g,w/count-.025,.7,d+.025,wood(),-w/2+(i+.5)*w/count,.49,0,.035);
  box(g,w+.09,.11,d+.065,colors.trim,0,.15,0);box(g,w+.08,.11,d+.06,colors.trim,0,.81,0);
  for(const a of [-1,1])for(const b of [-1,1]){box(g,.12,.88,.12,colors.trim,a*(w/2-.03),.48,b*(d/2-.03));ball(g,.028,.028,.017,0x624635,a*(w/2-.03),.77,b*(d/2+.047));}
  box(g,w+.12,.14,d+.12,0x3586a1,0,1.01,0);
  const cols=Math.max(1,Math.round(w/.7)),rows=2;for(let i=0;i<cols;i++)for(let j=0;j<rows;j++)box(g,(w+.08)/cols-.014,.055,(d+.08)/rows-.014,tile(),-(w+.08)/2+(i+.5)*(w+.08)/cols,1.105,-(d+.08)/2+(j+.5)*(d+.08)/rows,.014);
  return g;
}
export function plate(parent,x=0,y=0,z=0){const g=group(parent,x,y,z);if(!cache.has('plate')){const pts=[[0,0],[.23,0],[.30,.01],[.39,.06],[.41,.10],[.40,.125],[.35,.115],[.27,.057],[0,.052]].map(p=>new T.Vector2(...p));cache.set('plate',new T.LatheGeometry(pts,36));}mesh(g,cache.get('plate'),material(colors.white,{roughness:.22}));torus(g,.36,.009,0xe4dfca,0,.101,0).rotation.x=Math.PI/2;return g;}
export function ingredient(parent,type,x=0,y=0,z=0,scale=1){const g=group(parent,x,y,z);g.scale.setScalar(scale);
  if(type==='json'){
    ball(g,.22,.195,.22,material(0xe54429,{roughness:.31}),0,.18,0);
    for(let i=0;i<5;i++){const a=i*Math.PI*.4;const leaf=ball(g,.035,.018,.13,0x467939,Math.sin(a)*.063,.36,Math.cos(a)*.063);leaf.rotation.y=a;leaf.rotation.z=.18;}
    rod(g,[0,.35,0],[.01,.44,.018],.021,0x537334);
  }else if(type==='image'){
    const carrot=group(g,0,.13,0);carrot.rotation.z=-.6;carrot.rotation.x=.6;
    if(!cache.has('carrot'))cache.set('carrot',new T.LatheGeometry([[.012,-.28],[.06,-.18],[.10,-.05],[.12,.10],[.10,.2],[.03,.23]].map(p=>new T.Vector2(...p)),20));mesh(carrot,cache.get('carrot'),material(0xf38a24,{roughness:.48}));
    for(let i=0;i<4;i++){const l=ball(carrot,.035,.15,.028,0x548832,(i-1.5)*.042,.32,0);l.rotation.z=(i-1.5)*-.27;}
    for(let i=0;i<3;i++)box(carrot,.09,.012,.012,0xd56920,.02,i*.095-.1,.106,.005);
  }else if(type==='code'){
    cylinder(g,.045,.06,.24,0x92b252,0,.17,0);for(let i=0;i<7;i++){const a=i*2.4;ball(g,.105,.10,.095,[0x388337,0x4d943a,0x5b9c41][i%3],Math.cos(a)*.12,.29+Math.sin(i)*.02,Math.sin(a)*.10);}ball(g,.12,.1,.12,0x579a3d,0,.37,0);
  }else if(type==='text'){
    const bread=group(g,0,.085,0);bread.rotation.y=-.18;box(bread,.37,.13,.35,0xb97130,0,0,0,.07);box(bread,.31,.135,.29,0xffdf9d,0,.01,0,.06);for(let i=0;i<13;i++)ball(bread,.01,.006,.014,0xd4a455,(random()-.5)*.24,.082,(random()-.5)*.22);
  }else{ball(g,.25,.22,.25,material(0xb9c4c1,{metalness:.6,roughness:.25}),0,.09,0);ball(g,.045,.04,.045,colors.gold,0,.32,0);}
  return g;
}
export function board(parent,x=0,z=0){const g=group(parent,x,1.16,z);box(g,.91,.07,.72,wood());box(g,.09,.055,.2,colors.trim,0,0,-.43);const knife=box(g,.045,.17,.3,material(0xcbd7d9,{metalness:.5,roughness:.28}),.30,.15,.1,.015);knife.rotation.z=-.25;box(g,.06,.065,.22,0x454a45,.30,.19,-.13,.018);return g;}
export function stove(parent,x=0,z=0){const g=group(parent,x,1.15,z);box(g,1.15,.10,1.08,material(0xaebaaf,{metalness:.35,roughness:.36}),0,0,0);box(g,1.09,.03,.94,0x4c524c,0,.065,0);
  for(const xx of [-.30,.30]){torus(g,.22,.036,0x242c2c,xx,.1,0).rotation.x=Math.PI/2;for(let i=0;i<4;i++){const a=i*Math.PI/2;rod(g,[xx+Math.cos(a)*.1,.12,Math.sin(a)*.1],[xx+Math.cos(a)*.24,.12,Math.sin(a)*.24],.022,0x222d30);}}
  for(const xx of [-.34,0,.34])ball(g,.045,.036,.043,0xda694b,xx,-.015,.58);return g;
}
export function pot(parent,x=0,y=0,z=0){const g=group(parent,x,y,z);const pts=[[0,0],[.19,0],[.25,.035],[.285,.28],[.28,.31],[.255,.31],[.23,.06],[0,.06]].map(p=>new T.Vector2(...p));mesh(g,new T.LatheGeometry(pts,28),material(0x879f9e,{metalness:.6,roughness:.26}));torus(g,.273,.018,0xdce0ce,0,.30,0).rotation.x=Math.PI/2;
  for(const s of [-1,1]){const h=torus(g,.095,.026,0x465153,s*.31,.20,0);h.rotation.y=Math.PI/2;}
  cylinder(g,.232,.232,.012,0xebbc56,0,.18,0);rod(g,[.07,.14,.01],[.18,.62,.08],.028,0xaa6c35);return g;
}
export function sink(parent,x=0,z=0){const g=group(parent,x,1.15,z);box(g,1.18,.08,1.1,material(0xc9d5d1,{metalness:.45,roughness:.3}));box(g,.91,.06,.72,0x657f83,0,.055,.07,.12);box(g,.76,.025,.59,material(0x9fc6c5,{roughness:.2,metalness:.2}),0,.092,.075,.12);tube(g,[[.35,0,-.42],[.35,.45,-.42],[.12,.45,-.42],[.12,.29,-.35]],.037,material(0xd0d9ce,{metalness:.6,roughness:.2}));ball(g,.06,.05,.04,0xd78756,-.35,.12,-.4);return g;}
export function bell(parent,x=0,y=0,z=0){const g=group(parent,x,y,z);cylinder(g,.23,.25,.045,0x304a43,0,.02,0);const pts=[[.22,0],[.22,.05],[.15,.08],[.11,.21],[.02,.26]].map(p=>new T.Vector2(...p));mesh(g,new T.LatheGeometry(pts,24),material(0xebbd48,{metalness:.7,roughness:.22}));ball(g,.045,.036,.045,0xf5d570,0,.29,0);return g;}
export function recipe(parent,x=0,y=0,z=0){const g=group(parent,x,y,z);g.rotation.x=-.25;box(g,.66,.045,.77,colors.wood);box(g,.60,.032,.70,colors.cream,0,.035,0);for(let i=0;i<5;i++)box(g,.40-i%2*.08,.004,.018,0xb39b6e,0,.056,-.20+i*.083,.002);return g;}
export function barrel(parent,x,z,scale=1){const g=group(parent,x,0,z);g.scale.setScalar(scale);const pts=[[.33,0],[.39,.08],[.46,.48],[.40,.89],[.34,.95]].map(p=>new T.Vector2(...p));mesh(g,new T.LatheGeometry(pts,16),wood());cylinder(g,.34,.34,.04,colors.trim,0,.96,0);for(const y of [.14,.77])torus(g,y<.5?.416:.427,.04,0x525c56,0,y,0).rotation.x=Math.PI/2;for(let i=0;i<12;i++){const a=i*Math.PI/6;rod(g,[Math.sin(a)*.345,.93,Math.cos(a)*.345],[Math.sin(a)*.44,.18,Math.cos(a)*.44],.009,0x875129);}contact(g,0,0,1.4,1.4);return g;}
export function plant(parent,x,z,scale=1,flowers=false){const g=group(parent,x,0,z);g.scale.setScalar(scale);cylinder(g,.30,.22,.4,0xb86137,0,.2,0);torus(g,.3,.035,0xe19755,0,.4,0).rotation.x=Math.PI/2;cylinder(g,.27,.27,.02,0x57402b,0,.4,0);
  for(let i=0;i<9;i++){const a=i*2.4,r=.1+random()*.16;rod(g,[0,.4,0],[Math.sin(a)*r,.7+random()*.25,Math.cos(a)*r],.016,0x557138);const l=ball(g,.09,.26,.055,[0x4b8139,0x5d913c,0x3d7039][i%3],Math.sin(a)*r,.72,Math.cos(a)*r);l.rotation.set(Math.cos(a)*.65,0,-Math.sin(a)*.65);if(flowers&&i%2===0){const yy=.93+random()*.12;for(let j=0;j<6;j++)ball(g,.043,.043,.045,0xf4c947,Math.sin(a)*r+Math.cos(j)*.055,yy,Math.cos(a)*r+Math.sin(j)*.055);ball(g,.035,.04,.035,0x925230,Math.sin(a)*r,yy+.02,Math.cos(a)*r);}}
  return g;
}
export function crate(parent,x,y,z){const g=group(parent,x,y,z);for(const yy of [.1,.30,.50]){for(const zz of [-.34,.34])box(g,.92,.14,.05,wood(),0,yy,zz,.02);for(const xx of [-.43,.43])box(g,.05,.14,.68,wood(),xx,yy,0,.02);}box(g,.86,.06,.68,wood(),0,.03,0);return g;}
export function wheel(parent,x,y,z){const g=group(parent,x,y,z);torus(g,.55,.055,colors.trim);torus(g,.60,.023,0x65706b);for(let i=0;i<10;i++){const a=i*Math.PI/5;rod(g,[0,0,0],[Math.cos(a)*.54,Math.sin(a)*.54,0],.035,colors.trim);}ball(g,.1,.1,.075,colors.wood);return g;}
export function bunting(parent,a,b){const points=[];for(let i=0;i<=18;i++){const t=i/18;points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t-Math.sin(t*Math.PI)*.38,a[2]+(b[2]-a[2])*t]);}tube(parent,points,.014,0x704c31);for(let i=1;i<18;i+=1){const [x,y,z]=points[i];const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute([-.22,0,0,.22,0,0,0,-.43,.035],3));geo.computeVertexNormals();const m=mesh(parent,geo,material([0xe87554,0x67aaba,0xf0c465,0x91af60][i%4],{side:T.DoubleSide}),x,y,z);m.rotation.y=.13*Math.sin(i);}}
export function balloonBunch(parent,x,z){const g=group(parent,x,0,z);const tones=[0xe85552,0x59b1d0,0xeec248,0x77a755,0xc482b5];for(let i=0;i<5;i++){const a=i*2.4,xx=Math.sin(a)*.37,zz=Math.cos(a)*.32,y=2.1+i*.18;ball(g,.28,.34,.28,material(tones[i],{roughness:.27}),xx,y,zz);cylinder(g,.03,.0,.065,tones[i],xx,y-.36,zz);tube(g,[[0,.1,0],[xx*.45,y*.5,zz],[xx,y-.37,zz]],.006,0xd9cda7);}box(g,.2,.15,.2,colors.wood,0,.07,0);return g;}
