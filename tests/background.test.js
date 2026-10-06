import test from 'node:test';
import assert from 'node:assert/strict';
let listener, alarmListener;
let state = {job:{id:'a',tabId:7,active:true,phase:'watching'}};
let reloads=0, clears=0;
globalThis.chrome = {
 runtime:{onMessage:{addListener(fn){listener=fn;}},onStartup:{addListener(){}}},
 storage:{local:{async get(){return structuredClone(state);},async set(value){Object.assign(state,value);}}},
 alarms:{async clear(){clears++;},onAlarm:{addListener(fn){alarmListener=fn;}}},
 tabs:{onRemoved:{addListener(){}},async reload(){reloads++;}}
};
await import('../extension/background.js');
const message=(msg,tabId=7)=>new Promise(resolve=>listener(msg,{tab:{id:tabId,url:'https://m.booking.naver.com/booking/1'}},resolve));
test('only designated tab obtains context and claims booking once', async()=>{
 assert.equal((await message({type:'CONTEXT'},8)).job,null);
 assert.equal((await message({type:'CLAIM',id:'a'},8)).ok,false);
 const results=await Promise.all([message({type:'CLAIM',id:'a'}),message({type:'CLAIM',id:'a'})]);
 assert.deepEqual(results.map(r=>r.ok),[true,false]);
 assert.equal(state.job.phase,'booking');
 await alarmListener({name:'booking-watch'});
 assert.equal(reloads,0);
 assert.equal(clears,1);
});
test('stale result cannot stop current job; stop prevents further claim',async()=>{
 await message({type:'RESULT',id:'old',message:'done'});
 assert.equal(state.job.active,true);
 await message({type:'STOP'});
 assert.equal(state.job.active,false);
 assert.equal((await message({type:'CLAIM',id:'a'})).ok,false);
});

test('short-interval refresh validates job and tab before reloading', async () => {
 state.job={id:'b',tabId:7,active:true,phase:'watching',url:'https://m.booking.naver.com/booking/1'};
 assert.equal((await message({type:'RECHECK',id:'old'})).ok,false);
 assert.equal((await message({type:'RECHECK',id:'b'},8)).ok,false);
 assert.equal(reloads,0);
 assert.equal((await message({type:'RECHECK',id:'b'})).ok,true);
 assert.equal(reloads,1);
 state.job.phase='booking';
 assert.equal((await message({type:'RECHECK',id:'b'})).ok,false);
 assert.equal(reloads,1);
});
