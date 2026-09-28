// Screenshot comparison between two builds: node tests/visual.compare.js <dirA> <dirB>
// Serves each on its own port, walks through the main screens at phone and desktop sizes, and diffs.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'library.json'), 'utf8');
const [A, B] = process.argv.slice(2);
const OUT = process.env.OUT || '/tmp/visual'; fs.mkdirSync(OUT, { recursive: true });
const states = [
  ['feed', async p => {}],
  ['cards', async p => { await p.click('#view-seg [data-view="grid"]'); }],
  ['list', async p => { await p.click('#view-seg [data-view="list"]'); }],
  ['filters', async p => { await p.click('#btn-more-filters'); }],
  ['book', async p => { await p.fill('#f-q', 'middlemarch driftwood'); await p.waitForTimeout(300); await p.fill('#f-q', 'driftwood'); await p.waitForTimeout(300); await p.click('#results [data-id]'); }],
  ['edit', async p => { await p.fill('#f-q', 'driftwood'); await p.waitForTimeout(300); await p.click('#results [data-id]'); await p.evaluate(() => document.getElementById('btn-edit').click()); }],
  ['shelves', async p => { await p.evaluate(() => document.querySelector('nav button[data-panel="shelves"]').click()); }],
  ['epi-import-sell', async p => { await p.click('#nav-epi'); await p.evaluate(() => document.querySelector('#ie-seg [data-ie="sell"]').click()); }],
  ['epi-import-unid', async p => { await p.click('#nav-epi'); await p.evaluate(() => document.querySelector('#ie-seg [data-ie="unid"]').click()); }],
  ['epi-import-photos', async p => { await p.click('#nav-epi'); await p.evaluate(() => document.querySelector('#ie-seg [data-ie="import"]').click()); }],
  ['epi-data', async p => { await p.click('#nav-epi'); await p.evaluate(() => document.querySelector('.panel.active .appx-tabs [data-go="data"]').click()); }],
  ['epi-help', async p => { await p.click('#nav-epi'); await p.evaluate(() => document.querySelector('.panel.active .appx-tabs [data-go="help"]').click()); }],
  ['scanner', async p => { await p.evaluate(() => document.getElementById('btn-scan').click()); }],
  ['photos', async p => { await p.evaluate(() => document.getElementById('btn-photos').click()); }],
  ['walk', async p => { await p.click('#nav-epi'); await p.evaluate(() => { document.querySelector('#ie-seg [data-ie="unid"]').click(); document.getElementById('un-walk').click(); }); }],
  ['select', async p => { await p.evaluate(() => document.getElementById('btn-select').click()); }],
];
function serve(dir, port) { return spawn('python3', ['-m', 'http.server', String(port), '--directory', dir], { stdio: 'ignore' }); }
(async () => {
  const sa = serve(A, 4181), sb = serve(B, 4182); await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  let bad = 0;
  for (const [vw, vh] of [[400, 860], [1280, 900]]) for (const [name, act] of states.filter(s => !process.env.ONLY || process.env.ONLY.split(',').includes(s[0]))) {
    const shots = [];
    for (const port of [4181, 4182]) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, serviceWorkers: 'block' });
      await ctx.route('**/*', r => r.request().url().includes('localhost') ? r.continue() : r.abort());
      const p = await ctx.newPage();
      await p.goto(`http://localhost:${port}/tamarack-library.html?t=1`);
      await p.evaluate(f => { localStorage.clear(); localStorage.setItem('tamarack_library_store_v1', f); localStorage.setItem('tamarack_library_ui', JSON.stringify({view:'feed'})); }, FIX);
      await new Promise(r => { p.evaluate(() => new Promise(res => { const q = indexedDB.deleteDatabase('tamarack_library'); q.onsuccess = q.onerror = q.onblocked = res; })).then(r); });
      await p.goto(`http://localhost:${port}/tamarack-library.html`);
      await p.waitForFunction(() => /Showing/.test(document.getElementById('summary').textContent));
      await p.addStyleTag({ content: '*{transition:none!important;animation:none!important;caret-color:transparent!important} .toast{display:none!important}' });
      await act(p); await p.waitForTimeout(400);
      const f = `${OUT}/${name}-${vw}-${port === 4181 ? 'a' : 'b'}.png`;
      await p.screenshot({ path: f, fullPage: true }); shots.push(f); await ctx.close();
    }
    const diff = require('child_process').execSync(`python3 -c "
from PIL import Image, ImageChops
a=Image.open('${shots[0]}').convert('RGB'); b=Image.open('${shots[1]}').convert('RGB')
if a.size!=b.size: print('size', a.size, b.size)
else:
  d=ImageChops.difference(a,b); bb=d.getbbox(); print('same' if not bb else 'diff %s px=%d'%(bb, d.convert('L').point(lambda v:255 if v>24 else 0).histogram()[255]))
"`).toString().trim();
    if (diff !== 'same') bad++;
    console.log(`${vw} ${name}: ${diff}`);
  }
  await browser.close(); sa.kill(); sb.kill();
  console.log(bad ? `${bad} screens differ` : 'all screens identical');
})();
