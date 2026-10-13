import test from 'node:test';
import assert from 'node:assert/strict';
let listener, alarmListener;
let state = {job:{id:'a',tabId:7,active:true,phase:'watching'}};
let reloads=0, clears=0;
const updates=[];
const alarms=[];
let failReload=false,failUpdate=false;
const notifications=[];let failNotification=false,notificationPermission='granted';
const soundMessages=[];let failSound=false;
globalThis.chrome = {
 offscreen:{hasDocument:async()=>true},
 notifications:{async getPermissionLevel(){return notificationPermission;},async create(id,options){if(failNotification)throw new Error('notifications unavailable');notifications.push({id,...options});return id;}},
 runtime:{getContexts:async()=>[{}],getURL:path=>`chrome-extension://test/${path}`,sendMessage:async message=>{soundMessages.push(message);return failSound ? {ok:false,error:'audio unavailable'} : {ok:true};},onMessage:{addListener(fn){listener=fn;}},onStartup:{addListener(){}}},
 storage:{local:{async get(){return structuredClone(state);},async set(value){Object.assign(state,value);}}},
 alarms:{async create(name,options){alarms.push({name,...options});},async clear(){clears++;},onAlarm:{addListener(fn){alarmListener=fn;}}},
 tabs:{onRemoved:{addListener(){}},async reload(){if(failReload)throw new Error('reload failed');reloads++;},async create(){return {id:7};},async update(tabId,options){if(failUpdate)throw new Error('update failed');updates.push({tabId,...options});},async get(){return {url:state.job.url};}}
};
await import('../extension/background.js');
const message=(msg,tabId=7,url='https://m.booking.naver.com/booking/1',senderContext={})=>new Promise(resolve=>listener({scanId:state.job?.scanId,...msg},{tab:{id:tabId,url},...senderContext},resolve));
test('only designated tab obtains context and claims booking once', async()=>{
 assert.equal((await message({type:'CONTEXT'},8)).job,null);
 assert.equal((await message({type:'CLAIM',id:'a'},8)).ok,false);
 const results=await Promise.all([message({type:'CLAIM',id:'a'}),message({type:'CLAIM',id:'a'})]);
 assert.deepEqual(results.map(r=>r.ok),[true,false]);
 assert.equal(state.job.phase,'booking');
 await alarmListener({name:'booking-watch'});
 assert.equal(reloads,0);
 assert.equal(clears,1);
});
test('stale result cannot stop current job; stop prevents further claim',async()=>{
 await message({type:'RESULT',id:'old',message:'done'});
 assert.equal(state.job.active,true);
 await message({type:'STOP'});
 assert.equal(state.job.active,false);
 assert.equal((await message({type:'CLAIM',id:'a'})).ok,false);
});

test('short-interval refresh validates job and tab before reloading', async () => {
 state.job={id:'b',tabId:7,active:true,phase:'watching',url:'https://m.booking.naver.com/booking/1',nextCheckAt:Date.now()-1};
 assert.equal((await message({type:'RECHECK',id:'old'})).ok,false);
 assert.equal((await message({type:'RECHECK',id:'b'},8)).ok,false);
 assert.equal(reloads,0);
 assert.equal((await message({type:'RECHECK',id:'b'})).ok,true);
 assert.equal(reloads,1);
 state.job.phase='booking';
 assert.equal((await message({type:'RECHECK',id:'b'})).ok,false);
 assert.equal(reloads,1);
});

test('all dates run in priority order before waiting; each new round starts at first date', async () => {
 const dates=['2026-10-16','2026-10-23','2026-10-30'];
 state.job={id:'multi',scanId:'first',tabId:7,active:true,phase:'watching',dates,date:dates[0],dateIndex:0,url:'https://m.booking.naver.com/booking/1?startDate='+dates[0],intervalMin:5,intervalMax:5};
 const beforeAlarms=alarms.length, beforeUpdates=updates.length, beforeReloads=reloads;
 const firstScan=state.job.scanId;
 assert.equal((await message({type:'RECHECK',id:'multi',date:dates[0]})).ok,false);
 const next = await message({type:'SCHEDULE',id:'multi',date:dates[0]});
 assert.equal(next.ok,true);assert.equal(next.nextJob.date,dates[1]);
 assert.equal(state.job.date,dates[1]);
 assert.equal(state.job.nextCheckAt,null);
 assert.equal(alarms.length,beforeAlarms);
 assert.equal((await message({type:'SCHEDULE',id:'multi',date:dates[0],scanId:firstScan})).ok,false);
 assert.equal((await message({type:'CLAIM',id:'multi',date:dates[0]})).ok,false);
 await message({type:'SCHEDULE',id:'multi',date:dates[1]});
 assert.equal(state.job.date,dates[2]);
 assert.equal(alarms.length,beforeAlarms);assert.equal(updates.length,beforeUpdates);assert.equal(reloads,beforeReloads);
 const started=Date.now();
 const scheduled=await message({type:'SCHEDULE',id:'multi',date:dates[2],elapsedMs:100000});
 assert.equal(scheduled.ok,true);
 assert.ok(scheduled.nextCheckAt>=started+5000);
 assert.equal(alarms.length,beforeAlarms+1);
 assert.equal((await message({type:'RECHECK',id:'multi',date:dates[2]})).ok,false);
 state.job.nextCheckAt=Date.now()-1;
 await alarmListener({name:'booking-watch'});
 assert.equal(state.job.date,dates[0]);assert.equal(state.job.dateIndex,0);
 assert.equal(updates.length,beforeUpdates);assert.equal(reloads,beforeReloads+1);
 assert.equal((await message({type:'CLAIM',id:'multi',date:dates[0]})).ok,true);
 const count=updates.length;
 assert.equal((await message({type:'SCHEDULE',id:'multi',date:dates[0]})).ok,false);
 await alarmListener({name:'booking-watch'});
 assert.equal(updates.length,count);
});

test('final submission needs matching request page, consent and one atomic claim', async () => {
 const date='2026-10-26',url='https://m.booking.naver.com/booking/1';
 state.job={id:'final',tabId:7,active:true,autoConfirm:false,phase:'booking',date,url,selectedTime:'18:00'};
 const msg={type:'FINAL_CLAIM',id:'final',date};
 const request=url+'/request?startDateTime=2026-10-26T18:00:00';
 assert.equal((await message(msg,7,request)).ok,false);
 state.job.autoConfirm=true;
 assert.equal((await message(msg,7,url)).ok,false);
 assert.equal((await message(msg,8,request)).ok,false);
 assert.equal((await message(msg,7,request.replace('18:00','17:00'))).ok,false);
 const claims=await Promise.all([message(msg,7,request),message(msg,7,request)]);
 assert.deepEqual(claims.map(r=>r.ok),[true,false]);
 assert.equal(state.job.phase,'submitting');
});

test('each scan schedules a one-shot randomized check; duplicate schedule reuses it', async () => {
 state.job={id:'random',scanId:'scan-1',tabId:7,active:true,phase:'watching',date:'2026-10-26',url:'https://m.booking.naver.com/booking/1',intervalMin:15,intervalMax:30};
 const schedule=await message({type:'SCHEDULE',id:'random',date:state.job.date,elapsedMs:0});
 assert.equal(schedule.ok,true);
 assert.ok(state.job.lastInterval>=15 && state.job.lastInterval<=30);
 assert.ok(schedule.nextCheckAt>Date.now());
 assert.ok('when' in alarms.at(-1));
 assert.equal('periodInMinutes' in alarms.at(-1),false);
 const repeat=await message({type:'SCHEDULE',id:'random',date:state.job.date,elapsedMs:0});
 assert.equal(repeat.nextCheckAt,schedule.nextCheckAt);
 assert.equal((await message({type:'RECHECK',id:'random',date:state.job.date})).ok,false);
 const oldScan=state.job.scanId;
 state.job.nextCheckAt=Date.now()-1;
 const before=reloads;
 assert.equal((await message({type:'RECHECK',id:'random',date:state.job.date})).ok,true);
 assert.equal(reloads,before+1);
 assert.notEqual(state.job.scanId,oldScan);
 assert.equal((await message({type:'RECHECK',id:'random',date:state.job.date,scanId:oldScan})).ok,false);
 assert.equal((await message({type:'SCHEDULE',id:'random',date:state.job.date,scanId:oldScan})).ok,false);
 const next=await message({type:'SCHEDULE',id:'random',date:state.job.date});
 assert.equal(next.ok,true);
 state.job.phase='booking';
 assert.equal((await message({type:'SCHEDULE',id:'random',date:state.job.date})).ok,false);
});

test('reload errors stop the job instead of leaving an unscheduled active watcher', async () => {
 state.job={id:'failure',scanId:'fail-scan',tabId:7,active:true,phase:'watching',url:'https://m.booking.naver.com/booking/1',nextCheckAt:Date.now()-1};
 failReload=true;
 const response=await message({type:'RECHECK',id:'failure'});
 failReload=false;
 assert.equal(response.ok,false);assert.equal(state.job.active,false);
 assert.match(state.job.status,/새로고침 또는 날짜 전환 실패/);
});
test('initial navigation errors stop the new job and return a failure', async () => {
 failUpdate=true;
 const response=await message({type:'START',config:{url:'https://m.booking.naver.com/booking/13/bizes/1491414/items/7037654',date:'2026-10-26',times:[],intervalMin:15,intervalMax:60}});
 failUpdate=false;
 assert.equal(response.ok,false);assert.equal(state.job.active,false);
 assert.match(state.job.status,/예약 페이지 열기 실패/);
});

 test('logs discard older entries and keep only the latest ten', async () => {
 state.logs=Array.from({length:60},(_,i)=>({at:'2026-10-06T00:00:00Z',message:`old ${i}`}));
 await message({type:'PRUNE_LOGS'});
 assert.equal(state.logs.length,10);assert.equal(state.logs[0].message,'old 0');
 await message({type:'STOP'});
 assert.equal(state.logs.length,10);assert.equal(state.logs[0].message,'사용자 중지');
 assert.deepEqual(state.logs.slice(1).map(entry=>entry.message),Array.from({length:9},(_,i)=>`old ${i}`));
 for(let i=0;i<7;i++) await message({type:'STOP'});
 assert.equal(state.logs.length,10);
 });

test('restaurant manual continuation persists and refuses final automatic submission',async()=>{
 const date='2026-10-16',url='https://booking.naver.com/booking/6/bizes/77605/items/4221135';
 state.job={id:'manual-restaurant',scanId:'manual-scan',tabId:7,active:true,autoConfirm:true,phase:'watching',date,url};
 assert.equal((await message({type:'CLAIM',id:state.job.id,date,time:'17:00',manualContinuation:true},7,url)).ok,true);
 assert.equal(state.job.manualContinuation,true);
 assert.equal((await message({type:'FINAL_CLAIM',id:state.job.id,date},7,url+'/request?startDateTime=2026-10-16T17:00:00')).ok,false);
 assert.equal(state.job.phase,'booking');
});

test('stage completion is bound to the active job, scan, tab and saved stage',async()=>{
 state.job={id:'stages',scanId:'current',date:'2026-10-19',tabId:7,active:true,phase:'booking',stagePreferences:{stages:{options:{fields:[]}}},partyComposition:{counts:[]}};
 for(const patch of [{id:'old'},{scanId:'old'},{date:'2026-10-20'},{stageKey:'unknown'}])assert.equal((await message({type:'STAGE_DONE',id:'stages',date:'2026-10-19',stageKey:'options',...patch})).ok,false);
 assert.equal((await message({type:'STAGE_DONE',id:'stages',date:'2026-10-19',stageKey:'options'},8)).ok,false);
 for(let i=0;i<2;i++)assert.equal((await message({type:'STAGE_DONE',id:'stages',date:'2026-10-19',stageKey:'options'})).ok,true);
 assert.deepEqual(state.job.completedStages,['options']);
 assert.equal((await message({type:'STAGE_DONE',id:'stages',date:'2026-10-19',composition:true})).ok,true);assert.equal(state.job.compositionApplied,true);
 state.job.active=false;assert.equal((await message({type:'STAGE_DONE',id:'stages',date:'2026-10-19',composition:true})).ok,false);
});
test('setup records multiple screens through the final page and does not overwrite saved settings',async()=>{
 const scope='https://booking.naver.com/booking/6/bizes/77605/items/4221135';
 state.partyProfiles={[scope]:{counts:[{label:'Adult',count:2}]}};
 assert.equal((await message({type:'SETUP_START',scope})).ok,true);
 const id=state.setup.id,options={stage:'options',stageKey:'a',title:'First',fields:[{key:'a',type:'quantity',value:'1'}]};
 assert.equal((await message({type:'SETUP_STAGE',id,scope,step:options},8,scope)).ok,false);
 assert.equal((await message({type:'SETUP_STAGE',id,scope,step:options},7,scope)).ok,true);
 assert.equal((await message({type:'SETUP_STAGE',id,scope,step:{...options,stageKey:'b',title:'Second'}},7,scope)).ok,true);
 assert.equal((await message({type:'SETUP_STAGE',id,scope,step:{stage:'final',stageKey:'final',title:'Final',fields:[]}},7,scope+'/request/link')).ok,true);
 assert.equal(state.setupProfiles[scope].steps.length,3);assert.equal(state.setupProfiles[scope].complete,true);assert.equal(state.partyProfiles[scope].counts[0].count,2);
 const result=await message({type:'START',config:{url:scope,date:'2026-10-26',times:[],interval:60}});
 assert.equal(result.ok,false);assert.match(result.error,/사전 설정 미완료/);
 delete state.setupProfiles;delete state.setup;
});
test('verified setup route rejects new and reordered stages before applying values',async()=>{
 const fields=[{key:'a',type:'quantity',options:[]}],step={stageKey:'a',title:'First',fields};
 state.job={id:'route',scanId:'scan',date:'2026-10-26',tabId:7,active:true,phase:'booking',setupPlan:{steps:[step,{stageKey:'final',title:'Final',fields:[]}]},routeIndex:0};
 const seen=step=>message({type:'STAGE_SEEN',id:'route',date:'2026-10-26',step});
 assert.equal((await seen({stageKey:'final',fields:[]})).ok,false);
 assert.equal((await seen(step)).ok,true);assert.equal(state.job.routeIndex,1);
 assert.equal((await seen(step)).ok,true);assert.equal(state.job.routeIndex,1);
 assert.equal((await seen({stageKey:'new',fields})).ok,false);
 assert.equal((await seen({stageKey:'final',fields:[]})).ok,true);assert.equal(state.job.routeIndex,2);
});

test('schedule drafts persist without starting or changing the current watcher',async()=>{
 const job=structuredClone(state.job),config=structuredClone(state.config),beforeUpdates=updates.length,beforeReloads=reloads,beforeAlarms=alarms.length;
 const first={dates:['2026-10-16',''],times:['14:00'],timeMode:'exact',timeStart:'12:00',timeEnd:'15:00',timePicker:'14:00'};
 const second={...first,dates:['2026-10-16','2026-10-23'],times:[],timeMode:'range',timeStart:'14:00',timeEnd:'15:30'};
 await Promise.all([message({type:'SAVE_SCHEDULE_DRAFT',draft:first}),message({type:'SAVE_SCHEDULE_DRAFT',draft:second})]);
 assert.deepEqual(state.scheduleDraft,second);assert.deepEqual(state.job,job);assert.deepEqual(state.config,config);
 assert.equal(updates.length,beforeUpdates);assert.equal(reloads,beforeReloads);assert.equal(alarms.length,beforeAlarms);
 assert.equal((await message({type:'SAVE_SCHEDULE_DRAFT',draft:{...second,dates:Array(6).fill('')}})).ok,false);
 assert.deepEqual(state.scheduleDraft,second);
});

test('automatic setup publishes its current step and validates recoverable reading errors',async()=>{
 const scope='https://booking.naver.com/booking/6/bizes/77605/items/4221135';
 const previous=state.config || {};await message({type:'SETUP_START',scope});const id=state.setup.id;
 assert.equal(state.config.url,scope);assert.deepEqual(state.config.dates,previous.dates);
 const step={stage:'options',stageKey:'auto',title:'자동 단계',fields:[{key:'quantity:x',type:'quantity',label:'수량',value:'1',options:[]}]};
 assert.equal((await message({type:'SETUP_STAGE',id,scope,step},7,scope)).ok,true);assert.deepEqual(state.setup.currentStep,step);
 assert.equal((await message({type:'SETUP_ERROR',id,error:'읽기 실패'},8,scope)).ok,false);assert.equal(state.setup.error,null);
 assert.equal((await message({type:'SETUP_ERROR',id,error:'읽기 실패'},7,'https://example.com')).ok,false);
 assert.equal((await message({type:'SETUP_ERROR',id,error:'읽기 실패'},7,scope)).ok,true);assert.equal(state.setup.currentStep,null);assert.equal(state.setup.error,'읽기 실패');
 await message({type:'SETUP_STAGE',id,scope,step},7,scope);assert.equal(state.setup.error,null);assert.deepEqual(state.setup.currentStep,step);
});
test('learned controls are scoped to the setup tab and used by its booking job',async()=>{
 const scope='https://booking.naver.com/booking/13/bizes/123/items/456';
 await message({type:'SETUP_START',scope});const id=state.setup.id;
 const selectors={dateSelector:'button[data-value="{date}"]',timeSelector:'button[data-value="{time}"]'};
 const learn={type:'SETUP_SELECTORS',id,scope,selectors};
 assert.equal((await message(learn,8,scope)).ok,false);
 assert.equal((await message(learn,7,scope+'/request')).ok,false);
 assert.equal((await message({...learn,id:'old'},7,scope)).ok,false);
 assert.equal((await message({...learn,selectors:{dateSelector:'button:nth-child(3)'}},7,scope)).ok,false);
 assert.equal((await message(learn,7,scope)).ok,true);
 const next={type:'SETUP_SELECTORS',id,scope,stageKey:'middle',selectors:{bookingSelector:'button[data-testid="continue"]'}};
 assert.equal((await message(next,7,scope)).ok,false);
 await message({type:'SETUP_STAGE',id,scope,step:{stage:'options',stageKey:'middle',title:'확인',fields:[{key:'agree',type:'checkbox',required:true,label:'확인',options:[{value:'on',label:'확인'}]}]}},7,scope);
 assert.equal((await message(next,7,scope)).ok,true);
 assert.equal((await message({...next,stageKey:'other'},7,scope)).ok,false);
 await message({type:'SETUP_STAGE',id,scope,step:{stage:'final',stageKey:'final',title:'신청',fields:[]}},7,scope+'/request');
 assert.deepEqual(state.setupProfiles[scope].selectors,selectors);
 const config={url:scope,dates:['2026-10-16','2026-10-23'],times:[],timeMode:'any',intervalMin:15,intervalExtra:45};
 assert.equal((await message({type:'START',config})).ok,true);
 assert.equal(state.job.dateSelector,selectors.dateSelector);assert.equal(state.job.timeSelector,selectors.timeSelector);
 assert.equal(state.job.bookingSelector,undefined);assert.deepEqual(state.job.setupPlan.nextSelectors,{middle:'button[data-testid="continue"]'});
 assert.equal((await message({...learn,id},7,scope)).ok,false);
 assert.equal((await message({type:'START',config:{...config,url:'https://booking.naver.com/booking/13/bizes/123/items/789'}})).ok,true);
 assert.equal(state.job.dateSelector,undefined);assert.equal(state.job.timeSelector,undefined);
});

test('final-screen alerts are independent of auto confirmation and emitted once without switching tabs',async()=>{
 const scope='https://booking.naver.com/booking/13/bizes/123/items/456',date='2026-10-16';
 for(const autoConfirm of [false,true]) {
  state.job={id:`notice-${autoConfirm}`,scanId:'notice-scan',active:true,phase:'booking',tabId:7,url:scope,date,selectedTime:'14:30',autoConfirm};
  const url=scope+'/request/link?startDateTime=2026-10-16T14:30:00%2B09:00';
  const event={type:'FINAL_SCREEN',id:state.job.id,date},before=notifications.length,beforeUpdates=updates.length;
  for(const [change,tab,source] of [[{id:'old'},7,url],[{scanId:'old'},7,url],[{},8,url],[{},7,scope],[{},7,scope+'/request?startDateTime=2026-10-23T14:30:00'],[{},7,scope+'/request?startDateTime=2026-10-16T15:00:00'],[{},7,'https://example.com/request']])assert.equal((await message({...event,...change},tab,source)).ok,false);
  assert.equal(notifications.length,before);
  const replies=await Promise.all([message(event,7,url),message(event,7,url)]);
  assert.ok(replies.every(reply=>reply.ok));assert.equal(notifications.length,before+1);
  assert.match(notifications.at(-1).message,/2026-10-16 14:30/);assert.match(notifications.at(-1).message,/최종 신청 화면/);
  assert.equal(notifications.at(-1).iconUrl,'chrome-extension://test/icons/icon-128.png');assert.equal(state.notificationDiagnostics.status,'requested');
  assert.doesNotMatch(notifications.at(-1).title,/완료/);assert.equal(state.job.phase,'booking');assert.equal(state.job.active,true);assert.equal(updates.length,beforeUpdates);
 }
});
test('blocked notifications cannot prevent final submission and ordinary failures are silent',async()=>{
 const scope='https://booking.naver.com/booking/13/bizes/123/items/456',date='2026-10-16',url=scope+'/request';
 state.job={id:'notice-failure',scanId:'notice-scan',active:true,phase:'booking',tabId:7,url:scope,date,selectedTime:'14:30',autoConfirm:true};
 const before=notifications.length;
 failNotification=true;
 try {assert.equal((await message({type:'FINAL_SCREEN',id:state.job.id,date},7,url)).ok,true);}finally{failNotification=false;}
 assert.equal(state.notificationDiagnostics.status,'failed');assert.match(state.notificationDiagnostics.detail,/notifications unavailable/);
 assert.equal(state.job.phase,'booking');assert.equal(state.job.active,true);
 assert.equal((await message({type:'FINAL_CLAIM',id:state.job.id,date},7,url)).ok,true);
 await message({type:'RESULT',id:state.job.id,date,message:'입력 실패'},7,url);
 assert.equal(notifications.length,before);
 assert.equal((await message({type:'FINAL_SCREEN',id:state.job.id,date},7,url)).ok,false);
});
test('legacy date-only final URLs can notify for the visually verified time',async()=>{
 const scope='https://booking.naver.com/booking/12/bizes/665623/items/4706535',date='2026-10-16';
 state.job={id:'date-only-notice',scanId:'notice-scan',active:true,phase:'booking',tabId:7,url:scope,date,selectedTime:'14:30'};
 const before=notifications.length;
 assert.equal((await message({type:'FINAL_SCREEN',id:state.job.id,date},7,scope+'/request?startDateTime=2026-10-16T00:00:00')).ok,true);
 assert.equal(notifications.length,before+1);assert.match(notifications.at(-1).message,/14:30/);
});
test('notification tests report permission denial and API errors without changing a booking',async()=>{
 const job=structuredClone(state.job),config=structuredClone(state.config),before=notifications.length,beforeUpdates=updates.length;
 notificationPermission='denied';
 try {
  const result=await message({type:'TEST_NOTIFICATION'});assert.equal(result.ok,false);assert.equal(result.status,'blocked');assert.match(result.detail,/차단/);
 }finally{notificationPermission='granted';}
 assert.equal(notifications.length,before);assert.deepEqual(state.job,job);
 failNotification=true;
 try {const result=await message({type:'TEST_NOTIFICATION'});assert.equal(result.ok,false);assert.equal(result.status,'failed');}finally{failNotification=false;}
 const result=await message({type:'TEST_NOTIFICATION'});assert.equal(result.ok,true);assert.equal(result.status,'requested');
 assert.equal(notifications.length,before+1);assert.ok(notifications.at(-1).id.startsWith('booking-notification-test-'));
 const firstId=notifications.at(-1).id;
 assert.equal((await message({type:'TEST_NOTIFICATION'})).ok,true);
 assert.equal(notifications.length,before+2);assert.notEqual(notifications.at(-1).id,firstId);
 assert.deepEqual(state.job,job);assert.deepEqual(state.config,config);assert.equal(updates.length,beforeUpdates);
});
test('denied final-screen notifications record the cause while allowing submission',async()=>{
 const scope='https://booking.naver.com/booking/13/bizes/123/items/456',date='2026-10-16';
 state.job={id:'blocked-final',scanId:'blocked-scan',tabId:7,phase:'booking',active:true,url:scope,date,autoConfirm:true};
 const before=notifications.length;notificationPermission='denied';
 try {assert.equal((await message({type:'FINAL_SCREEN',id:state.job.id,date},7,scope+'/request')).ok,true);}finally{notificationPermission='granted';}
 assert.equal(state.notificationDiagnostics.status,'blocked');assert.equal(notifications.length,before);
 assert.equal((await message({type:'FINAL_CLAIM',id:state.job.id,date},7,scope+'/request')).ok,true);
});
test('SPA final-screen alerts use the sending document URL before tab metadata catches up',async()=>{
 const scope='https://booking.naver.com/booking/13/bizes/123/items/456',date='2026-10-16';
 state.job={id:'spa-notice',scanId:'spa-scan',tabId:7,phase:'booking',active:true,url:scope,date,selectedTime:'14:30'};
 const event={type:'FINAL_SCREEN',id:state.job.id,date},before=notifications.length;
 const context={url:scope+'/request/link?startDateTime=2026-10-16T14:30:00',frameId:0};
 assert.equal((await message(event,7,scope,{...context,frameId:1})).ok,false);
 assert.equal((await message(event,7,scope,{...context,url:'https://example.com/request'})).ok,false);
 assert.equal(notifications.length,before);
 assert.equal((await message(event,7,scope,context)).ok,true);
 assert.equal(notifications.length,before+1);assert.equal(state.notificationDiagnostics.status,'requested');
});
test('the verified current request URL can notify while both browser URL snapshots are stale',async()=>{
 const scope='https://booking.naver.com/booking/13/bizes/123/items/456',date='2026-10-16';
 state.job={id:'live-url-notice',scanId:'live-url-scan',tabId:7,phase:'booking',active:true,url:scope,date,selectedTime:'14:30'};
 const requestUrl=scope+'/request/link?startDateTime=2026-10-16T14:30:00';
 const event={type:'FINAL_SCREEN',id:state.job.id,date,requestUrl},before=notifications.length;
 assert.equal((await message(event,7,scope,{url:'https://example.com/',frameId:0})).ok,false);
 assert.equal((await message({...event,requestUrl:scope+'/request?startDateTime=2026-10-23T14:30:00'},7,scope,{url:scope,frameId:0})).ok,false);
 assert.equal(state.notificationDiagnostics.status,'rejected');assert.equal(notifications.length,before);
 const result=await message(event,7,scope,{url:scope,frameId:0});
 assert.equal(result.ok,true);assert.equal(result.notificationStatus,'requested');assert.equal(notifications.length,before+1);
 assert.equal((await message(event,7,scope,{url:scope,frameId:0})).notificationStatus,'already-requested');assert.equal(notifications.length,before+1);
});
test('sound settings and preview do not change the booking, and silence still shows notifications',async()=>{
 const job=structuredClone(state.job),config=structuredClone(state.config);
 assert.equal((await message({type:'SAVE_NOTIFICATION_SETTINGS',sound:'bell'})).ok,true);
 assert.deepEqual(state.notificationSettings,{sound:'bell'});
 assert.equal((await message({type:'SAVE_NOTIFICATION_SETTINGS',sound:'arbitrary-file'})).ok,false);
 const before=notifications.length;
 assert.equal((await message({type:'TEST_NOTIFICATION'})).ok,true);assert.equal(soundMessages.at(-1).sound,'bell');
 assert.equal(notifications.at(-1).silent,true);
 assert.equal((await message({type:'PREVIEW_NOTIFICATION_SOUND',sound:'beep'})).ok,true);assert.equal(soundMessages.at(-1).sound,'beep');assert.equal(notifications.length,before+1);
 await message({type:'SAVE_NOTIFICATION_SETTINGS',sound:'none'});const soundsBefore=soundMessages.length;
 await message({type:'TEST_NOTIFICATION'});assert.equal(soundMessages.length,soundsBefore);assert.equal(notifications.length,before+2);
 assert.deepEqual(state.job,job);assert.deepEqual(state.config,config);
 assert.equal(listener({target:'notification-audio',type:'PLAY_NOTIFICATION_SOUND'},{},()=>{throw new Error('worker must not intercept audio response');}),false);
});
test('final alerts play once and sound failures never block submission',async()=>{
 const scope='https://booking.naver.com/booking/13/bizes/123/items/456',date='2026-10-16';
 state.job={id:'sound-final',scanId:'sound-scan',tabId:7,phase:'booking',active:true,url:scope,date,autoConfirm:true};
 state.notificationSettings={sound:'chime'};const before=soundMessages.length;failSound=true;
 const event={type:'FINAL_SCREEN',id:state.job.id,date};
 try{assert.equal((await message(event,7,scope+'/request')).ok,true);}finally{failSound=false;}
 assert.equal(soundMessages.length,before+1);assert.match(state.notificationDiagnostics.detail,/소리 재생 실패/);
 assert.equal((await message(event,7,scope+'/request')).ok,true);assert.equal(soundMessages.length,before+1);
 assert.equal((await message({type:'FINAL_CLAIM',id:state.job.id,date},7,scope+'/request')).ok,true);
});
