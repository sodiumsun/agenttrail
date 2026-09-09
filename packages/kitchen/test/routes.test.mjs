import test from 'node:test';
import assert from 'node:assert/strict';
import {routeBetween,walkable} from '../public/src/routes.js';
test('chef routes go around the pass, never through counters',()=>{
  const route=routeBetween([-4.15,1.95],[1.85,-1.8]);assert.ok(route.length>2);
  for(let i=1;i<route.length;i++)for(let t=0;t<=1;t+=.05){const x=route[i-1][0]+(route[i][0]-route[i-1][0])*t,z=route[i-1][1]+(route[i][1]-route[i-1][1])*t;assert.ok(walkable(x,z),`Path crossed a counter at ${x},${z}`);}
  assert.deepEqual(route.at(-1),[1.85,-1.8]);assert.deepEqual(routeBetween([-4,2],[0,0]),[]);
});
