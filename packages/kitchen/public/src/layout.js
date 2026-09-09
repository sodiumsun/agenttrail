export function stationLayout(count){
  const columns=Math.max(2,Math.ceil(Math.min(count,8)/2)),extra=(columns-2)*2.7;
  const positions=Array.from({length:columns*2},(_,i)=>[(i%columns-(columns-1)/2)*(columns===2?6.9:5.4),i<columns?-3.45:3.55]);
  return {columns,extra,width:16.8+extra*2,walkWidth:5.15+extra,positions};
}
