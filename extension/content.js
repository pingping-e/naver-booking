(async () => {
  const {job} = await chrome.runtime.sendMessage({type: 'CONTEXT'});
  if (!job?.active || job.phase !== 'watching') return;
  const expected = new URL(job.url);
  if (location.origin !== expected.origin || location.pathname !== expected.pathname) return;
  const send = (type, extra = {}) => chrome.runtime.sendMessage({type, id: job.id, ...extra});
  // The background validates tab identity before allowing any booking action.
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const enabled = el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[inert]') && !/(?:^|[ _-])disabled(?:[ _-]|$)/i.test(el.className || '');
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const unique = list => { const items = [...list].filter(enabled); if (items.length > 1) throw new Error('같은 조건의 버튼이 여러 개입니다. 선택자를 더 구체적으로 지정하세요.'); return items[0]; };
  const pick = (selector, fallback) => unique(selector ? document.querySelectorAll(selector) : [...document.querySelectorAll('button, a, [role="button"]')].filter(fallback));
  const wait = async fn => { const deadline = Date.now() + 15000; do { const found = fn(); if (found) return found; await new Promise(r => setTimeout(r, 300)); } while (Date.now() < deadline); return null; };
  const active = async () => { const {job: latest} = await chrome.storage.local.get('job'); return latest?.id === job.id && latest.active; };
  try {
    await new Promise(r => setTimeout(r, 1500));
    if (/로그인이 필요|로그인해 주세요|자동입력 방지|캡차/.test(document.body.innerText)) { await send('RESULT', {message: '로그인 또는 인증이 필요합니다. 직접 처리 후 다시 시작하세요.'}); return; }
    const dateSelector = job.dateSelector || `[data-date="${job.date}"], [aria-label="${job.date}"]`;
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
    await new Promise(r => setTimeout(r, 700));
    let chosen;
    const slot = await wait(() => {
      for (const time of job.times) {
        const selector = job.timeSelector?.replaceAll('{time}', time);
        const found = pick(selector, el => text(el) === time);
        if (found) {chosen = time; return found;}
      }
    });
    if (!slot) { await send('LOG', {message: '원하는 시간의 활성 버튼 없음'}); return; }
    const claim = await send('CLAIM');
    if (!claim?.ok || !await active()) return;
    slot.click();
    const booking = await wait(() => pick(job.bookingSelector, el => /^(예약하기|예약|다음|다음단계)$/.test(text(el))));
    if (!booking) throw new Error('예약 진행 버튼을 찾지 못했습니다. 화면을 직접 확인하세요.');
    if (!await active()) return;
    booking.click();
    if (!job.autoConfirm) { await send('RESULT', {message: `${chosen} 예약 진행 버튼 클릭. 화면에서 내용을 확인하고 직접 확정하세요.`}); return; }
    const confirm = await wait(() => pick(job.confirmSelector));
    if (!confirm) throw new Error('최종 확정 버튼을 찾지 못했습니다. 자동 재시도 없이 중지합니다.');
    if (!await active()) return;
    confirm.click();
    await send('RESULT', {message: '최종 확정 버튼을 1회 클릭했습니다. 예약 내역에서 성공 여부를 확인하세요.'});
  } catch (error) { await send('RESULT', {message: `안전 중지: ${error.message}`}); }
})();
