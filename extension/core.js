import {stageKey} from './preflight.js';
export function validate(input) {
  if(input.autoConfirm!==undefined && typeof input.autoConfirm!=='boolean')throw new Error('자동 신청 설정은 체크박스로 지정하세요.');
  const url = new URL(input.url);
  const product=url.pathname.match(/^(\/booking\/\d+\/bizes\/\d+\/items\/\d+)(?:\/request(?:\/link)?)?\/?$/);
  if (url.protocol !== 'https:' || !['m.booking.naver.com', 'booking.naver.com'].includes(url.hostname) || url.username || url.password || !product) throw new Error('네이버 예약 상품 HTTPS 주소를 입력하세요.');
  if(url.pathname!==product[1]){url.pathname=product[1];url.search='';}
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
  const partySize = input.partySize == null || String(input.partySize).trim() === '' ? null : Number(input.partySize);
  if (partySize !== null && (!Number.isInteger(partySize) || partySize < 1 || partySize > 100)) throw new Error('예약 인원은 1~100명 사이의 정수로 입력하거나 비워 두세요.');
  const scope = url.origin + url.pathname.replace(/\/$/, '');
  let partyComposition = null;
  if (input.partyComposition != null) {
    const profile=input.partyComposition;
    if (profile.scope!==scope || !Array.isArray(profile.counts) || !profile.counts.length || profile.counts.length>20) throw new Error('이 상품의 인원 구성을 화면에서 다시 불러오세요.');
    const seen=new Set();
    const counts=profile.counts.map(({label,count})=>{
      if (typeof label!=='string' || !label.trim() || seen.has(label) || count==null || String(count).trim()==='' || !Number.isInteger(Number(count)) || Number(count)<0 || Number(count)>100) throw new Error('인원 구성은 항목별로 0~100명의 정수로 입력하세요.');
      seen.add(label);return {label,count:Number(count)};
    });
    if (partySize==null || counts.reduce((sum,item)=>sum+item.count,0)!==partySize) throw new Error('인원 구성의 합계가 예약 인원과 같아야 합니다.');
    partyComposition={scope,counts};
  }
  const interval = intervalMin;
  const formPreferences = input.formPreferences || null;
  if (formPreferences && (formPreferences.scope!==scope || !Array.isArray(formPreferences.fields) || formPreferences.fields.length>50)) throw new Error('현재 상품의 최종 추가정보를 다시 불러오세요.');
  let stagePreferences = input.stagePreferences || null;
  if(stagePreferences) {
    if(stagePreferences.scope!==scope || !stagePreferences.stages || typeof stagePreferences.stages!=='object' || Array.isArray(stagePreferences.stages))throw new Error('현재 상품의 중간 단계 설정을 다시 불러오세요.');
    const stages=Object.entries(stagePreferences.stages);
    if(stages.length>20 || stages.some(([key,stage])=>stage.scope!==scope || stage.stageKey!==key || !Array.isArray(stage.fields) || !stage.fields.length || stage.fields.length>50))throw new Error('중간 단계 설정 형식이 올바르지 않습니다.');
    const normalized={};
    for(const [,stage] of stages){
      const key=stageKey(stage.fields);
      if(normalized[key] && JSON.stringify(normalized[key].fields)!==JSON.stringify(stage.fields))throw new Error('같은 중간 항목에 서로 다른 설정이 저장되어 있습니다. 단계 설정을 확인하세요.');
      normalized[key]={...stage,stageKey:key};
    }
    stagePreferences={...stagePreferences,stages:normalized};
  }
  url.searchParams.set('startDate', uniqueDates[0]);
  if (/^\/booking\/6\//.test(url.pathname)) url.searchParams.delete('gbwState');
  return {...input, partySize, partyComposition, usePartyComposition:partyComposition!==null, timeMode, formPreferences, stagePreferences, dates: uniqueDates, date: uniqueDates[0], dateIndex: 0, url: url.href, interval, intervalMin, intervalMax, times: [...new Set(input.times)]};
}

export function isRequestUrl(job, value) {
  try {
    const current = new URL(value), expected = new URL(job.url);
    if (current.origin !== expected.origin || ![`${expected.pathname.replace(/\/$/, '')}/request`, `${expected.pathname.replace(/\/$/, '')}/request/link`].includes(current.pathname)) return false;
    const start = current.searchParams.get('startDateTime');
    return !start || (start.startsWith(`${job.date}T`) && (!job.selectedTime || start.slice(11,16) === job.selectedTime));
  } catch {return false;}
}

export function nextInterval(min, max, random = Math.random) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 5 || max < min) throw new Error('잘못된 새로고침 범위입니다.');
  return min + Math.floor(random() * (max - min + 1));
}
