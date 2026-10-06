export function validate(input) {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || !['m.booking.naver.com', 'booking.naver.com'].includes(url.hostname) || !/^\/booking\//.test(url.pathname)) throw new Error('네이버 예약 HTTPS 주소를 입력하세요.');
  const dates = input.dates ?? [input.date];
  if (!Array.isArray(dates) || dates.length < 1 || dates.length > 5) throw new Error('날짜는 1~5개 선택하세요.');
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date) throw new Error('날짜를 확인하세요.');
  }
  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.length > 1 && input.dateSelector?.trim() && !/\{date\}|\{day\}/.test(input.dateSelector)) throw new Error('여러 날짜의 날짜 선택자에는 {date} 또는 {day}를 포함하세요. 기본 인식은 비워두세요.');
  if (!Array.isArray(input.times) || input.times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('시간은 09:00, 10:30 형식으로 입력하세요.');
  const interval = Number(input.interval);
  if (!Number.isFinite(interval) || interval < 15 || interval > 86400) throw new Error('확인 간격은 15~86400초입니다.');
  if (input.autoConfirm && !input.confirmSelector?.trim()) throw new Error('최종 확정 버튼 선택자가 필요합니다.');
  url.searchParams.set('startDate', uniqueDates[0]);
  return {...input, dates: uniqueDates, date: uniqueDates[0], dateIndex: 0, url: url.href, interval, times: [...new Set(input.times)]};
}
