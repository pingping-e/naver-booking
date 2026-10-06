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
