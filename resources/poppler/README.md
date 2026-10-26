# 历史 Poppler 方案

早期构建要求在此放置各平台 `pdftoppm` 运行库，因此安装包预检曾因缺少可分发运行库而停止。当前 PDF 导入改用应用内 PDF.js 与 Electron canvas，本目录不再是打包输入，不需要下载或复制 Poppler。

该历史目录不包含任何 Poppler 二进制。第三方依赖与许可参见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)，当前打包步骤与真实结果参见[打包说明](../../docs/打包说明.md)。
