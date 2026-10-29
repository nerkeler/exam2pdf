const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'main.cjs'),'utf8');
const start = source.indexOf('function scheduleXhsSearchPosition()');
const end = source.indexOf('// 能拿到任何 HTTP', start);
function fixture() {
  let applied=0;
  const context = vm.createContext({xhsReady:true,requestedXhsBounds:{visible:true},xhsSearchPositionReady:false,applyXhsSearchOverlayBounds:()=>applied++});
  vm.runInContext(source.slice(start,end),context);
  return {context,applied:()=>applied};
}
test('search drawer refresh is synchronous and does not poll third-party DOM',()=>{
  const f=fixture(); f.context.scheduleXhsSearchPosition();
  assert.equal(f.applied(),1); assert.equal(f.context.xhsSearchPositionReady,true);
  assert.doesNotMatch(source,/async function measureXhsSearchPosition|setInterval\(/);
});
test('hidden or loading pages cannot reattach a search control',()=>{
  for(const key of ['xhsReady','requestedXhsBounds']) {
    const f=fixture(); f.context[key]=key==='xhsReady'?false:null;
    f.context.scheduleXhsSearchPosition(); assert.equal(f.applied(),0);
  }
});
