// The restaurant reservation widget uses stable data-gbw attributes for its state.
globalThis.NaverBookingRestaurant = {
  isPage(root) {return !!root.querySelector('[data-testid="gbw-flow-step1"], button[class*="CtaBar__btn_book"]');},
  async scan(root, job, {active, send}) {
    const text=el=>(el.innerText || el.textContent || '').replace(/\s+/g,' ').trim();
    const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
    const enabled=el=>visible(el) && !el.disabled && el.getAttribute('aria-disabled')!=='true' && !/Disabled|(?:^|[ _-])disabled(?:[ _-]|$)/i.test(el.className || '');
    const wait=async fn=>{const end=Date.now()+15000;do{if(!await active())return null;const result=fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,200));}while(Date.now()<end);return null;};
    let widget=root.querySelector('[data-testid="gbw-flow-step1"]');
    if(!widget){
      const open=await wait(()=>root.querySelector('button[class*="CtaBar__btn_book"]'));
      if(!open || !enabled(open))throw new Error('인원·날짜 선택 화면을 열지 못했습니다.');
      if(!await active())return;open.click();
      widget=await wait(()=>root.querySelector('[data-testid="gbw-flow-step1"]'));
    }
    if(!widget)throw new Error('예약 조건 화면이 준비되지 않았습니다.');
    if(job.partySize!=null)await NaverBookingParty.apply(root,job.partySize,active);
    else if(!Number(widget.getAttribute('data-gbw-step1-people')))throw new Error('이 예약은 인원 선택이 필요합니다. 확장 설정에 예약 인원을 입력하세요.');
    const people=Number(widget.getAttribute('data-gbw-step1-people'));
    const [year,month,day]=job.date.split('-').map(Number),targetMonth=year*12+month;
    const label=()=>widget.querySelector('[class*="_monthLabel_"]');
    const readMonth=()=>{const match=label()&&text(label()).match(/(20\d{2})\s*[.년/-]\s*(\d{1,2})/);return match?Number(match[1])*12+Number(match[2]):null;};
    if(!await wait(()=>readMonth()!==null && !widget.querySelector('[data-skeleton="true"]') && widget.querySelector('[class*="_dayGrid_"] [class*="_day_"]')))throw new Error('식당 예약 달력이 준비되지 않았습니다.');
    for(let step=0;readMonth()!==targetMonth && step<24;step++){
      const previous=readMonth();
      const arrow=widget.querySelector(previous<targetMonth?'button[aria-label="다음달"], button[aria-label="Next month"]':'button[aria-label="이전달"], button[aria-label="Previous month"]');
      if(!arrow || !enabled(arrow))throw new Error('원하는 월로 이동할 수 없습니다.');
      if(!await active())return;arrow.click();
      if(!await wait(()=>readMonth()!==null && readMonth()!==previous && !widget.querySelector('[data-skeleton="true"]')))throw new Error('달력 월 변경을 확인하지 못했습니다.');
    }
    if(readMonth()!==targetMonth)throw new Error('원하는 월을 확인하지 못했습니다.');
    const dates=[...widget.querySelectorAll('[class*="_dayGrid_"] [class*="_cell_"]')].filter(el=>Number(el.querySelector('[class*="_day_"]')?.textContent)===day);
    if(dates.length!==1)throw new Error('예약 날짜를 정확하게 찾지 못했습니다.');
    if(!enabled(dates[0])){await send('LOG',{message:'예약 불가'});return;}
    if(!await active())return;dates[0].click();
    if(!await wait(()=>Number(widget.getAttribute('data-gbw-step1-day'))===day && readMonth()===targetMonth))throw new Error('선택한 예약 날짜를 확인하지 못했습니다.');
    const ready=await wait(()=>!widget.querySelector('[data-skeleton="true"]') && (widget.querySelector('[class*="_timePeriodGrid_"] button') || /예약 가능한 시간이 없습니다|예약 마감|예약할 수 있는 시간이 없/.test(text(widget))));
    if(!ready)throw new Error('예약 시간 목록을 확인하지 못했습니다.');
    const slots=[...widget.querySelectorAll('[class*="_timePeriodGrid_"] button')].filter(enabled).map(el=>{
      const grid=el.closest('[class*="_timePeriodGrid_"]');
      const period=grid.parentElement.querySelector('[class*="_timePeriodLabel_"]')?.textContent || '';
      return {el,time:NaverBookingSlots.parseTime(text(el),period)};
    }).filter(slot=>NaverBookingSlots.isAllowed(slot.time,job));
    const chosen=(job.timeMode==='exact' || (!job.timeMode&&job.times?.length)) ? job.times.map(time=>slots.find(slot=>slot.time===time)).find(Boolean) : slots[0];
    if(!chosen){await send('LOG',{message:'예약 불가'});return;}
    if(Number(widget.getAttribute('data-gbw-step1-people'))!==people || (job.partySize!=null && people!==job.partySize))throw new Error('예약 인원이 변경되어 중지합니다.');
    await send('LOG',{message:`예약 가능: ${chosen.time}`});
    const claim=await send('CLAIM',{time:chosen.time,manualContinuation:true});
    if(!claim?.ok || !await active())return;chosen.el.click();
    if(!await wait(()=>chosen.el.getAttribute('aria-pressed')==='true' && widget.getAttribute('data-gbw-step1-time')===chosen.time && Number(widget.getAttribute('data-gbw-step1-day'))===day && readMonth()===targetMonth))throw new Error('예약 시간 선택을 확인하지 못했습니다.');
    const next=await wait(()=>[...widget.querySelectorAll('button')].find(el=>/^(다음|Next)$/.test(text(el)) && enabled(el)));
    if(!next)throw new Error('예약 다음 단계 버튼을 찾지 못했습니다.');
    if(Number(widget.getAttribute('data-gbw-step1-people'))!==people)throw new Error('예약 인원이 변경되어 중지합니다.');
    await send('LOG',{message:`${people}명 예약 조건 선택 완료 — 다음 화면에서 예약 신청을 직접 완료하세요.`});
    if(!await active())return;next.click();
    await send('RESULT',{message:`${people}명 · ${job.date} ${chosen.time} 예약 조건을 선택했습니다. 다음 화면에서 내용을 확인하고 예약 신청을 완료하세요.`});
  }
};
