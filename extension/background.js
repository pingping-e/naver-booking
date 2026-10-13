import {validate, isRequestUrl, nextInterval,todayInKorea} from './core.js';
import {preflight,stepSchema} from './preflight.js';
import {notificationSounds,soundChoice} from './notification-sounds.js';
import {playNotificationSound} from './notification-audio.js';
const ALARM = 'booking-watch';
const LOAD_RETRY_LIMIT=2,LOAD_RETRY_DELAY=5000;
let queue = Promise.resolve();
function serialized(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; }
async function log(message) {
  const {logs = []} = await chrome.storage.local.get('logs');
  await chrome.storage.local.set({logs: [{at: new Date().toISOString(), message}, ...logs].slice(0, 10)});
}
async function desktopNotification(id,title,message,kind) {
  let diagnostic;
  try {
    if(!chrome.notifications?.create)throw new Error('알림 권한이 없습니다. 최신 확장을 다시 로드하고 추가 권한을 허용하세요.');
    const permission=await chrome.notifications.getPermissionLevel();
    if(permission==='denied')diagnostic={status:'blocked',detail:'Chrome에서 확장 프로그램 알림이 차단되어 있습니다.'};
    else {
      await chrome.notifications.create(id,{type:'basic',iconUrl:chrome.runtime.getURL('icons/icon-128.png'),title,message,silent:true});
      diagnostic={status:'requested',detail:'Chrome에 알림 요청을 보냈습니다. 표시되지 않으면 시스템의 Chrome 알림 배너와 집중 모드를 확인하세요.'};
    }
  }catch(error){diagnostic={status:'failed',detail:String(error.message || error).slice(0,300)};}
  try {
    const {notificationSettings}=await chrome.storage.local.get('notificationSettings');
    await playNotificationSound(soundChoice(notificationSettings));
  }catch(error){diagnostic.detail+=` 소리 재생 실패: ${String(error.message || error).slice(0,200)}`;}
  await chrome.storage.local.set({notificationDiagnostics:{...diagnostic,kind,at:new Date().toISOString()}});
  return diagnostic;
}
async function stop(reason) {
  await chrome.alarms.clear(ALARM);
  const {job} = await chrome.storage.local.get('job');
  if (job) await chrome.storage.local.set({job: {...job, active: false, status: reason}});
  await log(reason);
}
async function refresh(job) {
  await chrome.alarms.clear(ALARM);
  const dates=(job.dates || [job.date]).filter(date=>date>=todayInKorea());
  if(!dates.length){await stop('등록한 날짜가 모두 지나 감시를 종료했습니다.');return false;}
  const date = dates[0];
  const url = new URL(job.url);url.searchParams.set('startDate', date);
  const refreshed = {...job,dates,dateIndex: 0, date, url: url.href, scanId: crypto.randomUUID(), checkStartedAt: Date.now(), nextCheckAt: null, status: `감시 중: ${date} (1/${dates.length})`};
  try {
    await chrome.storage.local.set({job: refreshed});
    if(date!==(job.dates?.[0] ?? job.date))await chrome.tabs.update(job.tabId,{url:url.href});
    else await chrome.tabs.reload(job.tabId);
    return true;
  } catch {
    await stop('새로고침 또는 날짜 전환 실패 — 탭을 확인하고 다시 시작하세요.');
    return false;
  }
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if(msg.target==='notification-audio')return false;
  serialized(async () => {
    if(msg.type==='SAVE_NOTIFICATION_SETTINGS') {
      if(!Object.hasOwn(notificationSounds,msg.sound))throw new Error('알림 소리를 선택하세요.');
      await chrome.storage.local.set({notificationSettings:{sound:msg.sound}});
    } else if(msg.type==='PREVIEW_NOTIFICATION_SOUND') {
      await playNotificationSound(msg.sound);
    } else if(msg.type==='TEST_NOTIFICATION') {
      const result=await desktopNotification(`booking-notification-test-${crypto.randomUUID()}`,'알림 테스트','이 알림이 보이면 최종 신청 화면 도착 알림도 표시할 수 있습니다.','test');
      return {ok:result.status==='requested',...result};
    } else if (msg.type === 'SAVE_SCHEDULE_DRAFT') {
      const draft=msg.draft;
      if(!draft || !Array.isArray(draft.dates) || draft.dates.length<1 || draft.dates.length>5 || draft.dates.some(value=>typeof value!=='string') || !Array.isArray(draft.times) || draft.times.length>100 || draft.times.some(value=>typeof value!=='string') || !['any','exact','after','range'].includes(draft.timeMode))throw new Error('날짜·시간 설정을 저장하지 못했습니다.');
      await chrome.storage.local.set({scheduleDraft:{dates:[...draft.dates],times:[...draft.times],timeMode:draft.timeMode,timeStart:String(draft.timeStart || ''),timeEnd:String(draft.timeEnd || ''),timePicker:String(draft.timePicker || '')}});
    } else if (msg.type === 'PRUNE_LOGS') {
      const {logs = []} = await chrome.storage.local.get('logs');
      if (logs.length > 10) await chrome.storage.local.set({logs: logs.slice(0, 10)});
    } else if (msg.type === 'CONTEXT') {
      const {job,setup} = await chrome.storage.local.get(['job','setup']);
      return {ok: true, job: sender.tab?.id === job?.tabId ? job : null,setup:setup?.active && sender.tab?.id===setup.tabId ? setup : null};
    } else if(msg.type==='SETUP_START') {
      const url=new URL(msg.scope);
      if(url.protocol!=='https:' || !['booking.naver.com','m.booking.naver.com'].includes(url.hostname) || !/^\/booking\/\d+\/bizes\/\d+\/items\/\d+$/.test(url.pathname))throw new Error('예약 상품 주소를 입력하세요.');
      const scope=url.origin+url.pathname;
      await stop('사전 설정 시작 — 감시 중지');
      const tab=await chrome.tabs.create({url:'about:blank',active:true});
      const setup={id:crypto.randomUUID(),scope,tabId:tab.id,active:true};
      const {setupProfiles={},config:latestConfig={}}=await chrome.storage.local.get(['setupProfiles','config']);
      await chrome.storage.local.set({setup,config:{...latestConfig,url:scope},setupProfiles:{...setupProfiles,[scope]:{scope,id:setup.id,steps:[],complete:false}}});
      await chrome.tabs.update(tab.id,{url:scope});
    } else if(msg.type==='SETUP_SELECTORS') {
      const {setup,setupProfiles={}}=await chrome.storage.local.get(['setup','setupProfiles']);
      if(!setup?.active || setup.id!==msg.id || setup.scope!==msg.scope || sender.tab?.id!==setup.tabId)return {ok:false};
      const source=new URL(sender.tab.url),base=new URL(setup.scope);
      if(source.origin!==base.origin || source.pathname!==base.pathname)return {ok:false};
      const selectors=msg.selectors;
      if(!selectors || !Object.keys(selectors).length || Object.entries(selectors).some(([key,value])=>!['dateSelector','timeSelector','bookingSelector'].includes(key) || typeof value!=='string' || !value || value.length>500 || key!=='bookingSelector' && !value.includes(key==='dateSelector' ? '{date}' : '{time}')))throw new Error('자동 인식 설정 형식이 올바르지 않습니다.');
      const plan=setupProfiles[setup.scope];if(!plan || plan.id!==setup.id)return {ok:false};
      const {bookingSelector,...dateTimeSelectors}=selectors;
      if(bookingSelector && !plan.steps.some(step=>step.stage!=='final' && step.stageKey===msg.stageKey))return {ok:false};
      await chrome.storage.local.set({setupProfiles:{...setupProfiles,[setup.scope]:{...plan,selectors:{...plan.selectors,...dateTimeSelectors},...(bookingSelector ? {nextSelectors:{...plan.nextSelectors,[msg.stageKey]:bookingSelector}} : {})}}});
    } else if(msg.type==='SETUP_STAGE') {
      const {setup,setupProfiles={}}=await chrome.storage.local.get(['setup','setupProfiles']);
      if(!setup?.active || setup.id!==msg.id || setup.scope!==msg.scope || sender.tab?.id!==setup.tabId)return {ok:false};
      const source=new URL(sender.tab.url),base=new URL(setup.scope);
      if(source.origin!==base.origin || ![base.pathname,base.pathname+'/request',base.pathname+'/request/link'].includes(source.pathname))return {ok:false};
      const step=msg.step;
      if(!step || !['composition','options','final'].includes(step.stage) || typeof step.stageKey!=='string' || !Array.isArray(step.fields) || step.fields.length>50)throw new Error('단계 항목 형식이 올바르지 않습니다.');
      const plan=setupProfiles[setup.scope];
      if(!plan || plan.id!==setup.id)return {ok:false};
      const index=plan.steps.findIndex(s=>s.stageKey===step.stageKey);
      if(index>=0 && stepSchema(plan.steps[index])!==stepSchema(step))throw new Error('같은 단계 식별값에 서로 다른 항목 또는 선택지가 나타났습니다. 단계를 구분하지 못해 중지합니다.');
      const steps=[...plan.steps];if(index>=0)steps[index]=step;else steps.push(step);
      if(steps.length>20)throw new Error('사전 설정 단계가 20개를 초과했습니다. 경로를 확인하세요.');
      await chrome.storage.local.set({setup:{...setup,currentStep:step,error:null},setupProfiles:{...setupProfiles,[setup.scope]:{...plan,steps,complete:step.stage==='final' || plan.complete}}});
    } else if(msg.type==='SETUP_ERROR') {
      const {setup}=await chrome.storage.local.get('setup');
      if(!setup?.active || setup.id!==msg.id || sender.tab?.id!==setup.tabId)return {ok:false};
      const source=new URL(sender.tab.url),base=new URL(setup.scope);
      if(source.origin!==base.origin || ![base.pathname,base.pathname+'/request',base.pathname+'/request/link'].includes(source.pathname))return {ok:false};
      await chrome.storage.local.set({setup:{...setup,currentStep:null,error:String(msg.error || '화면을 읽지 못했습니다.').slice(0,500)}});
    } else if (msg.type === 'START') {
      let config = validate(msg.config);
      const scope=new URL(config.url).origin+new URL(config.url).pathname;
      const {setupProfiles={},setup}=await chrome.storage.local.get(['setupProfiles','setup']);
      const plan=setupProfiles[scope],missing=preflight(plan,config).filter(s=>!s.ready);
      // The popup supplies no manual selectors. Apply only this product's learned overrides.
      if(plan?.selectors)config=validate({...config,...plan.selectors});
      if(plan && (!plan.complete || missing.length))throw new Error(!plan.complete ? '사전 설정에서 마지막 화면까지 먼저 확인하세요.' : `사전 설정 미완료: ${missing.map(s=>s.title+' — '+s.error).join(' / ')}`);
      if(plan && config.stagePreferences)config.stagePreferences={...config.stagePreferences,stages:Object.fromEntries(Object.entries(config.stagePreferences.stages).filter(([key])=>plan.steps.some(s=>s.stage==='options' && s.stageKey===key)))};
      if(setup?.active)await chrome.storage.local.set({setup:{...setup,active:false}});
      await stop('기존 감시 종료');
      const tab = await chrome.tabs.create({url: 'about:blank', active: true});
      const job = {...config, setupPlan:plan || null,routeIndex:0,completedStages:[],compositionApplied:false,manualContinuation:false,selectedTime:null,loadRetryCount:0,id: crypto.randomUUID(), scanId: crypto.randomUUID(), checkStartedAt: Date.now(), tabId: tab.id, active: true, phase: 'watching', status: `감시 중: ${config.date} (1/${config.dates.length})`};
      await chrome.storage.local.set({job});
      try { await chrome.tabs.update(tab.id, {url: config.url}); }
      catch { await stop('예약 페이지 열기 실패 — 주소와 탭을 확인하세요.');throw new Error('예약 페이지를 열지 못했습니다.'); }
      await log('감시 시작');
    } else if (msg.type === 'STOP') {
      await stop('사용자 중지');
      const {setup}=await chrome.storage.local.get('setup');if(setup)await chrome.storage.local.set({setup:{...setup,active:false}});
    }
    else if (msg.type === 'CLAIM') {
      const {job} = await chrome.storage.local.get('job');
      if (!job?.active || job.id !== msg.id || job.date !== msg.date || job.scanId !== msg.scanId || sender.tab?.id !== job.tabId || job.phase !== 'watching') return {ok: false};
      if(job.date<todayInKorea()){await refresh(job);return {ok:false};}
      await chrome.storage.local.set({job: {...job, phase: 'booking', selectedTime: msg.time, manualContinuation:msg.manualContinuation === true, status: '예약 진행 중 — 새로고침 중단'}});
      await chrome.alarms.clear(ALARM);
      await log('시간 선택 완료, 예약 진행 잠금');
    } else if(msg.type==='STAGE_SEEN') {
      const {job}=await chrome.storage.local.get('job');
      if(!job?.active || job.phase!=='booking' || job.id!==msg.id || job.date!==msg.date || job.scanId!==msg.scanId || sender.tab?.id!==job.tabId)return {ok:false};
      if(!job.setupPlan)return {ok:true};
      const index=job.routeIndex || 0,expected=job.setupPlan.steps[index],previous=job.setupPlan.steps[index-1];
      if(previous?.stageKey===msg.step?.stageKey && stepSchema(previous)===stepSchema(msg.step))return {ok:true};
      if(!expected || expected.stageKey!==msg.step?.stageKey || stepSchema(expected)!==stepSchema(msg.step))return {ok:false,error:`사전 확인한 ${expected?.title || '경로 끝'} 단계와 현재 항목이 다릅니다. 전체 경로 사전 설정을 다시 진행하세요.`};
      await chrome.storage.local.set({job:{...job,routeIndex:index+1}});
    } else if (msg.type === 'STAGE_DONE') {
      const {job}=await chrome.storage.local.get('job');
      if(!job?.active || job.phase!=='booking' || job.id!==msg.id || job.date!==msg.date || job.scanId!==msg.scanId || sender.tab?.id!==job.tabId)return {ok:false};
      if(msg.composition===true && job.partyComposition)await chrome.storage.local.set({job:{...job,compositionApplied:true}});
      else if(typeof msg.stageKey==='string' && job.stagePreferences?.stages?.[msg.stageKey])await chrome.storage.local.set({job:{...job,completedStages:[...new Set([...(job.completedStages || []),msg.stageKey])]}});
      else return {ok:false};
    } else if (msg.type === 'FINAL_SCREEN') {
      const {job}=await chrome.storage.local.get('job');
      if(!job?.active || job.phase!=='booking' || job.id!==msg.id || job.date!==msg.date || job.scanId!==msg.scanId || sender.tab?.id!==job.tabId)return {ok:false,error:'진행 중인 예약의 날짜·탭·작업 정보가 알림 요청과 다릅니다.'};
      if(sender.frameId!==undefined && sender.frameId!==0)return {ok:false,error:'최종 신청 화면이 아닌 하위 프레임의 알림 요청입니다.'};
      // Both browser URL snapshots can lag behind history.pushState. Accept the
      // content's current URL only from the designated product's top-level document.
      const trustedUrl=new URL(sender.url || sender.tab.url),product=new URL(job.url);
      const base=product.pathname.replace(/\/$/,'');
      if(trustedUrl.origin!==product.origin || ![base,base+'/request',base+'/request/link'].includes(trustedUrl.pathname))return {ok:false,error:'알림 요청을 보낸 문서가 예약 상품과 다릅니다.'};
      const sourceUrl=msg.requestUrl || trustedUrl.href;
      const dateOnly=/^\/booking\/12\//.test(new URL(job.url).pathname) && new URL(sourceUrl).searchParams.get('startDateTime')?.slice(11,16)==='00:00';
      if(!isRequestUrl(dateOnly ? {...job,selectedTime:null} : job,sourceUrl)) {
        const detail='최종 화면 알림 요청의 페이지 주소가 예약 조건과 달라 알림을 보내지 않았습니다. 예약 탭을 새로고침한 뒤 감시를 다시 시작하세요.';
        await chrome.storage.local.set({notificationDiagnostics:{status:'rejected',detail,kind:'final',at:new Date().toISOString()}});
        await log(detail);
        return {ok:false,error:detail,logged:true};
      }
      if(job.finalScreenNotified)return {ok:true,notificationStatus:'already-requested'};
      // Persist before displaying so repeated content runs cannot duplicate the alert.
      await chrome.storage.local.set({job:{...job,finalScreenNotified:true}});
      const result=await desktopNotification(`booking-final-${job.id}`,'예약 가능한 시간을 찾았습니다',`${job.date}${job.selectedTime ? ' '+job.selectedTime : ''}\n최종 신청 화면에 도착했습니다.`,'final');
      await log(result.status==='requested' ? '최종 화면 도착 — Chrome에 알림 요청을 보냈습니다.' : `최종 화면 알림 표시 실패: ${result.detail}`);
      return {ok:true,notificationStatus:result.status};
    } else if (msg.type === 'FINAL_CLAIM') {
      const {job} = await chrome.storage.local.get('job');
      if (!job?.active || !job.autoConfirm || job.manualContinuation || job.phase !== 'booking' || job.id !== msg.id || job.date !== msg.date || job.scanId !== msg.scanId || sender.tab?.id !== job.tabId || !isRequestUrl(job, sender.tab.url)) return {ok: false};
      if(job.date<todayInKorea()){await stop('예약 날짜가 지나 최종 신청을 중지했습니다.');return {ok:false};}
      await chrome.storage.local.set({job: {...job, phase: 'submitting', status: '예약 신청 제출 중 — 재시도하지 않음'}});
      await log('최종 신청 버튼 1회 클릭 잠금');
    } else if(msg.type==='RETRY_LOAD') {
      const {job}=await chrome.storage.local.get('job');
      if(!job?.active || job.phase!=='watching' || job.id!==msg.id || job.date!==msg.date || job.scanId!==msg.scanId || sender.tab?.id!==job.tabId || msg.code!=='BOOKING_LOAD_TIMEOUT')return {ok:false};
      const source=new URL(sender.url || sender.tab.url),expected=new URL(job.url);
      if(source.origin!==expected.origin || source.pathname!==expected.pathname)return {ok:false};
      if(job.date<todayInKorea()){await refresh(job);return {ok:true,handled:true};}
      if(job.nextCheckAt)return {ok:true,handled:true,nextCheckAt:job.nextCheckAt};
      const count=Number(job.loadRetryCount || 0);
      if(count>=LOAD_RETRY_LIMIT){await stop('화면 로딩 재시도 2회 후에도 확인하지 못해 감시를 중지했습니다.');return {ok:true,handled:true};}
      const nextCheckAt=Date.now()+LOAD_RETRY_DELAY;
      await chrome.storage.local.set({job:{...job,loadRetryCount:count+1,nextCheckAt,status:`화면 로딩 지연 — 약 5초 후 재시도 (${count+1}/${LOAD_RETRY_LIMIT})`}});
      await chrome.alarms.create(ALARM,{when:Math.max(nextCheckAt,Date.now()+30000)});
      await log(`${job.date} 화면 로딩 지연 — 약 5초 후 재시도 (${count+1}/${LOAD_RETRY_LIMIT})`);
      return {ok:true,handled:true,nextCheckAt};
    } else if (msg.type === 'SCHEDULE') {
      const {job} = await chrome.storage.local.get('job');
      if (!job?.active || job.phase !== 'watching' || job.id !== msg.id || job.date !== msg.date || job.scanId !== msg.scanId || sender.tab?.id !== job.tabId) return {ok: false};
      const current = new URL(sender.tab.url), expected = new URL(job.url);
      if (current.origin !== expected.origin || current.pathname !== expected.pathname) {
        await stop('다른 화면으로 이동하여 감시 중지');return {ok: false};
      }
      if(job.date<todayInKorea()){await refresh(job);return {ok:true};}
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
      await chrome.storage.local.set({job: {...job,loadRetryCount:0,lastInterval: seconds, nextCheckAt, status: `전체 날짜 확인 완료 — ${seconds}초 후 첫 날짜부터 다시 확인`}});
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
  const {job,setup} = await chrome.storage.local.get(['job','setup']);
  if(setup?.tabId===tabId)await chrome.storage.local.set({setup:{...setup,active:false}});
  if (job?.active && job.tabId === tabId) await stop('예약 탭 닫힘');
}));
chrome.runtime.onStartup.addListener(() => serialized(async()=>{
  await stop('브라우저 재시작 — 설정 확인 후 다시 시작하세요');
  const {setup}=await chrome.storage.local.get('setup');if(setup)await chrome.storage.local.set({setup:{...setup,active:false}});
}));
