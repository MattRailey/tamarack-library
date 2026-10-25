// The shelf camera: stays open, one tap = one photo (no "Use Photo" step), each sent in the background in order;
// "Redo last" replaces the last photo under the same name; "Finished with N1 →" moves on to N2.
const { test, expect } = require('@playwright/test');
const { mockNet, openApp, click } = require('./helpers');

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

test('tap, tap, tap: photos go in order; redo replaces the last; next bookcase starts a new count', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await click(page, '#btn-photos'); await page.waitForSelector('#ph-bg.open');
  await page.fill('#ph-room', 'Den'); await page.fill('#ph-case', 'N1');
  await click(page, '#ph-cam');
  await page.waitForSelector('#cam-bg.open');
  await page.waitForFunction(() => document.getElementById('cam-video').videoWidth > 0, null, { timeout: 15000 });
  await expect(page.locator('#cam-redo')).toBeDisabled();
  for (let i = 0; i < 3; i++) { await page.click('#cam-shutter'); await page.waitForTimeout(150); }
  const inbox = () => net.uploads.filter(u => u.path.includes('/photos/inbox/'));
  await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(3);
  expect(inbox().map(u => u.path.slice(-12))).toEqual(['N1 shelf 001.jpg'.slice(-12), 'N1 shelf 002.jpg'.slice(-12), 'N1 shelf 003.jpg'.slice(-12)]);
  expect(inbox()[0].path).toMatch(/^\/Railey Library\/photos\/inbox\/\d{4}-\d\d-\d\d \d{6} Den N1 shelf 001\.jpg$/);
  await expect(page.locator('#cam-count')).toContainText('3 of N1');
  // redo: the next shot overwrites 003 (same name, by its revision), and the count stays at 3
  await page.click('#cam-redo');
  await expect(page.locator('#cam-msg')).toContainText('replaces the last one');
  await page.click('#cam-shutter');
  await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(4);
  const redo = inbox()[3];
  expect(redo.path).toBe(inbox()[2].path);
  expect(redo.mode['.tag']).toBe('update');
  await expect(page.locator('#cam-count')).toContainText('3 of N1');
  await expect(page.locator('#cam-redo')).toHaveText('↺ Redo last');
  // finished with N1: on to N2, new count from 001
  await expect(page.locator('#cam-next')).toHaveText('Finished with N1 →');
  // the heading says where; "Finished with N1 →" asks for the next name in a pop-up (counted up), Start goes to it
  await expect(page.locator('#cam-where-txt')).toHaveText('Den · N1');
  await page.click('#cam-next');
  await expect(page.locator('#ca-case')).toHaveValue('N2');
  await expect(page.locator('#ca-room')).toHaveValue('Den');
  await page.click('#ca-start');
  await expect(page.locator('#cam-where-txt')).toHaveText('Den · N2');
  await expect(page.locator('#cam-redo')).toBeDisabled();
  await page.click('#cam-shutter');
  await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(5);
  expect(inbox()[4].path).toMatch(/ Den N2 shelf 001\.jpg$/);
  await page.click('#cam-finish');
  await expect(page.locator('#cam-bg')).not.toHaveClass(/open/);
  await expect(page.locator('#ph-status')).toContainText('4 photos sent');
  // a break: next time Send photos opens on N2 (where the camera got to) and lists what was sent
  await click(page, '#ph-close'); await click(page, '#btn-photos');
  await expect(page.locator('#ph-case')).toHaveValue('N2');
  await expect(page.locator('#ph-done')).toContainText('Den N1 · 3');
  await expect(page.locator('#ph-done')).toContainText('Den N2 · 1');
});

test('Change opens the same pop-up; Cancel leaves it as it was', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await click(page, '#btn-photos'); await page.waitForSelector('#ph-bg.open');
  await page.fill('#ph-room', 'Den'); await page.fill('#ph-case', 'Tall oak');
  await click(page, '#ph-cam');
  await page.waitForSelector('#cam-bg.open');
  await expect(page.locator('#cam-where-txt')).toHaveText('Den · Tall oak');
  await page.click('#cam-change');
  await expect(page.locator('#ca-title')).toHaveText('Change room or bookcase');
  await page.fill('#ca-case', 'Something else'); await page.click('#ca-cancel');
  await expect(page.locator('#cam-where-txt')).toHaveText('Den · Tall oak');
  // a name with no number: the next one is typed fresh
  await page.click('#cam-next');
  await expect(page.locator('#ca-case')).toHaveValue('');
  await page.click('#ca-cancel');
});

test('Send photos works with no room or bookcase: no pop-up, photos go as no-room no-bookcase; a place can be set later', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await click(page, '#btn-photos'); await page.waitForSelector('#ph-bg.open');
  await page.fill('#ph-room', 'Den'); await page.fill('#ph-case', 'N1');
  await click(page, '#ph-noloc');                       // "Clear the place"
  await expect(page.locator('#ph-room')).toHaveValue(''); await expect(page.locator('#ph-case')).toHaveValue('');
  await click(page, '#ph-cam');
  await page.waitForSelector('#cam-bg.open');
  await page.waitForFunction(() => document.getElementById('cam-video').videoWidth > 0, null, { timeout: 15000 });
  await expect(page.locator('#cam-ask')).toBeHidden();                      // it does not ask first
  await expect(page.locator('#cam-where-txt')).toHaveText('no location yet');
  await expect(page.locator('#cam-next')).toBeHidden();                     // nothing to "finish with"
  await page.click('#cam-shutter');
  const inbox = () => net.uploads.filter(u => u.path.includes('/photos/inbox/'));
  await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(1);
  expect(inbox()[0].path).toMatch(/^\/Railey Library\/photos\/inbox\/\d{4}-\d\d-\d\d \d{6} no-room no-bookcase shelf 001\.jpg$/);
  await expect(page.locator('#cam-count')).toContainText('1 of these (no location yet)');
  // it is known after all: Change → Start sets a place; "No location yet" in the pop-up puts it back
  await page.click('#cam-change');
  await expect(page.locator('#ca-none')).toBeVisible();
  await page.fill('#ca-room', 'Den'); await page.fill('#ca-case', 'N1'); await page.click('#ca-start');
  await expect(page.locator('#cam-ask')).toBeHidden();
  await expect(page.locator('#cam-where-txt')).toHaveText('Den · N1');
  await page.click('#cam-change'); await expect(page.locator('#ca-none')).toBeVisible(); await page.click('#ca-none');
  await expect(page.locator('#cam-ask')).toBeHidden();
  await expect(page.locator('#cam-where-txt')).toHaveText('no location yet');
  await page.click('#cam-shutter');
  await expect.poll(() => inbox().length, { timeout: 10000 }).toBe(2);
  expect(inbox()[1].path).toMatch(/ no-room no-bookcase shelf 002\.jpg$/);   // back to "no location": its numbering carries on (no name clash)
});

test('Recheck shelves still needs the bookcase (the pop-up has no "No location yet")', async ({ page }) => {
  await mockNet(page); await openApp(page, { dropbox: true });
  await page.evaluate(() => openShelfCam({ room: '', bookcase: '', kind: 'recheck', build: false }));
  await expect(page.locator('#cam-ask')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#ca-none')).toBeHidden();
  await page.click('#ca-start');
  await expect(page.locator('#ca-err')).toBeVisible();
});

test('each shot keeps the sharpest frame; a shot much softer than usual is called out', async ({ page }) => {
  await mockNet(page); await openApp(page, { dropbox: true });
  const r = await page.evaluate(() => {
    const mk = blur => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600); x.fillStyle = '#000'; x.font = '28px serif';
      for (let i = 0; i < 14; i++) x.fillText('1 ½ cups flour, 2 eggs, bake 25 minutes', 40, 40 + i * 40);
      if (!blur) return c;
      const b = document.createElement('canvas'); b.width = 800; b.height = 600; const y = b.getContext('2d'); y.filter = 'blur(' + blur + 'px)'; y.drawImage(c, 0, 0); return b; };
    const sharp = frameSharpness(mk(0), 800, 600), soft = frameSharpness(mk(2), 800, 600), mush = frameSharpness(mk(6), 800, 600);
    cam = { scores: [] };
    const calls = [sharp, sharp * 0.9, sharp * 1.1, mush, sharp * 0.95].map(s => camBlurry(s));
    cam = null;
    return { order: sharp > soft && soft > mush, calls };
  });
  expect(r.order).toBe(true);
  expect(r.calls).toEqual([false, false, false, true, false]);
});

test('taps in a row are all taken, in order (none lost while a shot picks its frame)', async ({ page }) => {
  const net = await mockNet(page); await openApp(page, { dropbox: true });
  await click(page, '#btn-photos'); await page.waitForSelector('#ph-bg.open');
  await page.fill('#ph-room', 'Den'); await page.fill('#ph-case', 'N9');
  await click(page, '#ph-cam'); await page.waitForSelector('#cam-bg.open');
  await page.waitForFunction(() => document.getElementById('cam-video').videoWidth > 0, null, { timeout: 15000 });
  for (let i = 0; i < 4; i++) await page.click('#cam-shutter');           // quicker than a shot takes
  const inbox = () => net.uploads.filter(u => u.path.includes('/photos/inbox/')).map(u => u.path.slice(-7));
  await expect.poll(inbox, { timeout: 15000 }).toEqual(['001.jpg', '002.jpg', '003.jpg', '004.jpg']);
});
