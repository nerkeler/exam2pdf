const IMAGE_RE = /\.(jpe?g|png|webp|bmp|gif|tiff?|heic|heif)$/i;
const ZIP_RE = /\.zip$/i;

const $ = (id) => document.getElementById(id);

const DEFAULT_PROMPT = `你是一位经验丰富的老师。我会发给你一份学生作答后的试卷（PDF 或图片），请逐题批阅，全部使用中文，并严格按以下固定格式输出：

## 第 N 题
- 学生作答：（转写学生的答案或解题过程；空白未答写"未作答"）
- 批阅结果：正确 / 部分正确 / 错误 / 未作答
- 错因分析：（错在哪一步、属于什么类型的错误：概念不清 / 计算失误 / 审题偏差 / 方法不会等）
- 正确解法：（分步骤写清完整过程，不要跳步）
- 知识点：（本题考查的知识点）

要求：
1. 按试卷顺序逐题输出，不要遗漏任何一题。
2. 图片不清晰或无法识别的题，写"第 N 题：无法识别"，不要编造。
3. 全部题目结束后，输出：

## 总结
- 得分情况概述（正确 X 题、部分正确 Y 题、错误 Z 题、未作答 W 题）
- 主要失分原因归类
- 薄弱知识点清单
- 针对性学习建议（3 条以内）`;

$("promptText").value = DEFAULT_PROMPT;

$("copyPrompt").addEventListener("click", async () => {
  await copyText($("promptText").value);
  const btn = $("copyPrompt");
  btn.textContent = "已复制";
  setTimeout(() => (btn.textContent = "复制"), 1200);
});

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext !== false) {
    try { await navigator.clipboard.writeText(text); return; } catch (e) {}
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

const tabs = { install: $("tabInstall"), print: $("tabPrint"), grade: $("tabGrade") };
const secs = { install: $("secInstall"), print: $("secPrint"), grade: $("secGrade") };

function switchTab(name) {
  for (const k of Object.keys(tabs)) {
    tabs[k].classList.toggle("active", k === name);
    secs[k].hidden = k !== name;
  }
}
tabs.install.addEventListener("click", () => switchTab("install"));
tabs.print.addEventListener("click", () => switchTab("print"));
tabs.grade.addEventListener("click", () => switchTab("grade"));

function pageToast(msg, ok = true) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText =
    "position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:99999;" +
    "background:" + (ok ? "#00b42a" : "#f53f3f") + ";color:#fff;font-size:14px;" +
    "padding:10px 20px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);white-space:pre-line";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

let uid = 0;

const lightbox = $("lightbox");
const lbImg = $("lightboxImg");
let lbCtx = null;
let lbIndex = 0;

function lbShow() {
  const item = lbCtx.items[lbIndex];
  lbImg.src = item.url;
  $("lightboxTitle").textContent = item.file.name;
  $("lightboxPos").textContent = `${lbIndex + 1} / ${lbCtx.items.length}`;
  $("lbLeft").disabled = lbIndex === 0;
  $("lbRight").disabled = lbIndex === lbCtx.items.length - 1;
}
function openLb(ctx, i) {
  lbCtx = ctx;
  lbIndex = i;
  lbShow();
  lightbox.hidden = false;
}
function lbMove(d) {
  if (!lbCtx || !lbCtx.items.length) return;
  lbIndex = (lbIndex + d + lbCtx.items.length) % lbCtx.items.length;
  lbShow();
}
$("lbPrev").addEventListener("click", () => lbMove(-1));
$("lbNext").addEventListener("click", () => lbMove(1));
$("lbLeft").addEventListener("click", () => {
  if (lbIndex === 0) return;
  const items = lbCtx.items;
  [items[lbIndex - 1], items[lbIndex]] = [items[lbIndex], items[lbIndex - 1]];
  lbIndex -= 1;
  renderList(lbCtx);
  lbShow();
});
$("lbRight").addEventListener("click", () => {
  const items = lbCtx.items;
  if (lbIndex >= items.length - 1) return;
  [items[lbIndex + 1], items[lbIndex]] = [items[lbIndex], items[lbIndex + 1]];
  lbIndex += 1;
  renderList(lbCtx);
  lbShow();
});
$("lbDel").addEventListener("click", () => {
  const items = lbCtx.items;
  URL.revokeObjectURL(items[lbIndex].url);
  items.splice(lbIndex, 1);
  if (!items.length) {
    lightbox.hidden = true;
    renderList(lbCtx);
    return;
  }
  if (lbIndex >= items.length) lbIndex = items.length - 1;
  renderList(lbCtx);
  lbShow();
});
$("lbClose").addEventListener("click", () => (lightbox.hidden = true));
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) lightbox.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (lightbox.hidden) return;
  if (e.key === "Escape") lightbox.hidden = true;
  if (e.key === "ArrowLeft") lbMove(-1);
  if (e.key === "ArrowRight") lbMove(1);
  if (e.key === "Backspace" || e.key === "Delete") $("lbDel").click();
});

function naturalCompare(a, b) {
  const ra = String(a).split(/(\d+)/);
  const rb = String(b).split(/(\d+)/);
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    const x = ra[i], y = rb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x), ny = Number(y);
    if (!isNaN(nx) && !isNaN(ny) && x !== "" && y !== "") {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

async function unzipBytes(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 zip 文件");
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (ptr + 46 > u8.length || dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOff = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;
    const parts = name.split("/");
    if (parts.some((p) => p.startsWith(".")) || name.includes("__MACOSX")) continue;
    if (!IMAGE_RE.test(name)) continue;
    if (localOff + 30 > u8.length || dv.getUint32(localOff, true) !== 0x04034b50) continue;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) {
      data = comp;
    } else if (method === 8) {
      data = new Uint8Array(
        await new Response(new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()
      );
    } else {
      continue;
    }
    out.push([name, data]);
  }
  out.sort((a, b) => naturalCompare(a[0], b[0]));
  return out;
}

function renderList(ctx) {
  const { items, ul, countEl, listwrap, zone } = ctx;
  zone.hidden = items.length > 0;
  listwrap.hidden = items.length === 0;
  countEl.textContent = items.length ? `（${items.length} 页）` : "";
  ul.innerHTML = "";
  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "item";
    li.draggable = true;
    li.dataset.id = item.id;

    const media = document.createElement("img");
    media.src = item.url;
    media.title = "点击放大预览";
    media.addEventListener("click", () => openLb(ctx, i));
    li.appendChild(media);

    const order = document.createElement("span");
    order.className = "order";
    order.textContent = i + 1;
    li.appendChild(order);

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.file.name;
    name.title = item.file.name;
    li.appendChild(name);

    const ops = document.createElement("div");
    ops.className = "ops";
    ops.innerHTML = `<button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del" class="del">删</button>`;
    li.appendChild(ops);

    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", item.id);
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      li.classList.add("over");
    });
    li.addEventListener("dragleave", () => li.classList.remove("over"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("over");
      const dragId = Number(e.dataTransfer.getData("text/plain"));
      const from = items.findIndex((x) => x.id === dragId);
      const to = items.findIndex((x) => x.id === item.id);
      if (from < 0 || from === to) return;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      renderList(ctx);
    });

    ops.addEventListener("click", (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      if (act === "up" && i > 0) items.splice(i - 1, 0, items.splice(i, 1)[0]);
      if (act === "down" && i < items.length - 1) items.splice(i + 1, 0, items.splice(i, 1)[0]);
      if (act === "del") {
        URL.revokeObjectURL(item.url);
        items.splice(i, 1);
      }
      renderList(ctx);
    });

    ul.appendChild(li);
  });
}

function extFromType(t) {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" }[t] || ".jpg";
}

async function addZipFile(ctx, f) {
  setStatus(ctx, `正在解压 ${f.name}…`);
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const entries = await unzipBytes(bytes);
    if (!entries.length) {
      setStatus(ctx, `${f.name} 里没有图片`, "err");
      return 0;
    }
    let added = 0;
    const base = f.name.replace(/\.zip$/i, "");
    for (const [name, data] of entries) {
      const blob = new Blob([data], { type: "image/*" });
      const item = { id: uid++, file: new File([blob], name, { type: blob.type }), isZip: false, url: URL.createObjectURL(blob) };
      const r = await MiniPDF.ensureJpeg(new Uint8Array(await blob.arrayBuffer()), blob.type);
      item.w = r.w; item.h = r.h;
      if (ctx.names.has(item.file.name)) continue;
      ctx.names.add(item.file.name);
      ctx.items.push(item);
      added++;
    }
    setStatus(ctx, `已从 ${f.name} 解压 ${added} 页`);
    setTimeout(() => setStatus(ctx, "", ""), 1500);
    return added;
  } catch (e) {
    setStatus(ctx, `zip 解析失败：${e.message}`, "err");
    return 0;
  }
}

async function addFiles(ctx, fileList) {
  let added = 0;
  for (const f of fileList) {
    if (ZIP_RE.test(f.name)) {
      added += await addZipFile(ctx, f);
    } else if (IMAGE_RE.test(f.name)) {
      if (ctx.names.has(f.name)) continue;
      ctx.names.add(f.name);
      ctx.items.push({ id: uid++, file: f, isZip: false, url: URL.createObjectURL(f) });
      added++;
    }
  }
  if (added) renderList(ctx);
  return added;
}

function setStatus(ctx, msg, cls) {
  ctx.statusEl.textContent = msg;
  ctx.statusEl.className = "status" + (cls ? " " + cls : "");
}

async function generatePDF(ctx, preview) {
  if (!ctx.items.length) return;
  const btn = preview ? ctx.printBtn : ctx.genBtn;
  btn.disabled = true;
  setStatus(ctx, preview ? "正在生成打印预览…" : "正在合成 PDF…");
  let win = null;
  if (preview) win = window.open("", "_blank");
  try {
    const pages = [];
    for (const it of ctx.items) {
      const bytes = new Uint8Array(await it.file.arrayBuffer());
      pages.push(await MiniPDF.ensureJpeg(bytes, it.file.type || ""));
    }
    const blob = await MiniPDF.build(pages);
    const url = URL.createObjectURL(blob);
    if (preview) {
      if (win) {
        win.location.href = url;
        setStatus(ctx, "预览已在新标签页打开，按 Cmd+P 即可打印", "ok");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.click();
        setStatus(ctx, "弹窗被拦截，已改为下载，请允许弹窗后重试", "err");
      }
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = (ctx.titleEl.value || "试卷") + ".pdf";
      a.click();
      setStatus(ctx, `完成，共 ${blob.size} 字节，已开始下载`, "ok");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (win) win.close();
    setStatus(ctx, `失败：${e.message}`, "err");
  } finally {
    btn.disabled = false;
  }
}

function createList(key) {
  const section = secs[key];
  const zone = section.querySelector(".drop");
  const listwrap = section.querySelector(".listwrap");
  const ul = section.querySelector(".list");
  const countEl = section.querySelector(".count");
  const statusEl = section.querySelector(".status");
  const titleEl = section.querySelector(".title");
  const ctx = {
    key,
    items: [],
    names: new Set(),
    ul,
    countEl,
    statusEl,
    titleEl,
    listwrap,
    zone,
    genBtn: section.querySelector(".generate"),
    printBtn: section.querySelector(".printPreview"),
  };

  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("over");
    })
  );
  zone.addEventListener("drop", (e) => addFiles(ctx, e.dataTransfer.files));

  zone.querySelector(".pickImages").addEventListener("click", () => zone.querySelector(".inpImages").click());
  zone.querySelector(".pickFolder").addEventListener("click", () => zone.querySelector(".inpFolder").click());
  zone.querySelector(".pickZip").addEventListener("click", () => zone.querySelector(".inpZip").click());
  zone.querySelector(".inpImages").addEventListener("change", (e) => addFiles(ctx, e.target.files));
  zone.querySelector(".inpFolder").addEventListener("change", (e) => addFiles(ctx, e.target.files));
  zone.querySelector(".inpZip").addEventListener("change", (e) => addFiles(ctx, e.target.files));

  section.querySelector(".clearAll").addEventListener("click", () => {
    ctx.items.forEach((it) => URL.revokeObjectURL(it.url));
    ctx.items.length = 0;
    ctx.names.clear();
    renderList(ctx);
  });
  section.querySelector(".addMore").addEventListener("click", () => zone.querySelector(".inpImages").click());

  ctx.genBtn.addEventListener("click", () => generatePDF(ctx, false));
  ctx.printBtn.addEventListener("click", () => generatePDF(ctx, true));

  return ctx;
}

const printList = createList("print");
const gradeList = createList("grade");

document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

$("copyCode").addEventListener("click", async () => {
  await copyText($("userscriptSource").textContent.trim() + "\n");
  $("copyMsg").textContent = "已复制，去油猴扩展里新建脚本粘贴保存即可";
  setTimeout(() => ($("copyMsg").textContent = ""), 2500);
});
