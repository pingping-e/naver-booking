import {notificationSounds} from './notification-sounds.js';
let currentAudio;
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.target!=='notification-audio' || message.type!=='PLAY_NOTIFICATION_SOUND')return false;
  (async()=>{
    if(!Object.hasOwn(notificationSounds,message.sound))throw new Error('알림 소리 설정이 올바르지 않습니다.');
    currentAudio?.pause();
    const file=notificationSounds[message.sound].file;
    if(!file){currentAudio=null;return;}
    const audio=new Audio(chrome.runtime.getURL(file));currentAudio=audio;audio.volume=0.65;
    await audio.play();
  })().then(()=>respond({ok:true}),error=>respond({ok:false,error:error.message}));
  return true;
});
