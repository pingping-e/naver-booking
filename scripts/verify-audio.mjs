// Decode and play real bundled audio through the offscreen page's message handler.
// This browser replica uses a preview gesture; OS audio output is not inspected.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../extension/',import.meta.url);
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
try {
 const page=await browser.newPage();
 await page.addInitScript(()=>{
  window.chrome={runtime:{getURL:path=>'https://extension.test/'+path,onMessage:{addListener(fn){window.audioHandler=fn;}}}};
  const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(...args){window.lastAudio=this;window.playCount=(window.playCount || 0)+1;return play.apply(this,args);};
 });
 await page.route('https://extension.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  const type=name.endsWith('.js')?'text/javascript':name.endsWith('.mp3')?'audio/mpeg':name.endsWith('.wav')?'audio/wav':'text/html';
  await route.fulfill({body:await readFile(new URL(name,root)),contentType:type});
 });
 await page.goto('https://extension.test/offscreen.html');await page.waitForFunction(()=>!!window.audioHandler);
 await page.evaluate(()=>{
  const button=document.createElement('button');button.id='preview';button.textContent='Preview';document.body.append(button);
  button.onclick=()=>{window.result=null;window.audioHandler({target:'notification-audio',type:'PLAY_NOTIFICATION_SOUND',sound:window.nextSound},{},result=>{window.result=result;});};
 });
 for(const sound of ['alert','chime','bell','beep']) {
  await page.evaluate(sound=>window.nextSound=sound,sound);await page.locator('#preview').click();
  await page.waitForFunction(()=>window.result!==null);assert.equal((await page.evaluate(()=>window.result)).ok,true);
  await page.waitForFunction(()=>window.lastAudio.ended);
  const media=await page.evaluate(()=>({duration:window.lastAudio.duration,time:window.lastAudio.currentTime,error:window.lastAudio.error}));
  assert.equal(media.error,null);assert.ok(media.duration>0 && media.duration<4);assert.ok(media.time>=media.duration-.05);
 }
 const before=await page.evaluate(()=>window.playCount);
 await page.evaluate(()=>window.nextSound='none');await page.locator('#preview').click();await page.waitForFunction(()=>window.result!==null);
 assert.equal(await page.evaluate(()=>window.playCount),before);
 console.log('PASS real audio playback: uploaded MP3 and three WAV sounds decode, play and end; silence does not play');
}finally{await browser.close();}
