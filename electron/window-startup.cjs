const DEFAULT_STARTUP_TIMEOUT_MS = 15000;

function monitorWindowStartup(window, loadPromise, onFailure, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_STARTUP_TIMEOUT_MS;
  const showWindow = options.showWindow !== false;
  const schedule = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  let timer;
  let failureReported = false;

  const clearStartupTimer = () => {
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
  };

  const fail = (error) => {
    if (failureReported) return;
    failureReported = true;
    clearStartupTimer();
    if (window.isDestroyed?.()) return;
    onFailure(error instanceof Error ? error : new Error(String(error || "工作台启动失败")));
  };

  timer = schedule(() => {
    fail(new Error("工作台启动超时：" + Math.round(timeoutMs / 1000) + " 秒内没有完成首屏加载。请检查应用文件后重试。"));
  }, timeoutMs);
  timer?.unref?.();

  window.once("ready-to-show", () => {
    clearStartupTimer();
    if (!window.isDestroyed?.() && showWindow) window.show();
  });
  window.once("closed", clearStartupTimer);
  window.webContents.on("render-process-gone", (_event, details) => {
    if (!details || details.reason === "clean-exit") return;
    // killed = 被信号终止（SIGTERM/SIGKILL）：多为外部工具误杀或系统内存回收，
    // 与应用文件/数据目录无关，重启即可——避免误导用户去查权限。
    const hint = details.reason === "killed"
      ? "这是被外部终止（如其他程序结束了它），不是应用文件或数据问题：直接重新启动即可。"
      : "";
    fail(new Error("工作台渲染进程异常退出（" + details.reason + "，代码 " + details.exitCode + "）。" + hint));
  });
  Promise.resolve(loadPromise).catch(fail);

  return { fail, clearStartupTimer };
}

module.exports = { monitorWindowStartup, DEFAULT_STARTUP_TIMEOUT_MS };
