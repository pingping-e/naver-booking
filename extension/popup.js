const form = document.querySelector('form'), status = document.querySelector('#status');
const {config, formProfiles = {}} = await chrome.storage.local.get(['config', 'formProfiles']);
let currentForm = null;
const fieldControls = new Map();
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
      remove.addEventListener('click', () => { const dates = dateValues();dates.splice(index, 1);renderDates(dates); });
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
  dateFields.querySelector('.date-row:last-child input').focus();
});
let selectedTimes = [...new Set(config?.times || [])];
function renderTimes() {
  document.querySelector('#time-chips').replaceChildren(...selectedTimes.map((time, index) => {
    const chip = document.createElement('button');chip.type = 'button';chip.className = 'time-chip';chip.textContent = `${time} ×`;chip.setAttribute('aria-label', `${time} 삭제`);
    chip.addEventListener('click', () => { selectedTimes.splice(index, 1);renderTimes(); });
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
});
function scopeForUrl(value) {
  try { const url = new URL(value); return url.origin + url.pathname.replace(/\/$/, ''); } catch { return ''; }
}
function renderFields(profile) {
  currentForm = profile || null;
  fieldControls.clear();
  document.querySelector('#form-fields').replaceChildren();
  document.querySelector('#form-scope').textContent = profile ? `적용 상품: ${profile.scope}` : '아직 불러온 항목이 없습니다.';
  for (const field of profile?.fields || []) {
    const label = document.createElement('label');
    label.append(document.createTextNode(`${field.label} (필수)`));
    let control;
    if (['checkbox', 'radio', 'select'].includes(field.type)) {
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
function selectProfile() {
  const scope=scopeForUrl(form.elements.url.value);
  renderFields(formProfiles[scope] || (config?.formPreferences?.scope === scope ? config.formPreferences : null));
  document.querySelector('#clinic-presets').hidden=!/\/bizes\/1491414\/items\/7037654$/.test(scope);
}
form.elements.url.addEventListener('change',selectProfile);
selectProfile();
document.querySelector('#inspect-form').addEventListener('click',async()=>{
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !/^https:\/\/(m\.)?booking\.naver\.com\//.test(tab.url || '')) throw new Error('네이버 예약 신청 탭을 열고 다시 시도하세요.');
    const response=await chrome.tabs.sendMessage(tab.id,{type:'INSPECT_FORM'});
    if (!response.ok) throw new Error(response.error);
    form.elements.url.value=response.scope;
    document.querySelector('#clinic-presets').hidden=!/\/bizes\/1491414\/items\/7037654$/.test(response.scope);
    renderFields(formProfiles[response.scope] || response);
    status.textContent='필수 항목을 불러왔습니다. 값을 지정하고 저장하세요.';
  } catch(error) {status.textContent=error.message;}
});
document.querySelector('#save-fields').addEventListener('click',async()=>{
  try {
    const profile=readFields();
    if (!profile) throw new Error('먼저 필수 항목을 불러오세요.');
    const {formProfiles:latest={}}=await chrome.storage.local.get('formProfiles');
    Object.assign(formProfiles,latest,{[profile.scope]:profile});
    await chrome.storage.local.set({formProfiles, config:{...config,url:profile.scope,formPreferences:profile}});
    status.textContent='필수 입력을 저장했습니다. 감시 시작 시 적용됩니다. 실행 중이면 중지 후 다시 시작하세요.';
  } catch(error) {status.textContent=error.message;}
});
async function render() {
  const {job, logs = []} = await chrome.storage.local.get(['job', 'logs']);
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
    data.formPreferences = currentForm?.scope === scopeForUrl(data.url) ? readFields() : null;
    if (data.formPreferences) { formProfiles[data.formPreferences.scope]=data.formPreferences; await chrome.storage.local.set({formProfiles}); }
    const response = await chrome.runtime.sendMessage({type: 'START', config: data});
    if (!response.ok) throw new Error(response.error);
    await chrome.storage.local.set({config: data});
    await render();
  } catch (error) {status.textContent = error.message;}
});
document.querySelector('#stop').addEventListener('click', async () => {await chrome.runtime.sendMessage({type: 'STOP'}); await render();});
chrome.storage.onChanged.addListener(render);
await render();
