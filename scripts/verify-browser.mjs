import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const browser=await chromium.launch({...process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {channel:'chrome'},headless:process.env.PLAYWRIGHT_HEADLESS==='1'});
const page=await browser.newPage();
let checks=0;
const load=async(name)=>{
 await page.setContent(await readFile(new URL(`tests/fixtures/${name}.html`,root),'utf8'));
 for(const file of ['composition','stages','form'])await page.addScriptTag({path:new URL(`extension/${file}.js`,root).pathname});
};
try {
 for(const name of ['vipsComposition','grillQuantity']) {
  await load(name);
  await page.evaluate(()=>{
   document.querySelector('[data-testid="gbw-flow-step2"]').removeAttribute('data-testid');
   document.querySelectorAll('button[aria-label]').forEach(button=>{button.disabled=false;button.addEventListener('click',()=>{const value=button.parentElement.querySelector('[role="status"]');if(value)value.textContent=String(Number(value.textContent)+(button.getAttribute('aria-label').endsWith('증가')?1:-1));});});
  });
  const counts=await page.evaluate(()=>NaverBookingComposition.discover(document).map(({label},i)=>({label,count:i===0?2:0})));
  await page.evaluate(async counts=>{await NaverBookingComposition.apply(document,counts,2,async()=>true);NaverBookingComposition.verify(document,counts,2);},counts);checks++;
 }
 for(const name of ['clinicOptions','farmOptions']) {
  await load(name);
  const profile=await page.evaluate(()=>NaverBookingStages.serialize(NaverBookingStages.discover(document)));
  assert.ok(profile.fields.length>0);
  if(name==='clinicOptions') {
   await page.evaluate(()=>{document.querySelector('input[type="checkbox"]').checked=false;});
   await page.evaluate(()=>NaverBookingStages.apply(document,NaverBookingStages.automaticProfile(NaverBookingStages.discover(document)),async()=>true));
   assert.equal(await page.locator('input[type="checkbox"]').isChecked(),true);checks++;
  }
  if(name==='farmOptions') {
   assert.equal(profile.fields.filter(f=>f.type==='quantity').length,6);
   assert.equal(profile.fields.filter(f=>f.type==='checkbox').length,3);
   await page.evaluate(()=>document.querySelectorAll('[class*="Count__control_wrap__"]').forEach(w=>w.querySelectorAll('button').forEach(b=>{
    b.className=b.className.replace(/Count__disabled__\S+/g,'');b.addEventListener('click',()=>{const value=[...w.children].find(c=>c.tagName==='SPAN');value.textContent=String(Number(value.textContent)+(b.className.includes('btn_plus')?1:-1));});
   })));
   // One tent and four visitors are represented by 1 tent + 2 extra persons, not 4 tents.
   const quantities=profile.fields.filter(f=>f.type==='quantity');quantities[0].value='1';quantities[1].value='2';
  }
  await page.evaluate(async profile=>{await NaverBookingStages.apply(document,profile,async()=>true);NaverBookingStages.verify(document,profile);},profile);checks++;
  const error=await page.evaluate(async profile=>{profile.fields.pop();try{await NaverBookingStages.apply(document,profile,async()=>true);return null;}catch(e){return e.message;}},profile);
  assert.match(error,/現在|현재 화면/);checks++;
  const stopped=await page.evaluate(async profile=>{try{await NaverBookingStages.apply(document,profile,async()=>false);return null;}catch(e){return e.message;}},profile);
  assert.match(stopped,/중지/);checks++;
 }
 await load('vipsFinal');
 await page.evaluate(()=>document.querySelectorAll('button[aria-haspopup="listbox"]').forEach(button=>button.addEventListener('click',()=>{
  if(button.getAttribute('aria-expanded')==='true'){document.querySelector('[role="listbox"]')?.remove();button.setAttribute('aria-expanded','false');return;}
  button.setAttribute('aria-expanded','true');
  const list=document.createElement('div');list.role='listbox';list.id=button.getAttribute('aria-controls') || 'fixture-list';
  for(const value of button.dataset.choices ? JSON.parse(button.dataset.choices) : ['확인했습니다.']) {
   const option=document.createElement('div');option.role='option';option.textContent=value;
   option.addEventListener('click',()=>{const text=button.querySelector('[class*="Select__text__"]');text.textContent=option.textContent;text.className=text.className.replace(/\S*is_placeholder\S*/g,'');button.setAttribute('aria-expanded','false');list.remove();});list.append(option);
  }
  document.body.append(list);
 })));
 const inspected=await page.evaluate(async()=> (await NaverBookingForm.inspect(document)).map(({controls,...f})=>f));
 assert.equal(inspected[0].options[0].value,'확인했습니다.');
 assert.equal(await page.locator('[role="listbox"]').count(),0);checks++;
 const vips=await page.evaluate(()=>NaverBookingForm.discover(document).map(({controls,...f})=>({...f,value:f.type==='customselect'?'확인했습니다.':['on']})));
 assert.equal(vips.length,5);await page.evaluate(p=>NaverBookingForm.fill(document,p),vips);checks++;
 await page.evaluate(()=>{document.querySelectorAll('button[aria-haspopup="listbox"]').forEach(b=>{const s=b.querySelector('[class*="Select__text__"]');s.textContent='선택해 주세요.';s.className+=' Select__is_placeholder__test';});document.querySelector('input[type="checkbox"]').checked=false;});
 await page.evaluate(()=>NaverBookingForm.fill(document,null));
 assert.equal(await page.locator('input[type="checkbox"]').isChecked(),true);assert.equal((await page.locator('[class*="Select__text__"]').allTextContents()).filter(v=>v==='확인했습니다.').length,4);checks++;
 await page.evaluate(()=>{const b=document.querySelector('button[aria-haspopup="listbox"]');b.dataset.choices=JSON.stringify(['창가','안쪽']);const s=b.querySelector('[class*="Select__text__"]');s.textContent='선택해 주세요.';s.className+=' Select__is_placeholder__test';});
 const pending=await page.evaluate(()=>NaverBookingForm.fill(document,null,async()=>true,{automaticOnly:true}));
 assert.equal(pending.pending.length,1);assert.equal(await page.locator('[class*="Select__text__"]').first().innerText(),'선택해 주세요.');checks++;
 const multiple=await page.evaluate(async()=> (await NaverBookingForm.inspect(document)).map(({controls,...f})=>({...f,value:f.options.length===2?'안쪽':NaverBookingForm.automaticValue(f)})));
 await page.evaluate(p=>NaverBookingForm.fill(document,p),multiple);assert.equal(await page.locator('[class*="Select__text__"]').first().innerText(),'안쪽');checks++;
 await load('clinicFinal');
 const clinic=await page.evaluate(()=>NaverBookingForm.discover(document).map(({controls,...f})=>({...f,value:[f.options[0].value]})));
 assert.equal(clinic.length,2);
 await page.evaluate(p=>NaverBookingForm.fill(document,p),clinic);checks++;
 await load('grillFinal');
 const grill=await page.evaluate(()=>NaverBookingForm.discover(document).map(({controls,...f})=>({...f,value:f.type==='checkbox'?['on']:'0'})));
 assert.equal(grill.length,4);
 await page.evaluate(p=>NaverBookingForm.fill(document,p),grill);checks++;
 // Explicit empty final page profile, and newly inserted required input.
 await load('farmFinal');await page.evaluate(()=>NaverBookingForm.fill(document,[]));checks++;
 await page.setContent('<label>New required question<input required></label>');
 const drift=await page.evaluate(async()=>{try{await NaverBookingForm.fill(document,[]);return null;}catch(e){return e.message;}});
 assert.match(drift,/현재 화면이 다릅니다/);checks++;
 // Exercise the real popup with isolated browser storage and message transport.
 const scope='https://booking.naver.com/booking/6/bizes/77605/items/4221135';
 await page.route('http://popup.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  const body=await readFile(new URL(`extension/${name}`,root));
  await route.fulfill({body,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});
 });
 await page.addInitScript(({scope})=>{
  window.__store={config:{url:scope,partySize:'2',intervalMin:15,intervalExtra:45,autoConfirm:false},partyProfiles:{},formProfiles:{},stageProfiles:{[scope]:{scope,stages:{existing:{scope,stageKey:'existing',title:'Existing stage',fields:[]}}}}};
  window.__reply={ok:true,scope,stage:'composition',people:2,fields:[{label:'성인',type:'number',value:'2'},{label:'어린이',type:'number',value:'0'}]};
  window.chrome={storage:{local:{get:async()=>structuredClone(window.__store),set:async data=>Object.assign(window.__store,data)},onChanged:{addListener(){}}},tabs:{query:async()=>[{id:1,url:scope}],sendMessage:async()=>window.__reply},runtime:{sendMessage:async()=>({ok:true})}};
 },{scope});
 await page.goto('http://popup.test/popup.html');
 await page.evaluate(()=>document.querySelector('#inspect-form').click());await page.locator('#party-count-fields input').first().waitFor();
 assert.ok(await page.locator('#inspect-status').innerText());
 assert.ok((await page.locator('#party-count-fields').boundingBox()).y>(await page.locator('#start-setup').boundingBox()).y);
 assert.match(await page.locator('#form-scope').innerText(),/최종 신청 추가정보/);
 await page.locator('#save-settings').click();await page.waitForFunction(()=>!!window.__store.partyProfiles[window.__reply.scope]);checks++;
 await page.evaluate(()=>window.__reply={...window.__reply,stage:'final',fields:[]});await page.evaluate(()=>document.querySelector('#inspect-form').click());assert.equal(await page.locator('#save-settings').isVisible(),false);
 assert.equal(await page.evaluate(()=>window.__store.config.usePartyComposition),true);
 assert.equal(await page.evaluate(()=>Object.keys(window.__store.stageProfiles[window.__reply.scope].stages).length),1);checks++;
 await page.evaluate(()=>window.__reply={...window.__reply,stage:'final',fields:[{key:'field:Choice',label:'Choice',type:'customselect',options:[{value:'A',label:'A'},{value:'B',label:'B'}],value:''}]});
 await page.evaluate(()=>document.querySelector('#inspect-form').click());assert.equal(await page.locator('#form-fields select option').count(),3);await page.locator('#form-fields select').selectOption('B');await page.locator('#save-settings').click();await page.waitForFunction(()=>window.__store.formProfiles[window.__reply.scope].fields[0]?.value==='B');checks++;
 await page.evaluate(()=>window.__reply={...window.__reply,stage:'options',stageKey:'new',title:'New quantity stage',fields:[{key:'quantity:new',label:'Tent',type:'quantity',required:false,value:'1',options:[]}]});
 await page.evaluate(()=>document.querySelector('#inspect-form').click());await page.locator('#save-settings').click();await page.waitForFunction(()=>Object.keys(window.__store.stageProfiles[window.__reply.scope].stages).length===2);checks++;
 await page.evaluate(()=>window.__reply={ok:false,error:'Changed screen'});await page.evaluate(()=>document.querySelector('#inspect-form').click());await page.waitForFunction(()=>document.querySelector('#inspect-status').textContent==='Changed screen');checks++;
 // Full content orchestration on a intercepted request page: autoConfirm cannot click payment.
 const paymentPage=await browser.newPage();
 const paymentScope='https://booking.naver.com/booking/6/bizes/969051/items/5279424';
 const paymentHtml=await readFile(new URL('tests/fixtures/grillFinal.html',root),'utf8');
 await paymentPage.route('https://booking.naver.com/**',route=>route.fulfill({body:'<meta charset="utf-8">'+paymentHtml+'<button data-click-code="submitbutton.submit">결제하기</button>',contentType:'text/html'}));
 await paymentPage.goto(paymentScope+'/request/link');
 for(const file of ['composition','stages','slots','form','party','restaurant'])await paymentPage.addScriptTag({path:new URL(`extension/${file}.js`,root).pathname});
 await paymentPage.evaluate(scope=>{
  const job={active:true,id:'payment',date:'2026-10-20',scanId:'scan',phase:'booking',url:scope,autoConfirm:true,formPreferences:{scope,fields:NaverBookingForm.discover(document).map(({controls,...f})=>({...f,value:f.type==='checkbox'?['on']:'0'}))}};
  window.__paymentMessages=[];window.__paymentClicks=0;document.querySelector('[data-click-code="submitbutton.submit"]').addEventListener('click',()=>window.__paymentClicks++);
  window.chrome={storage:{local:{get:async()=>({job})}},runtime:{sendMessage:async m=>{window.__paymentMessages.push(m);if(m.type==='CONTEXT')return {job};if(m.type==='RESULT')job.active=false;return {ok:true};}}};
 },paymentScope);
 await paymentPage.evaluate(()=>{
  const fields=[...document.body.children].filter(e=>!e.matches('button[data-click-code="submitbutton.submit"], script'));
  fields.forEach(e=>e.remove());setTimeout(()=>fields.forEach(e=>document.body.append(e)),600);
 });
 await paymentPage.addScriptTag({path:new URL('extension/content.js',root).pathname});
 await paymentPage.waitForFunction(()=>window.__paymentMessages.some(m=>m.type==='RESULT'));
 assert.equal(await paymentPage.evaluate(()=>window.__paymentClicks),0);
 assert.equal(await paymentPage.evaluate(()=>window.__paymentMessages.some(m=>m.type==='FINAL_CLAIM')),false);checks++;
 assert.equal(await paymentPage.evaluate(()=>window.__paymentMessages.filter(m=>m.type==='FINAL_SCREEN').length),1);checks++;
 // A same-document CLAIM updates storage, while the original job snapshot has no time.
 await paymentPage.goto(paymentScope+'/request/link?startDateTime=2026-10-20T17%3A00%3A00%2B09%3A00');
 for(const file of ['composition','stages','slots','form','party','restaurant'])await paymentPage.addScriptTag({path:new URL(`extension/${file}.js`,root).pathname});
 await paymentPage.evaluate(scope=>{
  const original={active:true,id:'changed-time',scanId:'scan',date:'2026-10-20',phase:'booking',url:scope,autoConfirm:false};
  const stored={...original,selectedTime:'18:00'};window.__paymentMessages=[];
  window.chrome={storage:{local:{get:async()=>({job:stored})}},runtime:{sendMessage:async m=>{window.__paymentMessages.push(m);if(m.type==='CONTEXT')return {job:original};if(m.type==='RESULT')stored.active=false;return {ok:true};}}};
 },paymentScope);
 await paymentPage.addScriptTag({path:new URL('extension/content.js',root).pathname});
 await paymentPage.waitForFunction(()=>window.__paymentMessages.some(m=>m.type==='RESULT'));
 assert.match(await paymentPage.evaluate(()=>window.__paymentMessages.find(m=>m.type==='RESULT').message),/예약 시간이 선택한 시간과 다릅니다/);checks++;
 assert.equal(await paymentPage.evaluate(()=>window.__paymentMessages.some(m=>m.type==='FINAL_SCREEN')),false);checks++;
 await paymentPage.close();
 for(const autoConfirm of [false,true]) {
  const finalPage=await browser.newPage(),scope='https://booking.naver.com/booking/13/bizes/123/items/456';
  await finalPage.route('https://booking.naver.com/**',route=>route.fulfill({body:'<button data-click-code="submitbutton.submit">예약 신청</button>',contentType:'text/html'}));
  await finalPage.goto(scope+'/request/link?startDateTime=2026-10-16T14:30:00');
  for(const file of ['composition','stages','slots','form','party','restaurant'])await finalPage.addScriptTag({path:new URL(`extension/${file}.js`,root).pathname});
  await finalPage.evaluate(({scope,autoConfirm})=>{
   const job={active:true,id:'notify-flow',scanId:'flow-scan',date:'2026-10-16',selectedTime:'14:30',phase:'booking',url:scope,autoConfirm};
   window.__messages=[];window.__clicks=0;document.querySelector('button').onclick=()=>window.__clicks++;
   window.chrome={storage:{local:{get:async()=>({job})}},runtime:{sendMessage:async m=>{window.__messages.push(m);if(m.type==='CONTEXT')return {job};if(m.type==='RESULT')job.active=false;return {ok:true};}}};
  },{scope,autoConfirm});
  await finalPage.addScriptTag({path:new URL('extension/content.js',root).pathname});
  await finalPage.waitForFunction(()=>window.__messages.some(m=>m.type==='RESULT'));
  const messages=await finalPage.evaluate(()=>window.__messages);
  assert.equal(messages.filter(m=>m.type==='FINAL_SCREEN').length,1);
  assert.equal(await finalPage.evaluate(()=>window.__clicks),Number(autoConfirm));
  assert.equal(messages.some(m=>m.type==='FINAL_CLAIM'),autoConfirm);
  if(autoConfirm)assert.ok(messages.findIndex(m=>m.type==='FINAL_SCREEN')<messages.findIndex(m=>m.type==='FINAL_CLAIM'));
  await finalPage.close();checks++;
 }
 // Learned attributes drive the actual scan across dates and time modes.
 for(const timeMode of ['exact','any']) {
  const learnedPage=await browser.newPage(),learnedScope='https://booking.naver.com/booking/13/bizes/123/items/456';
  await learnedPage.route('https://booking.naver.com/**',route=>route.fulfill({body:'<button data-value="2026-10-16">16</button><button data-value="2026-10-23">23</button><div id="times"></div>',contentType:'text/html'}));
  await learnedPage.goto(learnedScope);
  for(const file of ['composition','stages','slots','form','party','restaurant','setup'])await learnedPage.addScriptTag({path:new URL(`extension/${file}.js`,root).pathname});
  await learnedPage.evaluate(({scope,timeMode})=>{
   const dateSelector=NaverBookingSetup.learn(document,document.querySelector('[data-value="2026-10-16"]')).dateSelector;
   const times=document.querySelector('#times');times.innerHTML='<button data-value="14:00">14:00</button><button data-value="15:00">15:00</button>';
   const timeSelector=NaverBookingSetup.learn(document,times.lastElementChild).timeSelector;times.replaceChildren();
   window.__learnedMessages=[];window.__selectedDate=null;
   document.querySelectorAll('[data-value]').forEach(button=>button.onclick=()=>{window.__selectedDate=button.dataset.value;times.innerHTML='<button data-value="14:00">14:00</button><button data-value="15:00">15:00</button>';});
   const job={active:true,id:'learned',scanId:'learned',date:'2026-10-23',dates:['2026-10-16','2026-10-23'],phase:'watching',url:scope,timeMode,times:['15:00'],dateSelector,timeSelector};
   window.chrome={storage:{local:{get:async()=>({job})}},runtime:{sendMessage:async message=>{window.__learnedMessages.push(message);if(message.type==='CONTEXT')return {job};return {ok:message.type!=='CLAIM'};}}};
  },{scope:learnedScope,timeMode});
  await learnedPage.addScriptTag({path:new URL('extension/content.js',root).pathname});
  await learnedPage.waitForFunction(()=>window.__learnedMessages.some(m=>m.type==='CLAIM'));
  assert.equal(await learnedPage.evaluate(()=>window.__selectedDate),'2026-10-23');
  assert.equal(await learnedPage.evaluate(()=>window.__learnedMessages.find(m=>m.type==='CLAIM').time),timeMode==='exact' ? '15:00' : '14:00');
  await learnedPage.close();checks++;
 }
 console.log(`PASS ${checks} browser fixture checks (reproductions, no live submissions)`);
} finally {await browser.close();}
