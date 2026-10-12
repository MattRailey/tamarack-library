// The camera itself: Chrome's fake camera plays a made-up video of two book barcodes, one after the other, so the real
// reading loop (ZXing, as on an iPhone) runs. It must read book after book, and come back by itself when the phone
// stops the camera (track ended) or the photo picker is cancelled. The video is written to the temp folder at start.
const { test, expect } = require('@playwright/test');
const fs = require('fs'), os = require('os'), path = require('path');
const { mockNet, openApp, click } = require('./helpers');

const W = 640, H = 360, FPS = 10;
function ean13Modules(code) {
  const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const R = L.map(s => s.replace(/./g, c => c === '0' ? '1' : '0')), G = R.map(s => s.split('').reverse().join(''));
  const P = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLG','LGLGGL','LGLGLG','LGGLGL'][+code[0]];
  let m = '101';
  for (let i = 1; i <= 6; i++) m += (P[i - 1] === 'L' ? L : G)[+code[i]];
  m += '01010';
  for (let i = 7; i <= 12; i++) m += R[+code[i]];
  return m + '101';
}
function frame(code) {
  const y = Buffer.alloc(W * H, 235);
  if (code) {
    const m = ean13Modules(code), mw = 4, x0 = Math.round((W - m.length * mw) / 2), y0 = Math.round((H - 150) / 2);
    for (let yy = y0; yy < y0 + 150; yy++) for (let i = 0; i < m.length; i++) if (m[i] === '1') y.fill(16, yy * W + x0 + i * mw, yy * W + x0 + (i + 1) * mw);
  }
  return Buffer.concat([Buffer.from('FRAME\n'), y, Buffer.alloc(W * H / 2, 128)]);
}
const VIDEO = path.join(os.tmpdir(), 'railey-library-two-books.y4m');
{
  const a = frame('9780316769488'), b = frame('9780141182636'), blank = frame('');
  const seq = [];
  for (let i = 0; i < 100; i++) seq.push(i < 30 ? a : i < 50 ? blank : i < 80 ? b : blank);
  fs.writeFileSync(VIDEO, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`), ...seq]));
}
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + VIDEO] } });

async function withReader(page) {
  await mockNet(page);
  // the barcode reader comes from its CDN, as in the app
  await page.route('https://cdn.jsdelivr.net/**', r => r.continue());
  await page.context().grantPermissions(['camera']);
  await openApp(page);
}

test('the camera reads book after book in "Scan a stack", and comes back when the phone stops it', async ({ page }) => {
  test.setTimeout(60000);
  await withReader(page);
  await click(page, '#btn-scan'); await page.waitForSelector('#scan-bg.open');
  await click(page, '#sc-modes [data-k="many"]');
  await page.fill('#sc-room', ''); await page.fill('#sc-case', ''); await page.fill('#sc-shelf', '');
  await expect(page.locator('#sc-batch')).toContainText('The Catcher in the Rye', { timeout: 20000 });
  await expect(page.locator('#sc-batch')).toContainText('Watership Down', { timeout: 20000 });
  await expect(page.locator('#sc-batch .sc-bh')).toContainText('2 added');
  // the phone ends the camera (screen locked, a call): the watchdog starts it again and it keeps reading
  const before = await page.evaluate(() => { const t = scanStream.getVideoTracks()[0]; t.stop(); return t.id; });
  await expect.poll(() => page.evaluate(() => !!(scanStream && scanStream.getVideoTracks()[0].readyState === 'live')), { timeout: 8000 }).toBe(true);
  expect(await page.evaluate(() => scanStream.getVideoTracks()[0].id)).not.toBe(before);
  await page.evaluate(() => { batchSeen.clear(); lastCode = ''; });
  await expect(page.locator('#sc-hint')).toContainText(/Already scanned|Scan one barcode/, { timeout: 10000 });
  await expect.poll(() => page.evaluate(() => Date.now() - tickAt), { timeout: 5000 }).toBeLessThan(1000);
});

test('one at a time: a second book reads after the first is added; the camera comes back after a cancelled photo', async ({ page }) => {
  test.setTimeout(60000);
  await withReader(page);
  await click(page, '#btn-scan'); await page.waitForSelector('#scan-bg.open');
  await click(page, '#sc-modes [data-k="add"]');
  await expect(page.locator('#sc-result')).toContainText(/Catcher in the Rye|Watership Down/, { timeout: 20000 });
  const first = (await page.textContent('#sc-result')).includes('Catcher') ? 'Watership Down' : 'The Catcher in the Rye';
  await click(page, '#sc-add');
  await expect(page.locator('#sc-result')).toContainText(first, { timeout: 20000 });
  // the photo picker opened and cancelled: the camera starts again by itself
  await page.evaluate(() => { camHold = Date.now() - 1000; stopCamera(); window.dispatchEvent(new Event('focus')); });
  await expect.poll(() => page.evaluate(() => !!(scanStream && scanStream.getVideoTracks()[0].readyState === 'live')), { timeout: 8000 }).toBe(true);
});
