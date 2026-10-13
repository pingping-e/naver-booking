// Intermediate product quantities and options. Labels come from the current DOM.
globalThis.NaverBookingStages = {
  key(fields) {return `options:${JSON.stringify(fields.map(f=>[f.key,f.type,!!f.required]))}`;},
  visible(el) { return !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'; },
  enabled(el) { return this.visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !/Disabled|(?:^|[ _-])disabled(?:[ _-]|$)/i.test(el.className || ''); },
  discover(root) {
    const fields = [], sections = [];
    const add = field => {
      if (!field.label || fields.some(item => item.key === field.key)) throw new Error('중간 단계 항목 이름이 없거나 중복됩니다. 화면을 확인하세요.');
      fields.push(field);
    };
    for (const section of root.querySelectorAll('.section_option')) {
      if (!this.visible(section)) continue;
      const title = section.querySelector('.section_title')?.textContent.trim();
      if (!title) throw new Error('옵션 단계 제목을 읽지 못했습니다.');
      const required = /필수|required/i.test(title);
      const sectionFields = [];
      for (const item of section.querySelectorAll('.option_item')) {
        const checkbox = item.querySelector('input[type="checkbox"]');
        const count = item.querySelector('[class*="Count__control_wrap__"]');
        if (!checkbox && !count) throw new Error(`${title}: 지원하지 않는 옵션 입력입니다.`);
        const label = (item.querySelector('.option_info .title, [class*="Count__info_name__"], [class*="Count__info_tit__"]')?.textContent || '').trim();
        if (checkbox && count) throw new Error(`${label}: 혼합된 옵션 입력을 구분하지 못했습니다.`);
        const description = item.querySelector('.desc, [class*="Count__info_desc__"]')?.textContent.trim() || '';
        const key = `${title}:${checkbox ? 'check' : 'quantity'}:${label}`;
        const field = {key,label,description,type:checkbox ? 'checkbox' : 'quantity',required,options:[],value:checkbox ? (checkbox.checked ? ['on'] : []) : '',controls:[]};
        if (checkbox) {
          field.options = [{value:'on',label,disabled:checkbox.disabled}];
          field.controls = [checkbox];
        } else {
          const value = [...count.children].find(el => el.tagName === 'SPAN');
          if (!value || !/^\d+$/.test(value.textContent.trim())) throw new Error(`${label}: 현재 수량을 읽지 못했습니다.`);
          field.value = value.textContent.trim();
          field.controls = [value];
          field.minus = count.querySelector('button[class*="Count__btn_minus__"]');
          field.plus = count.querySelector('button[class*="Count__btn_plus__"]');
          if (!field.minus || !field.plus) throw new Error(`${label}: 수량 버튼을 구분하지 못했습니다.`);
        }
        add(field);sectionFields.push(field);
      }
      if (sectionFields.length) sections.push(title);
    }
    if (!fields.length) return null;
    return {stage:'options',stageKey:this.key(fields),title:sections.join(' · '),fields};
  },
  serialize(stage) {
    return {...stage,fields:stage.fields.map(({controls,minus,plus,...field})=>field)};
  },
  automaticProfile(stage) {
    if(!stage.fields.every(f=>f.type==='checkbox' && f.required && f.options.length===1 && !f.options[0].disabled))return null;
    return {...this.serialize(stage),fields:this.serialize(stage).fields.map(f=>({...f,value:['on']}))};
  },
  validate(stage, profile) {
    if (!profile || !Array.isArray(profile.fields) || (profile.stageKey !== stage.stageKey && this.key(profile.fields)!==stage.stageKey)) throw new Error(`${stage.title}: 저장한 단계 설정이 없습니다. 현재 화면에서 불러와 저장하세요.`);
    if (new Set(profile.fields.map(f=>f.key)).size !== profile.fields.length || stage.fields.length !== profile.fields.length || stage.fields.some(f=>!profile.fields.some(s=>s.key===f.key && s.type===f.type && s.required===f.required))) throw new Error(`${stage.title}: 저장한 항목과 현재 화면이 다릅니다. 다시 불러와 저장하세요.`);
    for (const field of stage.fields) {
      const saved = profile.fields.find(f=>f.key===field.key);
      if (field.type === 'quantity') {
        if (!/^\d+$/.test(String(saved.value)) || Number(saved.value)>100) throw new Error(`${field.label}: 수량은 0~100의 정수로 지정하세요.`);
      } else if (!Array.isArray(saved.value) || saved.value.some(v=>v!=='on') || saved.value.length>1 || (field.required && !saved.value.length)) throw new Error(`${field.label}: 필수 옵션을 지정하세요.`);
    }
  },
  async apply(root, profile, active) {
    let stage = this.discover(root);
    if (!stage) throw new Error('저장한 중간 옵션 화면을 찾지 못했습니다.');
    this.validate(stage,profile); // Check the entire schema before the first mutation.
    const fresh = key => {
      const current=this.discover(root);if (!current) throw new Error('옵션 화면이 변경되었습니다.');
      this.validate(current,profile);return current.fields.find(f=>f.key===key);
    };
    const wait = async fn => {const end=Date.now()+15000;do {if (!await active()) throw new Error('작업이 중지되었습니다.');if(fn()) return;await new Promise(r=>setTimeout(r,100));} while(Date.now()<end);throw new Error('옵션 변경 결과를 확인하지 못했습니다.');};
    for (const saved of profile.fields) {
      if (!await active()) throw new Error('작업이 중지되었습니다.');
      let field = fresh(saved.key);
      if (field.type === 'checkbox') {
        const target=saved.value.length===1, input=field.controls[0];
        if (input.checked!==target) {
          if (input.disabled) throw new Error(`${field.label}: 옵션을 변경할 수 없습니다.`);
          (input.closest('label') || input).click();
          await wait(()=>fresh(saved.key).controls[0].checked===target);
        }
      } else {
        const target=Number(saved.value);
        for (let step=0;Number(field.value)!==target && step<100;step++) {
          if (!await active()) throw new Error('작업이 중지되었습니다.');
          const before=Number(field.value), direction=before<target ? 1 : -1;
          const button=direction>0 ? field.plus : field.minus;
          if (!this.enabled(button)) throw new Error(`${field.label}: 지정한 수량 ${target}을 선택할 수 없습니다.`);
          button.click();await wait(()=>Number(fresh(saved.key).value)===before+direction);
          field=fresh(saved.key);
        }
        if (Number(field.value)!==target) throw new Error(`${field.label}: 수량 적용에 실패했습니다.`);
      }
    }
    this.verify(root,profile);
  },
  verify(root,profile) {
    const stage=this.discover(root);if(!stage)throw new Error('옵션 화면이 변경되었습니다.');this.validate(stage,profile);
    if(stage.fields.some(f=>JSON.stringify(f.value)!==JSON.stringify(profile.fields.find(s=>s.key===f.key).value)))throw new Error('저장한 수량·옵션과 적용 결과가 다릅니다.');
  }
};
