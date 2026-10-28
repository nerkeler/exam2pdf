const QRCode = require("qrcode");

async function mobileUploadState(server) {
  const urls = server.urls;
  // Keep the bearer URL local: no remote QR service or network request.
  const qrCodes = await Promise.all(urls.map(url => QRCode.toDataURL(url, {
    errorCorrectionLevel: "M", margin: 4, width: 256,
    color: { dark: "#000000", light: "#ffffff" }
  })));
  return { enabled: true, urls, qrCodes };
}
module.exports = { mobileUploadState };
