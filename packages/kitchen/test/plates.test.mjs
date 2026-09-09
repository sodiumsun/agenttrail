import test from 'node:test';
import assert from 'node:assert/strict';
import {CrewStore} from '../src/runtime/crew.mjs';
import {PlateStore} from '../src/runtime/plates.mjs';
const event=(extra={})=>({id:'e1',artifactId:'image',revisionId:'sha256-a',cwd:'/repo',provider:'codex',sessionId:'one',kind:'produced',type:'image',file:'public/image.png',...extra});
test('plates require exact artifact identity and discard private payloads',()=>{
  const p=new PlateStore(new CrewStore(['/repo']));assert.equal(p.accept(event({revisionId:undefined})),false);assert.equal(p.accept(event({cwd:'/outside'})),false);assert.equal(p.accept(event({file:'../secret'})),false);
  assert.equal(p.accept(event({body:'secret bytes',prompt:'secret prompt'})),true);assert.equal(p.accept(event()),false);assert.ok(!JSON.stringify(p.snapshot()).includes('secret'));
});
test('receipts survive delayed offers; identities and project boundaries cannot change',()=>{
  const crew=new CrewStore(['/repo','/other']),p=new PlateStore(crew);
  const received=event({kind:'received',handoffId:'h1',recipientProvider:'claude',recipientSessionId:'two'});
  assert.equal(p.accept(received),true);assert.equal(p.accept({...received,id:'late-offer',kind:'offered'}),false);assert.equal(p.snapshot().transfers[0].state,'received');
  assert.equal(p.accept({...received,id:'changed',revisionId:'other'}),false);
  crew.accept({id:'start',provider:'cursor',sessionId:'foreign',cwd:'/other',kind:'session-start',at:Date.now()});
  assert.equal(p.accept({...received,id:'cross',handoffId:'h2',recipientProvider:'cursor',recipientSessionId:'foreign'}),false);
});

test('explicit dish links and historical roles survive a handoff within one session',()=>{
  const crew=new CrewStore(['/repo']),orders=new Map([['order-one',{project:'/repo'}],['order-other',{project:'/other'}]]),store=new PlateStore(crew,Date.now,id=>orders.get(id));
  crew.accept({id:'start-role-order',provider:'codex',sessionId:'one',cwd:'/repo',kind:'turn-start',source:'hook'});
  crew.accept({id:'research-role-order',provider:'codex',sessionId:'one',cwd:'/repo',kind:'role',roleId:'researcher',source:'hook'});
  const base={id:'produce-order',cwd:'/repo',provider:'codex',sessionId:'one',artifactId:'notes',revisionId:'r1',kind:'produced',orderId:'order-one',type:'text'};
  assert.equal(store.accept({...base,id:'bad-scope',orderId:'order-other'}),false);assert.equal(store.accept(base),true);
  crew.accept({id:'writer-role-order',provider:'codex',sessionId:'one',cwd:'/repo',kind:'role',roleId:'writer',source:'hook'});
  assert.equal(store.accept({...base,id:'receive-order',kind:'received',handoffId:'within-session',recipientProvider:'codex',recipientSessionId:'one'}),true);
  const state=store.snapshot();assert.equal(state.artifacts[0].producerRoleId,'researcher');assert.equal(state.transfers[0].senderRoleId,'researcher');assert.equal(state.transfers[0].recipientRoleId,'writer');assert.equal(state.transfers[0].orderId,'order-one');
});
