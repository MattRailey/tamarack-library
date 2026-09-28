/* Railey Library — settings.js
   Library settings: name, tagline, which library (Dropbox folder) this device opens.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Library settings. Shared (in the catalog JSON, store.settings.library):
   name + tagline. Per device (this browser only): Dropbox folder and
   app key — those are how a device finds the catalog in the first place.
   A set-up link (?folder=…&appkey=…) configures a new device in one tap.
   ============================================================ */
function libCfg(){ const s=((store.settings||{}).library)||{}; const dflt=LIB_NS ? (dbxFolder().split('/').filter(Boolean).pop()||'Our Library') : 'Railey Library'; return { title:(s.title||'').trim()||dflt, tag: s.tag!=null ? s.tag : 'Our books at home' }; }
function applyCfg(){
  const c=libCfg(), folderName=dbxFolder().split('/').filter(Boolean).pop()||dbxFolder();
  $('lib-name').textContent=c.title; $('lib-tag').textContent=c.tag; $('lib-tag').style.display=c.tag?'':'none';
  document.title=c.title;
  const m=document.querySelector('meta[name="apple-mobile-web-app-title"]'); if(m) m.content=c.title.length>14?'Library':c.title;
  document.querySelectorAll('.cfg-title').forEach(e=>e.textContent=c.title);
  document.querySelectorAll('.cfg-folder').forEach(e=>e.textContent=folderName);
  document.querySelectorAll('.cfg-path').forEach(e=>e.textContent=dbxFolder());
}
function knownLibs(){ let k=[]; try{ k=JSON.parse(lsGet(KNOWN_KEY)||'[]'); }catch(e){} if(!k.includes(dbxFolder())) k.push(dbxFolder()); return k.sort(natCmp); }
function switchLibrary(folder){
  if(!confirm('Open the library in “'+folder+'” on this device?\n\nEach library keeps its own books, Dropbox login and settings here — nothing is copied or mixed. You can switch back any time.')) return;
  const k=knownLibs(); if(!k.includes(folder)) k.push(folder); lsSet(KNOWN_KEY, JSON.stringify(k));
  lsSet(FOLDER_KEY, folder); location.reload();
}
function fillCfgForm(){
  const k=knownLibs(); $('cfg-libs').innerHTML=k.map(f=>'<option'+(f===dbxFolder()?' selected':'')+'>'+esc(f)+'</option>').join('');
  $('cfg-switch-row').classList.toggle('hide', k.length<2); const c=libCfg(); $('cfg-title').value=((store.settings||{}).library||{}).title||''; $('cfg-tag').value=c.tag; $('cfg-folder').value=dbxFolder(); }
$('cfg-save').onclick=()=>{
  const title=$('cfg-title').value.trim(), tag=$('cfg-tag').value.trim();
  let folder=$('cfg-folder').value.trim()||'/Railey Library'; if(!folder.startsWith('/')) folder='/'+folder; folder=folder.replace(/\/+$/,'');
  const cur=libCfg();
  if(title!==(((store.settings||{}).library||{}).title||'') || tag!==cur.tag){
    store.settings=Object.assign({}, store.settings, { library:{ title, tag }, updatedAt:Date.now() });
    commit();
  }
  if(folder!==dbxFolder()){ switchLibrary(folder); return; }
  applyCfg(); toast('Settings saved');
};
$('cfg-switch').onclick=()=>{ const f=$('cfg-libs').value; if(f && f!==dbxFolder()) switchLibrary(f); };
$('cfg-link').onclick=async()=>{
  const u=new URL(location.href.split('#')[0].split('?')[0]);
  let f=$('cfg-folder').value.trim()||dbxFolder(); if(!f.startsWith('/')) f='/'+f;     // type a new folder name first to make a link for someone else's library
  u.searchParams.set('folder', f.replace(/\/+$/,'')); if(dbxAppKey()) u.searchParams.set('appkey', dbxAppKey());
  try{ await navigator.clipboard.writeText(u.toString()); toast('Set-up link copied'); }catch(e){ prompt('Copy this link:', u.toString()); }
};
// set-up link: ?folder=/Smith Library&appkey=abc123
(function(){
  lsSet(KNOWN_KEY, JSON.stringify(knownLibs()));   // remember every library opened on this device
  if(window.__libSetup){ const k=knownLibs(); lsSet(KNOWN_KEY, JSON.stringify(k)); setTimeout(()=>toast('Opened the library in '+dbxFolder()+' — connect Dropbox under Epilogue → Data & Sync'), 800); }
})();

$('ps-photos').onclick=()=>openPhotos();
$('ps-scan').onclick=()=>openScanner({kind:'add'});
