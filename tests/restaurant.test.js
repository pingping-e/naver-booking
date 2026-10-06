import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/slots.js';
import '../extension/party.js';
import '../extension/restaurant.js';
globalThis.getComputedStyle=()=>({visibility:'visible'});
function fixture({closed=false,people=2}={}) {
 const state={day:0,time:'',next:0,dateClicks:0,messages:[]};
 const control=(textContent='')=>({textContent,className:'',getClientRects:()=>[{}],getAttribute:()=>null});
 const date={...control('16'),disabled:closed,querySelector:()=>({textContent:'16'}),click(){state.day=16;state.dateClicks++;}};
 const grid={parentElement:{querySelector:()=>({textContent:'PM'})}};
 const time={...control('5:00'),closest:()=>grid,getAttribute:name=>name==='aria-pressed' ? String(state.time==='17:00') : null,click(){state.time='17:00';}};
 const next={...control('Next'),click(){state.next++;}};
 const widget={getAttribute:name=>({'data-gbw-step1-people':String(people),'data-gbw-step1-day':String(state.day),'data-gbw-step1-time':state.time}[name]),
  querySelector(selector){if(selector.includes('monthLabel'))return {textContent:'2026. 10'};if(selector.includes('skeleton'))return null;if(selector.includes('_dayGrid_'))return date;if(selector.includes('_timePeriodGrid_'))return time;return null;},
  querySelectorAll(selector){if(selector.includes('_dayGrid_'))return [date];if(selector.includes('_timePeriodGrid_'))return [time];if(selector==='button')return [next];return [];}};
 const root={querySelector:()=>widget};
 const job={date:'2026-10-16',partySize:people,timeMode:'exact',times:['17:00']};
 const actions={active:async()=>true,send:async(type,payload)=>{state.messages.push({type,...payload});return {ok:true};}};
 return {state,root,job,actions};
}
test('restaurant verifies people, date and PM time before opening next screen once',async()=>{
 const {state,root,job,actions}=fixture();
 await NaverBookingRestaurant.scan(root,job,actions);
 assert.equal(state.time,'17:00');assert.equal(state.next,1);
 assert.equal(state.messages.find(m=>m.type==='CLAIM').time,'17:00');
 assert.equal(state.messages.find(m=>m.type==='CLAIM').manualContinuation,true);
 assert.match(state.messages.find(m=>m.type==='RESULT').message,/2명/);
});
test('closed restaurant date logs unavailable without a claim or date click',async()=>{
 const {state,root,job,actions}=fixture({closed:true});
 await NaverBookingRestaurant.scan(root,job,actions);
 assert.deepEqual(state.messages,[{type:'LOG',message:'예약 불가'}]);
 assert.equal(state.dateClicks,0);assert.equal(state.next,0);
});
test('restaurant time criteria exclude otherwise available slots',async()=>{
 const {state,root,job,actions}=fixture();job.times=['18:00'];
 await NaverBookingRestaurant.scan(root,job,actions);
 assert.deepEqual(state.messages,[{type:'LOG',message:'예약 불가'}]);assert.equal(state.next,0);
});
test('restaurant claim refusal prevents time and next button clicks',async()=>{
 const {state,root,job,actions}=fixture();actions.send=async(type,payload)=>{state.messages.push({type,...payload});return {ok:type!=='CLAIM'};};
 await NaverBookingRestaurant.scan(root,job,actions);
 assert.equal(state.time,'');assert.equal(state.next,0);assert.equal(state.messages.some(m=>m.type==='RESULT'),false);
});
test('restaurant with no default people requires explicit input',async()=>{
 const {root,job,actions}=fixture({people:0});job.partySize=null;
 await assert.rejects(()=>NaverBookingRestaurant.scan(root,job,actions),/인원 선택이 필요/);
});
