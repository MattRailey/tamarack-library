/* Railey Library — core.js
   Shared helpers, which-library keys, the on-device store (IndexedDB) and per-book merging.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Storage model
   ------------------------------------------------------------
   One JSON store: { format, version, updatedAt, books:[...] }.
   Every book carries its own `updatedAt` (ms). Deleting a book
   keeps a small tombstone { id, deleted:true, updatedAt } so a
   delete on one device propagates instead of the book coming
   back from another device's copy. Merging two stores (local vs
   Dropbox, or a restored backup) keeps the newer version of
   each book, so nothing is lost when two devices edit
   different books between syncs.
   ============================================================ */
// ---- Which library is this device looking at? Each library = one Dropbox folder. Every key this app
// stores on the device is tagged with the library, so two libraries on one phone never share or mix
// data, logins or settings. (The original Railey Library keeps the untagged keys it always had.)
const FOLDER_KEY = 'tamarack_library_folder';          // per device: the library currently open
const KNOWN_KEY  = 'tamarack_library_known';           // per device: libraries opened here before
(function(){ // set-up link: ?folder=/Smith Library&appkey=abc123 opens (or switches to) that library
  const q=new URLSearchParams(location.search); if(q.has('code') || !q.has('folder')) return;
  let f=q.get('folder').trim(); if(!f.startsWith('/')) f='/'+f; f=f.replace(/\/+$/,'');
  try{ localStorage.setItem(FOLDER_KEY, f); if(q.has('appkey')) localStorage.setItem('tamarack_library_dropbox_appkey'+(f==='/Railey Library'?'':'@'+f), q.get('appkey').trim()); }catch(e){}
  q.delete('folder'); q.delete('appkey'); history.replaceState(null,'', location.pathname+(q.toString()?'?'+q:'')+location.hash);
  window.__libSetup=f;
})();
const LIB_NS     = dbxFolder()==='/Railey Library' ? '' : '@'+dbxFolder();
const STORE_KEY  = 'tamarack_library_store_v1'+LIB_NS;
const PREV_KEY   = 'tamarack_library_store_prev'+LIB_NS;   // previous save, one step back, just in case
const UI_KEY     = 'tamarack_library_ui'+LIB_NS;
const SYNCED_KEY = 'tamarack_library_synced_sig'+LIB_NS;
// Dropbox app key: pasted on the Data & Sync tab (or arrives in a set-up link) and kept per library on this device.
const DEFAULT_DBX_APP_KEY = '';   // a fork can build its own app key in here so nobody has to paste it
const DBX_APPKEY_KEY  = 'tamarack_library_dropbox_appkey'+LIB_NS;
const DBX_TOKENS_KEY  = 'tamarack_library_dropbox_tokens'+LIB_NS;    // this library's own Dropbox login
const DBX_VERIFIER_KEY= 'tamarack_library_dropbox_pkce'+LIB_NS;
function dbxFolder(){ let f=String(lsGet(FOLDER_KEY)||'/Railey Library').trim().replace(/\\/g,'/').replace(/\/+$/,''); if(!f.startsWith('/')) f='/'+f; return f||'/Railey Library'; }
function dbxArg(o){ return JSON.stringify(o).replace(/[\u007f-\uffff]/g,c=>'\\u'+('000'+c.charCodeAt(0).toString(16)).slice(-4)); }
function dbxPath(){ return dbxFolder()+'/tamarack-library.json'; }
function dbxAppKey(){ return (lsGet(DBX_APPKEY_KEY) || DEFAULT_DBX_APP_KEY || '').trim(); }
function redirectUri(){ return location.origin + location.pathname.replace(/\.html$/,''); } // one URI whether opened with or without .html
const PAGE = 120;

const $ = id => document.getElementById(id);
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function uid(){ return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function norm(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
function normKey(s){ return norm(s).replace(/^(the|a|an)\s+/,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function natCmp(a,b){ return String(a||'').localeCompare(String(b||''), undefined, {numeric:true, sensitivity:'base'}); }
function posCmp(a,b){ const x=String(a.position||''), y=String(b.position||''); if(!x||!y) return x?-1:y?1:0; return natCmp(x,y); }
function todayLocal(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtLocalDate(ymd){ if(!ymd) return ''; const p=ymd.split('-').map(Number); if(p.length!==3||!p[0]) return ymd; return new Date(p[0],p[1]-1,p[2]).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
function money(n){ return '$' + Number(n||0).toLocaleString(undefined,{minimumFractionDigits:0, maximumFractionDigits:2}); }
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'), 2600); }

function emptyStore(){ return { format:'tamarack-library', version:1, updatedAt:0, books:[], imports:[] }; }
function validStore(s){ return s && typeof s==='object' && Array.isArray(s.books); }
function loadStore(){
  const raw = lsGet(STORE_KEY);
  if(!raw) return emptyStore();
  try{ const s = JSON.parse(raw); if(validStore(s)){ if(!Array.isArray(s.imports)) s.imports=[]; return s; } }catch(e){}
  // Main copy unreadable — fall back to the previous save rather than starting empty.
  try{ const p = JSON.parse(lsGet(PREV_KEY)||''); if(validStore(p)){ if(!Array.isArray(p.imports)) p.imports=[]; return p; } }catch(e){}
  return emptyStore();
}
let store = loadStore();
setTimeout(()=>snapAll(), 0);

/* The on-device copy lives in IndexedDB (plenty of room). localStorage caps each site at ~5 MB,
   and the catalog plus its backup copy outgrew that, which caused the "storage full" alerts. */
const IDB_NAME='tamarack_library', IDB_OS='kv';
let _idbP=null;
function idb(){
  if(!_idbP) _idbP=new Promise((res,rej)=>{
    try{ if(!window.indexedDB) return rej(new Error('no indexedDB'));
      const r=indexedDB.open(IDB_NAME,1);
      r.onupgradeneeded=()=>r.result.createObjectStore(IDB_OS);
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); r.onblocked=()=>rej(new Error('blocked'));
    }catch(e){ rej(e); }
  });
  return _idbP;
}
async function idbGet(k){ const db=await idb(); return new Promise((res,rej)=>{ const q=db.transaction(IDB_OS).objectStore(IDB_OS).get(k); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); }
async function idbPut(k,v){ const db=await idb(); return new Promise((res,rej)=>{ const t=db.transaction(IDB_OS,'readwrite'); t.objectStore(IDB_OS).put(v,k); t.oncomplete=()=>res(true); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error||new Error('aborted')); }); }
async function loadFromIdb(){
  try{
    let s=null;
    try{ const raw=await idbGet(STORE_KEY); if(raw){ s=JSON.parse(raw); if(!validStore(s)) s=null; } }catch(e){ s=null; }
    if(!s){ try{ const p=await idbGet(PREV_KEY); if(p){ s=JSON.parse(p); if(!validStore(s)) s=null; } }catch(e){ s=null; } }   // main copy unreadable → one save back
    if(!s) return;
    if(!Array.isArray(s.imports)) s.imports=[];
    const merged=mergeStores(store, s);
    if(sig(merged)!==sig(store)){ store=merged; snapAll(); refreshAll(); }
  }catch(e){}
}
let _saveT=null, _lastSaved=null, _warned=false;
function writeLocal(){ clearTimeout(_saveT); _saveT=setTimeout(saveLocalNow, 400); }
async function saveLocalNow(){
  const json=JSON.stringify(store);
  try{
    if(_lastSaved) await idbPut(PREV_KEY, _lastSaved);
    await idbPut(STORE_KEY, json);
    _lastSaved=json;
    try{ localStorage.removeItem(STORE_KEY); localStorage.removeItem(PREV_KEY); }catch(e){}   // free the old, cramped spot
    return;
  }catch(e){}
  if(lsSet(STORE_KEY, json)) return;       // fallback for browsers without IndexedDB
  if(_warned) return; _warned=true;        // say it once, not on every save
  toast(dbxTokens() ? 'This device could not keep an offline copy, but your changes are still saving to Dropbox.'
                    : 'Could not save on this device — download a backup from Data & Sync.');
}
// Snapshot of each book as last saved, used to stamp which fields an edit changed (b.ft = {field: time}).
const _snap=new Map();
const FT_SKIP=new Set(['id','updatedAt','ft']);
// '' / 0 / false / [] / missing all mean "not set": saving the edit form writes blanks for fields the
// book never had, and those must not count as edits (they would override real changes from another device).
const blankish=v=>v==null || v==='' || v===false || v===0 || (Array.isArray(v) && !v.length);
const sameVal=(a,b)=>(blankish(a) && blankish(b)) || JSON.stringify(a)===JSON.stringify(b);
function snapAll(){ _snap.clear(); for(const b of store.books) _snap.set(b.id,{u:b.updatedAt, v:Object.assign({},b)}); }
function stampFields(){
  for(const b of store.books){
    if(b.deleted) continue;
    const s=_snap.get(b.id);
    if(s && s.u!==b.updatedAt){
      const keys=new Set(Object.keys(b).concat(Object.keys(s.v)));
      for(const k of keys){ if(FT_SKIP.has(k)) continue;
        if(!sameVal(b[k], s.v[k])){ b.ft=Object.assign({}, b.ft); b.ft[k]=b.updatedAt||Date.now(); } }
    }
    if(!s || s.u!==b.updatedAt) _snap.set(b.id,{u:b.updatedAt, v:Object.assign({},b)});
  }
}
function commit(){               // call after any user change
  stampFields();
  store.updatedAt = Date.now();
  writeLocal();
  markDirty();
  schedulePush();
  refreshAll();
}
function allBooks(){ return store.books.filter(b=>!b.deleted); }
function live(){ return store.books.filter(b=>!b.deleted && b.saleStatus!=='sold'); }
function byId(id){ return store.books.find(b=>b.id===id); }

// Newer copy wins, except fields the older copy changed more recently (tracked in ft) — so a loan marked on
// the phone and an author fixed on the desktop both survive.
function mergeBook(nw, old){
  if(nw.deleted || old.deleted || !old.ft) return nw;
  let out=null;
  for(const k in old.ft){
    if(old.ft[k] > ((nw.ft||{})[k]||0) && !sameVal(old[k], nw[k])){
      // the result is a new version of the book (so it gets uploaded), newer than both inputs
      if(!out) out=Object.assign({}, nw, {ft:Object.assign({}, nw.ft), updatedAt:Math.max(nw.updatedAt||0, old.updatedAt||0)+1});
      if(old[k]===undefined) delete out[k]; else out[k]=old[k];
      out.ft[k]=old.ft[k];
    }
  }
  return out || nw;
}
function mergeStores(a, b){
  const map = new Map();
  for(const bk of a.books) map.set(bk.id, bk);
  for(const bk of b.books){
    const cur = map.get(bk.id);
    if(!cur){ map.set(bk.id, bk); continue; }
    if((bk.updatedAt||0)===(cur.updatedAt||0)) continue;
    const [nw, old] = (bk.updatedAt||0) > (cur.updatedAt||0) ? [bk, cur] : [cur, bk];
    map.set(bk.id, mergeBook(nw, old));
  }
  const imp = new Map();
  for(const i of (a.imports||[]).concat(b.imports||[])) if(i && i.id) imp.set(i.id, Object.assign({}, imp.get(i.id)||{}, i));
  const imports = [...imp.values()].sort((x,y)=>(x.at||0)-(y.at||0)).slice(-20);
  const settings = ((b.settings||{}).updatedAt||0) > ((a.settings||{}).updatedAt||0) ? b.settings : (a.settings||b.settings);
  return { format:'tamarack-library', version:1, updatedAt:Math.max(a.updatedAt||0, b.updatedAt||0), books:[...map.values()], imports, settings };
}
function sig(s){ return s.books.map(b=>b.id+':'+(b.updatedAt||0)+(b.deleted?'x':'')).sort().join('|') + '#' + (s.imports||[]).map(i=>i.id+(i.undone?'u':'')).join(','); }
