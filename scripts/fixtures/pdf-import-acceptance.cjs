const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'exam2pdf-pdf-acceptance-'));app.setPath('userData',profile);
const root=process.env.EXAM2PDF_TEST_ASAR || path.resolve(__dirname,'../..');
const {importAnswerPdf}=require(path.join(root,'electron/pdf-import.cjs'));
const deadline=setTimeout(()=>{console.error('PDF acceptance timed out');app.exit(1);},45000);
app.whenReady().then(async()=>{
  const source=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false}});
  try {
    async function makePdf(count){
      const html='<style>@page{size:A4;margin:0}.page{break-after:page;height:900px;padding:40px;background:#fff;color:#000;font:40px sans-serif}.page:last-child{break-after:auto}</style>'+Array.from({length:count},(_,i)=>'<section class="page"><h1>PDF import test page '+(i+1)+'</h1><p>Offline cross-platform canvas rendering.</p><div style="width:300px;height:200px;background:'+(i%2?'#e52':'#26c')+'"></div></section>').join('');
      await source.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return source.webContents.printToPDF({printBackground:true,preferCSSPageSize:true});
    }
    const bytes=await makePdf(2);
    const result=await importAnswerPdf({name:'two-pages.pdf',base64:bytes.toString('base64')});
    assert.equal(result.pages.length,2);
    for(const page of result.pages){const data=Buffer.from(page.base64,'base64');assert.ok(data.length>5000);const dimensions=nativeImage.createFromBuffer(data).getSize();assert.equal(dimensions.width,page.width);assert.equal(dimensions.height,page.height);assert.ok(Math.max(page.width,page.height)<=2201);}
    await assert.rejects(importAnswerPdf({base64:Buffer.from('%PDF-1.4\ncorrupt').toString('base64')}), /PDF 转换失败/);
    const tooMany=await makePdf(25);
    await assert.rejects(importAnswerPdf({base64:tooMany.toString('base64')}),/最多 24 页/);
    console.log(JSON.stringify({status:'passed',engine:process.versions.electron,moduleRoot:root,checks:['real two-page PDF -> JPEG','actual JPEG dimensions and nonempty content','malformed PDF rejected','25-page PDF rejected'],pages:result.pages.map(({width,height,base64})=>({width,height,bytes:Buffer.from(base64,'base64').length}))}));
    clearTimeout(deadline);app.exit(0);
  }finally{if(!source.isDestroyed())source.destroy();}
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1);});
