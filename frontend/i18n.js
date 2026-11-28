// 家卷多语言支持：中文为源语言（key 即中文原文），en 为译文覆盖；
// 未覆盖的 key 一律回退中文原文，保证新增文案永远不会显示成键名。
// 语言偏好存 localStorage exam2pdf-lang，切换后整页刷新以重渲染全部动态文案。
(function () {
  const DICTS = {
    en: {
      // 侧边栏 / 导航
      "家卷": "JiaJuan",
      "家庭试卷工作台": "Home Exam Paper Workbench",
      "学习流程": "Workflow",
      "采集浏览": "Collect",
      "试卷库": "Paper Library",
      "试卷批阅": "Grade Papers",
      "错题本": "Mistake Book",
      "学习情况": "Learning Stats",
      "收起": "Collapse",
      "当前学生数据": "Student Data",
      "帖子": "Papers",
      "作答": "Answers",
      "错题": "Mistakes",
      "训练": "Drills",
      "试卷": "Papers",
      "使用引导": "Guide",
      "关于声明": "About",
      "跟随系统": "Theme: System",
      // 屏幕标题 / 副标题
      "本地导入或手机上传作答照片；空白试卷仍在试卷库打印。": "Import answer photos locally or upload from phone; blank papers stay in the Paper Library for printing.",
      "学生作答": "Student Answers",
      "整理打印": "Arrange & Print",
      "批阅确认": "Review Confirm",
      "批阅报告": "Report",
      // 批阅页
      "本地导入": "Local Import",
      "手机上传": "Phone Upload",
      "试卷名称": "Paper Title",
      "本地导入作答照片": "Import Answer Photos Locally",
      "选择照片、PDF 或使用电脑摄像头拍摄；PDF 需要系统提供 Poppler，页面会在本机转成图片（最多 24 页），先检查顺序再保存。": "Pick photos, a PDF, or use the camera. PDFs are converted locally (Poppler required, up to 24 pages); check the order before saving.",
      "选择照片": "Pick Photos",
      "拍摄作答页": "Camera",
      "清空待保存图片": "Clear Staged",
      "手机扫码上传作答": "Upload via Phone QR",
      "手机与电脑连接同一 Wi-Fi，扫描二维码或输入局域网地址上传；照片会进入下方「待保存页面」，核对后点「保存作答记录」才入库。": "Connect the phone to the same Wi-Fi, scan the QR code or type the LAN address. Photos land in \"Staged Pages\" below and are saved only after you confirm.",
      "复制手机地址": "Copy Phone URL",
      "待保存页面": "Staged Pages",
      "页": "pages",
      "保存作答记录": "Save Answer",
      "图片保存在本机，不会自动发送给 AI。": "Images stay on this machine; nothing is sent to AI automatically.",
      "本地作答记录": "Answer Records",
      "每份记录可继续批阅或查看已确认报告。": "Continue grading or view confirmed reports.",
      "还没有学生作答记录": "No answer records yet",
      "导入学生完成后的照片，再开始批阅。": "Import finished answer photos to start grading.",
      "开启局域网手机上传": "Enable LAN phone upload",
      "已开启": "On",
      "已关闭": "Off",
      "同一 Wi-Fi 下可上传作答照片": "Uploadable over the same Wi-Fi",
      "局域网访问已关闭": "LAN upload is off",
      "关闭状态": "Off",
      // 试卷详情 / 试卷库
      "试卷详情": "Paper Detail",
      "拖动页面卡片调整打印顺序；也可用前后移按钮微调。": "Drag cards to reorder; fine-tune with the arrows.",
      "直接打印": "Print Now",
      "生成 PDF": "Export PDF",
      "补充图片": "Add Pages",
      "编辑": "Rename",
      "删除": "Delete",
      "打印": "Print",
      "恢复已移除的": "Restore removed",
      "搜索试卷": "Search papers",
      "全部科目": "All subjects",
      "张图": "photos",
      "导入图片": "Import Images",
      "导入文件夹": "Import Folder",
      "每张图片作为一页，导入后可预览、拖动排序并打印或生成 PDF。": "Each image becomes one page; preview, reorder, print or export PDF.",
      "当前学生还没有试卷": "No papers for this student yet",
      "去采集浏览页采集笔记，或从本地导入试卷。": "Collect from the Collect screen or import papers locally.",
      "没有匹配的试卷": "No matching papers",
      "换个关键词再试试。": "Try different keywords.",
      // 错题本 / 学情
      "知识点": "Knowledge Point",
      "按知识点复习，跟踪掌握情况。": "Review by knowledge point and track mastery.",
      "掌握情况": "Mastery",
      "已掌握": "Mastered",
      "未掌握": "Not Yet",
      "生成练习": "Generate Drill",
      "打印练习": "Print Drill",
      "生成结果需检查题目和答案后才能打印": "Check generated questions and answers before printing",
      // 设置 / 数据
      "应用设置": "App Settings",
      "AI 服务、学生、备份与诊断": "AI service, students, backup & diagnostics",
      "学生设置": "Students",
      "本地数据": "Local Data",
      "备份帖子、作答记录、训练历史和图片；新备份还会保存 AI 服务配置，但不包含 API Key。": "Backs up papers, answers, drill history and images; newer backups also store AI settings (never API keys).",
      "导出本地备份": "Export Backup",
      "恢复备份": "Restore Backup",
      "导出诊断信息": "Export Diagnostics",
      // 关于声明
      "关于家卷 · 使用声明": "About JiaJuan · Notice",
      "唯一官方渠道：": "Official channel only: ",
      "知道了": "Got it",
      "关闭": "Close",
      "提示": "Notice",
      "浏览": "Browse",
      "打印": "Print",
      "批阅": "Grade",
      "学习": "Stats",
      "当前学生 · 点击切换": "Current student · tap to switch",
      // 常见动态文案
      "来源：": "Source: ",
      "第 {n} 页": "Page {n}",
      "作答第 {n} 页": "Answer page {n}",
      "原卷第 {n} 页": "Source page {n}",
      "{n} 页": "{n} pages",
      "{n} 张图": "{n} photos",
      "{n} 张作答": "{n} answer pages",
      "来源：{x}": "Source: {x}",
      "已加入 {n} 页（整理打印示例）": "Added {n} pages (print demo)",
      "已提交打印任务": "Print job submitted",
      "正在准备打印…": "Preparing print…",
      "正在生成 PDF…": "Generating PDF…",
      "已取消 PDF 保存": "PDF save canceled",
      "页面顺序已调整": "Page order updated",
      "已经到最前或最后": "Already at first or last",
      "本机还没有添加打印机：请在「系统设置 → 打印机与扫描仪」添加后再打印": "No printer configured: add one in System Settings → Printers & Scanners, then print again",
      "手机上传已开启；用手机扫描本页二维码": "Phone upload enabled; scan the QR code with your phone",
      "手机上传已关闭，原地址随即失效": "Phone upload disabled; the previous URL is now invalid",
      "手机上传需要在 Electron 应用中开启": "Phone upload requires the Electron app",
      "整机备份与维护（所有学生）": "Whole-machine backup & maintenance (all students)",
      "导出整机备份": "Export Full Backup",
      "恢复整机备份": "Restore Full Backup",
      "正在加载": "Loading",
      "手机扫码上传 · ": "Phone upload · ",
      "人工批阅": "Manual Grading",
      "核对作答图片、逐题标记并确认；确认后才会进入错题本与学情统计。": "Check answer images, mark per question, then confirm; only confirmed results enter the Mistake Book and stats.",
      "查看确认后的逐题结果。": "View per-question results after confirmation.",
      "个人学习情况": "Learning Stats",
      "查看学习进度、薄弱知识点和针对性训练。": "See progress, weak knowledge points and targeted drills.",
      "变式练习": "Variation Drill",
      "检查题目和答案，确认后即可打印。": "Check questions and answers, then print after confirmation.",
      "整理试卷页面并生成 PDF。": "Arrange paper pages and export PDF.",
      "预览页面、拖动排序并打印试卷。": "Preview pages, drag to reorder and print the paper.",
      "管理采集和导入的试卷，卡片可直接打印。": "Manage collected and imported papers; cards print directly.",
      "移除": "Remove",
      "已加入 {n} 页作答内容": "Added {n} answer pages",
      "已开启，但没有检测到局域网 IPv4 地址。请检查电脑的 Wi-Fi 连接。": "Enabled, but no LAN IPv4 address detected. Check this computer's Wi-Fi connection.",
      "PDF 已保存：{x}": "PDF saved: {x}",
      "发现新版本 v{v}": "New version v{v} available",
      "（当前 v{c}）": " (current v{c})",
      "。当前安装包未签名，macOS 需要手动下载安装。": ". The installer is unsigned; macOS requires manual download & install.",
      "正在下载更新… {p}": "Downloading update… {p}",
      "更新已下载，重启应用即可完成安装。": "Update downloaded; restart the app to finish installing.",
      "打开下载页": "Open Download Page",
      "下载更新": "Download Update",
      "重启并安装": "Restart & Install",
      "更新检查失败：": "Update check failed: ",
      "重试": "Retry",
      "作者：": "Author: ",
      "在小红书网页中登录、浏览并采集试卷。": "Log in to Xiaohongshu, browse and collect exam papers.",
      "已收到 {n} 张，归属学生 {name}；切换到该学生后核对保存": "Received {n} photos for {name}; switch to that student to review and save",
      "暂存落盘失败：数据保留在收件箱，重启应用会自动恢复": "Staging write failed: data kept in the inbox and will be restored on next launch",
      "整理手机上传照片失败：{n} 张全部无法解析": "Failed to process the upload: all {n} photos were unreadable",
      "已收到 {n} 张，其中 {m} 张无法解析已跳过": "Received {n} photos; {m} unreadable ones were skipped",
      "安装失败：": "Install failed: ",
      "工作台初始化失败": "Workbench failed to initialize"
    }
  };
  let current = "zh-CN";
  try { current = localStorage.getItem("exam2pdf-lang") === "en" ? "en" : "zh-CN"; } catch {}

  function t(key, params) {
    let text = current === "zh-CN" ? key : ((DICTS[current] && DICTS[current][key]) || key);
    if (params) for (const name of Object.keys(params)) text = text.split("{" + name + "}").join(String(params[name]));
    return text;
  }

  function isEnglish() { return current === "en"; }

  function applyStatic() {
    if (current === "zh-CN") return;
    const dict = DICTS[current];
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const translated = dict[node.getAttribute("data-i18n")];
      if (typeof translated === "string") node.textContent = translated;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      const translated = dict[node.getAttribute("data-i18n-placeholder")];
      if (typeof translated === "string") node.setAttribute("placeholder", translated);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
      const translated = dict[node.getAttribute("data-i18n-aria")];
      if (typeof translated === "string") node.setAttribute("aria-label", translated);
    });
    document.documentElement.lang = current === "en" ? "en" : "zh-CN";
  }

  function setLanguage(lang) {
    const next = lang === "en" ? "en" : "zh-CN";
    try { localStorage.setItem("exam2pdf-lang", next); } catch {}
    if (next === current) return;
    location.reload();
  }

  function currentLanguage() { return current; }

  window.exam2pdfI18n = { t, isEnglish, applyStatic, setLanguage, currentLanguage, DICTS };
})();
