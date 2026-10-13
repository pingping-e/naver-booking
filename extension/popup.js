import {preflight,stageKey,stepSchema} from './preflight.js';
import {notificationSounds,soundChoice} from './notification-sounds.js';
const form = document.querySelector('form'), status = document.querySelector('#status');
const extensionVersion=chrome.runtime.getManifest?.().version;
document.querySelector('#extension-version').textContent=extensionVersion ? `확장 버전 ${extensionVersion}` : '';
const {config:storedConfig, scheduleDraft, formProfiles = {}, partyProfiles = {}, stageProfiles = {},notificationSettings} = await chrome.storage.local.get(['config','scheduleDraft', 'formProfiles','partyProfiles','stageProfiles','notificationSettings']);
const soundSelect=document.querySelector('#notification-sound'),soundStatus=document.querySelector('#sound-status');
soundSelect.replaceChildren(...Object.entries(notificationSounds).map(([value,sound])=>{const option=document.createElement('option');option.value=value;option.textContent=sound.label;return option;}));
soundSelect.value=soundChoice(notificationSettings);
function soundControls(){document.querySelector('#preview-notification-sound').disabled=soundSelect.value==='none';}
soundControls();
soundSelect.addEventListener('change',async()=>{
  soundControls();
  try {const result=await chrome.runtime.sendMessage({type:'SAVE_NOTIFICATION_SETTINGS',sound:soundSelect.value});if(!result?.ok)throw new Error(result?.error || '소리 설정 저장 실패');soundStatus.textContent='알림 소리를 저장했습니다.';soundStatus.classList.remove('field-error');}
  catch(error){soundStatus.textContent=error.message;soundStatus.classList.add('field-error');}
});
document.querySelector('#preview-notification-sound').addEventListener('click',async()=>{
  const button=document.querySelector('#preview-notification-sound');button.disabled=true;
  try {const result=await chrome.runtime.sendMessage({type:'PREVIEW_NOTIFICATION_SOUND',sound:soundSelect.value});if(!result?.ok)throw new Error(result?.error || '소리 재생 실패');soundStatus.textContent='선택한 소리를 재생했습니다.';soundStatus.classList.remove('field-error');}
  catch(error){soundStatus.textContent=error.message;soundStatus.classList.add('field-error');}
  finally{soundControls();}
});
const config={...storedConfig,...scheduleDraft};
let currentForm = null;
let partyProfileScope = '';
let currentStage = null;
let inspectedStage = null;
let editingStage = null;
let guidedSetup = false;
let lastAutomaticStep = '';
let planRender = 0;
const stageControls = new Map();
const inspectStatus=document.querySelector('#inspect-status');
const fieldControls = new Map();
function mergeStage(profile,stage) {
  return {scope:stage.scope,stages:{...Object.fromEntries(Object.entries(profile?.stages || {}).filter(([,s])=>stageKey(s.fields)!==stage.stageKey)),[stage.stageKey]:stage}};
}
async function renderPlan() {
  const renderId=++planRender;
  const scope=scopeForUrl(form.elements.url.value);
  const {setupProfiles={},setup,partyProfiles:parties={},formProfiles:finals={},stageProfiles:stages={},config:savedConfig={}}=await chrome.storage.local.get(['setupProfiles','setup','partyProfiles','formProfiles','stageProfiles','config']);
  if(renderId!==planRender || scope!==scopeForUrl(form.elements.url.value))return;
  Object.assign(partyProfiles,parties);Object.assign(formProfiles,finals);Object.assign(stageProfiles,stages);
  const plan=setupProfiles[scope];
  const rows=preflight(plan,{...savedConfig,partyComposition:parties[scope],stagePreferences:stages[scope],formPreferences:finals[scope]});
  const savedMiddle=Object.keys(stages[scope]?.stages || {}).length+(parties[scope] ? 1 : 0);
  const noMiddle=plan?.complete && plan.steps.every(step=>step.stage==='final');
  const middleStatus=noMiddle ? '중간 단계 없음' : savedMiddle ? `중간 단계 설정 ${savedMiddle}개 저장됨` : '저장된 중간 단계 설정 없음';
  const finalRow=plan?.steps.findIndex(step=>step.stage==='final') ?? -1;
  const finalStatus=finals[scope] ? '최종 신청 항목 저장됨' : finalRow>=0 && rows[finalRow]?.ready ? '최종 신청 항목 자동 처리' : '최종 신청 항목 저장 전';
  document.querySelector('#saved-stages').textContent=`${middleStatus} · ${finalStatus}`;
  document.querySelector('#setup-summary').textContent=!plan ? '전체 경로를 아직 사전 확인하지 않았습니다.' : `${plan.complete?'마지막 화면까지 확인됨':'경로 확인 중'} · 설정 준비 ${rows.filter(r=>r.ready).length}/${rows.length}단계`;
  document.querySelector('#setup-steps').replaceChildren(...rows.map(row=>{const li=document.createElement('li');li.textContent=`${row.title}: ${row.ready?'준비됨 (단일 필수 선택은 자동)':row.error}`;return li;}));
  const guided=!!setup?.active && setup.scope===scope;
  guidedSetup=guided;
  if(guided && setup.error) {
    inspectedStage=null;editingStage=null;lastAutomaticStep='';
    inspectStatus.textContent=setup.error;document.querySelector('#inspect-form').hidden=false;
  } else if(guided && setup.currentStep) {
    const step=setup.currentStep;
    const key=JSON.stringify([setup.id,step.stageKey,step.people,stepSchema(step)]);
    if(key!==lastAutomaticStep){lastAutomaticStep=key;showScreen({...step,scope:setup.scope,ok:true});}
    document.querySelector('#inspect-form').hidden=true;
  }
  renderSaveAction();
}
document.querySelector('#start-setup').addEventListener('click',async()=>{
  try {
    const scope=scopeForUrl(form.elements.url.value);if(!scope)throw new Error('예약 상품 주소를 입력하세요.');
    const result=await chrome.runtime.sendMessage({type:'SETUP_START',scope});if(!result?.ok)throw new Error(result?.error || '사전 설정 시작 실패');
    inspectedStage=null;editingStage=null;lastAutomaticStep='';renderStage(null);renderFields(null);
    document.querySelector('#inspect-form').hidden=true;
    inspectStatus.textContent='새 예약 탭에서 날짜·시간을 선택하세요. 각 화면의 항목을 자동으로 읽어 표시합니다.';
    await renderPlan();
  }catch(error){inspectStatus.textContent=error.message;}
});
document.querySelector('#setup-next').addEventListener('click',async()=>{
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const {setup}=await chrome.storage.local.get('setup');
    if(!setup?.active || setup.tabId!==tab?.id)throw new Error('사전 설정으로 연 예약 탭에서 진행하세요.');
    let profile,stage,people;
    if(inspectedStage==='options' && currentStage){
      profile=readStage();stage='options';
      const {stageProfiles:latest={}}=await chrome.storage.local.get('stageProfiles');
      const saved=mergeStage(latest[profile.scope],profile);
      await chrome.storage.local.set({stageProfiles:{...latest,[profile.scope]:saved}});stageProfiles[profile.scope]=saved;
    }else if(inspectedStage==='composition' && partyProfileScope===setup.scope){
      profile=readPartyProfile();stage='composition';people=Number(form.elements.partySize.value);
      const {partyProfiles:latest={},config:latestConfig={}}=await chrome.storage.local.get(['partyProfiles','config']);
      await chrome.storage.local.set({partyProfiles:{...latest,[profile.scope]:profile},config:{...latestConfig,url:profile.scope,partySize:String(people),partyComposition:profile,usePartyComposition:true}});partyProfiles[profile.scope]=profile;
    }else throw new Error('현재 중간 화면의 필수 항목을 먼저 불러오세요. 최종 화면에서는 필요한 입력만 저장하고 신청·결제는 누르지 마세요.');
    const response=await chrome.tabs.sendMessage(tab.id,{type:'SETUP_NEXT',stage,profile,people});if(!response?.ok)throw new Error(response?.error || '다음 단계 이동 실패');
    inspectStatus.textContent='현재 단계를 저장했습니다. 다음 화면의 항목을 자동으로 확인하고 있습니다.';
    await renderPlan();
  }catch(error){inspectStatus.textContent=error.message;}
});
if (config) for (const [name, value] of Object.entries(config)) {
  const field = form.elements.namedItem(name);
  if (!field) continue;
  if (field.type === 'checkbox') field.checked = value;
  else field.value = Array.isArray(value) ? value.join(', ') : value;
}
if (!Number.isInteger(Number(config?.intervalMin)) || Number(config.intervalMin) < 5) form.elements.intervalMin.value = '15';
if (!Number.isInteger(Number(config?.intervalExtra)) || Number(config.intervalExtra) < 0 || Number(config.intervalExtra) > 120) {
  const legacyMaximum = {'15-30':30, '30-60':60, '60-90':90, '90-180':180};
  const min = Number(form.elements.intervalMin.value);
  const oldMax = Number(config?.intervalMax ?? legacyMaximum[config?.intervalPreset] ?? config?.interval ?? 60);
  const extra = Math.max(0, oldMax - min);
  form.elements.intervalExtra.value = Math.min(extra, 120);
}
function renderInterval() {
  const minField = form.elements.intervalMin, extraField = form.elements.intervalExtra;
  const min = Number(minField.value), extra = Number(extraField.value);
  const minError = minField.value === '' || !Number.isInteger(min) ? '최소 시간을 정수로 입력하세요.' : min < 5 ? '최소 시간은 5초 이상이어야 합니다.' : min > 120 ? '최소 시간은 120초 이하여야 합니다.' : '';
  const extraError = extraField.value === '' || !Number.isInteger(extra) || extra < 0 || extra > 120 ? '추가 범위는 0~120초의 정수로 입력하세요.' : '';
  for (const [field, id, message] of [[minField, '#interval-min-error', minError], [extraField, '#interval-extra-error', extraError]]) {
    field.setCustomValidity(message);
    field.setAttribute('aria-invalid', String(Boolean(message)));
    const error = document.querySelector(id);error.textContent = message;error.hidden = !message;
  }
  form.querySelector('button[type="submit"]').disabled = Boolean(minError || extraError);
  document.querySelector('#interval-rule').textContent = minError || extraError ? '' : extra === 0 ? `${min}초 후 다시 확인합니다.` : `${min}~${min + extra}초 후 다시 확인합니다.`;
  renderComposition();
}
function renderComposition() {
  const enabled=form.elements.usePartyComposition.checked;
  document.querySelector('#party-composition').hidden=!enabled;
  const inputs=[...document.querySelectorAll('#party-count-fields input')];
  inputs.forEach(input=>{input.disabled=!enabled;});
  const size=Number(form.elements.partySize.value);
  const invalid=inputs.some(input=>input.value==='' || !Number.isInteger(Number(input.value)) || Number(input.value)<0 || Number(input.value)>100);
  const sum=inputs.reduce((total,input)=>total+Number(input.value),0);
  const error=!enabled ? '' : !inputs.length ? '인원 구성 화면에서 필수 항목을 먼저 불러오세요.' : invalid ? '항목별 인원을 0~100명의 정수로 입력하세요.' : !Number.isInteger(size) || size<1 || sum!==size ? `인원 구성 합계(${sum}명)가 예약 인원과 같아야 합니다.` : '';
  form.elements.usePartyComposition.setCustomValidity(error);
  const message=document.querySelector('#party-composition-error');message.textContent=error;message.hidden=!error;
  form.querySelector('button[type="submit"]').disabled=!!error || form.elements.intervalMin.getAttribute('aria-invalid')==='true' || form.elements.intervalExtra.getAttribute('aria-invalid')==='true';
}
function renderPartyProfile(profile) {
  partyProfileScope=profile?.scope || '';
  const fields=document.querySelector('#party-count-fields');fields.replaceChildren();
  for(const row of profile?.counts || []) {
    const label=document.createElement('label');label.append(document.createTextNode(row.label));
    const input=document.createElement('input');input.type='number';input.min='0';input.max='100';input.step='1';input.dataset.label=row.label;input.value=row.count;
    input.addEventListener('input',()=>{editingStage='composition';renderComposition();renderSaveAction();});label.append(input);fields.append(label);
  }
  renderComposition();
}
function readPartyProfile() {
  renderComposition();
  if(!form.elements.usePartyComposition.checkValidity())throw new Error(form.elements.usePartyComposition.validationMessage);
  if(partyProfileScope!==scopeForUrl(form.elements.url.value))throw new Error('현재 상품의 인원 구성 항목을 다시 불러오세요.');
  return {scope:scopeForUrl(form.elements.url.value),counts:[...document.querySelectorAll('#party-count-fields input')].map(input=>({label:input.dataset.label,count:Number(input.value)}))};
}
for(const name of ['usePartyComposition','partySize'])form.elements[name].addEventListener('input',()=>{renderComposition();if(form.elements.usePartyComposition.checked && partyProfileScope)editingStage='composition';renderSaveAction();});
async function savePartySettings() {
  try{const profile=readPartyProfile();partyProfiles[profile.scope]=profile;
    const {partyProfiles:latest={},config:latestConfig={}}=await chrome.storage.local.get(['partyProfiles','config']);
    await chrome.storage.local.set({partyProfiles:{...latest,[profile.scope]:profile},config:{...latestConfig,url:profile.scope,partySize:form.elements.partySize.value,usePartyComposition:true,partyComposition:profile}});inspectStatus.textContent='인원 구성을 저장했습니다.';
  }catch(error){inspectStatus.textContent=error.message;}
}
for (const field of [form.elements.intervalMin, form.elements.intervalExtra]) {
  field.addEventListener('input', renderInterval);
  field.addEventListener('change', renderInterval);
}
renderInterval();
const dateFields = document.querySelector('#date-fields');
const addDateButton = document.querySelector('#add-date');
function dateValues() { return [...dateFields.querySelectorAll('input[type="date"]')].map(input => input.value); }
function renderDates(values) {
  dateFields.replaceChildren();
  (values.length ? values : ['']).slice(0, 5).forEach((value, index) => {
    const row = document.createElement('div');row.className = 'date-row';
    const label = document.createElement('label');label.textContent = `날짜 ${index + 1}`;
    const input = document.createElement('input');input.type = 'date';input.name = index === 0 ? 'date' : `date${index + 1}`;input.required = true;input.value = value;
    label.append(input);row.append(label);
    if (index > 0) {
      const remove = document.createElement('button');remove.type = 'button';remove.className = 'remove-date';remove.textContent = '삭제';remove.setAttribute('aria-label', `날짜 ${index + 1} 삭제`);
      remove.addEventListener('click', () => { const dates = dateValues();dates.splice(index, 1);renderDates(dates);saveSchedule(); });
      row.append(remove);
    }
    dateFields.append(row);
  });
  const count = dateValues().length;
  addDateButton.disabled = count >= 5;
  addDateButton.textContent = count >= 5 ? '최대 5개까지 추가할 수 있습니다' : '+ 날짜 추가';
}
const savedDates = config?.dates?.length ? config.dates : ['date', 'date2', 'date3', 'date4', 'date5'].map(name => config?.[name]).filter(Boolean);
renderDates(savedDates);
addDateButton.addEventListener('click', () => {
  const dates = dateValues();
  if (dates.length >= 5) return;
  renderDates([...dates, '']);
  saveSchedule();
  dateFields.querySelector('.date-row:last-child input').focus();
});
let selectedTimes = [...new Set(config?.times || [])];
function renderTimes() {
  document.querySelector('#time-chips').replaceChildren(...selectedTimes.map((time, index) => {
    const chip = document.createElement('button');chip.type = 'button';chip.className = 'time-chip';chip.textContent = `${time} ×`;chip.setAttribute('aria-label', `${time} 삭제`);
    chip.addEventListener('click', () => { selectedTimes.splice(index, 1);renderTimes();saveSchedule(); });
    return chip;
  }));
  form.elements.times.value = selectedTimes.join(', ');
}
renderTimes();
if (!config?.timeMode) form.elements.timeMode.value = selectedTimes.length ? 'exact' : 'any';
function renderTimeMode() {
  const mode = form.elements.timeMode.value;
  document.querySelector('#exact-times').hidden = mode !== 'exact';
  document.querySelector('#time-start').hidden = !['after', 'range'].includes(mode);
  document.querySelector('#time-end').hidden = mode !== 'range';
  form.elements.timeStart.required = ['after', 'range'].includes(mode);
  form.elements.timeEnd.required = mode === 'range';
  document.querySelector('#time-rule').textContent = mode === 'any' ? '예약 가능한 모든 시간을 확인합니다.' : mode === 'exact' ? '추가한 시간 중 예약 가능한 시간을 선택합니다.' : mode === 'after' ? '시작 시간을 포함해 그 이후를 확인합니다.' : '시작·종료 시간을 모두 포함합니다. 같은 날짜 안의 범위를 지정하세요.';
}
form.elements.timeMode.addEventListener('change', renderTimeMode);
renderTimeMode();
document.querySelector('#add-time').addEventListener('click', () => {
  const input = document.querySelector('#time-picker');
  if (!input.value || !input.checkValidity()) {status.textContent = '추가할 시간을 선택하세요.';input.focus();return;}
  if (!selectedTimes.includes(input.value)) selectedTimes.push(input.value);
  renderTimes();
  saveSchedule();
});
document.querySelector('#time-picker').value=config.timePicker || '';
function saveSchedule() {
  const draft={dates:dateValues(),timeMode:form.elements.timeMode.value,times:[...selectedTimes],timeStart:form.elements.timeStart.value,timeEnd:form.elements.timeEnd.value,timePicker:document.querySelector('#time-picker').value};
  chrome.runtime.sendMessage({type:'SAVE_SCHEDULE_DRAFT',draft}).then(response=>{
    const notice=document.querySelector('#schedule-save-status');
    notice.textContent=response?.ok ? '날짜·시간이 자동 저장되었습니다.' : '날짜·시간 저장에 실패했습니다. 다시 입력해 주세요.';
  }).catch(()=>{document.querySelector('#schedule-save-status').textContent='날짜·시간 저장에 실패했습니다. 다시 입력해 주세요.';});
}
form.addEventListener('input',event=>{
  if(event.target.closest('#date-fields') || ['timeMode','timeStart','timeEnd'].includes(event.target.name) || event.target.id==='time-picker')saveSchedule();
});
form.addEventListener('change',event=>{
  if(event.target.closest('#date-fields') || ['timeMode','timeStart','timeEnd'].includes(event.target.name))saveSchedule();
});
function scopeForUrl(value) {
  try { const url = new URL(value); const match=url.pathname.match(/^(\/booking\/\d+\/bizes\/\d+\/items\/\d+)(?:\/request(?:\/link)?)?\/?$/);return match ? url.origin+match[1] : ''; } catch { return ''; }
}
function renderFields(profile) {
  currentForm = profile || null;
  fieldControls.clear();
  document.querySelector('#form-fields').replaceChildren();

  document.querySelector('#form-scope').textContent = profile ? `적용 상품: ${profile.scope}` : '최종 신청 추가정보는 아직 불러오지 않았습니다. 중간 단계 설정은 위에 별도로 표시됩니다.';
  for (const field of profile?.fields || []) {
    const label = document.createElement('label');
    label.append(document.createTextNode(`${field.label} (필수)`));
    let control;
    if (['checkbox', 'radio', 'select','customselect'].includes(field.type) && field.options.length) {
      control = document.createElement('select');
      control.multiple = field.type === 'checkbox';
      if (!control.multiple) {
        const placeholder = document.createElement('option');placeholder.value='';placeholder.textContent='선택하세요';control.append(placeholder);
      }
      const selected = Array.isArray(field.value) ? field.value : [field.value];
      for (const option of field.options) {
        const item=document.createElement('option');item.value=option.value;item.textContent=option.label;item.disabled=option.disabled;item.selected=selected.includes(option.value);control.append(item);
      }
    } else {
      control=document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
      if (field.type !== 'textarea') control.type=['text','email','tel','number','date','datetime-local','url','time','month','week','search'].includes(field.type) ? field.type : 'text';
      control.value=field.value || '';
    }
    control.required=true;
    for(const event of ['input','change'])control.addEventListener(event,()=>{editingStage='final';renderSaveAction();});
    label.append(control);document.querySelector('#form-fields').append(label);
    fieldControls.set(field.key,control);
  }
}
function readFields() {
  if (!currentForm) return null;
  const fields=currentForm.fields.map(field=>{
    const control=fieldControls.get(field.key);
    const value=['checkbox','radio'].includes(field.type) ? [...control.selectedOptions].map(option=>option.value).filter(Boolean) : control.value;
    if ((Array.isArray(value) ? !value.length : !value.trim()) || !control.checkValidity()) throw new Error(`${field.label}: 필수 값을 입력하세요.`);
    return {...field,value};
  });
  return {scope:currentForm.scope,fields};
}
function renderStage(profile) {
  currentStage=profile;stageControls.clear();document.querySelector('#stage-fields').replaceChildren();
  document.querySelector('#stage-settings').hidden=!profile;
  document.querySelector('#stage-scope').textContent=profile?.title || '';
  for(const field of profile?.fields || []) {
    const label=document.createElement('label');label.append(document.createTextNode(`${field.label} (${field.required?'필수':'추가'})`));
    const control=document.createElement('input');
    if(field.type==='quantity'){control.type='number';control.min='0';control.max='100';control.step='1';control.value=field.value;}
    else {control.type='checkbox';control.checked=field.value.includes('on');}
    for(const event of ['input','change'])control.addEventListener(event,()=>{editingStage='options';renderSaveAction();});
    label.append(control);if(field.description){const help=document.createElement('p');help.textContent=field.description;label.append(help);}
    document.querySelector('#stage-fields').append(label);stageControls.set(field.key,control);
  }
}
function readStage() {
  if(!currentStage || currentStage.scope!==scopeForUrl(form.elements.url.value))throw new Error('현재 상품의 중간 항목을 불러오세요.');
  return {...currentStage,fields:currentStage.fields.map(field=>{
    const control=stageControls.get(field.key),value=field.type==='quantity' ? String(Number(control.value)) : control.checked ? ['on'] : [];
    if(field.type==='quantity' && (control.value==='' || !/^\d+$/.test(control.value) || Number(value)>100))throw new Error(`${field.label}: 수량은 0~100의 정수로 입력하세요.`);
    if(field.type==='checkbox' && field.required && !value.length)throw new Error(`${field.label}: 필수 옵션을 선택하세요.`);
    return {...field,value};
  })};
}
function renderStageList(scope) {
  const stages=Object.values(stageProfiles[scope]?.stages || {});
  document.querySelector('#stage-list').replaceChildren();
  for(const stage of stages){
    const row=document.createElement('details');
    const summary=document.createElement('summary');summary.textContent=stage.title;row.append(summary);
    row.addEventListener('toggle',()=>{if(row.open){editingStage='options';renderStage(stage);renderPlan();}});
    const remove=document.createElement('button');remove.type='button';remove.textContent='이 단계 설정 삭제';remove.addEventListener('click',async()=>{
      const {stageProfiles:latest={}}=await chrome.storage.local.get('stageProfiles');
      const profile=latest[scope];if(profile){delete profile.stages[stage.stageKey];await chrome.storage.local.set({stageProfiles:latest});}
      stageProfiles[scope]=profile;renderStageList(scope);if(currentStage?.stageKey===stage.stageKey)renderStage(null);
    });row.append(remove);document.querySelector('#stage-list').append(row);
  }
}
async function saveStageSettings() {
  try{
    const stage=readStage(),{stageProfiles:latest={}}=await chrome.storage.local.get('stageProfiles');
    const profile=mergeStage(latest[stage.scope],stage);
    await chrome.storage.local.set({stageProfiles:{...latest,[stage.scope]:profile}});stageProfiles[stage.scope]=profile;
    renderStageList(stage.scope);inspectStatus.textContent='이 단계의 설정을 저장했습니다.';
  }catch(error){inspectStatus.textContent=error.message;}
}
function selectProfile() {
  inspectedStage=null;
  editingStage=null;lastAutomaticStep='';
  const scope=scopeForUrl(form.elements.url.value);
  renderPartyProfile(partyProfiles[scope] || (config?.partyComposition?.scope===scope ? config.partyComposition : null));
  renderFields(formProfiles[scope] || (config?.formPreferences?.scope === scope ? config.formPreferences : null));
  renderStage(null);
  renderStageList(scope);
  renderPlan().catch(error=>{inspectStatus.textContent=error.message;});
}
form.elements.url.addEventListener('change',selectProfile);
selectProfile();
function showScreen(response) {
  inspectedStage=response.stage;editingStage=response.stage;
  if(partyProfileScope!==response.scope)form.elements.usePartyComposition.checked=!!partyProfiles[response.scope];
  form.elements.url.value=response.scope;
  renderStage(null);renderStageList(response.scope);
  if(response.stage==='options'){
    const saved=Object.values(stageProfiles[response.scope]?.stages || {}).find(s=>stageKey(s.fields)===response.stageKey);
    renderStage({...response,fields:response.fields.map(f=>{const prev=saved?.fields.find(s=>s.key===f.key && s.type===f.type);return prev ? {...f,value:prev.value} : f.required && f.type==='checkbox' && f.options.length===1 && !f.options[0].disabled ? {...f,value:['on']} : f;})});
    renderPartyProfile(partyProfiles[response.scope] || null);renderFields(formProfiles[response.scope] || null);
    inspectStatus.textContent='수량·옵션 항목을 불러왔습니다. 설정 저장을 누르세요.';return;
  }
  if(response.stage==='composition') {
    const saved=partyProfiles[response.scope];
    const counts=response.fields.map(field=>({label:field.label,count:saved?.counts.find(row=>row.label===field.label)?.count ?? Number(field.value)}));
    form.elements.usePartyComposition.checked=true;
    if(guidedSetup || !form.elements.partySize.value)form.elements.partySize.value=String(response.people);
    renderPartyProfile({scope:response.scope,counts});
    renderFields(formProfiles[response.scope] || null);
    inspectStatus.textContent='인원 구성 항목을 불러왔습니다. 합계를 맞추고 저장하세요.';return;
  }
  if(partyProfileScope!==response.scope)renderPartyProfile(partyProfiles[response.scope] || null);
  const saved=formProfiles[response.scope];
  renderFields({...response,fields:response.fields.map(field=>{
    const previous=saved?.fields.find(item=>item.key===field.key && item.type===field.type);
    return previous ? {...field,value:previous.value} : field;
  })});
  inspectStatus.textContent=response.fields.length ? '최종 필수 항목을 불러왔습니다. 값을 지정하고 설정 저장을 누르세요.' : '최종 화면에 별도 필수 입력이 없습니다. 별도 설정 없이 준비되었습니다.';

}
async function rereadScreen() {
  inspectedStage=null;document.querySelector('#setup-next').disabled=true;
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id || !/^https:\/\/(m\.)?booking\.naver\.com\//.test(tab.url || ''))throw new Error('사전 설정으로 연 예약 화면을 먼저 열어 주세요.');
    const response=await chrome.tabs.sendMessage(tab.id,{type:'INSPECT_FORM'});
    if(!response?.ok)throw new Error(response?.error || '화면 읽기에 실패했습니다.');
    showScreen(response);document.querySelector('#inspect-form').hidden=true;
  }catch(error){inspectStatus.textContent=error.message;document.querySelector('#inspect-form').hidden=false;}
  finally {if(inspectedStage)editingStage=inspectedStage;await renderPlan();}
}
document.querySelector('#inspect-form').addEventListener('click',rereadScreen);
async function saveFinalSettings() {
  try {
    const profile=readFields();
    if (!profile) throw new Error('먼저 필수 항목을 불러오세요.');
    const {formProfiles:latest={},config:latestConfig={}}=await chrome.storage.local.get(['formProfiles','config']);
    Object.assign(formProfiles,latest,{[profile.scope]:profile});
    await chrome.storage.local.set({formProfiles:{...latest,[profile.scope]:profile}, config:{...latestConfig,url:profile.scope,formPreferences:profile}});
    inspectStatus.textContent='추가정보를 저장했습니다. 예약 진행 시 자동으로 적용됩니다.';
  } catch(error) {inspectStatus.textContent=error.message;}
}
function settingsStage() {
  return editingStage || inspectedStage || (currentStage ? 'options' : currentForm ? 'final' : partyProfileScope ? 'composition' : null);
}
function renderSaveAction() {
  const stage=settingsStage();
  const available=stage==='composition' ? !!partyProfileScope : stage==='options' ? !!currentStage : !!currentForm?.fields?.length;
  const guidedMid=guidedSetup && inspectedStage===stage && ['composition','options'].includes(stage);
  document.querySelector('#save-settings').hidden=!available || guidedMid || (guidedSetup && !inspectedStage);
  document.querySelector('#setup-next').hidden=!guidedMid;
  document.querySelector('#setup-next').disabled=!guidedMid;
}
document.querySelector('#save-settings').addEventListener('click',async()=>{
  const stage=settingsStage();
  if(stage==='composition')await savePartySettings();
  else if(stage==='options')await saveStageSettings();
  else if(stage==='final')await saveFinalSettings();
  await renderPlan();
});
async function render() {
  await renderPlan();
  const {job, logs = [],notificationDiagnostics} = await chrome.storage.local.get(['job', 'logs','notificationDiagnostics']);
  const notificationStatus=document.querySelector('#notification-status');
  notificationStatus.textContent=notificationDiagnostics?.detail || '예약을 시작하지 않고 알림 표시를 확인할 수 있습니다.';
  notificationStatus.classList.toggle('field-error',!!notificationDiagnostics && notificationDiagnostics.status!=='requested');
  if (logs.length > 10) await chrome.runtime.sendMessage({type: 'PRUNE_LOGS'});
  status.textContent = job?.status || '대기 중';
  document.querySelector('#logs').replaceChildren(...logs.slice(0, 10).map(entry => {
    const li = document.createElement('li'); li.textContent = `${new Date(entry.at).toLocaleTimeString()} ${entry.message}`; return li;
  }));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.dates = dateValues().filter(Boolean);
  data.times = data.times.split(',').map(t => t.trim()).filter(Boolean);
  data.autoConfirm = form.elements.autoConfirm.checked;
  try {
    data.url=scopeForUrl(data.url);
    data.partyComposition=form.elements.usePartyComposition.checked ? readPartyProfile() : null;
    data.usePartyComposition=form.elements.usePartyComposition.checked;
    if(data.partyComposition){const {partyProfiles:latest={}}=await chrome.storage.local.get('partyProfiles');await chrome.storage.local.set({partyProfiles:{...latest,[data.partyComposition.scope]:data.partyComposition}});}
    const {stageProfiles:latestStages={}}=await chrome.storage.local.get('stageProfiles');
    data.stagePreferences=latestStages[scopeForUrl(data.url)] || null;
    data.formPreferences = currentForm?.scope === scopeForUrl(data.url) ? readFields() : null;
    if(data.formPreferences){const {formProfiles:latest={}}=await chrome.storage.local.get('formProfiles');await chrome.storage.local.set({formProfiles:{...latest,[data.formPreferences.scope]:data.formPreferences}});}
    const response = await chrome.runtime.sendMessage({type: 'START', config: data});
    if (!response.ok) throw new Error(response.error);
    await chrome.storage.local.set({config: data});
    await render();
  } catch (error) {status.textContent = error.message;}
});
document.querySelector('#stop').addEventListener('click', async () => {await chrome.runtime.sendMessage({type: 'STOP'}); await render();});
document.querySelector('#test-notification').addEventListener('click',async()=>{
  const button=document.querySelector('#test-notification'),notice=document.querySelector('#notification-status');
  button.disabled=true;
  try {
    const result=await chrome.runtime.sendMessage({type:'TEST_NOTIFICATION'});
    notice.textContent=result?.detail || result?.error || '알림 요청 결과를 받지 못했습니다. 확장을 다시 로드하세요.';
    notice.classList.toggle('field-error',!result?.ok);
  }catch(error){notice.textContent=error.message;notice.classList.add('field-error');}
  finally{button.disabled=false;}
});
chrome.storage.onChanged.addListener(render);
await render();
