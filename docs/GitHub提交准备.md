# GitHub 公开仓库与提交检查

更新日期：2026-10-26。已创建公开仓库 [nerkeler/exam2pdf](https://github.com/nerkeler/exam2pdf)，首次提交 `c49d46d` 已推送到 `main`。四平台 CI、原生构建和随包 PDF 验证均已通过，[测试预览版 v0.1.0-preview.1](https://github.com/nerkeler/exam2pdf/releases/tag/v0.1.0-preview.1) 已公开发布（非草稿），具体产物与验收范围见[打包说明](打包说明.md)。源码公开与安装包构建、签名、目标平台安装验收是独立事项。

## 提交内容

- `README.md`：项目介绍、学习和测试使用定位、内容授权及数据处理说明。
- `electron/`、`docs/原型图.html`、`frontend/exam2pdf.user.js`、`frontend/page-reorder.js`：桌面应用、采集功能及 PDF.js 本机转换页面。
- `package.json`、`package-lock.json`、`scripts/`：依赖锁定、启动、测试与构建入口。
- `.github/workflows/`：自动化测试及多平台构建流程。
- `docs/测试与验收报告.md`、`docs/打包说明.md`：验证证据、历史评分与实际安装包状态。
- `LICENSE`、`THIRD_PARTY_NOTICES.md`：本项目代码许可与第三方组件说明。

`frontend/src/`、`frontend/exam2pdf.html`、`build.sh` 和 `spikes/` 是历史原型材料，当前 Electron 入口是 `electron/main.cjs`。历史材料若保留在仓库，不代表它们是当前运行方案。

## 数据和凭据检查

提交前检查 Git 当前候选文件：已暂存文件、未暂存修改及未忽略的新文件。仓库不得包含学生作答、第三方试卷原件、登录 Cookie、上传临时令牌、API Key、签名密钥、个人备份或真实账号截图。

`.gitignore` 覆盖本地试卷目录、应用数据、备份、登录状态文件、环境变量、签名证书、构建产物、依赖及日志。忽略规则无法自动移除已暂存或已跟踪文件，提交前仍需检查暂存清单及差异。凭据模式扫描不能替代对内容授权和个人信息的检查。

不要把临时验收路径、个人电脑绝对路径、真实账号截图或业务数据加入公开文档附件。问题反馈只使用去标识化截图、日志和可公开的自制测试样本。

## 验证命令

```sh
npm ci
npm test
npm start -- --check-only
npm run smoke:startup
npm run test:desktop
npm run test:pdf
npm audit
git diff --check
git diff --cached --check
git diff --cached --name-only
```

桌面检查需要图形会话；真实小红书、AI 接口、手机跨设备和打印机验收需要另外执行。`npm audit` 是当时公告数据库快照，不能保证没有未知或未来漏洞。多平台构建与分发结果见[打包说明](打包说明.md)。

## 后续发布

公开仓库已可访问，仍需持续查看 CI 和构建任务结果。安装包生成成功后保留版本号、目标架构、构建来源和校验和；公开下载页应标明未签名测试版本及尚未完成的目标系统验收。不要将源码公开或工作流上传成功描述为全部平台已经可用。

本项目只供个人学习、技术研究和功能测试。MIT 许可适用于本项目代码，不授予第三方资料的采集、传播或使用权；数据与使用声明见 [README](../README.md)。
