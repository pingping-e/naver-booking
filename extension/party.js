globalThis.NaverBookingParty = {
  async apply(root, target, active, {required = true} = {}) {
    if (target == null) return false;
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const enabled = el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !/Disabled|(?:^|[ _-])disabled(?:[ _-]|$)/i.test(el.className || '');
    const wait = async fn => { const end = Date.now() + 15000; do { if (!await active()) throw new Error('작업이 중지되었습니다.'); const result = fn();if (result) return result;await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < end);return null; };
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter.call(input, String(value));
      input.dispatchEvent(new Event('input', {bubbles:true}));input.dispatchEvent(new Event('change', {bubbles:true}));
    };
    const widget = root.querySelector('[data-testid="gbw-flow-step1"]');
    if (widget) {
      const read = () => Number(widget.getAttribute('data-gbw-step1-people'));
      if (read() === target) return true;
      const peopleSection = widget.querySelector('[class*="_sectionPeople_"]');
      const choicesIn = peopleSection || widget;
      const suffix = peopleSection ? '(?:명|people|persons?)?' : '(?:명|people|persons?)';
      const buttons = await wait(() => [...choicesIn.querySelectorAll('button')].filter(el => new RegExp(`^\\d+\\s*${suffix}$`, 'i').test(el.textContent.trim())).length);
      if (!buttons) throw new Error('인원 선택 화면이 준비되지 않았습니다.');
      const range = widget.querySelector('[data-testid="gbw-step1-selected-product"]')?.textContent.match(/(\d+)\s*[~〜–-]\s*(\d+)\s*(?:명|people)/i);
      if (range && (target < Number(range[1]) || target > Number(range[2]))) throw new Error(`${target}명은 가게의 허용 인원(${range[1]}~${range[2]}명)을 벗어납니다.`);
      const choices = [...choicesIn.querySelectorAll('button')].filter(el => new RegExp(`^${target}\\s*${suffix}$`, 'i').test(el.textContent.trim()));
      if (choices.length > 1) throw new Error('같은 인원 선택지가 여러 개입니다. 화면을 확인하세요.');
      if (choices.length) {
        if (!enabled(choices[0])) throw new Error(`${target}명은 선택할 수 없습니다.`);
        if (!await active()) throw new Error('작업이 중지되었습니다.');
        choices[0].click();
      } else {
        const custom = widget.querySelector('[class*="_textArea_"]');
        if (!custom || !enabled(custom)) throw new Error(`${target}명 인원을 선택할 수 없습니다.`);
        custom.click();
        const input = await wait(() => [...widget.querySelectorAll('input')].find(visible));
        if (!input) throw new Error('인원 직접 입력란을 찾지 못했습니다.');
        if ((input.min && target < Number(input.min)) || (input.max && target > Number(input.max))) throw new Error(`${target}명은 가게의 허용 인원을 벗어납니다.`);
        setValue(input, target);
        const apply = await wait(() => [...widget.querySelectorAll('button')].find(el => /^(적용|Apply)$/i.test(el.textContent.trim()) && enabled(el)));
        if (!apply) throw new Error(`${target}명을 적용할 수 없습니다. 가게의 허용 인원을 확인하세요.`);
        if (!await active()) throw new Error('작업이 중지되었습니다.');
        apply.click();
      }
      if (!await wait(() => read() === target)) throw new Error('선택한 예약 인원을 확인하지 못했습니다.');
      return true;
    }
    const findGroup = () => [...root.querySelectorAll('.count_area, [data-booking-people]')].filter(el => visible(el) && /인원|명|people|persons?/i.test(el.textContent));
    let groups = findGroup();
    if (!groups.length && required) groups = await wait(() => { const result=findGroup();return result.length ? result : null; }) || [];
    if (!groups.length) { if (!required) return false;throw new Error('예약 인원 입력란을 찾지 못했습니다. 인원을 비우거나 화면을 확인하세요.'); }
    if (groups.length !== 1) throw new Error('인원 입력란이 여러 개입니다. 화면을 확인하세요.');
    const group=groups[0], inputs=[...group.querySelectorAll('input[type="number"]')];
    if(inputs.length>1)throw new Error('인원 입력이 여러 항목으로 나뉘어 있습니다. 화면에서 직접 설정하세요.');
    const input=inputs[0];
    if (input && !input.readOnly && !input.disabled) {
      if ((input.min && target < Number(input.min)) || (input.max && target > Number(input.max))) throw new Error(`${target}명은 가게의 허용 인원을 벗어납니다.`);
      if (!await active()) throw new Error('작업이 중지되었습니다.');
      setValue(input,target);
      await new Promise(resolve=>setTimeout(resolve,100));
      if (!await wait(()=>Number(input.value)===target)) throw new Error('예약 인원이 적용되지 않았습니다.');
      return true;
    }
    const value=group.querySelector('[data-count], .count, .count_num');
    const read=()=>Number(value?.getAttribute('data-count') ?? value?.textContent.trim());
    if (!Number.isInteger(read())) throw new Error('현재 예약 인원을 읽지 못했습니다.');
    for(let step=0;step<100 && read()!==target;step++) {
      const before=read(), direction=before<target ? 1 : -1;
      const button=group.querySelector(direction>0 ? '.btn_plus, [aria-label="인원 추가"]' : '.btn_minus, [aria-label="인원 감소"]');
      if (!button || !enabled(button)) throw new Error(`${target}명은 선택할 수 없습니다.`);
      if (!await active()) throw new Error('작업이 중지되었습니다.');
      button.click();
      if (!await wait(()=>read()===before+direction)) throw new Error('예약 인원 변경을 확인하지 못했습니다.');
    }
    if (read()!==target) throw new Error('예약 인원이 적용되지 않았습니다.');
    return true;
  }
};
