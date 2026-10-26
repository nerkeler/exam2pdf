const {spawn}=require('node:child_process');const path=require('node:path');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const args=[path.join(__dirname,'fixtures/pdf-import-acceptance.cjs')];
// Only CI's disposable Linux runner opts out; normal app launches retain the sandbox.
if(process.platform==='linux' && process.env.CI==='true' && process.env.EXAM2PDF_TEST_NO_SANDBOX==='1') args.unshift('--no-sandbox');
const child=spawn(require('electron'),args,{env,stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>process.exit(code==null?1:code));
