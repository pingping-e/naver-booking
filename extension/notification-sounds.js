export const notificationSounds={
  none:{label:'소리 없음'},
  alert:{label:'내 알림음 · alert.mp3 (기본)',file:'sounds/alert.mp3'},
  chime:{label:'차임',file:'sounds/chime.wav'},
  bell:{label:'맑은 종',file:'sounds/bell.wav'},
  beep:{label:'짧은 전자음',file:'sounds/beep.wav'}
};
export function soundChoice(settings){return Object.hasOwn(notificationSounds,settings?.sound) ? settings.sound : 'alert';}
