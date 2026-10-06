import test from 'node:test';
import assert from 'node:assert/strict';
import {validate, isRequestUrl, nextInterval} from '../extension/core.js';
const base = {url:'https://m.booking.naver.com/booking/13/bizes/1491414/items/7037654',date:'2026-10-06',times:['09:00'],interval:60};
test('booking URL gets requested date and duplicate slots removed', () => {
 const result=validate({...base,times:['09:00','09:00','10:30']});
 assert.equal(new URL(result.url).searchParams.get('startDate'),base.date);
 assert.deepEqual(result.times,['09:00','10:30']);
});
test('reject unrelated hosts and unsafe URLs', () => {
 for(const url of ['http://m.booking.naver.com/booking/1','https://m.booking.naver.com.evil.test/booking/1','https://example.com/booking/1','https://booking.naver.com/other']) assert.throws(()=>validate({...base,url}));
});
test('reject invalid schedules', () => {
 for(const patch of [{date:'2026-02-30'},{times:['24:00']},{interval:14},{interval:Infinity}]) assert.throws(()=>validate({...base,...patch}));
});
test('built-in submission selector and additional-info preferences work without overrides', () => {
 const result=validate({...base,autoConfirm:true});
 assert.equal(result.autoConfirm,true);
 assert.equal(result.treatment,'필러');
 assert.equal(result.source,'유튜브');
 assert.equal(validate({...base,treatment:'스킨보톡스',source:'네이버 검색'}).treatment,'스킨보톡스');
});

test('allow 15-second checks and any-time mode', () => {
 assert.deepEqual(validate({...base,times:[],interval:15}).times,[]);
 assert.equal(validate({...base,interval:15}).interval,15);
});

test('accept one to five dates, preserve priority and remove duplicates', () => {
 const dates=['2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10'];
 const result=validate({...base,dates});
 assert.deepEqual(result.dates,dates);
 assert.equal(result.date,dates[0]);
 assert.equal(result.dateIndex,0);
 assert.deepEqual(validate({...base,dates:[dates[1],dates[0],dates[1]]}).dates,[dates[1],dates[0]]);
});
test('reject empty, oversized or invalid multi-date lists', () => {
 for(const dates of [[],Array(6).fill('2026-10-06'),['2026-10-06','2026-02-30'],'2026-10-06']) assert.throws(()=>validate({...base,dates}));
});
test('multiple dates require a templated custom date selector', () => {
 const input={...base,dates:['2026-10-06','2026-10-07']};
 assert.throws(()=>validate({...input,dateSelector:'[data-date="2026-10-06"]'}));
 assert.equal(validate({...input,dateSelector:'[data-date="{date}"]'}).dates.length,2);
});

test('submission is restricted to the matching request path, date and selected time', () => {
 const job={...base,selectedTime:'18:00'};
 const root=base.url+'/request';
 assert.equal(isRequestUrl(job,root+'?startDateTime=2026-10-06T18%3A00%3A00%2B09%3A00'),true);
 for(const url of [base.url,root+'/other',root+'?startDateTime=2026-10-07T18:00:00',root+'?startDateTime=2026-10-06T17:00:00','https://example.com/request']) assert.equal(isRequestUrl(job,url),false);
});

test('saved required fields are only applied to their matching product', () => {
 const profile={scope:base.url,fields:[{key:'field:요청사항',type:'text',value:'예시'}]};
 assert.deepEqual(validate({...base,formPreferences:profile}).formPreferences,profile);
 assert.equal(validate({...base,formPreferences:{...profile,scope:'https://booking.naver.com/booking/other'}}).formPreferences,null);
});

test('time conditions validate bounds and preserve legacy exact/any settings', () => {
 assert.equal(validate(base).timeMode,'exact');
 assert.equal(validate({...base,times:[]}).timeMode,'any');
 assert.equal(validate({...base,timeMode:'after',timeStart:'12:00'}).timeStart,'12:00');
 assert.equal(validate({...base,timeMode:'range',timeStart:'14:00',timeEnd:'15:00'}).timeMode,'range');
 for(const patch of [{timeMode:'exact',times:[]},{timeMode:'after',timeStart:''},{timeMode:'range',timeStart:'15:00',timeEnd:'14:00'},{timeMode:'range',timeStart:'14:00',timeEnd:'24:00'},{timeMode:'invalid'}]) assert.throws(()=>validate({...base,...patch}));
});

test('randomized presets configure exactly the requested ranges', () => {
 for(const [preset,min,max] of [['15-30',15,30],['30-60',30,60],['60-90',60,90],['90-180',90,180]]) {
  const result=validate({...base,intervalPreset:preset});
  assert.equal(result.intervalMin,min);assert.equal(result.intervalMax,max);
 }
 assert.throws(()=>validate({...base,intervalPreset:'invalid'}));
});
test('random delay includes both bounds and permits consecutive equal draws', () => {
 for(const [min,max] of [[15,30],[30,60],[60,90],[90,180]]) {
  assert.equal(nextInterval(min,max,()=>0),min);
  assert.equal(nextInterval(min,max,()=>0.999999),max);
  assert.equal(nextInterval(min,max,()=>0.5),nextInterval(min,max,()=>0.5));
  for(let i=0;i<100;i++){const delay=nextInterval(min,max);assert.ok(Number.isInteger(delay)&&delay>=min&&delay<=max);}
 }
});

test('five-second floor and maximum buttons validate every option', () => {
 for(const max of [15,30,60,90,120]) {
  const result=validate({...base,intervalMin:5,intervalMax:max});
  assert.equal(result.intervalMin,5);assert.equal(result.intervalMax,max);
  assert.equal(nextInterval(5,max,()=>0),5);
  assert.equal(nextInterval(5,max,()=>0.99999),max);
 }
 for(const patch of [{intervalMin:0,intervalMax:30},{intervalMin:31,intervalMax:30},{intervalMin:5,intervalMax:25},{intervalMin:5.5,intervalMax:30}]) assert.throws(()=>validate({...base,...patch}));
});

test('default 15-to-60-second configuration remains valid', () => {
 const result=validate({...base,intervalMin:15,intervalMax:60});
 assert.equal(result.intervalMin,15);assert.equal(result.intervalMax,60);
});
