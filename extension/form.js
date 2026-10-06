// Discover required fields from the user's logged-in reservation request page.
globalThis.NaverBookingForm = {
  clean(text) { return text.replace(/\s+/g, ' ').replace(/[*＊]?\s*(?:필수|required)/gi, '').trim(); },
  selectedText(button) {return button.querySelector('[class*="Select__text__"]')?.textContent.trim() || '';},
  discover(root) {
    const fields = [], consumed = new Set();
    const add = (label, controls) => {
      if (!controls.length) throw new Error(`${label}: 지원하는 필수 입력 요소를 찾지 못했습니다.`);
      controls.forEach(el => consumed.add(el));
      const first = controls[0];
      const type = first.getAttribute('aria-haspopup') === 'listbox' ? 'customselect' : first.tagName === 'SELECT' ? 'select' : first.tagName === 'TEXTAREA' ? 'textarea' : first.type || 'text';
      if (first.multiple && type === 'select') throw new Error(`${label}: 다중 선택 드롭다운은 직접 입력하세요.`);
      if (['checkbox', 'radio'].includes(type) && controls.some(control => control.type !== type)) throw new Error(`${label}: 혼합된 입력 요소는 직접 입력하세요.`);
      if (['password', 'file', 'hidden', 'submit', 'button'].includes(type)) throw new Error(`${label}: 자동 입력을 지원하지 않는 항목입니다.`);
      if (!['checkbox', 'radio'].includes(type) && controls.length !== 1) throw new Error(`${label}: 입력란을 구분하지 못했습니다.`);
      const key = `field:${label}`;
      if (fields.some(field => field.key === key)) throw new Error(`${label}: 동일한 이름의 필수 항목이 여러 개입니다.`);
      const options = ['checkbox', 'radio'].includes(type)
        ? controls.map(el => ({value: el.value, label: this.clean(el.closest('label')?.textContent || el.value), disabled: el.disabled || el.getAttribute('aria-disabled') === 'true'}))
        : type === 'select' ? [...first.options].map(el => ({value: el.value, label: el.textContent.trim(), disabled: el.disabled})) : [];
      if (options.length && new Set(options.map(option => option.value)).size !== options.length) throw new Error(`${label}: 옵션 값을 구분하지 못했습니다.`);
      const value = type === 'customselect' ? this.selectedText(first) : ['checkbox', 'radio'].includes(type) ? controls.filter(el => el.checked).map(el => el.value) : first.value;
      fields.push({key, label, type, options, value, controls});
    };
    const titles = [...root.querySelectorAll('.booking_inner .form_title')].filter(el => el.querySelector('.necessary_text') || el.getAttribute('aria-required') === 'true');
    for (const title of titles) {
      add(this.clean(title.textContent), [...title.parentElement.querySelectorAll('input:not([type="hidden"]), select, textarea')]);
    }
    for (const group of root.querySelectorAll('[class*="ExtraInputForm__field__"][role="group"]')) {
      const title=group.querySelector('[class*="ExtraInputForm__title__"]');
      if (!title?.querySelector('[class*="ExtraInputForm__required__"]')) continue;
      add(this.clean(title.textContent), [...group.querySelectorAll('input:not([type="hidden"]), select, textarea, button[aria-haspopup="listbox"]')]);
    }
    for (const control of root.querySelectorAll('input[required], select[required], textarea[required], input[aria-required="true"], select[aria-required="true"], textarea[aria-required="true"]')) {
      if (consumed.has(control) || control.disabled) continue;
      const label = this.clean(control.labels?.[0]?.textContent || control.getAttribute('aria-label') || control.name || control.id);
      if (!label) throw new Error('필수 입력란의 이름을 읽지 못했습니다.');
      if (['checkbox', 'radio'].includes(control.type) && control.name) {
        const controls = [...root.querySelectorAll('input')].filter(el => el.type === control.type && el.name === control.name);
        add(label, controls);
      } else add(label, [control]);
    }
    if (!fields.length) throw new Error('필수 입력란을 찾지 못했습니다. 최종 예약 신청 화면에서 불러오세요.');
    return fields;
  },
  async fill(root, preferences, active = async () => true) {
    const fields = this.discover(root);
    const saved = Array.isArray(preferences) ? new Map(preferences.map(field => [field.key, field])) : null;
    for (const field of fields) {
      let desired;
      if (saved) {
        const setting = saved.get(field.key);
        if (!setting || setting.type !== field.type) throw new Error(`${field.label}: 저장한 필수 입력 설정이 없습니다. 다시 불러오세요.`);
        desired = setting.value;
      } else {
        const key = field.label.startsWith('시술 선택') ? 'treatment' : field.label.startsWith('내원 경로') ? 'source' : null;
        if (!key) throw new Error(`${field.label}: 최종 페이지에서 필수 입력을 미리 설정하세요.`);
        desired = [preferences[key]];
      }
      if (field.type === 'customselect') {
        if (typeof desired !== 'string' || !desired.trim()) throw new Error(`${field.label}: 선택할 문구를 지정하세요.`);
        const button=field.controls[0];
        if (!await active()) throw new Error('작업이 중지되었습니다.');
        if (this.selectedText(button) === desired) continue;
        const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
        const enabled=el=>visible(el) && !el.disabled && el.getAttribute('aria-disabled')!=='true';
        if (!enabled(button)) throw new Error(`${field.label}: 선택 목록을 열 수 없습니다.`);
        button.click();
        const wait=async fn=>{const end=Date.now()+15000;do{if(!await active())throw new Error('작업이 중지되었습니다.');const result=fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,150));}while(Date.now()<end);return null;};
        const list=await wait(()=>{
          const id=button.getAttribute('aria-controls');
          const lists=[...root.querySelectorAll('[role="listbox"]')].filter(visible).filter(el=>!id || el.id===id);
          if(lists.length>1)throw new Error(`${field.label}: 선택 목록을 구분하지 못했습니다.`);
          return lists[0];
        });
        if (!list) throw new Error(`${field.label}: 선택 목록이 준비되지 않았습니다.`);
        const choices=[...list.querySelectorAll('[role="option"]')].filter(el=>el.textContent.trim()===desired && enabled(el));
        if (choices.length!==1) throw new Error(`${field.label}: 지정한 옵션을 정확하게 찾지 못했습니다.`);
        if (!await active()) throw new Error('작업이 중지되었습니다.');
        choices[0].click();
        if (!await wait(()=>this.selectedText(button)===desired)) throw new Error(`${field.label}: 선택 결과를 확인하지 못했습니다.`);
      } else if (['checkbox', 'radio'].includes(field.type)) {
        const values = Array.isArray(desired) ? desired : [desired];
        if (!values.length || (field.type === 'radio' && values.length !== 1)) throw new Error(`${field.label}: 필수 선택 값을 지정하세요.`);
        for (const value of values) {
          if (!field.options.some(option => option.value === value && !option.disabled)) throw new Error(`${field.label}: 지정한 옵션을 선택할 수 없습니다.`);
        }
        for (const input of field.controls) {
          const wanted = values.includes(input.value);
          if (input.checked === wanted) continue;
          if (!await active()) throw new Error('작업이 중지되었습니다.');
          if (input.disabled) throw new Error(`${field.label}: 기존 선택을 변경할 수 없습니다.`);
          (input.closest('label') || input).click();
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        if (field.controls.some(input => input.checked !== values.includes(input.value))) throw new Error(`${field.label}: 선택 결과를 확인하지 못했습니다.`);
      } else {
        if (typeof desired !== 'string' || !desired.trim()) throw new Error(`${field.label}: 필수 입력 값을 지정하세요.`);
        if (field.type === 'select' && !field.options.some(option => option.value === desired && !option.disabled)) throw new Error(`${field.label}: 지정한 옵션을 선택할 수 없습니다.`);
        if (!await active()) throw new Error('작업이 중지되었습니다.');
        const input = field.controls[0];
        if (input.disabled || input.readOnly) {
          if (input.value !== desired) throw new Error(`${field.label}: 입력값을 변경할 수 없습니다.`);
        } else {
          const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, desired);
          input.dispatchEvent(new Event('input', {bubbles: true}));
          input.dispatchEvent(new Event('change', {bubbles: true}));
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        if (input.value !== desired || !input.checkValidity()) throw new Error(`${field.label}: 입력 결과가 유효하지 않습니다.`);
      }
    }
    if (saved && [...saved.keys()].some(key => !fields.some(field => field.key === key))) throw new Error('저장한 필수 항목과 현재 화면이 다릅니다. 다시 불러오세요.');
  }
};
if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['INSPECT_FORM','APPLY_FORM'].includes(message.type)) return;
  (async()=>{
    if (!/^\/booking\/\d+\/bizes\/\d+\/items\/\d+\/request(?:\/link)?\/?$/.test(location.pathname)) throw new Error('최종 예약 신청 페이지에서 불러오세요.');
    const scope=location.origin + location.pathname.replace(/\/request(?:\/link)?\/?$/, '');
    if(message.type==='APPLY_FORM') {
      if(message.profile?.scope!==scope)throw new Error('저장한 설정과 현재 예약 상품이 다릅니다.');
      const href=location.href;
      await NaverBookingForm.fill(document,message.profile.fields,async()=>location.href===href);
      return {ok:true};
    }
    const fields = NaverBookingForm.discover(document).map(({controls, ...field}) => field);
    return {ok: true, scope, fields};
  })().then(respond,error=>respond({ok:false,error:error.message}));
  return true;
});
