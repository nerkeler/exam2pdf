(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.exam2pdfPageReorder = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TILE_SELECTOR = '.page-tile[draggable="true"]';

  function moveArrayItem(items, from, to) {
    if (!Array.isArray(items) || !Number.isInteger(from) || !Number.isInteger(to)
      || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return false;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    return true;
  }

  function bindTouchReorder(container, onReorder) {
    if (!container || typeof container.addEventListener !== "function" || typeof onReorder !== "function") return () => {};
    let drag = null;
    const tiles = () => Array.from(container.querySelectorAll(TILE_SELECTOR));
    const reset = () => {
      tiles().forEach((tile) => tile.classList.remove("dragging", "drop-target"));
      drag = null;
    };

    function onPointerDown(event) {
      if (event.pointerType !== "touch") return;
      const handle = event.target?.closest?.("[data-reorder-handle]");
      const tile = handle?.closest?.(TILE_SELECTOR);
      const index = Number(tile?.dataset?.index);
      if (!tile || !Number.isInteger(index)) return;
      drag = { pointerId: event.pointerId, from: index, source: tile, to: null, started: false, x: event.clientX, y: event.clientY };
      try { handle.setPointerCapture?.(event.pointerId); } catch {}
      event.preventDefault();
    }

    function onPointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.started && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
      drag.started = true;
      drag.source.classList.add("dragging");
      const hit = container.ownerDocument?.elementFromPoint?.(event.clientX, event.clientY);
      const target = hit?.closest?.(TILE_SELECTOR);
      drag.to = target && container.contains(target) ? Number(target.dataset.index) : null;
      tiles().forEach((tile) => tile.classList.toggle("drop-target", tile === target));
      event.preventDefault();
    }

    function onPointerEnd(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const result = drag.started && Number.isInteger(drag.to) && drag.from !== drag.to
        ? [drag.from, drag.to]
        : null;
      if (drag.started) event.preventDefault();
      reset();
      if (result) onReorder(result[0], result[1]);
    }

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove, { passive: false });
    container.addEventListener("pointerup", onPointerEnd);
    container.addEventListener("pointercancel", onPointerEnd);
    return () => {
      reset();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerEnd);
      container.removeEventListener("pointercancel", onPointerEnd);
    };
  }

  return { moveArrayItem, bindTouchReorder };
});
