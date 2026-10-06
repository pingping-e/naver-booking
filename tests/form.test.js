import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/form.js';
const fill=(...args)=>globalThis.NaverBookingForm.fill(...args);
function group(name, values, selected=[], disabled=[]) {
 const inputs=values.map(value=>({tagName:'INPUT',type:'checkbox',value,checked:selected.includes(value),disabled:disabled.includes(value),getAttribute(){return null;},closest(){return {click:()=>{this.checked=!this.checked;}};}}));
 return {textContent:name+'필수',querySelector(){return {};},parentElement:{querySelectorAll(){return inputs;}},inputs};
}
const root=groups=>({querySelectorAll(selector){return selector === '.booking_inner .form_title' ? groups : [];}});
const prefs={treatment:'필러',source:'유튜브'};
test('select configured values and remove unrelated existing choices',async()=>{
 const groups=[group('시술 선택',['보톡스','필러'],['보톡스']),group('내원 경로',['네이버 검색','유튜브'])];
 await fill(root(groups),prefs);
 assert.deepEqual(groups.map(g=>g.inputs.filter(i=>i.checked).map(i=>i.value)),[['필러'],['유튜브']]);
});
test('already matching preferences stay selected',async()=>{
 const groups=[group('시술 선택',['필러'],['필러']),group('내원 경로',['유튜브'],['유튜브'])];
 await fill(root(groups),prefs);
 assert.ok(groups.every(g=>g.inputs[0].checked));
});
test('unavailable preferences never choose a substitute',async()=>{
 for(const g of [group('시술 선택',['다른 시술']),group('시술 선택',['필러'],[],['필러'])]) {
  await assert.rejects(fill(root([g]),prefs),/지정한 옵션/);
  assert.equal(g.inputs[0].checked,false);
 }
});
test('unknown required groups and missing known groups stop the workflow',async()=>{
 await assert.rejects(fill(root([group('새 필수 질문',['선택'])]),prefs),/미리 설정/);
 await assert.rejects(fill(root([]),prefs),/필수 입력란/);
});
test('stop prevents form clicks',async()=>{
 const g=group('시술 선택',['필러']);
 await assert.rejects(fill(root([g]),prefs,async()=>false),/중지/);
 assert.equal(g.inputs[0].checked,false);
});

test('generic saved checkbox fields support other shops without clinic defaults',async()=>{
 const groups=[group('좌석 선택',['창가','안쪽'])];
 const settings=[{key:'field:좌석 선택',type:'checkbox',value:['안쪽']}];
 await fill(root(groups),settings);
 assert.deepEqual(groups[0].inputs.map(i=>i.checked),[false,true]);
});
test('missing and changed saved fields stop instead of guessing',async()=>{
 const groups=[group('좌석 선택',['창가','안쪽'])];
 await assert.rejects(fill(root(groups),[]),/설정이 없습니다/);
 await assert.rejects(fill(root(groups),[{key:'field:좌석 선택',type:'radio',value:['창가']}]),/설정이 없습니다/);
});
test('generic text values dispatch input and change for controlled fields',async()=>{
 class Input {
  constructor(){this.tagName='INPUT';this.type='text';this._value='';this.events=[];}
  get value(){return this._value;}
  set value(value){this._value=value;}
  checkValidity(){return this._value.length>0;}
  getAttribute(){return null;}
  dispatchEvent(event){this.events.push(event.type);}
 }
 globalThis.HTMLInputElement=Input;
 const input=new Input();
 const title={textContent:'필수 요청사항',querySelector(){return {};},parentElement:{querySelectorAll(){return [input];}}};
 await fill(root([title]),[{key:'field:요청사항',type:'text',value:'창가 자리 요청'}]);
 assert.equal(input.value,'창가 자리 요청');
 assert.deepEqual(input.events,['input','change']);
});

function customFixture({selected='선택하세요',option='확인했습니다.',disabled=false,duplicate=false}={}) {
 let current=selected,clicks=0,opened=false;
 const visible={getClientRects:()=>[{}],getAttribute:()=>null};
 const choice={...visible,textContent:option,disabled,click(){clicks++;current=option;opened=false;}};
 const list={...visible,id:'list',querySelectorAll:()=>duplicate ? [choice,choice] : [choice]};
 const button={...visible,tagName:'BUTTON',type:'button',getAttribute:name=>name==='aria-haspopup' ? 'listbox' : name==='aria-controls' ? 'list' : null,querySelector:()=>({textContent:current}),click(){opened=true;}};
 const title={textContent:'영유아 포함 인원수로 예약해주세요*필수',querySelector:()=>({})};
 const group={querySelector:()=>title,querySelectorAll:()=>[button]};
 const root={querySelectorAll:selector=>selector.includes('ExtraInputForm') ? [group] : selector==='[role="listbox"]' && opened ? [list] : []};
 const settings=[{key:'field:영유아 포함 인원수로 예약해주세요',type:'customselect',value:'확인했습니다.'}];
 return {root,settings,read:()=>current,clicks:()=>clicks};
}
globalThis.getComputedStyle=()=>({visibility:'visible'});
test('custom required dropdowns expose their current label without React-generated IDs',()=>{
 const fixture=customFixture({selected:'확인했습니다.'});
 const [field]=NaverBookingForm.discover(fixture.root);
 assert.equal(field.key,fixture.settings[0].key);assert.equal(field.type,'customselect');assert.equal(field.value,'확인했습니다.');
});
test('custom dropdown selects only the saved exact option and verifies state',async()=>{
 const fixture=customFixture();await fill(fixture.root,fixture.settings);
 assert.equal(fixture.read(),'확인했습니다.');assert.equal(fixture.clicks(),1);
});
test('already matching custom selections do not click or reopen the list',async()=>{
 const fixture=customFixture({selected:'확인했습니다.'});await fill(fixture.root,fixture.settings);
 assert.equal(fixture.clicks(),0);
});
test('missing, disabled and duplicate custom options do not choose a substitute',async()=>{
 for(const settings of [{option:'다른 옵션'},{disabled:true},{duplicate:true}]){
  const fixture=customFixture(settings);
  await assert.rejects(()=>fill(fixture.root,fixture.settings),/정확하게 찾지/);
  assert.equal(fixture.clicks(),0);
 }
});
test('stop prevents custom dropdown selections',async()=>{
 const fixture=customFixture();await assert.rejects(()=>fill(fixture.root,fixture.settings,async()=>false),/중지/);assert.equal(fixture.clicks(),0);
});
