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
if (config?.dates) config.dates.forEach((date, index) => {
  form.elements.namedItem(index === 0 ? 'date' : `date${index + 1}`).value = date;
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
  status.textContent = job?.status || '대기 중';
  document.querySelector('#logs').replaceChildren(...logs.map(entry => {
    const li = document.createElement('li'); li.textContent = `${new Date(entry.at).toLocaleTimeString()} ${entry.message}`; return li;
  }));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.dates = ['date', 'date2', 'date3', 'date4', 'date5'].map(name => data[name]).filter(Boolean);
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
