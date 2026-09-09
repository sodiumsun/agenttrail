import {isWorking,needsAttention} from './activity.js';

export function workingFirst(crew){
  return crew.map((data,index)=>({data,index})).sort((a,b)=>Number(isWorking(b.data)||needsAttention(b.data))-Number(isWorking(a.data)||needsAttention(a.data))||a.index-b.index);
}
// Poses illustrate observed work; they never change the source state or its progress.
export function workPose(s){
  if(!isWorking(s)||s.state!=='working')return s.state;
  const work=s.workContext;
  if(work&&s.lastEventAt-work.at<45_000)return {execute:'executing',review:'reading',research:'reading',build:'writing'}[work.category]||'working';
  return 'working';
}
export const approachPoint=home=>[home.x,home.z<0?-1.25:1.65];
export function nextWorkBeat(memory,s,time,wallNow,{newRoom=false,paused=false,reduced=false}={}){
  const stamp=Math.max(s.lastEventAt||0,s.workContext?.at||0),changed=stamp!==memory.seenWorkAt;memory.seenWorkAt=stamp;
  if(newRoom){memory.beatAt=time;return false;}
  if(!changed||!isWorking(s)||wallNow-stamp>12_000||paused||reduced||memory.walkRoute?.length||time-(memory.beatAt??-100)<8)return false;
  memory.beatAt=time;return true;
}
