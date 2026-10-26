const fs = require("node:fs/promises");

function sendToPrinter(printWindow) {
  return new Promise((resolve, reject) => {
    try {
      printWindow.webContents.print({ printBackground: true, silent: false }, (success, failureReason) => {
        resolve({ success, failureReason: success ? "" : String(failureReason || "打印未完成") });
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function printAndCleanup(printWindow, printDirectory) {
  try {
    return await sendToPrinter(printWindow);
  } finally {
    try {
      if (!printWindow.isDestroyed()) printWindow.close();
    } finally {
      await fs.rm(printDirectory, { recursive: true, force: true });
    }
  }
}

module.exports = { printAndCleanup };
