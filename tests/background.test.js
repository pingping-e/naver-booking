import test from 'node:test';
import assert from 'node:assert/strict';
let listener, alarmListener;
let state = {job:{id:'a',tabId:7,active:true,phase:'watching'}};
let reloads=0, clears=0;
const updates=[];
globalThis.chrome = {
 runtime:{onMessage:{addListener(fn){listener=fn;}},onStartup:{addListener(){}}},
 storage:{local:{async get(){return structuredClone(state);},async set(value){Object.assign(state,value);}}},
 alarms:{async clear(){clears++;},onAlarm:{addListener(fn){alarmListener=fn;}}},
 tabs:{onRemoved:{addListener(){}},async reload(){reloads++;},async update(tabId,options){updates.push({tabId,...options});},async get(){return {url:state.job.url};}}
};
await import('../extension/background.js');
const message=(msg,tabId=7,url='https://m.booking.naver.com/booking/1')=>new Promise(resolve=>listener(msg,{tab:{id:tabId,url}},resolve));
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

test('dates rotate for short timers and alarms; stale date cannot book', async () => {
 state.job={id:'multi',tabId:7,active:true,phase:'watching',dates:['2026-10-06','2026-10-07','2026-10-08'],date:'2026-10-06',dateIndex:0,url:'https://m.booking.naver.com/booking/1?startDate=2026-10-06'};
 assert.equal((await message({type:'RECHECK',id:'multi',date:'2026-10-06'})).ok,true);
 assert.equal(state.job.date,'2026-10-07');
 assert.equal(new URL(updates.at(-1).url).searchParams.get('startDate'),'2026-10-07');
 assert.equal((await message({type:'CLAIM',id:'multi',date:'2026-10-06'})).ok,false);
 await message({type:'RESULT',id:'multi',date:'2026-10-06',message:'stale'});
 assert.equal(state.job.active,true);
 await alarmListener({name:'booking-watch'});
 assert.equal(state.job.date,'2026-10-08');
 await message({type:'RECHECK',id:'multi',date:'2026-10-08'});
 assert.equal(state.job.date,'2026-10-06');
 assert.equal(state.job.dateIndex,0);
 assert.equal(updates.length,3);
 assert.equal((await message({type:'CLAIM',id:'multi',date:'2026-10-06'})).ok,true);
 await alarmListener({name:'booking-watch'});
 assert.equal(updates.length,3);
});

test('final submission needs matching request page, consent and one atomic claim', async () => {
 const date='2026-10-26',url='https://m.booking.naver.com/booking/1';
 state.job={id:'final',tabId:7,active:true,autoConfirm:false,phase:'booking',date,url,selectedTime:'18:00'};
 const msg={type:'FINAL_CLAIM',id:'final',date};
 const request=url+'/request?startDateTime=2026-10-26T18:00:00';
 assert.equal((await message(msg,7,request)).ok,false);
 state.job.autoConfirm=true;
 assert.equal((await message(msg,7,url)).ok,false);
 assert.equal((await message(msg,8,request)).ok,false);
 assert.equal((await message(msg,7,request.replace('18:00','17:00'))).ok,false);
 const claims=await Promise.all([message(msg,7,request),message(msg,7,request)]);
 assert.deepEqual(claims.map(r=>r.ok),[true,false]);
 assert.equal(state.job.phase,'submitting');
});
