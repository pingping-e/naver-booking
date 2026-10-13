globalThis.NaverBookingSetup={
  learn(root,button) {
    if(!button || button.closest('[inert]') || button.disabled || button.getAttribute('aria-disabled')==='true' || /결제|payment|pay/i.test(button.textContent))return {};
    const tag=button.tagName.toLowerCase();
    const quote=value=>value.replace(/[\\"]/g,'\\$&').replace(/\n/g,'\\a ');
    // Only learn reusable semantic attributes, never a fixed calendar cell index.
    if(!root.querySelector('.calendar_title, [data-testid="gbw-flow-step1"]')) {
      for(const attr of ['data-date','data-value','aria-label','title']) {
        const value=button.getAttribute(attr),date=value?.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
        if(!date)continue;
        const selector=`${tag}[${attr}="${quote(value)}"]`;
        if(root.querySelectorAll(selector).length===1 && root.querySelector(selector)===button)return {dateSelector:selector.replace(date,'{date}')};
      }
    }
    if(!root.querySelector('.time_area button.btn_time, [data-testid="gbw-flow-step1"]')) {
      for(const attr of ['data-time','data-value','aria-label','title']) {
        const value=button.getAttribute(attr);
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || ''))continue;
        if(globalThis.NaverBookingSlots?.readTime(button)!==value)continue;
        const selector=`${tag}[${attr}="${quote(value)}"]`;
        if(root.querySelectorAll(selector).length===1)return {timeSelector:selector.replace(value,'{time}')};
      }
    }
    if(/^(계속|다음으로)$/.test(button.textContent.trim())) {
      for(const attr of ['data-testid','data-click-code']) {
        const value=button.getAttribute(attr);if(!value)continue;
        const selector=`${tag}[${attr}="${quote(value)}"]`;
        if(root.querySelectorAll(selector).length===1)return {bookingSelector:selector};
      }
    }
    return {};
  },
  async observe(setup) {
    NaverBookingForm.notice(document,'예약 설정 중 · 사이트에서 날짜·시간을 선택하세요. 다음 화면의 항목은 확장에 자동으로 표시됩니다.');
    let timer,running=false,last='';
    const remember=async event=>{
      try {
        const button=event.target.closest?.('button,a,[role="button"]');
        const selectors=this.learn(document,button);
        if(!Object.keys(selectors).length)return;
        const stageKey=selectors.bookingSelector ? globalThis.NaverBookingComposition?.widget(document) ? 'composition' : globalThis.NaverBookingStages?.discover(document)?.stageKey : undefined;
        if(selectors.bookingSelector && !stageKey)return;
        const result=await chrome.runtime.sendMessage({type:'SETUP_SELECTORS',id:setup.id,scope:setup.scope,selectors,stageKey});
        if(result?.ok)NaverBookingForm.notice(document,'예약 설정 중 · 선택한 버튼의 구조를 자동으로 저장했습니다. 설정을 계속 진행하세요.');
      }catch{}
    };
    document.addEventListener('click',remember,true);
    const capture=async()=>{
      if(running)return;
      running=true;
      try {
        const {setup:current}=await chrome.storage.local.get('setup');
        if(!current?.active || current.id!==setup.id){observer.disconnect();document.removeEventListener('click',remember,true);return;}
        const path=location.pathname,base=new URL(setup.scope).pathname;
        if(![base,base+'/request',base+'/request/link'].includes(path))return;
        let step;
        if(path!==base && document.querySelector('button[data-click-code="submitbutton.submit"]')) {
          await NaverBookingForm.ready(document,async()=>location.pathname===path);
          const fields=(await NaverBookingForm.inspect(document)).map(({controls,...f})=>{
            const value=NaverBookingForm.automaticValue(f);return value===undefined ? f : {...f,value,automatic:true};
          });
          step={stage:'final',stageKey:'final',title:'최종 신청 추가정보',fields};
        }else if(NaverBookingComposition.widget(document)) {
          step={stage:'composition',stageKey:'composition',title:'인원 구성 · 이용료 수량',people:NaverBookingComposition.total(document),fields:NaverBookingComposition.discover(document).map(f=>({key:`count:${f.label}`,label:f.label,type:'number',value:String(f.count),options:[]}))};
        }else {
          const stage=NaverBookingStages.discover(document);if(!stage)return;
          step=NaverBookingStages.serialize(stage);
        }
        const signature=JSON.stringify(step);if(signature===last && !current.error)return;
        const result=await chrome.runtime.sendMessage({type:'SETUP_STAGE',id:setup.id,scope:setup.scope,step});
        if(!result?.ok)throw new Error(result?.error || '사전 설정 단계 기록 실패');
        last=signature;
        if(step.stage==='final'){observer.disconnect();document.removeEventListener('click',remember,true);}
        NaverBookingForm.notice(document,step.stage==='final' ? '마지막 화면까지 확인했습니다. 확장을 열어 추가정보를 저장하고 감시를 시작하세요.' : '예약 설정 중 · 현재 화면의 항목을 자동으로 읽었습니다. 확장을 열어 값을 입력하고 ‘저장하고 다음’을 누르세요.');
      }catch(error){
        await chrome.runtime.sendMessage({type:'SETUP_ERROR',id:setup.id,error:error.message}).catch(()=>{});
        NaverBookingForm.notice(document,`화면 읽기 실패: ${error.message} 확장의 ‘다시 읽기’를 눌러 주세요.`);
      }
      finally{running=false;}
    };
    const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(capture,300);});
    observer.observe(document.documentElement,{subtree:true,childList:true});
    await capture();
  },
  async next(message) {
    const scope=location.origin+location.pathname.replace(/\/$/,'');
    if(message.profile?.scope!==scope || /\/request(?:\/link)?$/.test(location.pathname))throw new Error('중간 설정 화면에서만 다음 단계로 진행할 수 있습니다.');
    const {setup}=await chrome.runtime.sendMessage({type:'CONTEXT'});
    if(!setup?.active || setup.scope!==scope)throw new Error('현재 탭은 사전 설정 경로가 아닙니다. 사전 설정을 다시 시작하세요.');
    const path=location.origin+location.pathname,active=async()=>location.origin+location.pathname===path;
    const {setupProfiles={}}=await chrome.storage.local.get('setupProfiles');
    const bookingSelector=setupProfiles[scope]?.nextSelectors?.[message.stage==='composition' ? 'composition' : message.profile.stageKey];
    if(message.stage==='composition') {
      await NaverBookingComposition.apply(document,message.profile.counts,message.people,active);
      NaverBookingComposition.verify(document,message.profile.counts,message.people);
    }else {
      await NaverBookingStages.apply(document,message.profile,active);
      NaverBookingStages.verify(document,message.profile);
    }
    let next;const end=Date.now()+5000;
    do {
      if(!await active())throw new Error('입력 화면이 변경되어 중지했습니다.');
      const sheet=document.querySelector('[data-testid="gbw-flow-sheet"]') || document;
      const buttons=[...sheet.querySelectorAll('button')].filter(b=>NaverBookingStages.enabled(b) && !b.closest('[inert]') && b.getAttribute('data-click-code')!=='submitbutton.submit' && !/결제|payment|pay/i.test(b.textContent) && (b.getAttribute('data-click-code')==='nextbuttonview.request' || /^(다음|다음단계|Next)$/.test(b.textContent.trim()) || bookingSelector && b.matches(bookingSelector)));
      if(buttons.length>1)throw new Error('다음 버튼을 하나로 구분하지 못했습니다.');
      next=buttons[0];if(next)break;
      await new Promise(r=>setTimeout(r,100));
    }while(Date.now()<end);
    if(!next)throw new Error('다음 버튼이 준비되지 않았습니다. 날짜·시간과 현재 항목을 확인하세요.');
    if(message.stage==='composition')NaverBookingComposition.verify(document,message.profile.counts,message.people);
    else NaverBookingStages.verify(document,message.profile);
    next.click();return {ok:true};
  }
};
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type!=='SETUP_NEXT')return;
  NaverBookingSetup.next(message).then(respond,error=>respond({ok:false,error:error.message}));return true;
});
