import {validate} from './core.js';
const ALARM = 'booking-watch';
let queue = Promise.resolve();
function serialized(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; }
async function log(message) {
  const {logs = []} = await chrome.storage.local.get('logs');
  await chrome.storage.local.set({logs: [{at: new Date().toISOString(), message}, ...logs].slice(0, 60)});
}
async function stop(reason) {
  await chrome.alarms.clear(ALARM);
  const {job} = await chrome.storage.local.get('job');
  if (job) await chrome.storage.local.set({job: {...job, active: false, status: reason}});
  await log(reason);
}
async function refresh(job) {
  if (job.dates?.length > 1) {
    const dateIndex = ((job.dateIndex ?? 0) + 1) % job.dates.length;
    const date = job.dates[dateIndex];
    const url = new URL(job.url);
    url.searchParams.set('startDate', date);
    await chrome.storage.local.set({job: {...job, dateIndex, date, url: url.href, status: `감시 중: ${date} (${dateIndex + 1}/${job.dates.length})`}});
    try { await chrome.tabs.update(job.tabId, {url: url.href}); }
    catch { await stop('날짜 전환 실패 — 다시 시작하세요.'); }
  } else await chrome.tabs.reload(job.tabId);
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  serialized(async () => {
    if (msg.type === 'CONTEXT') {
      const {job} = await chrome.storage.local.get('job');
      return {ok: true, job: sender.tab?.id === job?.tabId ? job : null};
    } else if (msg.type === 'START') {
      const config = validate(msg.config);
      await stop('기존 감시 종료');
      const tab = await chrome.tabs.create({url: 'about:blank', active: true});
      const job = {...config, id: crypto.randomUUID(), tabId: tab.id, active: true, phase: 'watching', status: `감시 중: ${config.date} (1/${config.dates.length})`};
      await chrome.storage.local.set({job});
      // Chrome alarms cannot reliably schedule 15-second intervals.
      if (config.interval >= 30) await chrome.alarms.create(ALARM, {periodInMinutes: config.interval / 60});
      await chrome.tabs.update(tab.id, {url: config.url});
      await log('감시 시작');
    } else if (msg.type === 'STOP') await stop('사용자 중지');
    else if (msg.type === 'CLAIM') {
      const {job} = await chrome.storage.local.get('job');
      if (!job?.active || job.id !== msg.id || job.date !== msg.date || sender.tab?.id !== job.tabId || job.phase !== 'watching') return {ok: false};
      await chrome.storage.local.set({job: {...job, phase: 'booking', status: '예약 진행 중 — 새로고침 중단'}});
      await chrome.alarms.clear(ALARM);
      await log('시간 선택 완료, 예약 진행 잠금');
    } else if (msg.type === 'RECHECK') {
      const {job} = await chrome.storage.local.get('job');
      if (!job?.active || job.id !== msg.id || job.date !== msg.date || sender.tab?.id !== job.tabId || job.phase !== 'watching') return {ok: false};
      const current = new URL(sender.tab.url), expected = new URL(job.url);
      if (current.origin !== expected.origin || current.pathname !== expected.pathname) {
        await stop('다른 화면으로 이동하여 감시 중지');
        return {ok: false};
      }
      await refresh(job);
    } else if (msg.type === 'RESULT') {
      const {job} = await chrome.storage.local.get('job');
      if (job?.id === msg.id && job.date === msg.date && sender.tab?.id === job.tabId) await stop(msg.message);
    } else if (msg.type === 'LOG') {
      const {job} = await chrome.storage.local.get('job');
      if (job?.id === msg.id && job.date === msg.date && sender.tab?.id === job.tabId) await log(`${job.date || ''} ${msg.message}`.trim());
    }
    return {ok: true};
  }).then(respond, error => respond({ok: false, error: error.message}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => serialized(async () => {
  if (alarm.name !== ALARM) return;
  const {job} = await chrome.storage.local.get('job');
  if (!job?.active || job.phase !== 'watching') return;
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
