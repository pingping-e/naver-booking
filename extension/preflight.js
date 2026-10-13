// Compare the observed setup route with product-specific saved settings.
export const stageKey=fields=>`options:${JSON.stringify(fields.map(f=>[f.key,f.type,!!f.required]))}`;
export const stepSchema=step=>JSON.stringify(step.fields.map(f=>[f.key,f.type,!!f.required,(f.options || []).map(o=>[o.value,o.label,!!o.disabled])]));
export function preflight(plan, config) {
  if(!plan)return [];
  const automatic=f=>['checkbox','radio','select','customselect'].includes(f.type) && f.options?.filter(o=>o.value!=='').length===1 && !f.options.filter(o=>o.value!=='')[0].disabled;
  const schema=(fields,saved)=>Array.isArray(saved) && saved.length===fields.length && new Set(saved.map(f=>f.key)).size===saved.length && fields.every(f=>saved.some(s=>s.key===f.key && s.type===f.type));
  return plan.steps.map(step=>{
    let error='';
    if(step.stage==='composition') {
      const counts=config.partyComposition?.counts;
      if(!counts || counts.length!==step.fields.length || step.fields.some(f=>!counts.some(c=>c.label===f.label)))error='인원 구성 설정 필요';
      else if(counts.reduce((s,c)=>s+Number(c.count),0)!==Number(config.partySize))error='인원 구성 합계 확인 필요';
    } else {
      const saved=step.stage==='final' ? config.formPreferences?.fields : Object.values(config.stagePreferences?.stages || {}).find(s=>stageKey(s.fields)===step.stageKey)?.fields;
      if(saved && !schema(step.fields,saved))error='저장한 항목이 변경됨 — 다시 불러오기 필요';
      else {
        const missing=step.fields.filter(f=>{
          const entry=saved?.find(s=>s.key===f.key);
          if(!entry)return step.stage==='options' ? !(f.required && f.type==='checkbox' && automatic(f)) : !automatic(f);
          const value=entry.value;
          if(f.type==='quantity')return !/^\d+$/.test(String(value)) || Number(value)>100;
          if(['checkbox','radio'].includes(f.type))return !Array.isArray(value) || ((step.stage==='final' || f.required) && !value.length) || value.some(v=>!f.options.some(o=>o.value===v && !o.disabled));
          if(['select','customselect'].includes(f.type))return !f.options.some(o=>o.value===value && value!=='' && !o.disabled);
          return typeof value!=='string' || !value.trim();
        });
        if(missing.length)error=`값 지정 필요: ${missing.map(f=>f.label).join(' · ')}`;
      }
    }
    return {key:step.stageKey,title:step.title,ready:!error,error};
  });
}
