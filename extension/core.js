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
  const timeMode = input.timeMode || (input.times.length ? 'exact' : 'any');
  if (!['any', 'exact', 'after', 'range'].includes(timeMode)) throw new Error('시간 조건을 선택하세요.');
  if (timeMode === 'exact' && !input.times.length) throw new Error('특정 시간을 하나 이상 추가하세요.');
  const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
  if (['after', 'range'].includes(timeMode) && !validTime(input.timeStart)) throw new Error('시작 시간을 선택하세요.');
  if (timeMode === 'range' && (!validTime(input.timeEnd) || input.timeEnd < input.timeStart)) throw new Error('종료 시간은 시작 시간 이후로 선택하세요.');
  let intervalMin, intervalMax;
  if (input.intervalExtra !== undefined) {
    intervalMin = Number(input.intervalMin);
    const extra = Number(input.intervalExtra);
    if (input.intervalMin === '' || !Number.isInteger(intervalMin) || intervalMin < 5 || intervalMin > 120) throw new Error('최소 시간은 5~120초의 정수로 입력하세요.');
    if (input.intervalExtra === '' || !Number.isInteger(extra) || extra < 0 || extra > 120) throw new Error('추가 범위는 0~120초의 정수로 입력하세요.');
    intervalMax = intervalMin + extra;
  } else if (input.intervalMin !== undefined || input.intervalMax !== undefined) {
    intervalMin = Number(input.intervalMin);intervalMax = Number(input.intervalMax);
    if (!Number.isInteger(intervalMin) || intervalMin < 5 || ![15,30,60,90,120].includes(intervalMax) || intervalMin > intervalMax) throw new Error('최소 시간은 5초 이상, 최대 시간 이하로 지정하고 최대 시간은 15·30·60·90·120초 중에서 선택하세요.');
  } else if (input.intervalPreset) {
    const presets = {'15-30': [15,30], '30-60': [30,60], '60-90': [60,90], '90-180': [90,180]};
    if (!presets[input.intervalPreset]) throw new Error('새로고침 시간 범위를 선택하세요.');
    [intervalMin, intervalMax] = presets[input.intervalPreset];
  } else {
    const interval = Number(input.interval);
    if (!Number.isFinite(interval) || interval < 15 || interval > 86400) throw new Error('확인 간격은 15~86400초입니다.');
    intervalMin = intervalMax = interval;
  }
  const interval = intervalMin;
  const treatment = input.treatment?.trim() || '제모';
  const source = input.source?.trim() || '네이버 검색';
  const scope = url.origin + url.pathname.replace(/\/$/, '');
  const formPreferences = input.formPreferences?.scope === scope ? input.formPreferences : null;
  if (formPreferences && (!Array.isArray(formPreferences.fields) || formPreferences.fields.length > 50)) throw new Error('필수 입력 설정을 다시 불러오세요.');
  url.searchParams.set('startDate', uniqueDates[0]);
  return {...input, timeMode, treatment, source, formPreferences, dates: uniqueDates, date: uniqueDates[0], dateIndex: 0, url: url.href, interval, intervalMin, intervalMax, times: [...new Set(input.times)]};
}

export function isRequestUrl(job, value) {
  try {
    const current = new URL(value), expected = new URL(job.url);
    if (current.origin !== expected.origin || current.pathname !== `${expected.pathname.replace(/\/$/, '')}/request`) return false;
    const start = current.searchParams.get('startDateTime');
    return !start || (start.startsWith(`${job.date}T`) && (!job.selectedTime || start.slice(11,16) === job.selectedTime));
  } catch {return false;}
}

export function nextInterval(min, max, random = Math.random) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 5 || max < min) throw new Error('잘못된 새로고침 범위입니다.');
  return min + Math.floor(random() * (max - min + 1));
}
