import {notificationSounds} from './notification-sounds.js';
let creating;
export async function playNotificationSound(sound) {
  if(!Object.hasOwn(notificationSounds,sound))throw new Error('알림 소리를 선택하세요.');
  if(sound==='none')return;
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
  if(!contexts.length) {
    if(!creating)creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['AUDIO_PLAYBACK'],justification:'최종 신청 화면 도착 알림과 선택한 미리 듣기 소리를 재생합니다.'}).finally(()=>{creating=null;});
    await creating;
  }
  const result=await chrome.runtime.sendMessage({target:'notification-audio',type:'PLAY_NOTIFICATION_SOUND',sound});
  if(!result?.ok)throw new Error(result?.error || '알림 소리를 재생하지 못했습니다.');
}
