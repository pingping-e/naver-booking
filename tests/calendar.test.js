import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const content = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
async function inspectCalendar(readyAt) {
  let clock = 0, selected = false, clicks = 0;
  const messages = [];
  const job = {id:'calendar',scanId:'scan',active:true,phase:'watching',url:'https://booking.naver.com/booking/1',date:'2026-10-16',dates:['2026-10-16'],times:[]};
  const num = {textContent:'16'};
  const title = {get innerText(){return clock >= readyAt ? '2026. 10' : '';},matches:selector=>selector === '.calendar_title',querySelector:()=>null};
  const button = {className:'calendar_date closed',classList:{contains:value=>value === 'closed'},getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,querySelector:()=>num,matches:selector=>selector === '.calendar_date',click(){selected=true;clicks++;}};
  const document = {
    body:{innerText:''},
    querySelector(selector) {
      if (selector === '.calendar_title') return title;
      if (selector === '.calendar_date.selected .num') return selected ? num : null;
      return null;
    },
    querySelectorAll(selector) {return selector === '.calendar_table button.calendar_date' && clock >= readyAt ? [button] : [];}
  };
  const context = vm.createContext({URL,document,location:new URL(job.url),getComputedStyle:()=>({visibility:'visible'}),Date:class extends Date {static now(){return clock;}},setTimeout(fn,delay){clock+=delay;queueMicrotask(fn);},chrome:{storage:{local:{async get(){return {job};}}},runtime:{async sendMessage(message){messages.push(message);if(message.type === 'CONTEXT') return {job};if(message.type === 'RESULT') job.active=false;return {ok:false};}}}});
  await vm.runInContext(content,context);
  return {clock,clicks,messages,job};
}
test('calendar shell is not ready until its month and date buttons load', async () => {
  const result = await inspectCalendar(2200);
  assert.ok(result.clock >= 2200 && result.clock < 15000);
  assert.equal(result.clicks,1);
  assert.ok(result.messages.some(message=>message.type === 'LOG' && message.message.includes('마감 상태')));
  assert.ok(!result.messages.some(message=>message.type === 'RESULT'));
});
test('missing date buttons stop monitoring instead of reporting a completed check', async () => {
  const result = await inspectCalendar(Infinity);
  assert.ok(result.clock >= 15000);
  assert.equal(result.clicks,0);
  assert.equal(result.job.active,false);
  assert.ok(result.messages.some(message=>message.type === 'RESULT' && message.message.includes('예약 가능 여부를 확인하지 못했습니다')));
  assert.ok(!result.messages.some(message=>message.type === 'LOG' && message.message.includes('마감')));
});
