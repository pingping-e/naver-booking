// Discover required fields from the user's logged-in reservation request page.
globalThis.NaverBookingForm = {
  clean(text) { return text.replace(/\s+/g, ' ').replace(/[*＊]?\s*(?:필수|required)/gi, '').trim(); },
  selectedText(button) {
    const text=button.querySelector('[class*="Select__text__"]');
    return text?.className?.includes('is_placeholder') ? '' : text?.textContent.trim() || '';
  },
  automaticValue(field) {
    if (!['checkbox','radio','select','customselect'].includes(field.type)) return undefined;
    const choices=field.options.filter(option=>option.value!=='');
    if(choices.length!==1 || choices[0].disabled)return undefined;
    return ['checkbox','radio'].includes(field.type) ? [choices[0].value] : choices[0].value;
  },
  resolve(fields, preferences) {
    if(preferences!=null) {
      if(!Array.isArray(preferences))throw new Error('필수 입력 설정 형식이 올바르지 않습니다.');
      const saved=new Map(preferences.map(f=>[f.key,f]));
      if(saved.size!==preferences.length || saved.size!==fields.length || fields.some(f=>saved.get(f.key)?.type!==f.type))throw new Error('저장한 필수 항목과 현재 화면이 다릅니다. 다시 불러와 저장하세요.');
      return preferences;
    }
    return fields.map(({controls,...field})=>{
      const value=this.automaticValue(field);
      if(value===undefined)throw new Error(`${field.label}: 선택지 또는 입력값을 미리 지정해야 합니다. 예약 설정 시작으로 항목별 값을 상품별로 저장하세요.`);
      return {...field,value};
    });
  },
  async inspect(root, active = async()=>true) {
    const fields=this.discover(root,{allowEmpty:true});
    const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
    for(const field of fields.filter(f=>f.type==='customselect')) {
      const button=field.controls[0],before=this.selectedText(button);
      if(!await active())throw new Error('작업이 중지되었습니다.');
      if(!visible(button) || button.disabled || button.getAttribute('aria-disabled')==='true')throw new Error(`${field.label}: 선택 목록을 열 수 없습니다.`);
      try {
        if(button.getAttribute('aria-expanded')!=='true')button.click();
        let list;
        const end=Date.now()+5000;
        do {
          if(!await active())throw new Error('작업이 중지되었습니다.');
          const id=button.getAttribute('aria-controls');
          const lists=[...root.querySelectorAll('[role="listbox"]')].filter(visible).filter(el=>!id || el.id===id);
          if(lists.length>1)throw new Error(`${field.label}: 선택 목록을 구분하지 못했습니다.`);
          list=lists[0];if(list)break;
          await new Promise(r=>setTimeout(r,100));
        }while(Date.now()<end);
        if(!list)throw new Error(`${field.label}: 선택 목록이 준비되지 않았습니다.`);
        field.options=[...list.querySelectorAll('[role="option"]')].map(el=>({value:el.textContent.trim(),label:el.textContent.trim(),disabled:!!el.disabled || el.getAttribute('aria-disabled')==='true'}));
        if(!field.options.length || field.options.some(o=>!o.value) || new Set(field.options.map(o=>o.value)).size!==field.options.length)throw new Error(`${field.label}: 선택지를 정확하게 읽지 못했습니다.`);
      } finally {
        if(button.getAttribute('aria-expanded')==='true')button.click();
      }
      if(this.selectedText(button)!==before)throw new Error(`${field.label}: 목록 불러오기 중 선택값이 변경되었습니다.`);
    }
    return fields;
  },
  async ready(root,active=async()=>true) {
    let signature='',changedAt=Date.now();
    const end=Date.now()+15000;
    do {
      if(!await active())throw new Error('작업이 중지되었습니다.');
      const fields=this.discover(root,{allowEmpty:true});
      const next=JSON.stringify(fields.map(f=>[f.key,f.type,f.options]));
      if(next!==signature){signature=next;changedAt=Date.now();}
      if(Date.now()-changedAt>=1000)return;
      await new Promise(r=>setTimeout(r,150));
    }while(Date.now()<end);
    throw new Error('최종 필수 항목 화면이 계속 변경되어 입력하지 않았습니다.');
  },
  async applyStandalone(root) {
    const product=location.pathname.match(/^(\/booking\/\d+\/bizes\/\d+\/items\/\d+)(\/request(?:\/link)?)?\/?$/);
    if(!product)return;
    const run=async()=>{
      const match=location.pathname.match(/^(\/booking\/\d+\/bizes\/\d+\/items\/\d+)\/request(?:\/link)?\/?$/);
      if(!match || !root.querySelector('button[data-click-code="submitbutton.submit"]'))return false;
      const href=location.href,scope=location.origin+match[1],active=async()=>location.href===href;
      try {
        await this.ready(root,active);
        const {formProfiles={}}=await chrome.storage.local.get('formProfiles');
        const profile=formProfiles[scope];
        if(profile && (profile.scope!==scope || !Array.isArray(profile.fields)))throw new Error('저장한 최종 입력 설정 형식이 올바르지 않습니다. 다시 불러와 저장하세요.');
        const result=await this.fill(root,profile?.fields ?? null,active,{automaticOnly:!profile});
        this.notice(root,result.pending.length ? `확인 항목 ${result.applied}개 자동 선택. 사전 설정 필요: ${result.pending.join(' · ')}` : `필수 항목 ${result.applied}개를 적용했습니다. 예약 내용을 확인하세요. 신청·결제 버튼은 누르지 않았습니다.`);
      }catch(error){if(await active())this.notice(root,`입력 중지: ${error.message}`);}
      return true;
    };
    if(await run())return;
    let running=false;
    const observer=new MutationObserver(async()=>{
      if(running)return;
      if(location.origin+location.pathname!==location.origin+product[1] && !location.pathname.startsWith(product[1]+'/request')){observer.disconnect();return;}
      running=true;
      try{if(await run())observer.disconnect();}finally{running=false;}
    });
    observer.observe(root.documentElement,{childList:true,subtree:true});
  },
  notice(root,message) {
    let box=root.getElementById('naver-booking-input-status');
    if(!box){box=root.createElement('div');box.id='naver-booking-input-status';box.setAttribute('role','status');box.setAttribute('aria-live','polite');root.body.prepend(box);}
    box.style.cssText='position:sticky;top:0;z-index:2147483647;box-sizing:border-box;width:100%;padding:20px 24px;margin:0 0 16px;background:#f0fff5;border:2px solid #03c75a;border-radius:10px;color:#123823;font:600 18px/1.6 system-ui;box-shadow:0 4px 16px #0002;max-height:30vh;overflow:auto;';
    if(box.textContent!==message)box.textContent=message;
  },
  discover(root, {allowEmpty = false} = {}) {
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
    for (const label of root.querySelectorAll('[class*="RequestV2__checkbox_agree_all__"] label')) {
      if (!label.querySelector('[class*="RequestV2__required__"]')) continue;
      const controls=[...label.querySelectorAll('input[type="checkbox"]')];
      if (controls.length!==1) throw new Error('필수 동의 체크박스를 정확하게 구분하지 못했습니다.');
      if (consumed.has(controls[0])) continue;
      add(this.clean(label.querySelector('[class*="Checkbox__label__"]')?.textContent || label.textContent), controls);
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
    if (!fields.length && !allowEmpty) throw new Error('필수 입력란을 찾지 못했습니다. 최종 예약 신청 화면에서 불러오세요.');
    return fields;
  },
  async fill(root, preferences, active = async () => true, {automaticOnly=false}={}) {
    let fields=preferences==null ? await this.inspect(root,active) : this.discover(root,{allowEmpty:true});
    const pending=automaticOnly ? fields.filter(f=>this.automaticValue(f)===undefined).map(f=>f.label) : [];
    if(automaticOnly)fields=fields.filter(f=>this.automaticValue(f)!==undefined);
    preferences=this.resolve(fields,preferences);
    if (!Array.isArray(preferences)) throw new Error('현재 화면의 필수 입력을 불러와 저장하세요.');
    const saved = new Map(preferences.map(field => [field.key, field]));
    if (saved.size !== preferences.length || saved.size !== fields.length || fields.some(field=>saved.get(field.key)?.type!==field.type)) throw new Error('저장한 필수 항목과 현재 화면이 다릅니다. 다시 불러와 저장하세요.');
    for (const field of fields) {
      const desired = saved.get(field.key).value;
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
    return {applied:fields.length,pending};
  }
};
if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['INSPECT_FORM','APPLY_FORM','APPLY_STAGE','APPLY_PARTY'].includes(message.type)) return;
  (async()=>{
    const match=location.pathname.match(/^(\/booking\/\d+\/bizes\/\d+\/items\/\d+)(\/request(?:\/link)?)?\/?$/);
    if(!match)throw new Error('예약 상품 또는 최종 신청 화면에서 불러오세요.');
    const scope=location.origin+match[1], href=location.href,path=location.origin+location.pathname;
    // The restaurant widget encodes quantity changes in gbwState on each click.
    const active=async()=>location.origin+location.pathname===path && (!match[2] || location.href===href);
    if(message.type!=='INSPECT_FORM' && message.profile?.scope!==scope)throw new Error('저장한 설정과 현재 예약 상품이 다릅니다.');
    if(!match[2] && NaverBookingComposition.widget(document)) {
      if(message.type==='APPLY_PARTY') {
        await NaverBookingComposition.apply(document,message.profile.counts,message.people,active);return {ok:true};
      }
      if(message.type!=='INSPECT_FORM')throw new Error('현재 인원 구성 화면에는 인원 구성 적용 버튼을 사용하세요.');
      const fields=NaverBookingComposition.discover(document).map(({label,count})=>({key:`count:${label}`,label,type:'number',value:String(count),options:[]}));
      return {ok:true,stage:'composition',people:NaverBookingComposition.total(document),scope,fields};
    }
    if(!match[2]) {
      const stage=NaverBookingStages.discover(document);
      if(!stage)throw new Error('수량·옵션 화면이나 인원 구성·최종 신청 화면을 먼저 열어 주세요.');
      if(message.type==='APPLY_STAGE'){await NaverBookingStages.apply(document,message.profile,active);return {ok:true};}
      if(message.type!=='INSPECT_FORM')throw new Error('현재 중간 단계에는 단계 입력 적용 버튼을 사용하세요.');
      return {ok:true,scope,...NaverBookingStages.serialize(stage)};
    }
    if(message.type==='APPLY_FORM') {
      if(!document.querySelector('button[data-click-code="submitbutton.submit"]'))throw new Error('최종 신청 화면이 준비되지 않았습니다.');
      await NaverBookingForm.fill(document,message.profile.fields,active);return {ok:true};
    }
    if(message.type!=='INSPECT_FORM')throw new Error('최종 화면에는 추가정보 입력 적용 버튼을 사용하세요.');
    if(!document.querySelector('button[data-click-code="submitbutton.submit"]'))throw new Error('최종 신청 화면이 준비되지 않았습니다.');
    await NaverBookingForm.ready(document,active);
    const fields=(await NaverBookingForm.inspect(document,active)).map(({controls,...field})=>{
      const value=NaverBookingForm.automaticValue(field);
      return value===undefined ? field : {...field,value,automatic:true};
    });
    return {ok:true,stage:'final',scope,fields};
  })().then(async result=>{
    if(message.type==='INSPECT_FORM') {
      const {setup}=await chrome.runtime.sendMessage({type:'CONTEXT'});
      if(setup?.active && setup.scope===result.scope) {
        const step={stage:result.stage,stageKey:result.stage==='options'?result.stageKey:result.stage,title:result.title || (result.stage==='final'?'최종 신청 추가정보':'인원 구성 · 이용료 수량'),fields:result.fields,...(result.people?{people:result.people}:{})};
        const saved=await chrome.runtime.sendMessage({type:'SETUP_STAGE',id:setup.id,scope:setup.scope,step});
        if(!saved?.ok)throw new Error(saved?.error || '사전 설정 단계 기록 실패');
        NaverBookingForm.notice(document,result.stage==='final' ? '마지막 화면까지 확인했습니다. 확장에서 추가정보를 저장하세요.' : '예약 설정 중 · 현재 화면을 다시 읽었습니다. 확장에서 값을 입력하고 저장하고 다음을 누르세요.');
      }
    }
    return result;
  }).then(respond,error=>respond({ok:false,error:error.message}));
  return true;
});
