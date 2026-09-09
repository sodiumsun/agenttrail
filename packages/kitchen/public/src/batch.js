import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Merge static parts in their parent's coordinates. Animated rig groups stay separate.
export function batchMeshes(root,recursive=true){
  root.updateWorldMatrix(true,true);
  const inverse=root.matrixWorld.clone().invert(),buckets=new Map();
  const collect=m=>{
    if(!m.isMesh||m.material.transparent||Array.isArray(m.material))return;
    if(!buckets.has(m.material))buckets.set(m.material,[]);buckets.get(m.material).push(m);
  };
  if(recursive)root.traverse(collect);else root.children.forEach(collect);
  for(const [mat,meshes] of buckets){
    if(meshes.length<2)continue;
    const geometries=meshes.map(m=>{let g=m.geometry.clone();if(g.index){const indexed=g;g=g.toNonIndexed();indexed.dispose();}g.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,m.matrixWorld));return g;});
    const merged=mergeGeometries(geometries);
    if(merged){merged.userData.kitchenBatch=true;const mesh=new T.Mesh(merged,mat);mesh.castShadow=meshes.some(m=>m.castShadow);mesh.receiveShadow=meshes.some(m=>m.receiveShadow);for(const m of meshes)m.removeFromParent();root.add(mesh);}
    for(const g of geometries)g.dispose();
  }
}
export function disposeBatches(root){root.traverse(o=>{if(o.geometry?.userData.kitchenBatch)o.geometry.dispose();});}
