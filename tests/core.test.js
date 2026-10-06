import test from 'node:test';
import assert from 'node:assert/strict';
import {validate, isRequestUrl} from '../extension/core.js';
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
