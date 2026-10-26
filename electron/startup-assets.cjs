const fs = require("node:fs");

function loadCollectorScript(filePath, readFileSync = fs.readFileSync) {
  try {
    return { source: readFileSync(filePath, "utf8"), error: null };
  } catch (error) {
    return { source: "", error };
  }
}

function tryRunOptionalStartupTask(task, onError) {
  try {
    task();
    return true;
  } catch (error) {
    if (typeof onError === "function") onError(error);
    return false;
  }
}

module.exports = { loadCollectorScript, tryRunOptionalStartupTask };
