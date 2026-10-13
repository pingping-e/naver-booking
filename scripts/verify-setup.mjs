// Real service-worker logic with browser DOM and bridged Chrome APIs, no installation or live submissions.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),scope='https://booking.naver.com/booking/13/bizes/999999/items/999999';
const browser=await chromium.launch({headless:true,...process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {}});
let booking,popup,workerListener,staleNotificationUrl;
const notifications=[],soundMessages=[];
const state={config:{url:scope}},messages=[];
async function notify(){if(popup && !popup.isClosed())await popup.evaluate(()=>window.changed?.()).catch(()=>{});}
async function write(value){Object.assign(state,structuredClone(value));await notify();}
const fixture=`<meta charset="utf-8"><button data-value="2026-10-16">16</button><button data-value="14:00">14:00</button><button id="begin" onclick="install(1)">조건 선택 완료</button><div id="stage"></div><script>
window.finalClicks=0;
function install(n){
 if(n===3){history.pushState({},'',location.pathname+'/request/link');document.body.innerHTML='<label>요청<input required></label><button data-click-code="submitbutton.submit" onclick="window.finalClicks++">예약 신청</button>';return;}
 const title=n===1?'텐트':'방문자';document.querySelector('#stage').innerHTML='<section class="section_option"><h3 class="section_title">필수 옵션</h3><div class="option_item"><div class="Count__info_tit__test">'+title+'</div><div class="Count__control_wrap__test"><button class="Count__btn_minus__test" onclick="change(-1)">-</button><span>0</span><button class="Count__btn_plus__test" onclick="change(1)">+</button></div></div></section><button data-click-code="nextbuttonview.request" onclick="install('+(n+1)+')">다음</button>';
}
function change(n){const el=document.querySelector('[class*=Count__control_wrap__] span');el.textContent=Number(el.textContent)+n;}
</script>`;
const send=(message,tabId)=>new Promise(resolve=>{messages.push(message);const url=message.type==='FINAL_SCREEN' && staleNotificationUrl || booking?.url();workerListener(message,tabId?{tab:{id:tabId,url},url,frameId:0}:{},resolve);});
globalThis.chrome={offscreen:{hasDocument:async()=>true},notifications:{getPermissionLevel:async()=> 'granted',create:async(id,options)=>{notifications.push({id,...options});return id;}},runtime:{getContexts:async()=>[{}],sendMessage:async message=>{soundMessages.push(message);return {ok:true};},getURL:path=>`chrome-extension://test/${path}`,onMessage:{addListener(fn){workerListener=fn;}},onStartup:{addListener(){}}},storage:{local:{get:async()=>structuredClone(state),set:write}},alarms:{clear:async()=>true,create:async()=>{},onAlarm:{addListener(){}}},tabs:{onRemoved:{addListener(){}},create:async()=>({id:7}),update:async(id,{url})=>{
 booking=await browser.newPage();await booking.route('https://booking.naver.com/**',route=>route.fulfill({body:fixture,contentType:'text/html; charset=utf-8'}));
 await booking.exposeFunction('readState',()=>structuredClone(state));await booking.exposeFunction('workerRpc',message=>send(message,7));
 await booking.addInitScript(()=>{window.handlers=[];window.chrome={storage:{local:{get:()=>window.readState()}},runtime:{sendMessage:async message=>{const result=await window.workerRpc(message);if(message.type==='RESULT')window.__finished=true;return result;},onMessage:{addListener(fn){window.handlers.push(fn);}}}};});
 await booking.goto(url);
 for(const name of ['composition','stages','slots','form','setup'])await booking.addScriptTag({path:new URL(`extension/${name}.js`,root).pathname});
 await booking.evaluate(()=>{chrome.storage.local.get('setup').then(({setup})=>NaverBookingSetup.observe(setup));});
}}};
await import('../extension/background.js');
async function openPopup(){
 const page=await browser.newPage();popup=page;
 await page.exposeFunction('readState',()=>structuredClone(state));await page.exposeFunction('writeState',write);await page.exposeFunction('workerRpc',message=>send(message));
 await page.exposeFunction('tabRpc',message=>booking.evaluate(message=>new Promise(resolve=>{for(const fn of window.handlers)if(fn(message,{},resolve))break;}),message));
 await page.addInitScript(scope=>{window.chrome={storage:{local:{get:()=>window.readState(),set:value=>window.writeState(value)},onChanged:{addListener(fn){window.changed=fn;}}},runtime:{sendMessage:message=>window.workerRpc(message)},tabs:{query:async()=>[{id:7,url:scope}],sendMessage:(id,message)=>window.tabRpc(message)}};},scope);
 await page.route('https://extension.test/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1);await route.fulfill({body:await readFile(new URL(`extension/${name}`,root)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8'});});
 await page.goto('https://extension.test/popup.html');return page;
}
try{
 await openPopup();await popup.locator('#start-setup').click();
 // Wait until the worker has opened and initialized the synthetic reservation tab.
 await popup.waitForFunction(()=>document.querySelector('#inspect-status').textContent.includes('새 예약 탭'));
 assert.equal(await popup.locator('input[name$="Selector"]').count(),0);
 await booking.locator('[data-value="2026-10-16"]').click();
 await booking.waitForFunction(()=>chrome.storage.local.get().then(s=>!!s.setupProfiles[s.setup.scope].selectors?.dateSelector));
 await booking.locator('[data-value="14:00"]').click();
 await booking.waitForFunction(()=>chrome.storage.local.get().then(s=>!!s.setupProfiles[s.setup.scope].selectors?.timeSelector));
 assert.deepEqual(state.setupProfiles[scope].selectors,{dateSelector:'button[data-value="{date}"]',timeSelector:'button[data-value="{time}"]'});
 assert.deepEqual(await booking.evaluate(()=>{
   const root=document.createElement('div');root.innerHTML='<div class="calendar_title">2026.10</div><button data-date="2026-10-16">16</button>';
   return NaverBookingSetup.learn(root,root.querySelector('button'));
 }),{});
 await booking.locator('#begin').click();await popup.waitForFunction(()=>document.querySelector('#stage-fields').textContent.includes('텐트'));
 assert.equal(await popup.locator('#inspect-form').isVisible(),false);
 const banner=booking.locator('#naver-booking-input-status');assert.equal(await banner.evaluate(el=>el===document.body.firstElementChild),true);assert.equal(await banner.evaluate(el=>getComputedStyle(el).fontSize),'18px');assert.equal(await banner.evaluate(el=>getComputedStyle(el).position),'sticky');assert.ok((await banner.boundingBox()).height>=70);
 await booking.locator('.section_title').evaluate(el=>el.textContent='');await popup.locator('#inspect-form').waitFor();assert.ok(state.setup.error);
 await booking.locator('.section_title').evaluate(el=>el.textContent='필수 옵션');await popup.waitForFunction(()=>document.querySelector('#inspect-form').hidden);assert.equal(state.setup.error,null);
 await popup.locator('#stage-fields input').fill('1');await popup.locator('#setup-next').click();await popup.waitForFunction(()=>document.querySelector('#stage-fields').textContent.includes('방문자'));
 await popup.close();await openPopup();await popup.waitForFunction(()=>document.querySelector('#stage-fields').textContent.includes('방문자'));
 assert.equal(await popup.locator('#inspect-form').isVisible(),false);
 await booking.locator('[data-click-code="nextbuttonview.request"]').evaluate(button=>{
   button.removeAttribute('data-click-code');button.dataset.testid='continue';button.textContent='다음으로';
   button.addEventListener('click',event=>event.stopImmediatePropagation(),{capture:true,once:true});
   button.click();
 });
 await booking.waitForFunction(()=>chrome.storage.local.get().then(s=>Object.values(s.setupProfiles[s.setup.scope].nextSelectors || {}).includes('button[data-testid="continue"]')));
 await popup.locator('#stage-fields input').fill('2');await popup.locator('#setup-next').click();await popup.locator('#form-fields input').waitFor();
 await popup.locator('#form-fields input').fill('메모');await popup.locator('#save-settings').click();await popup.waitForFunction(()=>window.chrome.storage.local.get().then(s=>s.formProfiles?.[s.setup.scope]?.fields[0]?.value==='메모'));
 assert.equal(state.setupProfiles[scope].complete,true);assert.equal(state.setupProfiles[scope].steps.length,3);assert.equal(Object.keys(state.stageProfiles[scope].stages).length,2);
 assert.equal(messages.some(message=>message.type==='INSPECT_FORM'),false);assert.equal(await booking.evaluate(()=>window.finalClicks),0);
 const noticeScope='https://booking.naver.com/booking/13/bizes/888888/items/888888';
 await popup.close();
 for(const autoConfirm of [false,true]) {
  const before=notifications.length,soundsBefore=soundMessages.length;
  const config={url:noticeScope,dates:['2026-10-16'],times:[],timeMode:'any',intervalMin:15,intervalExtra:45,autoConfirm,formPreferences:{...state.formProfiles[scope],scope:noticeScope}};
  assert.equal((await send({type:'START',config})).ok,true);
  assert.equal((await send({type:'CLAIM',id:state.job.id,date:state.job.date,scanId:state.job.scanId,time:'14:00'},7)).ok,true);
  await booking.evaluate(()=>install(3));staleNotificationUrl=noticeScope;
  assert.equal(state.job.active,true);
  await booking.addScriptTag({path:new URL('extension/content.js',root).pathname});
  await booking.waitForFunction(()=>window.__finished===true);
  assert.equal(notifications.length,before+1,JSON.stringify({job:state.job,diagnostic:state.notificationDiagnostics,messages:messages.slice(-10)}));assert.equal(state.notificationDiagnostics.status,'requested');
  assert.match(notifications.at(-1).message,/2026-10-16 14:00/);
  assert.equal(soundMessages.length,soundsBefore+1);assert.equal(soundMessages.at(-1).sound,'alert');
  assert.equal(await booking.evaluate(()=>window.finalClicks),Number(autoConfirm));
  assert.equal(await booking.locator('input').inputValue(),'메모');
 }
 const firstTest=await send({type:'TEST_NOTIFICATION'}),firstId=notifications.at(-1).id;
 assert.equal(firstTest.ok,true);assert.equal((await send({type:'TEST_NOTIFICATION'})).ok,true);assert.notEqual(notifications.at(-1).id,firstId);
 console.log('PASS real worker + browser reproduction: guided setup, final alerts with stale browser URLs in both confirmation modes, unique repeated test alerts; no live submissions');
}finally{await browser.close();}
