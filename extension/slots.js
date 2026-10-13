// A classic content script shared with DOM-independent tests.
globalThis.NaverBookingSlots = {
  currentMonthDates(elements) {
    const buttons=[...elements],days=buttons.map(el=>Number(el.querySelector('.num')?.textContent));
    const first=days.indexOf(1);
    if(first<0){if(buttons.length>7)throw new Error('달력의 월 경계를 확인하지 못했습니다.');return buttons;}
    const next=days.indexOf(1,first+1),end=next<0?days.length:next;
    const current=buttons.slice(first,end);
    if(current.some((el,i)=>days[first+i]!==i+1))throw new Error('달력 날짜 순서가 변경되었습니다.');
    return current;
  },
  parseTime(value, period = '') {
    const match = value.trim().match(/^(?:(오전|오후)\s*)?(\d{1,2}):([0-5]\d)(?:\s*(?:예약\s*가능|가능|잔여\s*\d+.*))?$/);
    if (!match) return null;
    let hour = Number(match[2]);
    const meridiem = match[1] || (/^(오전|AM)$/i.test(period.trim()) ? '오전' : /^(오후|PM)$/i.test(period.trim()) ? '오후' : '');
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (meridiem === '오후' ? 12 : 0);
    } else if (hour > 23) return null;
    return `${String(hour).padStart(2, '0')}:${match[3]}`;
  },
  isAllowed(time, settings) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return false;
    const mode = settings.timeMode || (settings.times?.length ? 'exact' : 'any');
    if (mode === 'any') return true;
    if (mode === 'exact') return settings.times?.includes(time) || false;
    if (mode === 'after') return !!settings.timeStart && time >= settings.timeStart;
    if (mode === 'range') return !!settings.timeStart && !!settings.timeEnd && time >= settings.timeStart && time <= settings.timeEnd;
    return false;
  },
  readTime(element) {
    const list = element.closest('.time_list');
    const title = list?.previousElementSibling;
    const period = title?.matches('.time_title') ? title.textContent.trim() : '';
    return this.parseTime((element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(), period);
  }
};
