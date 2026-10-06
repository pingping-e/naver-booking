import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/slots.js';
const {parseTime} = globalThis.NaverBookingSlots;
test('any-time mode recognizes time labels', () => {
 for (const [label, expected] of [['09:00','09:00'],['9:30','09:30'],['오후 2:00','14:00'],['오전 12:00','00:00'],['10:30 예약 가능','10:30']]) assert.equal(parseTime(label),expected);
});
test('navigation, invalid times and sold-out labels are excluded', () => {
 for(const label of ['예약하기','2026-10-06','24:00','오후 13:00','10:00 매진','09:00 마감','10:00 예약 불가','시간 안내 09:00']) assert.equal(parseTime(label),null);
});

test('normalize 12-hour slots using the observed AM/PM section header', () => {
 assert.equal(parseTime('6:00','오후'),'18:00');
 assert.equal(parseTime('2:30','PM'),'14:30');
 assert.equal(parseTime('12:00','오후'),'12:00');
 assert.equal(parseTime('10:00','오전'),'10:00');
 assert.equal(parseTime('12:00','AM'),'00:00');
});
test('read period from the time list immediately after its title', () => {
 const title={textContent:'오후',matches: selector=>selector==='.time_title'};
 const element={innerText:'6:00',closest:()=>({previousElementSibling:title})};
 assert.equal(globalThis.NaverBookingSlots.readTime(element),'18:00');
});
