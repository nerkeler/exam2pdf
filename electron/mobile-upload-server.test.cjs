const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { randomBytes } = require("node:crypto");
const { createUploadHandler, getLanAddresses, startMobileUploadServer } = require("./mobile-upload-server.cjs");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function invoke(handler, url, { method = "GET", form } = {}) {
  let body = Buffer.alloc(0);
  const headers = {};
  if (form) {
    const request = new Request("http://localhost" + url, { method, body: form });
    body = Buffer.from(await request.arrayBuffer());
    headers["content-type"] = request.headers.get("content-type");
  }
  const incoming = Readable.from(body.length ? [body] : []);
  incoming.url = url;
  incoming.method = method;
  incoming.headers = headers;
  const outgoing = {
    headersSent: false,
    destroyed: false,
    writeHead(status, responseHeaders) { this.statusCode = status; this.headers = responseHeaders; this.headersSent = true; },
    end(value) { this.body = String(value); }
  };
  await handler(incoming, outgoing);
  return { status: outgoing.statusCode, headers: outgoing.headers, body: outgoing.body };
}

test("serves a private upload page and stores submitted answer photos locally", async () => {
  const token = randomBytes(32).toString("hex");
  const saved = [];
  const events = [];
  const handler = createUploadHandler({
    token,
    answerStore: { async createPost(payload) {
      saved.push(payload);
      return { post: { id: "answer-1", title: payload.title, pages: payload.images.length } };
    } },
    onUploaded: async (answer) => events.push(answer.id)
  });
  const page = await invoke(handler, "/u/" + token);
  assert.equal(page.status, 200);
  assert.match(page.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.match(page.body, /上传学生作答/);

  const form = new FormData();
  form.set("title", "八年级周练");
  form.set("studentName", "小明");
  form.append("images", new Blob([PNG], { type: "image/png" }), "answer-1.png");
  form.append("images", new Blob([PNG], { type: "image/png" }), "answer-2.png");
  const response = await invoke(handler, "/u/" + token + "/upload", { method: "POST", form });
  assert.equal(response.status, 201);
  assert.deepEqual(JSON.parse(response.body), { id: "answer-1", title: "八年级周练", pages: 2 });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].recordType, "answer");
  assert.equal(saved[0].studentName, "小明");
  assert.equal(saved[0].images.length, 2);
  assert.equal(Buffer.from(saved[0].images[0].base64, "base64").toString("hex"), PNG.toString("hex"));
  assert.deepEqual(events, ["answer-1"]);
});

test("rejects unknown tokens and images whose content does not match their declared type", async () => {
  const token = randomBytes(32).toString("hex");
  const saved = [];
  const handler = createUploadHandler({
    token,
    answerStore: { async createPost(payload) { saved.push(payload); return { post: { id: "answer-1", title: payload.title, pages: 1 } }; } }
  });
  const invalid = await invoke(handler, "/u/not-the-token");
  assert.equal(invalid.status, 404);

  const form = new FormData();
  form.append("images", new Blob(["not a png"], { type: "image/png" }), "bad.png");
  const response = await invoke(handler, "/u/" + token + "/upload", { method: "POST", form });
  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).error, /格式无效/);
  const mislabeled = new FormData();
  mislabeled.append("images", new Blob([PNG], { type: "image/jpeg" }), "wrong.jpg");
  const mismatch = await invoke(handler, "/u/" + token + "/upload", { method: "POST", form: mislabeled });
  assert.equal(mismatch.status, 400);
  assert.match(JSON.parse(mismatch.body).error, /格式无效/);
  assert.equal(saved.length, 0);
});

test("returns only non-internal IPv4 addresses for phone links", () => {
  assert.deepEqual(getLanAddresses({
    lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    en0: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
    bridge: [{ family: "IPv6", address: "fd00::1", internal: false }]
  }), ["192.168.1.20"]);
});

test("serves an upload over a real local HTTP socket and closes the temporary address", async (t) => {
  const saved = [];
  const server = await startMobileUploadServer({
    host: "127.0.0.1",
    port: 0,
    networkInterfaces: { en0: [{ family: "IPv4", address: "192.168.1.20", internal: false }] },
    answerStore: { async createPost(payload) {
      const post = { id: "socket-answer", title: payload.title, pages: payload.images.length };
      saved.push({ payload, post });
      return { post };
    } }
  });
  let closed = false;
  t.after(async () => { if (!closed) await server.close(); });

  assert.equal(server.enabled, true);
  assert.equal(server.urls.length, 1);
  assert.match(server.urls[0], /^http:\/\/192\.168\.1\.20:\d+\/u\/[a-f0-9]{64}$/);

  const form = new FormData();
  form.set("title", "本机网络上传验证");
  form.append("images", new Blob([PNG], { type: "image/png" }), "answer.png");
  const response = await fetch(server.localUrl + "/upload", { method: "POST", body: form });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "socket-answer", title: "本机网络上传验证", pages: 1 });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].payload.recordType, "answer");
  assert.equal(Buffer.from(saved[0].payload.images[0].base64, "base64").toString("hex"), PNG.toString("hex"));

  await server.close();
  closed = true;
  await assert.rejects(fetch(server.localUrl), (error) => error.cause?.code === "ECONNREFUSED");
});

test("phone page and forged form cannot override the student bound to the session", async () => {
  const token = randomBytes(32).toString("hex");
  const saved = [];
  const handler = createUploadHandler({ token, studentName: '甲<script>', getStudentId: () => 'student-A', answerStore: { async createPost(payload) { saved.push(payload); return { post: { id: 'one', title: payload.title, pages: 1 } }; } } });
  const page = await invoke(handler, '/u/' + token);
  assert.match(page.body, /甲&lt;script&gt;/);
  assert.doesNotMatch(page.body, /name="studentName"/);
  const form = new FormData(); form.set('studentName', '乙');
  form.append('images', new Blob([PNG], { type: 'image/png' }), 'answer.png');
  assert.equal((await invoke(handler, '/u/' + token + '/upload', { method: 'POST', form })).status, 201);
  assert.equal(saved[0].studentName, '甲<script>'); assert.equal(saved[0].studentId, 'student-A');
});
