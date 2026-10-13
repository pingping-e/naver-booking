import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/composition.js';
globalThis.getComputedStyle=()=>({visibility:'visible'});
function fixture(initial={성인:0,청소년:0,취학:0,미취학:0},people=3){
 const counts={...initial},clicks=[];
 const statuses=()=>Object.keys(counts).map(label=>({textContent:String(counts[label]),getAttribute:()=>`${label} 수량`}));
 const buttons=()=>Object.keys(counts).flatMap(label=>[-1,1].map(direction=>({getClientRects:()=>[{}],getAttribute:name=>name==='aria-label' ? `${label} 수량 ${direction>0?'증가':'감소'}` : null,disabled:direction<0 ? counts[label]===0 : Object.values(counts).reduce((sum,n)=>sum+n,0)>=people,click(){counts[label]+=direction;clicks.push([label,direction]);}})));
 const widget={querySelector:()=>({textContent:`${people}명의 인원 구성을 선택해주세요 *필수`}),querySelectorAll:selector=>selector.startsWith('[role')?statuses():buttons()};
 return {root:{querySelector:()=>widget},counts,clicks};
}
const wanted=[{label:'성인',count:2},{label:'청소년',count:0},{label:'취학',count:0},{label:'미취학',count:1}];
test('composition discovers actual category labels without store-specific names',()=>{
 const f=fixture({일반:0,어린이:0});assert.deepEqual(NaverBookingComposition.discover(f.root).map(row=>row.label),['일반','어린이']);
});
test('composition fills exact saved category counts',async()=>{
 const f=fixture();await NaverBookingComposition.apply(f.root,wanted,3,async()=>true);
 assert.deepEqual(f.counts,{성인:2,청소년:0,취학:0,미취학:1});assert.equal(f.clicks.length,3);
});
test('composition decreases first to avoid exceeding the site total',async()=>{
 const f=fixture({성인:3,청소년:0,취학:0,미취학:0});await NaverBookingComposition.apply(f.root,wanted,3,async()=>true);
 assert.deepEqual(f.clicks,[['성인',-1],['미취학',1]]);
});
test('matching composition avoids clicks',async()=>{
 const f=fixture({성인:2,청소년:0,취학:0,미취학:1});await NaverBookingComposition.apply(f.root,wanted,3,async()=>true);assert.equal(f.clicks.length,0);
});
test('changed categories and incorrect totals stop before modifying counts',async()=>{
 const f=fixture();
 await assert.rejects(()=>NaverBookingComposition.apply(f.root,[{label:'일반',count:3}],3,async()=>true),/항목이 변경/);
 await assert.rejects(()=>NaverBookingComposition.apply(f.root,wanted,4,async()=>true),/총인원/);
 await assert.rejects(()=>NaverBookingComposition.apply(f.root,wanted.map(row=>({...row,count:0})),3,async()=>true),/합계/);
 assert.equal(f.clicks.length,0);
});
test('stop prevents composition clicks',async()=>{
 const f=fixture();await assert.rejects(()=>NaverBookingComposition.apply(f.root,wanted,3,async()=>false),/중지/);assert.equal(f.clicks.length,0);
});
