async function checkBookingDate(job) {
  if (!job?.active || !['watching', 'booking'].includes(job.phase)) return;
  const expected = new URL(job.url);
  const requestPath = `${expected.pathname.replace(/\/$/, '')}/request`;
  const requestPaths=[requestPath,`${requestPath}/link`];
  if (location.origin !== expected.origin || ![expected.pathname, ...requestPaths].includes(location.pathname)) return;
  if (job.phase === 'watching' && location.pathname !== expected.pathname) return;
  const send = (type, extra = {}) => chrome.runtime.sendMessage({type, id: job.id, date: job.date, scanId: job.scanId, ...extra});
  // The background validates tab identity before allowing any booking action.
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const enabled = el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[inert]') && !/(?:^|[ _-])(?:disabled|unselectable)(?:[ _-]|$)/i.test(el.className || '');
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const unique = list => { const items = [...list].filter(enabled); if (items.length > 1) throw new Error('같은 조건의 버튼이 여러 개입니다. 예약 설정을 다시 진행하세요.'); return items[0]; };
  const dateButton = elements => { const items = [...elements].filter(el => visible(el) && (enabled(el) || el.classList.contains('closed'))); if (items.length > 1) throw new Error('같은 날짜의 버튼이 여러 개입니다. 예약 설정을 다시 진행하세요.'); return items[0]; };
  const pick = (selector, fallback) => unique(selector ? document.querySelectorAll(selector) : [...document.querySelectorAll('button, a, [role="button"]')].filter(fallback));
  const wait = async fn => { const deadline = Date.now() + 15000; do { const found = fn(); if (found) return found; await new Promise(r => setTimeout(r, 300)); } while (Date.now() < deadline); return null; };
  const active = async () => { const {job: latest} = await chrome.storage.local.get('job'); return latest?.id === job.id && latest.date === job.date && latest.scanId === job.scanId && latest.active; };
  const seen=async step=>{const result=await send('STAGE_SEEN',{step});if(!result?.ok)throw new Error(result?.error || '사전 확인한 단계를 현재 작업에 연결하지 못했습니다.');};
  const finishRequest = async () => {
    const current = new URL(location.href);
    const start = current.searchParams.get('startDateTime');
    if (!requestPaths.includes(location.pathname) || (start && !start.startsWith(`${job.date}T`))) throw new Error('예약 신청 날짜/시간 또는 경로가 작업과 다릅니다.');
    const selector = job.confirmSelector || 'button[data-click-code="submitbutton.submit"]';
    const formReady = await wait(() => document.querySelector(selector));
    if (!formReady) throw new Error('추가정보 또는 예약 신청 버튼을 찾지 못했습니다. 화면을 직접 확인하세요.');
    const scope = expected.origin + expected.pathname.replace(/\/$/, '');
    const {job:latest}=await chrome.storage.local.get('job');
    const selectedTime=latest?.id===job.id && latest.scanId===job.scanId ? latest.selectedTime : job.selectedTime;
    if(start && selectedTime && start.slice(11,16)!==selectedTime) {
      // Legacy booking/12 uses midnight as a date marker; verify its visible slot.
      const dateOnly=/^\/booking\/12\//.test(expected.pathname) && start.slice(11,16)==='00:00';
      const displayed=dateOnly && await wait(()=>{
        const labels=[...document.querySelectorAll('.desc.date .time')].filter(visible);
        return labels.length===1 && NaverBookingSlots.parseTime(text(labels[0]))===selectedTime;
      });
      if(!displayed)throw new Error('최종 화면의 예약 시간이 선택한 시간과 다릅니다.');
    }
    if(!await active())return;
    const notification=await send('FINAL_SCREEN',{requestUrl:location.href});
    if(!notification?.ok && !notification?.logged)await send('LOG',{message:`최종 화면 알림 요청 거부: ${notification?.error || '응답을 받지 못했습니다.'}`});
    else if(notification?.ok && !notification.notificationStatus)await send('LOG',{message:'알림 기능 응답을 확인하지 못했습니다. 확장과 예약 탭을 새로고침하세요.'});
    const missing=Object.keys(job.stagePreferences?.stages || {}).filter(key=>!latest?.completedStages?.includes(key));
    if(missing.length)throw new Error('저장한 중간 단계가 적용되지 않았습니다. 단계 설정과 현재 경로를 다시 확인하세요.');
    if(job.partyComposition && !latest?.compositionApplied)throw new Error('저장한 인원 구성 단계를 확인하지 못했습니다.');
    const preferences = job.formPreferences?.scope===scope ? job.formPreferences.fields : null;
    if(job.formPreferences && !Array.isArray(preferences))throw new Error('저장한 최종 입력 설정의 상품 또는 형식이 다릅니다. 다시 불러와 저장하세요.');
    // Request shells may mount the submit button before their extra fields.
    await NaverBookingForm.ready(document,active);
    if(preferences)await wait(()=>{
      try{const fields=NaverBookingForm.discover(document,{allowEmpty:true});return fields.length===preferences.length && fields.every(f=>preferences.some(p=>p.key===f.key && p.type===f.type));}catch{return false;}
    });
    if(!await active())return;
    const fields=await NaverBookingForm.inspect(document,active);
    await seen({stageKey:'final',fields:fields.map(({controls,...f})=>f)});
    if(preferences)await NaverBookingForm.fill(document,preferences,active);
    else {
      const result=await NaverBookingForm.fill(document,null,active,{automaticOnly:true});
      if(result.pending.length)throw new Error(`값을 미리 지정해야 하는 필수 항목: ${result.pending.join(' · ')}. 현재 화면에서 불러와 저장하세요.`);
    }
    if (!await active()) return;
    if (!job.autoConfirm || /결제|payment|pay/i.test(text(document.querySelector(selector)))) {
      await send('RESULT', {message: '최종 추가정보 설정을 적용했습니다. 예약 내용·약관을 확인하고 신청 또는 결제를 직접 완료하세요.'});
      return;
    }
    const confirm = await wait(() => pick(selector));
    if (!confirm) throw new Error('예약 신청 버튼이 비활성입니다. 필수 입력과 약관을 확인하세요.');
    const invalid = [...document.querySelectorAll('input[required], select[required], textarea[required]')].some(el => !el.disabled && !el.checkValidity());
    if (invalid) throw new Error('입력되지 않은 필수 항목이 있습니다. 직접 입력하세요.');
    const claim = await send('FINAL_CLAIM');
    if (!claim?.ok || !await active()) return;
    confirm.click();
    await send('RESULT', {message: '동의하고 예약 신청하기 버튼을 1회 클릭했습니다. 예약 내역에서 접수 여부를 확인하세요.'});
  };
  const optionProfile = stage => {
    const scope=expected.origin+expected.pathname.replace(/\/$/,'');
    return (job.stagePreferences?.scope===scope ? job.stagePreferences.stages[stage.stageKey] : null) || NaverBookingStages.automaticProfile(stage);
  };
  const applyOptions = async () => {
    const stage=NaverBookingStages.discover(document);if(!stage)return false;
    await seen(NaverBookingStages.serialize(stage));
    const profile=optionProfile(stage);
    await NaverBookingStages.apply(document,profile,active);
    if(!await active())throw new Error('작업이 중지되었습니다.');
    if(job.stagePreferences?.stages?.[stage.stageKey]) {
      const recorded=await send('STAGE_DONE',{stageKey:stage.stageKey});if(!recorded?.ok)throw new Error('단계 적용 기록을 저장하지 못했습니다.');
    }
    return true;
  };
  const continueFlow = async (people=job.partySize) => {
    const visited=new Set();
    for(let step=0;step<20 && await active();step++) {
      const ready=await wait(()=>requestPaths.includes(location.pathname) && document.querySelector(job.confirmSelector || 'button[data-click-code="submitbutton.submit"]') || NaverBookingComposition.widget(document) || NaverBookingStages.discover(document));
      if(!ready)throw new Error('다음 입력 단계를 확인하지 못했습니다. 로그인 또는 화면 구조를 확인하세요.');
      if(requestPaths.includes(location.pathname)){await finishRequest();return;}
      if(NaverBookingComposition.widget(document)) {
        if(visited.has('composition'))throw new Error('인원 구성 다음 단계로 이동하지 못했습니다.');
        visited.add('composition');
        if(!job.partyComposition)throw new Error('인원 구성 항목을 현재 화면에서 불러와 저장하세요.');
        await seen({stageKey:'composition',fields:NaverBookingComposition.discover(document).map(f=>({key:`count:${f.label}`,type:'number',options:[]}))});
        await NaverBookingComposition.apply(document,job.partyComposition.counts,people,active);
        const recorded=await send('STAGE_DONE',{composition:true});if(!recorded?.ok)throw new Error('인원 구성 적용 기록을 저장하지 못했습니다.');
      } else {
        const stage=NaverBookingStages.discover(document);
        if(visited.has(stage.stageKey))throw new Error('같은 옵션 단계가 반복되어 중지합니다.');
        visited.add(stage.stageKey);await applyOptions();
      }
      const sheet=document.querySelector('[data-testid="gbw-flow-sheet"]') || document;
      const currentKey=NaverBookingComposition.widget(document) ? 'composition' : NaverBookingStages.discover(document)?.stageKey;
      const nextSelector=job.setupPlan?.nextSelectors?.[currentKey];
      const next=await wait(()=>unique([...sheet.querySelectorAll('button')].filter(el=>!el.closest('.slick-slider') && el.getAttribute('data-click-code')!=='submitbutton.submit' && !/결제|payment|pay/i.test(text(el)) && (el.getAttribute('data-click-code')==='nextbuttonview.request' || /^(다음|다음단계|Next)$/.test(text(el)) || nextSelector && el.matches(nextSelector)))));
      if(!next)throw new Error('중간 단계 다음 버튼이 비활성입니다. 저장한 수량·필수 옵션을 확인하세요.');
      if(!await active())return;
      if(NaverBookingComposition.widget(document))NaverBookingComposition.verify(document,job.partyComposition.counts,people);
      else NaverBookingStages.verify(document,optionProfile(NaverBookingStages.discover(document)));
      const previous=location.href,composition=!!NaverBookingComposition.widget(document),stageKey=NaverBookingStages.discover(document)?.stageKey;
      next.click();
      await wait(()=>location.href!==previous || (composition ? !NaverBookingComposition.widget(document) : NaverBookingStages.discover(document)?.stageKey!==stageKey));
    }
    if(await active())throw new Error('예약 입력 단계 수가 너무 많아 중지합니다.');
  };
  try {
    if (job.phase === 'booking') {
      if (job.manualContinuation) { await send('RESULT', {message:'예약 조건을 선택했습니다. 화면에서 나머지 항목과 예약 신청을 직접 완료하세요.'});return; }
      await continueFlow();
      return;
    }
    if (!await active()) return;
    if (/^\/booking\/6\//.test(expected.pathname) && globalThis.NaverBookingRestaurant && !NaverBookingRestaurant.isPage(document)) {
      await wait(() => NaverBookingRestaurant.isPage(document) || document.querySelector('.calendar_title, [data-date]') || job.dateSelector && document.querySelector(job.dateSelector.replaceAll('{date}',job.date).replaceAll('{day}',String(Number(job.date.slice(-2))))));
    }
    if (globalThis.NaverBookingRestaurant?.isPage(document)) {
      await NaverBookingRestaurant.scan(document, job, {active, send, continueFlow});return;
    }
    let partyApplied = false;
    if (job.partySize != null) partyApplied = await NaverBookingParty.apply(document, job.partySize, active, {required:false});
    if (/로그인이 필요|로그인해 주세요|자동입력 방지|캡차/.test(document.body.innerText)) { await send('RESULT', {message: '로그인 또는 인증이 필요합니다. 직접 처리 후 다시 시작하세요.'}); return; }
    const dateSelector = job.dateSelector?.replaceAll('{date}', job.date).replaceAll('{day}', String(Number(job.date.slice(-2)))) || `[data-date="${job.date}"], [aria-label="${job.date}"]`;
    const [year, month, day] = job.date.split('-').map(Number);
    const targetMonth = year * 12 + month;
    const calendarMonth = () => {
      const title = document.querySelector('.calendar_title');
      const match = title && text(title).match(/(20\d{2})\s*[.년/-]\s*(\d{1,2})/);
      return match ? Number(match[1]) * 12 + Number(match[2]) : null;
    };
    let date = await wait(() => {
      const direct = dateButton(document.querySelectorAll(dateSelector));
      if (direct || job.dateSelector) return direct;
      const displayedMonth = calendarMonth();
      const buttons = [...document.querySelectorAll('.calendar_table button.calendar_date')];
      const ready = displayedMonth !== null && buttons.some(el => visible(el) && /\d+/.test(el.querySelector('.num')?.textContent || '') && (displayedMonth !== targetMonth || Number(el.querySelector('.num').textContent) === day));
      return ready ? document.querySelector('.calendar_title') : null;
    });
    if (date && !job.dateSelector && date.matches('.calendar_title')) {
      date = null;
      for (let step = 0; step < 24; step++) {
        const title = document.querySelector('.calendar_title');
        const match = title && text(title).match(/(20\d{2})\s*[.년/-]\s*(\d{1,2})/);
        if (!match || !await active()) break;
        const currentMonth = Number(match[1]) * 12 + Number(match[2]);
        if (currentMonth === targetMonth) {
          date = await wait(() => calendarMonth() === targetMonth && dateButton(NaverBookingSlots.currentMonthDates(document.querySelectorAll('.calendar_table button.calendar_date')).filter(el => Number(el.querySelector('.num')?.textContent) === day)));
          break;
        }
        const direction = currentMonth < targetMonth ? '.btn_next' : '.btn_prev';
        const arrow = title.querySelector(direction);
        if (!arrow || !enabled(arrow)) break;
        const previous = text(title);
        arrow.click();
        const changed = await wait(() => calendarMonth() !== null && text(document.querySelector('.calendar_title') || title) !== previous && document.querySelector('.calendar_table button.calendar_date .num'));
        if (!changed) break;
      }
    }
    // A query parameter alone is not proof of the selected calendar date.
    if (!date) throw new Error('날짜 버튼이 준비되지 않아 예약 가능 여부를 확인하지 못했습니다. 화면을 확인한 뒤 다시 시작하세요.');
    if (!await active()) return;
    if (date.classList.contains('closed')) {
      await send('LOG', {message: '예약 불가'});return;
    }
    if (!enabled(date)) {
      await send('LOG', {message: '예약 불가'});return;
    }
    date.click();
    if (!job.dateSelector && date.matches('.calendar_date')) {
      const selected = await wait(() => document.querySelector('.calendar_date.selected .num')?.textContent.trim() === String(Number(job.date.slice(-2))));
      if (!selected) throw new Error('선택한 날짜를 확인하지 못했습니다.');
    }
    await new Promise(r => setTimeout(r, 700));
    let chosen;
    const slot = await wait(() => {
      const timeMode = job.timeMode || (job.times.length ? 'exact' : 'any');
      if (timeMode !== 'exact') {
        // Keep explicit time-only selectors; a {time} template requires a requested time.
        const selector = job.timeSelector && !job.timeSelector.includes('{time}') ? job.timeSelector : null;
        const nativeSlots = document.querySelectorAll('.time_area button.btn_time');
        const candidates = selector ? document.querySelectorAll(selector) : nativeSlots.length ? nativeSlots : document.querySelectorAll('button, a, [role="button"]');
        const found = [...candidates].find(el => enabled(el) && NaverBookingSlots.isAllowed(NaverBookingSlots.readTime(el), job) && !/마감|매진|불가/.test(text(el)));
        if (found) { chosen = NaverBookingSlots.readTime(found); return found; }
        return null;
      }
      for (const time of job.times) {
        const selector = job.timeSelector?.replaceAll('{time}', time);
        const nativeSlots = document.querySelectorAll('.time_area button.btn_time');
        const found = selector ? pick(selector) : nativeSlots.length
          ? unique([...nativeSlots].filter(el => NaverBookingSlots.readTime(el) === time))
          : pick(null, el => NaverBookingSlots.readTime(el) === time);
        if (found) {chosen = time; return found;}
      }
    });
    if (!slot) { await send('LOG', {message: '예약 불가'}); return; }
    await send('LOG', {message: `예약 가능: ${chosen}`});
    const claim = await send('CLAIM', {time: chosen});
    if (!claim?.ok || !await active()) return;
    slot.click();
    if(slot.matches('.btn_time') && !await wait(()=>[...document.querySelectorAll('.btn_time.selected')].some(el=>NaverBookingSlots.readTime(el)===chosen)))throw new Error('선택한 예약 시간을 확인하지 못했습니다.');
    if (job.partySize != null && !partyApplied) await NaverBookingParty.apply(document, job.partySize, active);
    // Discover product quantities separately; never use partySize for them.
    await wait(()=>NaverBookingStages.discover(document) || [...document.querySelectorAll('button[data-click-code="nextbuttonview.request"]')].some(enabled));
    const optionsApplied=await applyOptions();
    if(!optionsApplied && Object.keys(job.stagePreferences?.stages || {}).length)throw new Error('저장한 중간 옵션 화면이 나타나지 않았습니다. 다시 불러와 저장하세요.');
    const booking = await wait(() => pick(job.bookingSelector || (document.querySelector('[data-click-code="nextbuttonview.request"]') ? '[data-click-code="nextbuttonview.request"]' : null), el => /^(예약하기|예약|다음|다음단계)$/.test(text(el))));
    if (!booking) throw new Error('예약 진행 버튼을 찾지 못했습니다. 화면을 직접 확인하세요.');
    if (!await active()) return;
    booking.click();
    await continueFlow();
  } catch (error) { if(await active())await send('RESULT', {message: `안전 중지: ${error.message}`}); }
  finally {
    const schedule = await send('SCHEDULE').catch(() => null);
    if (schedule?.ok && schedule.nextJob) {
      await checkBookingDate(schedule.nextJob);
    } else if (schedule?.ok && schedule.nextCheckAt) {
      const recheck = async () => {
        const remaining = schedule.nextCheckAt - Date.now();
        if (remaining > 0) { setTimeout(recheck, remaining);return; }
        await send('RECHECK').catch(() => {});
      };
      setTimeout(recheck, Math.max(0, schedule.nextCheckAt - Date.now()));
    }
  }
}
(async () => {
  const {job,setup} = await chrome.runtime.sendMessage({type: 'CONTEXT'});
  if(setup?.active)await NaverBookingSetup.observe(setup);
  else if(job?.active)await checkBookingDate(job);
  else await NaverBookingForm.applyStandalone(document);
})();
