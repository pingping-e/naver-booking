import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '../extension/core.js';
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
test('final confirmation needs explicit selector', () => {
 assert.throws(()=>validate({...base,autoConfirm:true}));
 assert.equal(validate({...base,autoConfirm:true,confirmSelector:'#confirm'}).autoConfirm,true);
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
