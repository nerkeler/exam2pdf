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

test("serves a private upload page and hands submitted photos to the workspace unstaged", async () => {
  const token = randomBytes(32).toString("hex");
  const received = [];
  const handler = createUploadHandler({
    token,
    onUploadReceived: async (payload) => { received.push(payload); }
  });
  const page = await invoke(handler, "/u/" + token);
  assert.equal(page.status, 200);
  assert.match(page.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.match(page.body, /上传学生作答/);
  assert.match(page.body, /核对页序并确认保存/);

  const form = new FormData();
  form.set("title", "八年级周练");
  form.set("studentName", "小明");
  form.append("images", new Blob([PNG], { type: "image/png" }), "answer-1.png");
  form.append("images", new Blob([PNG], { type: "image/png" }), "answer-2.png");
  const response = await invoke(handler, "/u/" + token + "/upload", { method: "POST", form });
  assert.equal(response.status, 201);
  assert.equal(received.length, 1);
  const payload = received[0];
  assert.ok(/^[0-9a-f-]{36}$/.test(payload.id), "each upload batch must carry a fresh id");
  assert.equal(payload.title, "八年级周练");
  assert.equal(payload.studentName, "小明");
  assert.equal(payload.images.length, 2);
  assert.equal(Buffer.from(payload.images[0].base64, "base64").toString("hex"), PNG.toString("hex"));
  assert.deepEqual(JSON.parse(response.body), { id: payload.id, title: "八年级周练", pages: 2 });
});

test("falls back to a default title and passes the bound student through", async () => {
  const token = randomBytes(32).toString("hex");
  const received = [];
  const handler = createUploadHandler({
    token,
    studentName: "小红",
    getStudentId: () => "student-7",
    onUploadReceived: async (payload) => { received.push(payload); }
  });
  const form = new FormData();
  form.append("images", new Blob([PNG], { type: "image/png" }), "answer.png");
  const response = await invoke(handler, "/u/" + token + "/upload", { method: "POST", form });
  assert.equal(response.status, 201);
  assert.equal(received[0].title, "手机上传作答");
  assert.equal(received[0].studentName, "小红");
  assert.equal(received[0].studentId, "student-7");
  assert.deepEqual(JSON.parse(response.body), { id: received[0].id, title: "手机上传作答", pages: 1 });
});

test("rejects unknown tokens and images whose content does not match their declared type", async () => {
  const token = randomBytes(32).toString("hex");
  const received = [];
  const handler = createUploadHandler({
    token,
    onUploadReceived: async (payload) => { received.push(payload); }
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
  assert.equal(received.length, 0);
});

test("returns only non-internal IPv4 addresses for phone links", () => {
  assert.deepEqual(getLanAddresses({
    lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    en0: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
    bridge: [{ family: "IPv6", address: "fd00::1", internal: false }],
    utun: [{ family: "IPv4", address: "100.110.91.123", internal: false }]
  }), ["192.168.1.20"]);
});

test("keeps RFC1918 LAN ranges and drops CGNAT or virtual adapters like Tailscale", () => {
  const pick = (addresses) => getLanAddresses(Object.fromEntries(addresses.map((address, index) => ["nic" + index, [{ family: "IPv4", address, internal: false }]])));
  assert.deepEqual(pick(["192.168.1.20", "10.0.0.5", "172.16.9.9", "172.32.0.1"]), ["192.168.1.20", "10.0.0.5", "172.16.9.9"]);
  assert.deepEqual(pick(["100.110.91.123", "100.64.0.1", "198.18.0.1", "169.254.3.7", "8.8.8.8"]), []);
});

test("serves an upload over a real local HTTP socket and closes the temporary address", async (t) => {
  const saved = [];
  const server = await startMobileUploadServer({
    host: "127.0.0.1",
    port: 0,
    networkInterfaces: { en0: [{ family: "IPv4", address: "192.168.1.20", internal: false }] },
    onUploadReceived: async (payload) => { saved.push(payload); }
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
  assert.deepEqual(await response.json(), { id: saved[0].id, title: "本机网络上传验证", pages: 1 });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].images.length, 1);
  assert.equal(Buffer.from(saved[0].images[0].base64, "base64").toString("hex"), PNG.toString("hex"));

  await server.close();
  closed = true;
  await assert.rejects(fetch(server.localUrl), (error) => error.cause?.code === "ECONNREFUSED");
});

test("phone page and forged form cannot override the student bound to the session", async () => {
  const token = randomBytes(32).toString("hex");
  const saved = [];
  const handler = createUploadHandler({ token, studentName: '甲<script>', getStudentId: () => 'student-A', onUploadReceived: async (payload) => { saved.push(payload); } });
  const page = await invoke(handler, '/u/' + token);
  assert.match(page.body, /甲&lt;script&gt;/);
  assert.doesNotMatch(page.body, /name="studentName"/);
  const form = new FormData(); form.set('studentName', '乙');
  form.append('images', new Blob([PNG], { type: 'image/png' }), 'answer.png');
  assert.equal((await invoke(handler, '/u/' + token + '/upload', { method: 'POST', form })).status, 201);
  assert.equal(saved[0].studentName, '甲<script>'); assert.equal(saved[0].studentId, 'student-A');
});
