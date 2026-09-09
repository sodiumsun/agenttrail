import path from 'node:path';
import { clean,within } from './crew.mjs';

const providers=['claude','codex','cursor'];
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=220&&/^[\w.:-]+$/.test(value);
export class PlateStore {
  constructor(crew,clock=Date.now,findOrder=()=>null){this.findOrder=findOrder;this.crew=crew;this.clock=clock;this.artifacts=new Map();this.transfers=new Map();this.seen=new Set();}
  accept(e){
    const project=this.crew.rootFor(e.cwd),at=this.clock();
    if(!project||!identity(e.id)||!identity(e.artifactId)||!identity(e.revisionId)||!providers.includes(e.provider)||!identity(e.sessionId)||!['produced','offered','received','failed'].includes(e.kind))return false;
    const eventKey=`${project}:${e.provider}:${e.id}`;if(this.seen.has(eventKey))return false;
    const producer=`${e.provider}:${e.sessionId}`,key=JSON.stringify([project,e.artifactId,e.revisionId]);
    const knownProducer=this.crew.sessions.get(producer);if(knownProducer&&knownProducer.project!==project)return false;
    let file=null;if(e.file){if(typeof e.file!=='string')return false;const absolute=path.resolve(e.cwd,e.file);if(!within(absolute,project))return false;file=path.relative(project,absolute);}
    const prior=this.artifacts.get(key);if(prior&&prior.producer!==producer)return false;
    if(e.orderId&&(!identity(e.orderId)||this.findOrder(e.orderId)?.project!==project||prior&&prior.orderId!==e.orderId))return false;
    const orderId=prior?.orderId||e.orderId||null;
    let transfer=null;
    if(e.kind!=='produced'){
      if(!identity(e.handoffId)||!providers.includes(e.recipientProvider)||!identity(e.recipientSessionId))return false;
      const recipient=`${e.recipientProvider}:${e.recipientSessionId}`;
      const known=this.crew.sessions.get(recipient);if(known&&known.project!==project)return false;
      const transferKey=JSON.stringify([project,e.handoffId]),old=this.transfers.get(transferKey);
      if(old&&(old.artifactKey!==key||old.sender!==producer||old.recipient!==recipient))return false;
      if(old&&old.state!=='offered')return false;
      transfer={id:transferKey,handoffId:e.handoffId,project,artifactKey:key,sender:producer,recipient,state:e.kind,at,source:'explicit relay',eventId:e.id,orderId,senderRoleId:prior?.producerRoleId||null,recipientRoleId:known?.roleBinding?.roleId||null};
    }
    this.seen.add(eventKey);if(this.seen.size>4000)this.seen.delete(this.seen.values().next().value);
    const kind=['json','image','text','code','table'].includes(e.type)?e.type:'unknown';
    this.artifacts.set(key,{id:key,artifactId:e.artifactId,revisionId:e.revisionId,project,producer,producerRoleId:prior?prior.producerRoleId:e.kind==='produced'?knownProducer?.roleBinding?.roleId||null:null,orderId,kind:prior?.kind||kind,file:prior?.file||file,label:prior?.label||clean(e.label)||file||'Shared artifact',at:prior?.at||at,source:'explicit relay',eventId:prior?.eventId||e.id});
    if(transfer)this.transfers.set(transfer.id,transfer);
    while(this.artifacts.size>200)this.artifacts.delete(this.artifacts.keys().next().value);
    for(const [id,t] of this.transfers)if(!this.artifacts.has(t.artifactKey))this.transfers.delete(id);
    while(this.transfers.size>400)this.transfers.delete(this.transfers.keys().next().value);
    return true;
  }
  snapshot(){return {artifacts:[...this.artifacts.values()],transfers:[...this.transfers.values()]};}
}
