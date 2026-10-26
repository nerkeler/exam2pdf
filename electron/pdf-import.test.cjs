const test = require('node:test');
const assert = require('node:assert/strict');
const { importAnswerPdf, renderPdfWithElectron } = require('./pdf-import.cjs');
const pdf = Buffer.from('%PDF-1.4\nfixture').toString('base64');
const image = () => ({ mime: 'image/jpeg', base64: Buffer.from([255,216,255,224,0,1]).toString('base64'), width: 600, height: 800 });

test('preserves numeric PDF page order and dimensions without external executables', async () => {
  const result = await importAnswerPdf({ name:'作答.pdf', base64:pdf }, { renderPdfImpl: async encoded => { assert.equal(encoded,pdf); return [image(),image()]; } });
  assert.equal(result.sourceName,'作答.pdf');
  assert.deepEqual(result.pages.map(page => page.name),['PDF 第 1 页','PDF 第 2 页']);
  assert.equal(result.pages[0].height,800);
});
test('rejects invalid PDFs before constructing a renderer', async () => {
  for (const base64 of ['', '!!!!', Buffer.from('not a pdf').toString('base64')]) {
    await assert.rejects(importAnswerPdf({base64}, { renderPdfImpl:()=>{throw new Error('must not run');} }), /PDF/);
  }
});
test('rejects corrupt/encrypted documents, empty output, excessive pages and malformed images', async () => {
  await assert.rejects(importAnswerPdf({base64:pdf},{renderPdfImpl:async()=>{throw new Error('encrypted');}}), /encrypted/);
  await assert.rejects(importAnswerPdf({base64:pdf},{renderPdfImpl:async()=>[]}), /没有可导入/);
  await assert.rejects(importAnswerPdf({base64:pdf},{renderPdfImpl:async()=>Array.from({length:25},image)}), /最多 24 页/);
  await assert.rejects(importAnswerPdf({base64:pdf},{renderPdfImpl:async()=>[{...image(),width:9999}]}), /转换结果无效/);
  await assert.rejects(importAnswerPdf({base64:pdf},{renderPdfImpl:async()=>[{...image(),base64:'AAAA'}]}), /转换结果无效/);
});
test('isolates PDF rendering and destroys the hidden window after success, failure and timeout', async () => {
  for (const mode of ['success','failure','timeout']) {
    let destroyed=false, options, network;
    const fakeSession={setPermissionRequestHandler(){},webRequest:{onBeforeRequest(_filter,handler){network=handler;}}};
    const electron={session:{fromPartition(name){assert.match(name,/^pdf-import-/);return fakeSession;}},BrowserWindow:class {
      constructor(value){options=value;this.webContents={setWindowOpenHandler(){},on(){},executeJavaScript:async()=>{if(mode==='failure')throw new Error('render failed');if(mode==='timeout')return new Promise(()=>{});return [image()];}};}
      async loadFile(){} isDestroyed(){return destroyed;} destroy(){destroyed=true;}
    }};
    const result=renderPdfWithElectron(pdf,{electron,timeoutMs:10});
    if(mode==='success') assert.equal((await result).length,1); else await assert.rejects(result,/failed|超时/);
    assert.equal(destroyed,true);assert.equal(options.webPreferences.sandbox,true);assert.equal(options.webPreferences.nodeIntegration,false);
    network({},result=>assert.equal(result.cancel,true));
  }
});
