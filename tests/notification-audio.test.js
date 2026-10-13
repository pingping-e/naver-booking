import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {notificationSounds,soundChoice} from '../extension/notification-sounds.js';
import {playNotificationSound} from '../extension/notification-audio.js';
test('sound choices preserve saved values and bundled WAV files have valid PCM headers',async()=>{
 assert.equal(soundChoice(),'alert');assert.equal(soundChoice({sound:'unknown'}),'alert');assert.equal(soundChoice({sound:'none'}),'none');assert.equal(soundChoice({sound:'bell'}),'bell');
 for(const sound of Object.values(notificationSounds).filter(s=>s.file?.endsWith('.wav'))) {
  const wav=await readFile(new URL('../extension/'+sound.file,import.meta.url));
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt16LE(20),1);
  assert.equal(wav.readUInt32LE(40),wav.length-44);assert.ok(wav.length>10000);
 }
});
test('concurrent sounds share one offscreen document and reuse it until closed',async()=>{
 let exists=false,creates=0;const messages=[];
 globalThis.chrome={offscreen:{createDocument:async options=>{creates++;assert.deepEqual(options.reasons,['AUDIO_PLAYBACK']);await Promise.resolve();exists=true;}},runtime:{getURL:path=>`chrome-extension://test/${path}`,getContexts:async options=>{assert.deepEqual(options.contextTypes,['OFFSCREEN_DOCUMENT']);return exists ? [{}] : [];},sendMessage:async message=>{messages.push(message);return {ok:true};}}};
 await Promise.all([playNotificationSound('chime'),playNotificationSound('bell')]);assert.equal(creates,1);assert.equal(messages.length,2);
 await playNotificationSound('beep');assert.equal(creates,1);
 await playNotificationSound('none');assert.equal(messages.length,3);
 exists=false;await playNotificationSound('chime');assert.equal(creates,2);
 await assert.rejects(playNotificationSound('not-a-sound'));assert.equal(messages.length,4);
});
test('offscreen playback errors are reported and creation failures can recover',async()=>{
 let fail=true;
 globalThis.chrome={offscreen:{createDocument:async()=>{if(fail)throw new Error('creation failed');}},runtime:{getURL:path=>`chrome-extension://test/${path}`,getContexts:async()=>[],sendMessage:async()=>({ok:false,error:'playback blocked'})}};
 await assert.rejects(playNotificationSound('chime'),/creation failed/);fail=false;
 await assert.rejects(playNotificationSound('chime'),/playback blocked/);
});
