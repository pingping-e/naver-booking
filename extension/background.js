import {validate, isRequestUrl, nextInterval} from './core.js';
const ALARM = 'booking-watch';
let queue = Promise.resolve();
function serialized(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; }
async function log(message) {
  const {logs = []} = await chrome.storage.local.get('logs');
  await chrome.storage.local.set({logs: [{at: new Date().toISOString(), message}, ...logs].slice(0, 10)});
}
async function stop(reason) {
  await chrome.alarms.clear(ALARM);
  const {job} = await chrome.storage.local.get('job');
  if (job) await chrome.storage.local.set({job: {...job, active: false, status: reason}});
  await log(reason);
}
async function refresh(job) {
  await chrome.alarms.clear(ALARM);
  const date = job.dates?.[0] ?? job.date;
  const url = new URL(job.url);url.searchParams.set('startDate', date);
  const refreshed = {...job, dateIndex: 0, date, url: url.href, scanId: crypto.randomUUID(), checkStartedAt: Date.now(), nextCheckAt: null, status: `감시 중: ${date} (1/${job.dates?.length ?? 1})`};
  try {
    await chrome.storage.local.set({job: refreshed});
    await chrome.tabs.reload(job.tabId);
    return true;
  } catch {
    await stop('새로고침 또는 날짜 전환 실패 — 탭을 확인하고 다시 시작하세요.');
    return false;
  }
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  serialized(async () => {
    if (msg.type === 'PRUNE_LOGS') {
      const {logs = []} = await chrome.storage.local.get('logs');
      if (logs.length > 10) await chrome.storage.local.set({logs: logs.slice(0, 10)});
    } else if (msg.type === 'CONTEXT') {
      const {job} = await chrome.storage.local.get('job');
      return {ok: true, job: sender.tab?.id === job?.tabId ? job : null};
    } else if (msg.type === 'START') {
      const config = validate(msg.config);
      await stop('기존 감시 종료');
      const tab = await chrome.tabs.create({url: 'about:blank', active: true});
      const job = {...config, id: crypto.randomUUID(), scanId: crypto.randomUUID(), checkStartedAt: Date.now(), tabId: tab.id, active: true, phase: 'watching', status: `감시 중: ${config.date} (1/${config.dates.length})`};
      await chrome.storage.local.set({job});
      try { await chrome.tabs.update(tab.id, {url: config.url}); }
      catch { await stop('예약 페이지 열기 실패 — 주소와 탭을 확인하세요.');throw new Error('예약 페이지를 열지 못했습니다.'); }
      await log('감시 시작');
    } else if (msg.type === 'STOP') await stop('사용자 중지');
    else if (msg.type === 'CLAIM') {
      const {job} = await chrome.storage.local.get('job');
      if (!job?.active || job.id !== msg.id || job.date !== msg.date || job.scanId !== msg.scanId || sender.tab?.id !== job.tabId || job.phase !== 'watching') return {ok: false};
      await chrome.storage.local.set({job: {...job, phase: 'booking', selectedTime: msg.time, manualContinuation:msg.manualContinuation === true, status: '예약 진행 중 — 새로고침 중단'}});
      await chrome.alarms.clear(ALARM);
      await log('시간 선택 완료, 예약 진행 잠금');
    } else if (msg.type === 'FINAL_CLAIM') {
      const {job} = await chrome.storage.local.get('job');
      if (!job?.active || !job.autoConfirm || job.manualContinuation || job.phase !== 'booking' || job.id !== msg.id || job.date !== msg.date || job.scanId !== msg.scanId || sender.tab?.id !== job.tabId || !isRequestUrl(job, sender.tab.url)) return {ok: false};
      await chrome.storage.local.set({job: {...job, phase: 'submitting', status: '예약 신청 제출 중 — 재시도하지 않음'}});
      await log('최종 신청 버튼 1회 클릭 잠금');
    } else if (msg.type === 'SCHEDULE') {
      const {job} = await chrome.storage.local.get('job');
      if (!job?.active || job.phase !== 'watching' || job.id !== msg.id || job.date !== msg.date || job.scanId !== msg.scanId || sender.tab?.id !== job.tabId) return {ok: false};
      const current = new URL(sender.tab.url), expected = new URL(job.url);
      if (current.origin !== expected.origin || current.pathname !== expected.pathname) {
        await stop('다른 화면으로 이동하여 감시 중지');return {ok: false};
      }
      if (job.nextCheckAt) return {ok: true, nextCheckAt: job.nextCheckAt};
      if ((job.dateIndex ?? 0) < (job.dates?.length ?? 1) - 1) {
        const dateIndex = (job.dateIndex ?? 0) + 1;
        const date = job.dates[dateIndex];
        const nextJob = {...job, dateIndex, date, scanId: crypto.randomUUID(), nextCheckAt: null, status: `감시 중: ${date} (${dateIndex + 1}/${job.dates.length})`};
        await chrome.storage.local.set({job: nextJob});
        return {ok: true, nextJob}; // Continue selecting dates in the same document.
      }
      const seconds = nextInterval(job.intervalMin ?? job.interval, job.intervalMax ?? job.interval);
      const delay = seconds * 1000;
      const nextCheckAt = Date.now() + delay;
      await chrome.storage.local.set({job: {...job, lastInterval: seconds, nextCheckAt, status: `전체 날짜 확인 완료 — ${seconds}초 후 첫 날짜부터 다시 확인`}});
      await chrome.alarms.clear(ALARM);
      // One-shot alarms are a fallback; the tab timer handles sub-30-second waits.
      await chrome.alarms.create(ALARM, {when: Math.max(nextCheckAt, Date.now() + 30000)});
      await log(`전체 날짜 확인 완료, 다음 확인까지 ${seconds}초`);
      return {ok: true, nextCheckAt};
    } else if (msg.type === 'RECHECK') {
      const {job} = await chrome.storage.local.get('job');
      if (!job?.active || job.id !== msg.id || job.date !== msg.date || job.scanId !== msg.scanId || sender.tab?.id !== job.tabId || job.phase !== 'watching') return {ok: false};
      const current = new URL(sender.tab.url), expected = new URL(job.url);
      if (current.origin !== expected.origin || current.pathname !== expected.pathname) {
        await stop('다른 화면으로 이동하여 감시 중지');
        return {ok: false};
      }
      if (!job.nextCheckAt || Date.now() < job.nextCheckAt) return {ok: false};
      if (!await refresh(job)) return {ok: false, error: '새로고침 실패'};
    } else if (msg.type === 'RESULT') {
      const {job} = await chrome.storage.local.get('job');
      if (job?.id === msg.id && job.date === msg.date && job.scanId === msg.scanId && sender.tab?.id === job.tabId) await stop(msg.message);
    } else if (msg.type === 'LOG') {
      const {job} = await chrome.storage.local.get('job');
      if (job?.id === msg.id && job.date === msg.date && job.scanId === msg.scanId && sender.tab?.id === job.tabId) await log(`${job.date || ''} ${msg.message}`.trim());
    }
    return {ok: true};
  }).then(respond, error => respond({ok: false, error: error.message}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => serialized(async () => {
  if (alarm.name !== ALARM) return;
  const {job} = await chrome.storage.local.get('job');
  if (!job?.active || job.phase !== 'watching' || !job.nextCheckAt || Date.now() < job.nextCheckAt) return;
  try {
    const tab = await chrome.tabs.get(job.tabId);
    const current = new URL(tab.url), expected = new URL(job.url);
    if (current.origin !== expected.origin || current.pathname !== expected.pathname) return stop('다른 화면으로 이동하여 감시 중지');
    await refresh(job);
  } catch { await stop('예약 탭이 없어 감시 중지'); }
}));
chrome.tabs.onRemoved.addListener(tabId => serialized(async () => {
  const {job} = await chrome.storage.local.get('job');
  if (job?.active && job.tabId === tabId) await stop('예약 탭 닫힘');
}));
chrome.runtime.onStartup.addListener(() => serialized(() => stop('브라우저 재시작 — 설정 확인 후 다시 시작하세요')));
