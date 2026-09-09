const step=.3;
export function walkable(x,z,width=5.15){
  if(x< -width||x>width||z< -2.4||z>2.5)return false;
  return !(x> -2.24&&x<2.24&&z>-.81&&z<1.4);
}
export function routeBetween(from,to,width=5.15){
  const start=from.map(v=>Math.round(v/step)),goal=to.map(v=>Math.round(v/step)),key=p=>p.join(','),end=key(goal);
  const open=[start],parents=new Map(),scores=new Map([[key(start),0]]),closed=new Set();
  while(open.length&&closed.size<1500){open.sort((a,b)=>scores.get(key(a))+Math.abs(a[0]-goal[0])+Math.abs(a[1]-goal[1])-scores.get(key(b))-Math.abs(b[0]-goal[0])-Math.abs(b[1]-goal[1]));const point=open.shift(),id=key(point);if(closed.has(id))continue;if(id===end){const path=[to];let current=id;while(parents.has(current)){const parent=parents.get(current);path.unshift(parent.map(v=>v*step));current=key(parent);}path[0]=from;return path.filter((p,i,ps)=>i===0||i===ps.length-1||Math.abs((p[0]-ps[i-1][0])*(ps[i+1][1]-p[1])-(p[1]-ps[i-1][1])*(ps[i+1][0]-p[0]))>.001);}
    closed.add(id);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const next=[point[0]+dx,point[1]+dz],nid=key(next);if(!walkable(next[0]*step,next[1]*step,width)||closed.has(nid))continue;const score=scores.get(id)+1;if(score<(scores.get(nid)??Infinity)){scores.set(nid,score);parents.set(nid,point);open.push(next);}}
  }
  return [];
}
