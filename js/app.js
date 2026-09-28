/* Railey Library — app.js
   Panels (tabs), refreshing everything after a change, and start-up.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Tabs + boot
   ============================================================ */
function showPanel(p){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active', b.dataset.panel===p));
  document.body.classList.toggle('behind-menu', p==='import'||p==='data'||p==='help');
  $('nav-epi').classList.toggle('active', p==='import'||p==='data'||p==='help');
  document.querySelectorAll('.panel').forEach(s=>s.classList.toggle('active', s.id===p));
  if(p==='shelves') renderShelves();
  if(p==='data'){ renderData(); fillCfgForm(); }
  if(p==='import'||p==='data'||p==='help') ui.appx=p;
  if(p==='import'){ renderUndo(); showIE(ui.ie||'sell'); }
  ui.panel=p; lsSet(UI_KEY, JSON.stringify(ui));
  window.scrollTo(0,0);
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>showPanel(b.dataset.panel));
// Epilogue bookmark opens the old ⋯ menu (Import & Export, Data & Sync); the sync warning dot rides on it
$('nav-epi').onclick=e=>{ e.stopPropagation(); $('menu-pop').classList.remove('open'); showPanel(['import','data','help'].includes(ui.appx)?ui.appx:'import'); };
$('nav-epi').appendChild($('sync-dot'));
$('menu-btn').onclick=e=>{ e.stopPropagation(); $('menu-pop').classList.toggle('open'); };
document.addEventListener('click', e=>{ if(!e.target.closest('#menu-pop')) $('menu-pop').classList.remove('open'); });
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{ $('menu-pop').classList.remove('open'); showPanel(b.dataset.go); });
// Import & Export has three parts: mystery books, selling, building a library from photos
function showIE(which){ document.querySelectorAll('#ie-seg button').forEach(y=>y.classList.toggle('active',y.dataset.ie===which));
  ['unid','sell','import'].forEach(k=>$('ie-'+k).classList.toggle('hide', k!==which));
  if(which==='sell') renderSell(); if(which==='unid') renderUnid(); ui.ie=which; lsSet(UI_KEY, JSON.stringify(ui)); }
document.querySelectorAll('#ie-seg button').forEach(x=>x.onclick=()=>showIE(x.dataset.ie));
function refreshAll(){
  applyCfg();
  refreshLists();
  renderLibrary(false);
  if($('shelves').classList.contains('active')) renderShelves();
  if($('data').classList.contains('active')) renderData();
  if($('import').classList.contains('active')){ renderUndo(); if(!$('ie-sell').classList.contains('hide')) renderSell(); if(!$('ie-unid').classList.contains('hide')) renderUnid(); }
}


if(ui.sort) $('f-sort').value = ui.sort;
syncViewSeg();
syncScope();
applyCfg();
refreshLists();
renderLibrary(true);
showPanel(ui.panel || 'library');
renderDbxCard();
loadFromIdb().then(()=>dbxHandleRedirect()).then(()=>{ if(lsGet(STORE_KEY)) writeLocal(); renderDbxCard(); setSync('', dbxTokens() ? 'Connecting…' : 'Local only (Dropbox not connected)'); syncNow(); });
window.addEventListener('online', ()=>{ syncNow(); setTimeout(fillPendingIsbns, 1000); if($('scan-bg').classList.contains('open')) syncScanMode(); });
window.addEventListener('offline', ()=>{ if(dbxTokens()) setSync('warn','Offline — changes are saved on this phone and sync when you’re back online'); if($('scan-bg').classList.contains('open')) syncScanMode(); });
// works with no signal: a small service worker keeps a copy of the app (and the barcode reader) on the phone
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
window.addEventListener('beforeunload', e=>{ if(pushTimer && dbxTokens() && sig(store)!==lastSyncedSig){ e.preventDefault(); e.returnValue=''; } });
