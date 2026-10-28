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
      const html='<style>@page{size:A4;margin:0}.page{break-after:page;height:900px;padding:40px;background:#fff;color:#000;font:40px sans-serif}.page:last-child{break-after:auto}</style>'+Array.from({length:count},(_,i)=>'<section class="page"><h1>PDF import test page '+(i+1)+'</h1><p>数学作答演示：有理数运算与一元一次方程。</p><p>Offline cross-platform canvas rendering.</p><div style="width:300px;height:200px;background:'+(i%2?'#e52':'#26c')+'"></div></section>').join('');
      await source.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return source.webContents.printToPDF({printBackground:true,preferCSSPageSize:true});
    }
    const bytes=await makePdf(2);
    const result=await importAnswerPdf({name:'two-pages.pdf',base64:bytes.toString('base64')});
    assert.equal(result.pages.length,2);
    for(const page of result.pages){const data=Buffer.from(page.base64,'base64');assert.ok(data.length>5000);const dimensions=nativeImage.createFromBuffer(data).getSize();assert.equal(dimensions.width,page.width);assert.equal(dimensions.height,page.height);assert.ok(Math.max(page.width,page.height)<=2201);}
    await assert.rejects(importAnswerPdf({base64:Buffer.from('%PDF-1.4\ncorrupt').toString('base64')}), /PDF 转换失败/);
    const tooMany=await makePdf(25);
    await assert.rejects(importAnswerPdf({base64:tooMany.toString('base64')}),/最多 24 页/);
    // Exercise the exact browser assets shipped in ASAR, including the WOFF2-only font set.
    await source.loadFile(path.join(root,'docs/原型图.html'));
    const assets = await source.webContents.executeJavaScript(`(async () => {
      const formula = document.createElement('div');
      document.body.appendChild(formula);
      katex.render(String.raw\`\\frac{1}{2}x^2+\\sqrt{9}\`, formula);
      for (const gender of ['male','female']) {
        const holder = document.createElement('div'); holder.innerHTML = studentAvatar({gender});
        document.body.append(holder); await holder.querySelector('img').decode();
        if (holder.querySelector('img').naturalWidth !== 256) throw new Error('Bundled student avatar missing');
      }
      const fonts = await document.fonts.load('20px KaTeX_Main');
      await document.fonts.ready;
      return { boot: window.__exam2pdfBootComplete, formula: !!formula.querySelector('.katex'),
        fontsLoaded: fonts.length > 0 && fonts.every(font => font.status === 'loaded'),
        autoRender: typeof renderMathInElement === 'function' };
    })()`);
    assert.deepEqual(assets, {boot:true,formula:true,fontsLoaded:true,autoRender:true});
    console.log(JSON.stringify({status:'passed',engine:process.versions.electron,moduleRoot:root,checks:['real two-page PDF -> JPEG','actual JPEG dimensions and nonempty content','malformed PDF rejected','25-page PDF rejected','packaged renderer boot, avatars and WOFF2 math fonts'],pages:result.pages.map(({width,height,base64})=>({width,height,bytes:Buffer.from(base64,'base64').length,sha256:require('node:crypto').createHash('sha256').update(Buffer.from(base64,'base64')).digest('hex')}))}));
    clearTimeout(deadline);app.exit(0);
  }finally{if(!source.isDestroyed())source.destroy();}
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1);});
