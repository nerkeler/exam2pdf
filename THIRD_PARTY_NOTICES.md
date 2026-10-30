# Third-party notices

Chromium 授权文本（`LICENSES.chromium.html`）以 gzip 压缩随安装包分发（`LICENSES.chromium.html.gz`），内容完整保留，解压即可查阅。

exam2pdf's own source code is covered by the root [PolyForm Noncommercial 1.0.0 License](LICENSE) (noncommercial use only). That license does not replace the licenses of bundled dependencies, imported content, user documents, or platform content.

## PDF.js / pdfjs-dist

- Project: Mozilla PDF.js, <https://github.com/mozilla/pdf.js>
- Distribution: `pdfjs-dist`, version pinned in `package-lock.json`.
- Main license: Apache License 2.0. The complete upstream license is retained at `node_modules/pdfjs-dist/LICENSE` in the installed dependency and application archive.
- Purpose: local PDF page rendering using Electron's Chromium canvas. The application loads its renderer, worker, CMaps, standard fonts, color profiles and WebAssembly assets from its packaged dependencies rather than a remote CDN.

PDF.js distribution resources include their own license files: `cmaps/LICENSE`, `iccs/LICENSE`, `standard_fonts/LICENSE_FOXIT`, `standard_fonts/LICENSE_LIBERATION`, and the `wasm/LICENSE_*` notices for its decoders. Keep those files alongside their resources when redistributing; the package's root license is not a replacement for resource-specific notices. No Poppler executable or Poppler shared library is bundled by this build.

## Electron / Chromium

- Project: <https://www.electronjs.org/>
- Electron uses the MIT License; Chromium and other embedded components have their own licenses and notices.
- Retain the Electron distribution's `LICENSE` and `LICENSES.chromium.html`, together with the framework resources supplied by the official runtime. Their final placement depends on the target operating system.

## KaTeX and fonts

- Project: <https://katex.org/>, source <https://github.com/KaTeX/KaTeX>
- KaTeX code is MIT licensed. Preserve the package license and the applicable font notices from the dependency when distributing the application.

## Dependency versions and build tools

`package-lock.json` records the exact dependency resolution. `electron-builder` and npm build tools are used to produce the installers; their licenses remain applicable to any portions redistributed. Check the final packaged dependency tree and accompanying notices when changing the lockfile or build file filters.

Third-party web pages and user-imported papers are not software dependencies and are not licensed by this document. exam2pdf does not ship a paper bank, answer collection, student data, API credentials, or a login session.

## QRCode

- Project: <https://github.com/soldair/node-qrcode>, MIT license.
- Purpose: generate phone-upload URL QR images locally. The dependency license is retained in the application archive.
