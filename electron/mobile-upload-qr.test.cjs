const test = require('node:test');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const { mobileUploadState } = require('./mobile-upload-qr.cjs');

test('mobile upload QR images encode each complete session URL locally', async () => {
  const urls = ['http://192.168.1.5:12345/?token=secret-123', 'http://10.0.0.5:12345/?token=secret-123'];
  const result = await mobileUploadState({ urls });
  assert.equal(result.enabled, true);
  assert.deepEqual(result.urls, urls);
  for (let i = 0; i < urls.length; i++) {
    assert.equal(result.qrCodes[i], await QRCode.toDataURL(urls[i], { errorCorrectionLevel: 'M', margin: 4, width: 256, color: { dark: '#000000', light: '#ffffff' } }));
    assert.equal(Buffer.from(result.qrCodes[i].split(',')[1], 'base64').subarray(1, 4).toString(), 'PNG');
  }
  assert.notEqual(result.qrCodes[0], result.qrCodes[1]);
  assert.deepEqual(await mobileUploadState({ urls: [] }), { enabled: true, urls: [], qrCodes: [] });
});
