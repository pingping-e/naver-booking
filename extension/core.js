export function validate(input) {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || !['m.booking.naver.com', 'booking.naver.com'].includes(url.hostname) || !/^\/booking\//.test(url.pathname)) throw new Error('네이버 예약 HTTPS 주소를 입력하세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0,10) !== input.date) throw new Error('날짜를 확인하세요.');
  if (!Array.isArray(input.times) || input.times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('시간은 09:00, 10:30 형식으로 입력하세요.');
  const interval = Number(input.interval);
  if (!Number.isFinite(interval) || interval < 15 || interval > 86400) throw new Error('확인 간격은 15~86400초입니다.');
  if (input.autoConfirm && !input.confirmSelector?.trim()) throw new Error('최종 확정 버튼 선택자가 필요합니다.');
  url.searchParams.set('startDate', input.date);
  return {...input, url: url.href, interval, times: [...new Set(input.times)]};
}
