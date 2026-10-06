import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/party.js';
globalThis.getComputedStyle=()=>({visibility:'visible'});
const control=()=>({getClientRects:()=>[{}],getAttribute:()=>null,className:''});
function widgetFixture(current=0, disabled=[]) {
 let people=current,clicks=0;
 const buttons=[4,5,6].map(count=>({...control(),textContent:`${count}명`,disabled:disabled.includes(count),click(){clicks++;people=count;}}));
 const widget={getAttribute:()=>String(people),querySelectorAll:()=>buttons,querySelector:selector=>selector.includes('selected-product') ? {textContent:'4~50명'} : null};
 return {root:{querySelector:()=>widget},read:()=>people,clicks:()=>clicks};
}
test('party selection applies the requested number and confirms widget state',async()=>{
 const fixture=widgetFixture();
 assert.equal(await NaverBookingParty.apply(fixture.root,5,async()=>true),true);
 assert.equal(fixture.read(),5);assert.equal(fixture.clicks(),1);
});
test('already selected party size is preserved without clicking again',async()=>{
 const fixture=widgetFixture(4);
 await NaverBookingParty.apply(fixture.root,4,async()=>true);
 assert.equal(fixture.clicks(),0);
});
test('blank party size does not inspect or alter the site',async()=>{
 assert.equal(await NaverBookingParty.apply({querySelector(){throw new Error('must not inspect');}},null,async()=>true),false);
});
test('disabled or unavailable party sizes never select another value',async()=>{
 const fixture=widgetFixture(4,[5]);
 await assert.rejects(()=>NaverBookingParty.apply(fixture.root,5,async()=>true),/선택할 수 없습니다/);
 await assert.rejects(()=>NaverBookingParty.apply(fixture.root,10,async()=>true),/선택할 수 없습니다/);
 assert.equal(fixture.read(),4);assert.equal(fixture.clicks(),0);
});
test('stopping prevents party changes',async()=>{
 const fixture=widgetFixture();
 await assert.rejects(()=>NaverBookingParty.apply(fixture.root,5,async()=>false),/중지/);
 assert.equal(fixture.clicks(),0);
});

test('shop-specific party limits are rejected without applying a substitute',async()=>{
 const fixture=widgetFixture(4);
 await assert.rejects(()=>NaverBookingParty.apply(fixture.root,3,async()=>true),/허용 인원/);
 await assert.rejects(()=>NaverBookingParty.apply(fixture.root,51,async()=>true),/허용 인원/);
 assert.equal(fixture.read(),4);assert.equal(fixture.clicks(),0);
});

test('English numeric choices are restricted to the people section',async()=>{
 let people=0;
 const choice={...control(),textContent:'2',click(){people=2;}};
 const section={querySelectorAll:()=>[choice]};
 const widget={getAttribute:()=>String(people),querySelector:selector=>selector.includes('sectionPeople') ? section : selector.includes('selected-product') ? {textContent:'1-6 people'} : null,querySelectorAll(){throw new Error('must scope numeric buttons');}};
 await NaverBookingParty.apply({querySelector:()=>widget},2,async()=>true);
 assert.equal(people,2);
 await assert.rejects(()=>NaverBookingParty.apply({querySelector:()=>widget},7,async()=>true),/허용 인원/);
});

test('multiple legacy category inputs require manual selection',async()=>{
 const group={...control(),textContent:'인원 성인 어린이',querySelectorAll:()=>[{},{}]};
 const root={querySelector:()=>null,querySelectorAll:()=>[group]};
 await assert.rejects(()=>NaverBookingParty.apply(root,2,async()=>true),/여러 항목/);
});
