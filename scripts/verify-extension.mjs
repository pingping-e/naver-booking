// Headed Chrome, installed extension, real storage/messages, synthetic booking UI.
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'naver-booking-extension-'));
const context=await chromium.launchPersistentContext(profile,{...process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {channel:'chrome'},headless:process.env.PLAYWRIGHT_HEADLESS==='1',ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const scope='https://booking.naver.com/booking/13/bizes/999999/items/999999';
const calendar=Array.from({length:31},(_,i)=>`<button class="calendar_date" onclick="this.classList.add('selected');document.querySelector('.time_area').hidden=false"><span class="num">${i+1}</span></button>`).join('');
const fixture=`<!doctype html><meta charset="utf-8"><div class="calendar_title">2026.10</div><div class="calendar_table">${calendar}</div><div class="time_area" hidden><button class="btn_time" onclick="this.classList.add('selected');installStage(1)">16:00</button></div><div id="stage"></div><script>
window.order={};window.finalClicks=0;
function installStage(n){
 if(n===2)order.tent=document.querySelector('[class*=Count__control_wrap__] span').textContent;
 if(n===3){order.people=document.querySelector('[class*=Count__control_wrap__] span').textContent;history.pushState({},'',location.pathname+'/request/link');document.body.innerHTML='<p id="order">Tent '+order.tent+' / Visitors '+order.people+'</p><label>Choice<select required><option value="">Select</option><option value="A">A</option><option value="B">B</option></select></label><label>Agreement<input type="checkbox" required value="on"></label><button data-click-code="submitbutton.submit" onclick="window.finalClicks++">결제하기</button>';return;}
 const name=n===1?'Tent':'Visitors';document.querySelector('#stage').innerHTML='<section class="section_option"><h3 class="section_title">필수 옵션</h3><div class="option_item"><div class="Count__info_tit__test">'+name+'</div><div class="Count__control_wrap__test"><button class="Count__btn_minus__test" onclick="change(-1)">-</button><span>0</span><button class="Count__btn_plus__test" onclick="change(1)">+</button></div></div></section><button data-click-code="nextbuttonview.request" onclick="installStage('+(n+1)+')">다음</button>';
}
function change(delta){const el=document.querySelector('[class*=Count__control_wrap__] span');el.textContent=String(Number(el.textContent)+delta);const url=new URL(location.href);url.searchParams.set('quantity',el.textContent);history.replaceState({},'',url);}
</script>`;
let checks=0;
try {
 await context.route('https://booking.naver.com/**',route=>route.fulfill({body:fixture,contentType:'text/html'}));
 const cdp=await context.browser().newBrowserCDPSession();
 const {id}=await cdp.send('Extensions.loadUnpacked',{path:new URL('../extension',import.meta.url).pathname});
 const worker=context.serviceWorkers().find(w=>w.url().startsWith(`chrome-extension://${id}`)) || await context.waitForEvent('serviceworker');
 const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
 await popup.locator('[name="url"]').fill(scope);
 const setupPagePromise=context.waitForEvent('page');await popup.locator('#start-setup').click();const setupPage=await setupPagePromise;await setupPage.waitForURL(scope);
 await setupPage.locator('.calendar_date').filter({hasText:/^19$/}).click();await setupPage.locator('.btn_time').click();
 for(const [index,value] of [[1,'1'],[2,'2']]) {
  await setupPage.locator('.section_title').waitFor();await setupPage.bringToFront();
  const before=index===1?'Tent':'Visitors';
  await popup.waitForFunction(expected=>document.querySelector('#stage-fields').textContent.includes(expected),before);
  assert.equal(await popup.locator('#inspect-form').isVisible(),false);
  await popup.locator('#stage-fields input').fill(value);
  assert.match(await popup.locator('#stage-fields').innerText(),new RegExp(before));
  await popup.locator('#setup-next').click();
  if(index===1)await setupPage.locator('[class*="Count__info_tit__"]').filter({hasText:'Visitors'}).waitFor();
  else await setupPage.waitForURL(scope+'/request/link');
  checks++;
 }
 await setupPage.bringToFront();await popup.locator('#form-fields select').first().waitFor();await popup.locator('#form-fields select').first().selectOption('A');
 const banner=setupPage.locator('#naver-booking-input-status');
 assert.equal(await banner.evaluate(el=>el===document.body.firstElementChild),true);
 assert.equal(await banner.evaluate(el=>getComputedStyle(el).fontSize),'18px');
 await popup.locator('#save-settings').click();
 await setupPage.waitForTimeout(1500);
 const captured=await worker.evaluate(scope=>chrome.storage.local.get('setupProfiles').then(s=>s.setupProfiles[scope]),scope);
 assert.equal(captured.complete,true);assert.equal(captured.steps.length,3);assert.notEqual(captured.steps[0].stageKey,captured.steps[1].stageKey);checks++;
 await popup.locator('[name="date"]').fill('2026-10-19');await popup.locator('[name="autoConfirm"]').check();
 const watchPagePromise=context.waitForEvent('page');await popup.locator('button[type="submit"]').click();const watchPage=await watchPagePromise;await watchPage.waitForURL(url=>url.pathname.endsWith('/request/link'),{timeout:20000});
 const deadline=Date.now()+10000;let job;
 do{job=await worker.evaluate(()=>chrome.storage.local.get('job').then(s=>s.job));if(!job.active)break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
 assert.equal(job.active,false);assert.match(job.status,/최종 추가정보 설정을 적용/);assert.equal(job.routeIndex,3);checks++;
 assert.equal(await watchPage.locator('#order').innerText(),'Tent 1 / Visitors 2');assert.equal(await watchPage.locator('select').inputValue(),'A');assert.equal(await watchPage.locator('input[type="checkbox"]').isChecked(),true);checks++;
 assert.equal(await watchPage.evaluate(()=>window.finalClicks),0);assert.equal(job.phase,'booking');checks++;
 console.log(`PASS ${checks} installed-extension checks (synthetic 2-stage route, no live submissions)`);
} catch(error) {
 const worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'));
 if(worker)console.error(await worker.evaluate(()=>chrome.storage.local.get('job').then(s=>({status:s.job?.status,routeIndex:s.job?.routeIndex}))));
 throw error;
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
