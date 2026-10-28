// Capture the current renderer with synthetic, in-memory demo data only.
// This does not load main.cjs, real accounts, the user's library, or AI services.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit' });
  process.exit(result.status == null ? 1 : result.status);
}
const { app, BrowserWindow, protocol, session } = require('electron');
const { deriveLearningStats } = require('../electron/learning-stats.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'exam2pdf-readme-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'exam2pdf-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const output = path.join(project, 'docs', 'images');
const date = '2026-10-28T09:00:00+08:00';
const questions = [
  { questionNo: '1', result: '正确', knowledgePoints: ['有理数运算'], solutionSummary: '先算乘方，再算乘除，最后算加减。$(-2)^2+3=7$。\n【重点：先确定运算顺序，再逐步计算。】' },
  { questionNo: '2', result: '错误', errorType: '计算', knowledgePoints: ['一元一次方程'], solutionSummary: '移项时改变符号：$3x-6=9$，得到 $3x=15$，所以 $x=5$。\n【重点：移项必须变号，求解后代回检验。】' },
  { questionNo: '3', result: '部分正确', errorType: '方法', knowledgePoints: ['坐标平移'], solutionSummary: '点 $A(2,3)$ 向右平移 2 个单位，得到 $A^{\\prime}(4,3)$。横坐标变化，纵坐标保持不变。\n【重点：左右移动看横坐标，上下移动看纵坐标。】' },
  { questionNo: '4', result: '正确', knowledgePoints: ['三角形面积'], solutionSummary: '根据底和对应的高，$S=\\frac{1}{2}\\times 6\\times 4=12$。\n【重点：底和高要对应，面积公式中不要漏乘二分之一。】' },
  { questionNo: '5', result: '未作答', errorType: '审题', knowledgePoints: ['一元一次方程'], solutionSummary: '先找等量关系，再设未知数列方程。建议完成对应知识点的针对性练习。' }
];
const answer = { id: 'demo-answer', title: '八年级数学 · 自制演示卷', studentId: 'demo-student', studentName: '演示学生', subject: '数学', collectedAt: date, reviewStatus: 'confirmed', review: questions, pages: 4 };
const posts = ['八年级数学 · 自制演示卷', '七年级数学 · 方程专题练习', '五年级数学 · 分数运算练习', '八年级数学 · 坐标与几何练习'].map((title, index) => ({ id: 'demo-' + index, title, subject: '数学', studentId: 'demo-student', source: '自制演示资料', author: '家卷演示', collectedAt: date, pages: 4, pageOrder: ['1.png', '2.png', '3.png', '4.png'], images: ['1.png', '2.png', '3.png', '4.png'] }));
function paper(number) {
  const lines = ['一、基础运算与概念', '1. 计算：(-2)² + 3 = ______', '2. 解方程：3x - 6 = 9', '二、坐标与几何', '3. 将点 A(2,3) 向右平移 2 个单位。', '4. 底为 6、高为 4 的三角形面积是？', '三、思考与表达', '5. 写出你的解题过程，并检查答案。'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="877" viewBox="0 0 620 877"><rect width="620" height="877" fill="white"/><g fill="#303c50" font-family="sans-serif"><text x="310" y="65" text-anchor="middle" font-size="26" font-weight="bold">数学 · 自制演示卷</text><text x="310" y="97" text-anchor="middle" font-size="13" fill="#68758b">README 展示资料 · 不含真实学生信息</text><path d="M45 120H575" stroke="#ccd4df"/>${lines.map((line, i) => `<text x="48" y="${166 + i * 60}" font-size="${[0,3,6].includes(i) ? 20 : 17}">${line}</text>`).join('')}<text x="310" y="835" text-anchor="middle" font-size="14" fill="#8791a3">演示第 ${number} 页 / 共 4 页</text></g></svg>`;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  const isolated = session.fromPartition('readme-' + Date.now());
  isolated.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_request, callback) => callback({ cancel: true }));
  isolated.protocol.handle('exam2pdf-media', request => new Response(paper(new URL(request.url).pathname.match(/\d+/)?.[0] || '1'), { headers: { 'content-type': 'image/svg+xml' } }));
  const win = new BrowserWindow({ width: 1360, height: 940, useContentSize: true, show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await win.loadFile(path.join(project, 'docs', '原型图.html'));
  if (!await win.webContents.executeJavaScript('window.__exam2pdfBootComplete')) throw new Error('Renderer did not boot');
  const stats = deriveLearningStats([answer], new Date(date));
  await win.webContents.executeJavaScript(`
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    applyTheme('light');
    state.posts = ${JSON.stringify(posts)};
    state.students = [{ id: 'demo-student', name: '演示学生' }];
    state.activeStudentId = 'demo-student';
    state.answers = [${JSON.stringify(answer)}];
    state.currentAnswer = state.answers[0];
    state.currentAnswerId = 'demo-answer';
    state.learningStats = ${JSON.stringify(stats)};
    state.mistakes = state.learningStats.mistakes;
    renderStudentControls(); renderSideDataOverview(); renderPosts(); renderAnswers();
  `);
  for (const [name, action] of [
    ['01-library.png', "switchScreen('s0b'); renderPosts();"],
    ['02-paper-order.png', "state.currentPostId='demo-0'; switchScreen('s0c'); renderPostDetail();"],
    ['03-review-report.png', "switchScreen('s4'); renderReport(state.currentAnswer);"],
    ['04-learning.png', "switchScreen('s6'); renderLearningStats();"]
  ]) {
    await win.webContents.executeJavaScript(action + "; document.querySelectorAll('img').forEach(img => img.loading='eager'); window.scrollTo(0,0);");
    await sleep(800);
    await win.webContents.executeJavaScript("Promise.all([...document.images].filter(img=>img.offsetParent).map(img=>img.decode().catch(()=>{})))");
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(output, name), image.toPNG());
    console.log('Captured docs/images/' + name);
  }
  win.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => app.exit(1), 45000).unref();
