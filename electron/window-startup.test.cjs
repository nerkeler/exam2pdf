const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { monitorWindowStartup, DEFAULT_STARTUP_TIMEOUT_MS } = require("./window-startup.cjs");

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.webContents = new EventEmitter();
    this.showCount = 0;
    this.destroyed = false;
  }

  isDestroyed() { return this.destroyed; }
  show() { this.showCount += 1; }
}

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cleared = true; }
  };
}

test("shows the workbench on the first frame and cancels the startup timeout", () => {
  const window = new FakeWindow();
  const timers = fakeTimers();
  const failures = [];
  monitorWindowStartup(window, Promise.resolve(), (error) => failures.push(error), {
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });

  assert.equal(timers.timers[0].delay, DEFAULT_STARTUP_TIMEOUT_MS);
  window.emit("ready-to-show");
  assert.equal(window.showCount, 1);
  assert.equal(timers.timers[0].cleared, true);
  assert.deepEqual(failures, []);
});

test("can verify a first frame without showing a window during startup smoke checks", () => {
  const window = new FakeWindow();
  const timers = fakeTimers();
  monitorWindowStartup(window, Promise.resolve(), () => assert.fail("unexpected startup failure"), {
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    showWindow: false
  });

  window.emit("ready-to-show");
  assert.equal(window.showCount, 0);
  assert.equal(timers.timers[0].cleared, true);
});

test("reports a page load failure once so the caller can show its fallback page", async () => {
  const window = new FakeWindow();
  const timers = fakeTimers();
  const failures = [];
  monitorWindowStartup(window, Promise.reject(new Error("missing app page")), (error) => failures.push(error), {
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });
  await new Promise((resolve) => setImmediate(resolve));
  window.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 5 });

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /missing app page/);
  assert.equal(timers.timers[0].cleared, true);
});

test("turns a missing first frame into a visible startup timeout", () => {
  const window = new FakeWindow();
  const timers = fakeTimers();
  const failures = [];
  monitorWindowStartup(window, new Promise(() => {}), (error) => failures.push(error), {
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });

  timers.timers[0].callback();
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /启动超时/);
});

test("does not show a destroyed window or report a clean renderer exit as a failure", () => {
  const window = new FakeWindow();
  const timers = fakeTimers();
  const failures = [];
  monitorWindowStartup(window, Promise.resolve(), (error) => failures.push(error), {
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });

  window.destroyed = true;
  window.emit("ready-to-show");
  window.webContents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });
  assert.equal(window.showCount, 0);
  assert.deepEqual(failures, []);
  assert.equal(timers.timers[0].cleared, true);
});
