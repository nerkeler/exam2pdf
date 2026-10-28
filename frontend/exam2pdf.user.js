// ==UserScript==
// @name         家卷采集助手（小红书 → 帖子池）
// @namespace    exam2pdf
// @version      3.1.0
// @description  在小红书笔记详情页采集图片并写入 exam2pdf 本地帖子池。
// @match        https://www.xiaohongshu.com/*
// @match        https://xiaohongshu.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @run-at       document-idle
// @license      PolyForm-Noncommercial-1.0.0
// @source       https://github.com/nerkeler/exam2pdf
// ==/UserScript==

/*
 * 家卷采集助手 · exam2pdf 官方发布。许可：PolyForm Noncommercial 1.0.0，
 * 仅限非商业用途；售卖、付费分发、捆绑广告或推广变现均未授权。
 * 修改版再分发须随附许可、保留 Required Notice 版权行并改名。
 * 唯一官方渠道：https://github.com/nerkeler/exam2pdf
 */

(function () {
  if (window.top !== window.self) return;

  function toast(msg, ok) {
    var old = document.getElementById("e2p-toast");
    if (old) old.remove();
    var t = document.createElement("div");
    t.id = "e2p-toast";
    t.textContent = msg;
    t.style.cssText =
      "position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:" + (ok ? "#00b42a" : "#f53f3f") + ";color:#fff;font-size:14px;" +
      "padding:10px 20px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);" +
      "font-family:system-ui,sans-serif;max-width:80vw;white-space:pre-line";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  function extract() {
    var route = location.pathname.match(/^\/(?:explore|discovery\/item|search_result|search-result)\/([a-zA-Z0-9_-]{1,128})(?:\/|$)/);
    if (!route) return null;
    var noteId = route[1];
    try {
      var s = window.__INITIAL_STATE__;
      var m = s && s.note && s.note.noteDetailMap;
      var entry = m && m[noteId];
      var n = entry && (entry.note || entry);
      if (n && n.imageList && n.imageList.length) {
        var urls = n.imageList
          .map(function (img) {
            var u = img.urlDefault || "";
            if (img.infoList && img.infoList.length) {
              var best = img.infoList.reduce(function (a, b) {
                return (b.width || 0) > (a.width || 0) ? b : a;
              }, {});
              if (best && best.url) u = best.url;
            }
            return u;
          })
          .slice(0, 24);
        if (urls.length) {
          var user = n.user || n.userInfo || {};
          var title = String(n.title || n.desc || noteId).trim().slice(0, 100) || noteId;
          var author = String(user.nickname || user.nickName || user.name || "").trim().slice(0, 80);
          if (!author) {
            var authorEl = document.querySelector(".author-wrapper .username, .author-info .username, .note-header .username, a[href^='/user/profile']");
            author = authorEl ? authorEl.textContent.trim().slice(0, 80) : "";
          }
          return { title: title, author: author, urls: urls, noteId: noteId, sourceUrl: location.href };
        }
      }
    } catch (e) {}
    var seen = {}, urls = [];
    var container = document.querySelector(".media-container")
      || document.querySelector(".swiper-wrapper")
      || document.querySelector("#noteContainer")
      || document.querySelector(".note-detail")
      || document;
    var imgs = container.querySelectorAll('img[src*="sns-webpic"], img[data-src*="sns-webpic"]');
    for (var j = 0; j < imgs.length && urls.length < 24; j++) {
      var im = imgs[j];
      if (im.closest && im.closest(".swiper-slide-duplicate")) continue;
      if (im.naturalWidth && im.naturalWidth < 300) continue;
      var u = im.getAttribute("src") || im.getAttribute("data-src") || "";
      u = u.replace("!nd_prv", "!nd_dft");
      var base = u.split("?")[0];
      if (u && !seen[base]) {
        seen[base] = 1;
        urls.push(u);
      }
    }
    if (urls.length) {
      var tEl = document.querySelector("#detail-title");
      var title = ((tEl && tEl.textContent) || document.title.replace(/ - 小红书$/, "") || "小红书笔记").trim().slice(0, 100);
      var authorEl = document.querySelector(".author-wrapper .username, .author-info .username, .note-header .username, a[href^='/user/profile']");
      return { title: title, author: authorEl ? authorEl.textContent.trim().slice(0, 80) : "", urls: urls.slice(0, 24), noteId: noteId, sourceUrl: location.href };
    }
    return null;
  }

  function gmBlob(url) {
    return new Promise(function (resolve, reject) {
      // 候选顺序：无压缩参数的原始图（画质最好）→ 高清默认变体 → 原样兜底；
      // 小红书数据源常给协议相对（//host/…）或 http 链接，统一规范化为 https
      function normalize(u) {
        if (!u) return "";
        if (u.indexOf("//") === 0) return "https:" + u;
        if (u.indexOf("http://") === 0) return "https://" + u.slice(7);
        return u;
      }
      var base = normalize(String(url).split("!")[0]);
      var candidates = [base, normalize(url.replace("!nd_prv", "!nd_dft")), normalize(url)]
        .filter(function (item, index, all) { return item && all.indexOf(item) === index; });
      var lastError = "下载失败";
      function pageFetch(candidate) {
        if (typeof fetch !== "function") return Promise.resolve(null);
        // 与页面里 <img> 相同的网络通道，CDN 允许跨域时最快命中
        return fetch(candidate, { referrer: location.href, credentials: "omit" }).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.blob();
        }).catch(function (error) {
          if (error && /^HTTP /.test(error.message || "")) lastError = error.message;
          return null;
        });
      }
      function bridgeFetch(candidate) {
        var bridge = window.exam2pdfCollector;
        if (!bridge || typeof bridge.fetchImage !== "function") return Promise.resolve(null);
        return bridge.fetchImage(candidate).then(function (result) {
          if (!result || !result.base64) return null;
          var binary = atob(result.base64);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return new Blob([bytes], { type: result.mime || "image/jpeg" });
        }).catch(function (error) {
          if (error && error.message) lastError = error.message;
          return null;
        });
      }
      function gmRequest(candidate) {
        var gm = typeof GM_xmlhttpRequest !== "undefined"
          ? GM_xmlhttpRequest
          : (typeof GM !== "undefined" && GM.xmlHttpRequest) ? GM.xmlHttpRequest : null;
        if (!gm) return Promise.resolve(null);
        return new Promise(function (done) {
          gm({
            method: "GET",
            url: candidate,
            responseType: "blob",
            timeout: 20000,
            onload: function (r) { done(r.response && r.response.size ? r.response : null); },
            onerror: function () { done(null); },
            ontimeout: function () { done(null); }
          });
        });
      }
      var attempt = function (idx) {
        if (idx >= candidates.length) { reject(new Error(lastError)); return; }
        var candidate = candidates[idx];
        pageFetch(candidate)
          .then(function (blob) { return blob || bridgeFetch(candidate); })
          .then(function (blob) { return blob || gmRequest(candidate); })
          .then(function (blob) {
            if (blob && blob.size) { resolve(blob); return; }
            attempt(idx + 1);
          })
          .catch(function (error) {
            if (error && error.message) lastError = error.message;
            attempt(idx + 1);
          });
      };
      attempt(0);
    });
  }

  function jpegSize(u8) {
    if (!u8 || u8[0] !== 0xff || u8[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xff) { i++; continue; }
      const marker = u8[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8] };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      i += 2 + ((u8[i + 2] << 8) | u8[i + 3]);
    }
    return null;
  }

  async function ensureJpeg(bytes, mime) {
    const originalSize = jpegSize(bytes);
    let bmp;
    try {
      const blob = new Blob([bytes], { type: mime || "image/png" });
      bmp = await createImageBitmap(blob);
      const maxSide = 3600;
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const width = Math.max(1, Math.round(bmp.width * scale));
      const height = Math.max(1, Math.round(bmp.height * scale));
      if (originalSize && scale === 1 && bytes.length <= 5 * 1024 * 1024) {
        const w = bmp.width;
        const h = bmp.height;
        if (bmp.close) bmp.close();
        return { bytes: bytes, w: w, h: h };
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d", { alpha: false }).drawImage(bmp, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.93);
      const binary = atob(dataUrl.split(",")[1]);
      const output = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i);
      if (bmp.close) bmp.close();
      canvas.width = 1;
      canvas.height = 1;
      return { bytes: output, w: width, h: height };
    } catch (error) {
      if (bmp && bmp.close) bmp.close();
      if (originalSize) return { bytes: bytes, w: originalSize.w, h: originalSize.h };
      throw error;
    }
  }

  function bytesToBase64(bytes) {
    var binary = "";
    for (var offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return btoa(binary);
  }

  async function buildPdf(pages) {
    const enc = new TextEncoder();
    const parts = [];
    let offset = 0;
    const offs = {};
    const push = function (x) {
      const u = typeof x === "string" ? enc.encode(x) : x;
      parts.push(u);
      offset += u.length;
    };
    const n = pages.length;
    push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
    offs[1] = offset;
    push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    offs[2] = offset;
    const kids = pages.map(function (_, i) { return (3 + i * 3) + " 0 R"; }).join(" ");
    push("2 0 obj\n<< /Type /Pages /Kids [" + kids + "] /Count " + n + " >>\nendobj\n");
    pages.forEach(function (p, i) {
      const pageNo = 3 + i * 3, contentNo = pageNo + 1, imgNo = pageNo + 2;
      const content = "q\n" + p.w + " 0 0 " + p.h + " 0 0 cm\n/Im0 Do\nQ";
      const contentU8 = enc.encode(content);
      offs[pageNo] = offset;
      push(pageNo + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + p.w + " " + p.h + "] /Resources << /XObject << /Im0 " + imgNo + " 0 R >> /ProcSet [/PDF /ImageC] >> /Contents " + contentNo + " 0 R >>\nendobj\n");
      offs[contentNo] = offset;
      push(contentNo + " 0 obj\n<< /Length " + contentU8.length + " >>\nstream\n");
      push(contentU8);
      push("\nendstream\nendobj\n");
      offs[imgNo] = offset;
      push(imgNo + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + p.w + " /Height " + p.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.bytes.length + " >>\nstream\n");
      push(p.bytes);
      push("\nendstream\nendobj\n");
    });
    const xrefStart = offset;
    let xref = "xref\n0 " + (3 + n * 3) + "\n0000000000 65535 f \n";
    for (let o = 1; o < 3 + n * 3; o++) xref += String(offs[o]).padStart(10, "0") + " 00000 n \n";
    push(xref);
    push("trailer\n<< /Size " + (3 + n * 3) + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }

  function download(blob, name) {
    var objUrl = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = objUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(objUrl); }, 10000);
  }

  var busy = false;

  function failureSummary(reasons) {
    return Object.keys(reasons).map(function (key) { return key + "×" + reasons[key]; }).join("、");
  }

  async function collect(btn) {
    var scopeToken;
    if (window.exam2pdfCollector && typeof window.exam2pdfCollector.beginCollection === "function") {
      try { scopeToken = await window.exam2pdfCollector.beginCollection(); }
      catch (error) { alert(error.message || "请打开笔记详情页"); return; }
    }
    if (busy) return;
    var d = extract();
    if (!d) {
      toast("未找到帖子图片：请打开笔记详情页（能左右滑动看图）后重试", false);
      return;
    }
    busy = true;
    btn.disabled = true;
    btn.style.opacity = "0.6";
    var orig = btn.textContent;
    var setBtn = function (t) { btn.textContent = t; };

    try {
      var pages = [], failed = 0, failReasons = {};
      var N = d.urls.length;
      for (var i = 0; i < N; i++) {
        setBtn("开始采集 " + (i + 1) + "/" + N + " 张");
        var blob = null;
        if (d.urls[i]) {
          try {
            blob = await gmBlob(d.urls[i]);
          } catch (downloadError) {
            var reason = (downloadError && downloadError.message) || "下载失败";
            failReasons[reason] = (failReasons[reason] || 0) + 1;
          }
        }
        if (blob) {
          try {
            var bytes = new Uint8Array(await blob.arrayBuffer());
            var page = await ensureJpeg(bytes, blob.type);
            page.sourceIndex = i;
            pages.push(page);
          } catch (e) {
            failed++;
            failReasons["图片转码失败"] = (failReasons["图片转码失败"] || 0) + 1;
          }
        } else failed++;
      }
      if (!pages.length) {
        var summary = failureSummary(failReasons);
        toast("采集失败：" + failed + " 张全部下载失败" + (summary ? "（" + summary + "）" : "") + "。图片链接会过期，请刷新笔记页后重新点击", false);
      } else {
        var bridge = window.exam2pdfCollector;
        if (bridge && typeof bridge.collectPost === "function") {
          var totalBytes = pages.reduce(function (sum, page) { return sum + page.bytes.length; }, 0);
          if (totalBytes > 80 * 1024 * 1024) throw new Error("图片总大小超过 80 MB，请减少图片后重试");
          setBtn("保存到帖子池…");
          var result = await bridge.collectPost({
            scopeToken: scopeToken,
            title: d.title,
            author: d.author,
            noteId: d.noteId,
            sourceUrl: d.sourceUrl,
            expectedImages: N,
            images: pages.map(function (page) {
              return { sourceIndex: page.sourceIndex, mime: "image/jpeg", base64: bytesToBase64(page.bytes), width: page.w, height: page.h };
            })
          });
          if (result && result.duplicate) {
            if (result.added > 0) toast("已补采 " + result.added + " 张，这篇笔记共 " + result.post.pages + "/" + result.post.expectedImages + " 张" + (result.post.missingImages ? "，还缺 " + result.post.missingImages + " 张，可重试" : "，已完整"), !result.post.missingImages);
            else if (result.updated > 0) toast("已更新 " + result.updated + " 张图片的清晰度", true);
            else toast("这篇笔记已在帖子池中，共 " + result.post.pages + " 张", true);
          } else {
            var partialSummary = failureSummary(failReasons);
            toast("✓ 已采集「" + d.title + "」" + pages.length + "/" + N + " 张，已保存到帖子池" + (failed ? "\n另有 " + failed + " 张未能下载" + (partialSummary ? "（" + partialSummary + "）" : "") : ""), failed === 0);
          }
        } else {
          setBtn("生成 PDF…");
          var pdf = await buildPdf(pages);
          download(pdf, d.title + ".pdf");
          toast("✓ 已采集「" + d.title + "」" + pages.length + "/" + N + " 张\nPDF 已开始下载", failed === 0);
        }
      }
    } catch (e) {
      toast("采集失败：" + (e && e.message ? e.message : "未知错误"), false);
    }
    busy = false;
    btn.disabled = false;
    btn.style.opacity = "";
    btn.textContent = orig;
  }

  function createCollectButton() {
    var b = document.createElement("button");
    b.id = "e2p-btn";
    b.textContent = "采集到家卷";
    b.style.cssText =
      "position:fixed;right:24px;bottom:24px;z-index:2147483647;background:#ff2442;color:#fff;" +
      "border:none;border-radius:24px;padding:11px 20px;font-size:14px;cursor:pointer;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.25);font-family:system-ui,sans-serif;" +
      "transition:transform .16s cubic-bezier(.22,1,.36,1),box-shadow .18s ease,opacity .16s ease";
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) {
      var rest = function () { b.style.transform = ""; b.style.boxShadow = "0 4px 14px rgba(0,0,0,.25)"; };
      var lift = function () { b.style.transform = "translateY(-1px)"; b.style.boxShadow = "0 8px 20px rgba(0,0,0,.28)"; };
      b.addEventListener("mouseenter", lift);
      b.addEventListener("mouseleave", rest);
      b.addEventListener("mousedown", function () { b.style.transform = "scale(.97)"; });
      b.addEventListener("mouseup", lift);
      b.addEventListener("blur", rest);
    }
    b.onclick = function () { return collect(b); };
    document.body.appendChild(b);
  }

  // 永久看门狗：SPA 跳转或页面重渲染移除注入 UI 后自动补回
  setInterval(function () {
    if (!document.body) return;
    if (!document.getElementById("e2p-btn")) createCollectButton();
  }, 800);
})();
