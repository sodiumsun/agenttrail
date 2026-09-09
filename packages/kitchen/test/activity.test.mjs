import test from 'node:test';
import assert from 'node:assert/strict';
import {IdentityBook,activityText,goalCards,rankedGoals,kitchenForSession} from '../public/src/activity.js';
const chef=(id,extra={})=>({id,sessionId:id,provider:'codex',project:'p',state:'writing',freshness:'recent',startedAt:1,...extra});
const p={id:'p',components:[{id:'old',title:'Completed goal',tasks:[{state:'x'}]},{id:'busy',title:'Current goal',tasks:[{state:'x'}]},{id:'elsewhere',title:'Other kitchen',tasks:[{state:'~'}]}],kitchens:[{id:'one',components:['old','busy']},{id:'two',components:['elsewhere']}]};
test('a completed goal with fresh work replaces inactive history in the room rail',()=>{
 const s=chef('a',{component:{id:'busy'}}),cards=goalCards(p,[s]);
 assert.deepEqual(rankedGoals(cards,{kitchenId:'one'}).map(c=>c.id),['busy']);
 assert.equal(cards.find(c=>c.id==='busy').counts.done,1);
 assert.deepEqual(rankedGoals(cards,{kitchenId:'one',pinned:['old']}).map(c=>c.id),['old','busy']);
});
test('two sessions on a goal stay separate and uncertain work remains visible',()=>{
 const crew=[chef('a',{component:{id:'busy'}}),chef('b',{component:{id:'busy'}}),chef('c')];
 const cards=goalCards(p,crew);assert.equal(cards.find(c=>c.id==='busy').chefs.length,2);
 assert.equal(cards.find(c=>c.id==='__unlinked').chefs[0].id,'c');assert.equal(kitchenForSession(crew[2],p).id,'one');
});
test('attention wins priority and cross-room goals only follow a deliberate pin',()=>{
 const cards=goalCards(p,[chef('a',{component:{id:'busy'}}),chef('b',{component:{id:'old'},state:'permission'}),chef('c',{component:{id:'elsewhere'},state:'input'})]);
 assert.deepEqual(rankedGoals(cards,{kitchenId:'one'}).map(c=>c.id),['old','busy']);
 assert.equal(rankedGoals(cards,{kitchenId:'one',pinned:['elsewhere']})[0].id,'elsewhere');
});
test('identities survive reordering and reload; same-provider chefs have distinct colors and names',()=>{
 const book=new IdentityBook(),crew=Array.from({length:12},(_,i)=>chef('s'+i));
 const first=book.assign(crew),second=new IdentityBook(book.save()).assign([...crew].reverse());
 assert.equal(new Set(first.map(s=>s.visualIndex)).size,12);assert.equal(new Set(first.map(s=>s.displayName)).size,12);
 for(const s of first)assert.deepEqual(second.find(x=>x.id===s.id),s);
});
test('literal activity does not turn an old file or arbitrary command into a current test run',()=>{
 assert.equal(activityText(chef('a',{state:'executing',file:'test/old.test.js'})),'Running a command');
 assert.equal(activityText(chef('a',{currentFile:'public/kitchen.css'})),'Editing kitchen.css');
 assert.match(activityText(chef('a',{freshness:'quiet'})),/^Last seen:/);
 assert.equal(activityText(chef('a',{freshness:'quiet',state:'permission'})),'Needs permission');
 assert.equal(activityText(chef('a'),false),'Connection lost');
 assert.match(activityText(chef('a',{activeToolCount:2})),/\+1 actions/);
});
test('a returning session cannot share a color with a currently visible replacement',()=>{
 const book=new IdentityBook();book.assign([chef('a')]);book.assign([chef('a',{ended:true}),chef('b')]);
 const resumed=book.assign([chef('a'),chef('b')]);assert.notEqual(resumed[0].visualIndex,resumed[1].visualIndex);assert.notEqual(resumed[0].badge,resumed[1].badge);
});
