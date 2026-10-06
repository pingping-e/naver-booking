async function checkBookingDate(job) {
  if (!job?.active || !['watching', 'booking'].includes(job.phase)) return;
  const expected = new URL(job.url);
  const requestPath = `${expected.pathname.replace(/\/$/, '')}/request`;
  if (location.origin !== expected.origin || ![expected.pathname, requestPath].includes(location.pathname)) return;
  if (job.phase === 'watching' && location.pathname !== expected.pathname) return;
  const send = (type, extra = {}) => chrome.runtime.sendMessage({type, id: job.id, date: job.date, scanId: job.scanId, ...extra});
  // The background validates tab identity before allowing any booking action.
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const enabled = el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[inert]') && !/(?:^|[ _-])(?:disabled|unselectable)(?:[ _-]|$)/i.test(el.className || '');
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const unique = list => { const items = [...list].filter(enabled); if (items.length > 1) throw new Error('같은 조건의 버튼이 여러 개입니다. 선택자를 더 구체적으로 지정하세요.'); return items[0]; };
  const pick = (selector, fallback) => unique(selector ? document.querySelectorAll(selector) : [...document.querySelectorAll('button, a, [role="button"]')].filter(fallback));
  const wait = async fn => { const deadline = Date.now() + 15000; do { const found = fn(); if (found) return found; await new Promise(r => setTimeout(r, 300)); } while (Date.now() < deadline); return null; };
  const active = async () => { const {job: latest} = await chrome.storage.local.get('job'); return latest?.id === job.id && latest.date === job.date && latest.scanId === job.scanId && latest.active; };
  const finishRequest = async () => {
    const current = new URL(location.href);
    const start = current.searchParams.get('startDateTime');
    if (location.pathname !== requestPath || (start && (!start.startsWith(`${job.date}T`) || (job.selectedTime && start.slice(11, 16) !== job.selectedTime)))) throw new Error('예약 신청 날짜/시간 또는 경로가 작업과 다릅니다.');
    const selector = job.confirmSelector || 'button[data-click-code="submitbutton.submit"]';
    const formReady = await wait(() => document.querySelector(selector) && document.querySelector('.booking_inner .form_title .necessary_text, input[required], select[required], textarea[required], [aria-required="true"]'));
    if (!formReady) throw new Error('추가정보 또는 예약 신청 버튼을 찾지 못했습니다. 화면을 직접 확인하세요.');
    const scope = expected.origin + expected.pathname.replace(/\/$/, '');
    const preferences = job.formPreferences?.scope === scope ? job.formPreferences.fields
      : /\/bizes\/1491414\/items\/7037654$/.test(expected.pathname) ? {treatment: job.treatment || '제모', source: job.source || '네이버 검색'} : null;
    if (!preferences) throw new Error('이 상품의 필수 입력을 최종 페이지에서 불러와 미리 설정하세요.');
    await NaverBookingForm.fill(document, preferences, active);
    if (!await active()) return;
    if (!job.autoConfirm) {
      await send('RESULT', {message: '추가정보 설정을 적용했습니다. 화면에서 확인 후 직접 예약 신청하세요.'});
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
  try {
    if (job.phase === 'booking') {
      if (location.pathname === requestPath) await finishRequest();
      return;
    }
    if (!await active()) return;
    if (/로그인이 필요|로그인해 주세요|자동입력 방지|캡차/.test(document.body.innerText)) { await send('RESULT', {message: '로그인 또는 인증이 필요합니다. 직접 처리 후 다시 시작하세요.'}); return; }
    const dateSelector = job.dateSelector?.replaceAll('{date}', job.date).replaceAll('{day}', String(Number(job.date.slice(-2)))) || `[data-date="${job.date}"], [aria-label="${job.date}"]`;
    let date = await wait(() => pick(dateSelector) || (!job.dateSelector && document.querySelector('.calendar_title')));
    if (date && !job.dateSelector && date.matches('.calendar_title')) {
      const [year, month, day] = job.date.split('-').map(Number);
      const targetMonth = year * 12 + month;
      date = null;
      for (let step = 0; step < 24; step++) {
        const title = document.querySelector('.calendar_title');
        const match = title && text(title).match(/(20\d{2})\s*[.년/-]\s*(\d{1,2})/);
        if (!match || !await active()) break;
        const currentMonth = Number(match[1]) * 12 + Number(match[2]);
        if (currentMonth === targetMonth) {
          date = unique([...document.querySelectorAll('.calendar_table button.calendar_date')].filter(el => Number(el.querySelector('.num')?.textContent) === day));
          break;
        }
        const direction = currentMonth < targetMonth ? '.btn_next' : '.btn_prev';
        const arrow = title.querySelector(direction);
        if (!arrow || !enabled(arrow)) break;
        const previous = text(title);
        arrow.click();
        const changed = await wait(() => text(document.querySelector('.calendar_title') || title) !== previous);
        if (!changed) break;
      }
    }
    // A query parameter alone is not proof of the selected calendar date.
    if (!date) { await send('LOG', {message: '날짜 버튼을 찾지 못했습니다. 날짜 선택자를 설정하세요.'}); return; }
    if (!await active()) return;
    date.click();
    if (!job.dateSelector && date.matches('.calendar_date')) {
      const selected = await wait(() => document.querySelector('.calendar_date.selected .num')?.textContent.trim() === String(Number(job.date.slice(-2))));
      if (!selected) throw new Error('선택한 날짜를 확인하지 못했습니다.');
    }
    if (date.classList.contains('closed')) {
      await send('LOG', {message: '해당 날짜는 마감 상태입니다.'});
      return;
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
    if (!slot) { await send('LOG', {message: '설정한 시간 조건에 맞는 예약 가능 시간이 없습니다.'}); return; }
    const claim = await send('CLAIM', {time: chosen});
    if (!claim?.ok || !await active()) return;
    slot.click();
    const booking = await wait(() => pick(job.bookingSelector || (document.querySelector('[data-click-code="nextbuttonview.request"]') ? '[data-click-code="nextbuttonview.request"]' : null), el => /^(예약하기|예약|다음|다음단계)$/.test(text(el))));
    if (!booking) throw new Error('예약 진행 버튼을 찾지 못했습니다. 화면을 직접 확인하세요.');
    if (!await active()) return;
    booking.click();
    // A new request document resumes from the stored booking phase.
    // Also handle SPA navigation when this document remains alive.
    const requestReady = await wait(() => location.pathname === requestPath && document.querySelector(job.confirmSelector || 'button[data-click-code="submitbutton.submit"]'));
    if (requestReady && await active()) await finishRequest();
    else if (await active()) await send('LOG', {message: '예약 신청 화면 또는 로그인을 기다리는 중입니다. 새로고침은 중단되어 있습니다.'});
  } catch (error) { await send('RESULT', {message: `안전 중지: ${error.message}`}); }
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
  const {job} = await chrome.runtime.sendMessage({type: 'CONTEXT'});
  await checkBookingDate(job);
})();
