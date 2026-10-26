const test = require("node:test");
const assert = require("node:assert/strict");
const { moveArrayItem, bindTouchReorder } = require("./page-reorder.js");

class ClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  toggle(name, force) {
    if (force === undefined) force = !this.values.has(name);
    if (force) this.values.add(name); else this.values.delete(name);
    return force;
  }
  contains(name) { return this.values.has(name); }
}

function makeTile(index) {
  return {
    dataset: { index: String(index) },
    classList: new ClassList(),
    closest(selector) { return selector === '.page-tile[draggable="true"]' ? this : null; }
  };
}

function makeHarness() {
  const tiles = [makeTile(0), makeTile(1), makeTile(2)];
  const listeners = new Map();
  const container = {
    ownerDocument: { hit: null, elementFromPoint() { return this.hit; } },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    querySelectorAll() { return tiles; },
    contains(element) { return tiles.includes(element); }
  };
  const handle = {
    setPointerCapture() {},
    closest(selector) { return selector === "[data-reorder-handle]" ? this : selector === '.page-tile[draggable="true"]' ? tiles[0] : null; }
  };
  const event = (target, pointerType = "touch", pointerId = 9, clientX = 0, clientY = 0) => ({
    target, pointerType, pointerId, clientX, clientY, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  });
  return { tiles, container, handle, listeners, event };
}

test("moves an item to the requested index and rejects invalid positions", () => {
  const items = ["a", "b", "c"];
  assert.equal(moveArrayItem(items, 0, 2), true);
  assert.deepEqual(items, ["b", "c", "a"]);
  assert.equal(moveArrayItem(items, 2, 2), false);
  assert.equal(moveArrayItem(items, -1, 0), false);
  assert.deepEqual(items, ["b", "c", "a"]);
});

test("touch dragging from a page handle reorders the target and clears drag styling", () => {
  const harness = makeHarness();
  const changes = [];
  bindTouchReorder(harness.container, (from, to) => changes.push([from, to]));

  const down = harness.event(harness.handle);
  harness.listeners.get("pointerdown")(down);
  assert.equal(down.defaultPrevented, true);
  harness.container.ownerDocument.hit = harness.tiles[2];
  harness.listeners.get("pointermove")(harness.event(harness.handle, "touch", 9, 20, 0));
  assert.equal(harness.tiles[0].classList.contains("dragging"), true);
  assert.equal(harness.tiles[2].classList.contains("drop-target"), true);
  harness.listeners.get("pointerup")(harness.event(harness.handle));

  assert.deepEqual(changes, [[0, 2]]);
  assert.equal(harness.tiles.some((tile) => tile.classList.contains("dragging") || tile.classList.contains("drop-target")), false);
});

test("ignores taps, mouse pointers, and targets outside the page grid", () => {
  const harness = makeHarness();
  const changes = [];
  bindTouchReorder(harness.container, (from, to) => changes.push([from, to]));
  harness.listeners.get("pointerdown")(harness.event(harness.handle, "mouse"));
  harness.listeners.get("pointermove")({ pointerId: 9, clientX: 40, clientY: 0, preventDefault() {} });

  harness.listeners.get("pointerdown")(harness.event(harness.handle));
  harness.listeners.get("pointerup")(harness.event(harness.handle));
  assert.deepEqual(changes, []);

  harness.listeners.get("pointerdown")(harness.event(harness.handle));
  harness.container.ownerDocument.hit = { closest() { return makeTile(8); } };
  harness.listeners.get("pointermove")(harness.event(harness.handle, "touch", 9, 20, 0));
  harness.listeners.get("pointerup")(harness.event(harness.handle));
  assert.deepEqual(changes, []);
});
