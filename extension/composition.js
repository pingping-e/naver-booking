globalThis.NaverBookingComposition = {
  widget(root) {
    const identified=root.querySelector('[data-testid="gbw-flow-step2"]');
    if(identified)return identified;
    const titles=[...root.querySelectorAll('[role="heading"], h1, h2, h3, p')].filter(el=>/\d+\s*명의\s*인원\s*구성|choose\s+a\s+\d+-person\s+option/i.test(el.textContent) && el.getClientRects().length);
    const matches=[];
    for(const title of titles){
      let node=title.parentElement;
      while(node && node!==root.body){
        if(node.querySelector('[role="status"][aria-label]') && node.querySelector('button[aria-label$=" 증가"], button[aria-label$=" 감소"]')){matches.push(node);break;}
        node=node.parentElement;
      }
    }
    const unique=[...new Set(matches)];
    if(unique.length>1)throw new Error('인원 구성 화면이 여러 개입니다.');
    return unique[0] || null;
  },
  total(root) {
    const widget=this.widget(root);
    const title=widget?.querySelector('[role="heading"], h1, h2, h3, p')?.textContent || '';
    const match=title.match(/(\d+)\s*명의\s*인원\s*구성|(?:choose\s+a\s+)(\d+)-person\s+option/i);
    return match ? Number(match[1] || match[2]) : null;
  },
  verify(root, counts, people) {
    const rows=this.discover(root);
    if(this.total(root)!==people || rows.length!==counts.length || rows.some(row=>row.count!==counts.find(item=>item.label===row.label)?.count))throw new Error('인원 구성 적용 결과가 다릅니다.');
  },
  discover(root) {
    const widget=this.widget(root);
    if(!widget)throw new Error('인원 구성 화면을 먼저 열어 주세요.');
    const seen=new Set();
    const rows=[...widget.querySelectorAll('[role="status"][aria-label]')].map(control=>{
      const name=control.getAttribute('aria-label');
      const label=name.replace(/\s+수량$/, '').trim();
      const count=Number(control.textContent.trim());
      if(label===name || !label || seen.has(label) || !/^\d+$/.test(control.textContent.trim()) || !Number.isInteger(count) || count>100)throw new Error('인원 구성 항목을 정확하게 구분하지 못했습니다.');
      seen.add(label);return {label,count,control};
    });
    if(!rows.length || rows.length>20)throw new Error('인원 구성 입력을 찾지 못했습니다.');
    return rows;
  },
  async apply(root, counts, people, active) {
    const widget=this.widget(root);
    if(this.total(root)!==people)throw new Error('인원 구성 화면의 총인원이 설정과 다릅니다.');
    if(!Array.isArray(counts) || counts.some(row=>!Number.isInteger(row.count) || row.count<0 || row.count>100) || counts.reduce((sum,row)=>sum+row.count,0)!==people)throw new Error('인원 구성 합계가 예약 인원과 다릅니다.');
    const rows=this.discover(root);
    if(rows.length!==counts.length || new Set(counts.map(row=>row.label)).size!==counts.length || rows.some(row=>!counts.some(item=>item.label===row.label)))throw new Error('인원 구성 항목이 변경되었습니다. 다시 불러와 저장하세요.');
    const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
    const change=async(label,target)=>{
      for(let step=0;step<100;step++){
        if(!await active())throw new Error('작업이 중지되었습니다.');
        const row=this.discover(root).find(item=>item.label===label);
        if(!row)throw new Error('인원 구성 항목이 변경되었습니다.');
        if(row.count===target)return;
        const direction=row.count<target ? 1 : -1;
        const name=row.control.getAttribute('aria-label')+(direction>0 ? ' 증가' : ' 감소');
        const buttons=[...widget.querySelectorAll('button[aria-label]')].filter(el=>el.getAttribute('aria-label')===name);
        if(buttons.length!==1 || !visible(buttons[0]) || buttons[0].disabled || buttons[0].getAttribute('aria-disabled')==='true')throw new Error(`${label} ${target}명을 적용할 수 없습니다.`);
        buttons[0].click();
        const end=Date.now()+15000;
        let changed=false;
        do {
          if(!await active())throw new Error('작업이 중지되었습니다.');
          const current=this.discover(root).find(item=>item.label===label);
          if(current?.count===row.count+direction){changed=true;break;}
          await new Promise(resolve=>setTimeout(resolve,150));
        }while(Date.now()<end);
        if(!changed)throw new Error(`${label} 인원 변경을 확인하지 못했습니다.`);
      }
      if(this.discover(root).find(row=>row.label===label)?.count!==target)throw new Error('인원 구성 적용에 실패했습니다.');
    };
    // Reduce existing categories first so the site's total limit is respected.
    for(const row of rows){const target=counts.find(item=>item.label===row.label).count;if(row.count>target)await change(row.label,target);}
    for(const row of counts)await change(row.label,row.count);
    this.verify(root,counts,people);
  }
};
