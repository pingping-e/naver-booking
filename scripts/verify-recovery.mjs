import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=new URL('../extension/',import.meta.url),scope='https://booking.naver.com/booking/13/bizes/123/items/456';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
async function run(body,phase='watching',bookingScope=scope) {
 const page=await browser.newPage();
 await page.clock.install({time:new Date('2026-10-13T00:00:00Z')});await page.clock.pauseAt(new Date('2026-10-13T00:00:00Z'));
 await page.route('https://booking.naver.com/**',route=>route.fulfill({body,contentType:'text/html; charset=utf-8'}));
 await page.goto(bookingScope+(phase==='booking' ? '/request/link' : ''));
 await page.evaluate(({scope,phase})=>{
  window.messages=[];const job={id:'fixture',scanId:'scan',tabId:7,active:true,phase,url:scope,date:'2026-10-16',times:[],timeMode:'any'};
  window.chrome={storage:{local:{get:async()=>({job})}},runtime:{onMessage:{addListener(){}},sendMessage:async message=>{
   window.messages.push(message);
   if(message.type==='CONTEXT')return {job};
   if(message.type==='RETRY_LOAD')return {ok:true,handled:true,nextCheckAt:Date.now()+5000};
   if(message.type==='RECHECK') {
    job.scanId='reloaded';
    document.body.innerHTML='<button data-date="2026-10-16" onclick="document.querySelector(\'.time_area\').hidden=false">16</button><div class="time_area" hidden><button class="btn_time">14:00</button></div>';
    void checkBookingDate({...job});return {ok:true};
   }
   if(message.type==='RESULT')job.active=false;
   return {ok:false};
  }}};
 },{scope:bookingScope,phase});
 for(const name of ['composition','stages','slots','form','party','restaurant','content'])await page.addScriptTag({path:new URL(name+'.js',root).pathname});
 await page.clock.runFor(16000);
 return page;
}
try {
 let page,messages;
 for(const bookingScope of [scope,scope.replace('/booking/13/','/booking/6/')]) {
 page=await run('<div data-skeleton="true">로딩 중</div>','watching',bookingScope);
 messages=await page.evaluate(()=>window.messages);
 assert.equal(messages.filter(m=>m.type==='RETRY_LOAD').length,1);assert.equal(messages.find(m=>m.type==='RETRY_LOAD').code,'BOOKING_LOAD_TIMEOUT');
 assert.equal(messages.some(m=>['RESULT','SCHEDULE','CLAIM'].includes(m.type)),false);
 await page.clock.runFor(5000);assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.type==='RECHECK').length),1);
 assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.type==='CLAIM').length),1);assert.equal(await page.evaluate(()=>window.messages.some(m=>m.type==='RESULT')),false);await page.close();
 }
 for(const [body,phase] of [
  ['<p>로그인이 필요합니다.</p>','watching'],
  ['<button data-date="2026-10-16">16</button><button data-date="2026-10-16">16</button>','watching'],
  ['<div data-skeleton="true">로딩 중</div>','booking']
 ]) {
  page=await run(body,phase);messages=await page.evaluate(()=>window.messages);
  assert.equal(messages.some(m=>m.type==='RETRY_LOAD'),false);assert.equal(messages.filter(m=>m.type==='RESULT').length,1);await page.close();
 }
 console.log('PASS recovery: initial loading timeout retries; login, ambiguous date controls and post-claim loading stop safely');
}finally{await browser.close();}
