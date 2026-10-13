import test from 'node:test';
import assert from 'node:assert/strict';
import {preflight,stageKey} from '../extension/preflight.js';
const one={key:'field:notice',label:'notice',type:'customselect',options:[{value:'Confirmed',label:'Confirmed',disabled:false}],value:''};
const final=fields=>({stage:'final',stageKey:'final',title:'Final',fields});
test('single required choices and an empty final page need no saved profile',()=>{
 for(const fields of [[],[one],[{...one,type:'checkbox',value:[]}]])assert.equal(preflight({steps:[final(fields)]},{})[0].ready,true);
});
test('multiple choices, text, quantities and optional paid extras require explicit values',()=>{
 for(const f of [{...one,options:[...one.options,{value:'Other'}]},{...one,type:'text'},{...one,type:'quantity'},{...one,type:'checkbox',required:false}]) {
  const stage=f.type==='quantity' || (f.type==='checkbox' && !f.required) ? 'options':'final';
  const step={...final([f]),stage,stageKey:stage==='options'?stageKey([f]):'final'};
  assert.equal(preflight({steps:[step]},{})[0].ready,false);
 }
});
test('disabled alternatives are not treated as a single-answer question',()=>{
 assert.equal(preflight({steps:[final([{...one,options:[...one.options,{value:'Other',disabled:true}]}])]},{})[0].ready,false);
});
test('two intermediate pages with the same title stay separate and values are checked independently',()=>{
 const quantity=(key,value)=>({key,label:key,type:'quantity',required:true,value,options:[]});
 const a={stage:'options',title:'필수 옵션',fields:[quantity('tent','1')]};a.stageKey=stageKey(a.fields);
 const b={stage:'options',title:'필수 옵션',fields:[quantity('people','2')]};b.stageKey=stageKey(b.fields);
 assert.notEqual(a.stageKey,b.stageKey);
 const plan={steps:[a,b,final([])]},config={stagePreferences:{stages:{[a.stageKey]:a}}};
 assert.deepEqual(preflight(plan,config).map(s=>s.ready),[true,false,true]);
 config.stagePreferences.stages[b.stageKey]=b;
 assert.ok(preflight(plan,config).every(s=>s.ready));
 assert.equal(a.fields[0].value,'1');assert.equal(b.fields[0].value,'2');
});
test('saved unavailable values are never replaced with the only remaining option',()=>{
 const plan={steps:[final([one])]},config={formPreferences:{fields:[{...one,value:'Removed'}]}};
 assert.equal(preflight(plan,config)[0].ready,false);
});
