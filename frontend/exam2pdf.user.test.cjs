const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { PostStore } = require("../electron/post-store.cjs");
const { buildXhsCollectionInput } = require("../electron/xhs-collection.cjs");

function makeJpeg(width, height) {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0xff, 0xd9]);
}

function createCollectorHarness(pathname, imageList, onCollect) {
  const source = fs.readFileSync(path.join(__dirname, "exam2pdf.user.js"), "utf8");
  const imageBytes = makeJpeg(1200, 1600);
  const imageUrl = "https://sns-webpic.xhscdn.com/note-page.jpg";
  const secondImageUrl = "https://sns-webpic.xhscdn.com/note-page-2.jpg";
  const collected = [];
  const fetchedUrls = [];
  let intervalCallback;
  const elements = new Map();
  const body = {
    appendChild(element) {
      element.parentNode = body;
      if (element.id) elements.set(element.id, element);
    }
  };
  const document = {
    body,
    title: "小红书",
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) {
      return {
        tagName: tag,
        style: {},
        textContent: "",
        children: [],
        dataset: {},
        appendChild(child) { this.children.push(child); child.parentNode = this; },
        addEventListener() {},
        setAttribute() {},
        getBoundingClientRect() { return { width: 100, height: 30, top: 0, right: 100 }; },
        querySelector() { return { style: {}, appendChild() {}, addEventListener() {}, setAttribute() {} }; },
        querySelectorAll() { return []; },
        remove() { if (this.id) elements.delete(this.id); }
      };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const window = {
    location: { pathname, href: "https://www.xiaohongshu.com" + pathname },
    __INITIAL_STATE__: {
      note: {
        noteDetailMap: {
          "note-123": {
            note: {
              title: "三年级数学试卷",
              user: { nickname: "橙子教辅" },
              imageList: imageList || [{ urlDefault: imageUrl, infoList: [{ width: 1200, url: imageUrl }] }]
            }
          }
        }
      }
    },
    exam2pdfCollector: {
      async fetchImage(url) {
        fetchedUrls.push(url);
        if (url !== imageUrl && url !== secondImageUrl) throw new Error("image URL unavailable");
        return { mime: "image/jpeg", base64: imageBytes.toString("base64") };
      },
      async collectPost(payload) {
        collected.push(payload);
        return onCollect ? onCollect(payload) : { duplicate: false };
      }
    }
  };
  window.top = window;
  window.self = window;
  window.document = document;
  const context = vm.createContext({
    window,
    location: window.location,
    document,
    Blob,
    TextEncoder,
    Uint8Array,
    URL,
    atob,
    btoa,
    console,
    createImageBitmap: async () => ({
      width: 1200,
      height: 1600,
      close() { this.width = 0; this.height = 0; }
    }),
    setInterval(callback) { intervalCallback = callback; return 1; },
    clearInterval() {},
    setTimeout() { return 1; }
  });

  new vm.Script(source, { filename: "exam2pdf.user.js" }).runInContext(context);
  assert.equal(typeof intervalCallback, "function");
  intervalCallback();
  const button = document.getElementById("e2p-btn");
  assert.ok(button);
  return { button, collected, imageBytes, fetchedUrls, imageUrl, secondImageUrl, window };
}

test("collects note-detail images with metadata and dimensions before releasing ImageBitmap", async () => {
  const { button, collected, imageBytes } = createCollectorHarness("/explore/note-123");
  await button.onclick();

  assert.equal(collected.length, 1);
  const payload = collected[0];
  assert.equal(payload.noteId, "note-123");
  assert.equal(payload.title, "三年级数学试卷");
  assert.equal(payload.author, "橙子教辅");
  assert.equal(payload.expectedImages, 1);
  assert.deepEqual(
    { width: payload.images[0].width, height: payload.images[0].height },
    { width: 1200, height: 1600 }
  );
  assert.equal(payload.images[0].base64, imageBytes.toString("base64"));
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "采集到家卷");
});

test("does not collect feed pages without a note-detail route", async () => {
  const { button, collected } = createCollectorHarness("/explore");
  await button.onclick();
  assert.deepEqual(collected, []);
});

test("keeps source page indexes when an image entry has no downloadable URL", async () => {
  const secondImageUrl = "https://sns-webpic.xhscdn.com/note-page-2.jpg";
  const { button, collected, fetchedUrls } = createCollectorHarness("/explore/note-123", [
    { urlDefault: "", infoList: [] },
    { urlDefault: secondImageUrl, infoList: [{ width: 1400, url: secondImageUrl }] }
  ]);

  await button.onclick();

  assert.deepEqual(fetchedUrls, [secondImageUrl]);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].expectedImages, 2);
  assert.deepEqual(Array.from(collected[0].images, (image) => image.sourceIndex), [1]);
});

test("stores a failed source page as missing and fills it at the right index on retry", async (t) => {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "exam2pdf-collector-retry-"));
  t.after(() => fsPromises.rm(root, { recursive: true, force: true }));
  const store = new PostStore(path.join(root, "posts"));
  await store.initialize();
  const sourceUrl = "https://www.xiaohongshu.com/explore/note-123";
  const missingFirstPage = [{ urlDefault: "", infoList: [] }];
  let postId;
  const { button, imageUrl, secondImageUrl, window } = createCollectorHarness(
    "/explore/note-123",
    missingFirstPage,
    async (payload) => {
      const result = await store.createPost(buildXhsCollectionInput(payload, sourceUrl, payload.noteId));
      postId = result.post.id;
      return result;
    }
  );
  const detail = window.__INITIAL_STATE__.note.noteDetailMap["note-123"].note;
  detail.imageList.push({ urlDefault: secondImageUrl, infoList: [{ width: 1400, url: secondImageUrl }] });

  await button.onclick();
  const partial = await store.getPost(postId);
  assert.equal(partial.expectedImages, 2);
  assert.equal(partial.missingImages, 1);
  assert.deepEqual(partial.pageOrder, ["page-002.jpg"]);
  assert.equal(partial.images[0].sourceIndex, 1);

  detail.imageList[0] = { urlDefault: imageUrl, infoList: [{ width: 1200, url: imageUrl }] };
  await button.onclick();
  const retried = await store.getPost(postId);
  assert.equal(retried.missingImages, 0);
  assert.deepEqual(retried.pageOrder, ["page-001.jpg", "page-002.jpg"]);
  assert.deepEqual(Array.from(retried.images, (image) => image.sourceIndex).sort(), [0, 1]);
});

test("keeps search controls out of the Xiaohongshu page", () => {
  const harness = createCollectorHarness("/explore/note-123");
  assert.equal(harness.window.document.getElementById("e2p-search-btn"), null);
  assert.equal(harness.window.exam2pdfSearch, undefined);
});
