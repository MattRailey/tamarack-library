/* Railey Library — dropbox.js
   Dropbox: sign-in (OAuth PKCE), download/upload with revision checks, and the sync loop.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Dropbox sync (the library's own Dropbox app — see top of script)
   ============================================================ */
function dbxTokens(){ try{ const r=lsGet(DBX_TOKENS_KEY); return r?JSON.parse(r):null; }catch(e){ return null; } }
async function dbxToken(){
  const t = dbxTokens();
  if(!t || !t.refresh_token && !t.access_token) return null;
  if(t.expires_at && t.expires_at - 60000 > Date.now()) return t;
  if(!t.refresh_token) return t;
  try{
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({ grant_type:'refresh_token', refresh_token:t.refresh_token, client_id:dbxAppKey() }) });
    const j = await r.json();
    if(!j.access_token) return null;
    t.access_token = j.access_token; t.expires_at = Date.now() + j.expires_in*1000;
    lsSet(DBX_TOKENS_KEY, JSON.stringify(t));
    return t;
  }catch(e){ return null; }
}
/* ---- Files in the library folder, wherever this library is kept ----
   Own Dropbox: straight to the Dropbox API with this device's sign-in.
   Friend library: through the friends service, which only lets this phone into its own folder.
   Paths are always "<library folder>/<file>", the same in both. */
function friendCfg(){ try{ const r=lsGet(FRIEND_KEY); const f=r?JSON.parse(r):null; return f && f.token && f.server ? f : null; }catch(e){ return null; } }
function cloudOn(){ return !!(friendCfg() || dbxTokens()); }
function cloudName(){ return friendCfg() ? 'the library' : 'Dropbox'; }
async function friendCall(ep, headers, body){
  const f=friendCfg();
  return fetch(f.server.replace(/\/+$/,'')+ep, { method:'POST', headers:Object.assign({ Authorization:'Bearer '+f.token }, headers||{}), body });
}
// → { ok, res, rev } | { missing } | { signedOut, expired }
async function cloudGet(path){
  if(friendCfg()){
    const r=await friendCall('/files/download', { 'X-Path':encodeURIComponent(path) });
    if(r.status===404) return { missing:true };
    if(r.status===401) return { signedOut:true, expired:true, revoked:true };
    if(!r.ok) throw new Error('download failed (HTTP '+r.status+')');
    return { ok:true, res:r, rev:r.headers.get('X-Rev')||null };
  }
  const t=await dbxToken(); if(!t) return { signedOut:true };
  const r=await fetch('https://content.dropboxapi.com/2/files/download', { method:'POST',
    headers:{ 'Authorization':'Bearer '+t.access_token, 'Dropbox-API-Arg':dbxArg({path}) } });
  if(r.status===409) return { missing:true };
  if(r.status===401) return { signedOut:true, expired:true };
  if(!r.ok) throw new Error('download failed (HTTP '+r.status+')');
  let rev=null; try{ rev=JSON.parse(r.headers.get('Dropbox-API-Result')||'{}').rev || null; }catch(e){}
  return { ok:true, res:r, rev };
}
// opts.rev: replace only if nobody saved since that revision; otherwise "add" (never a blind overwrite).
// opts.autorename: on a name clash keep both. → { ok, path, rev } | { conflict } | { signedOut }
async function cloudPut(path, body, opts){
  opts=opts||{};
  if(friendCfg()){
    const r=await friendCall('/files/upload', { 'Content-Type':'application/octet-stream', 'X-Path':encodeURIComponent(path),
      'X-Mode':opts.rev?'update:'+opts.rev:'add', 'X-Autorename':opts.autorename?'1':'0' }, body);
    if(r.status===409) return { conflict:true };
    if(r.status===401) return { signedOut:true, revoked:true };
    if(!r.ok) throw new Error('upload failed (HTTP '+r.status+')');
    const j=await r.json(); return { ok:true, path:j.path||path, rev:j.rev||null };
  }
  const t=await dbxToken(); if(!t) return { signedOut:true };
  const mode = opts.rev ? { '.tag':'update', update:opts.rev } : 'add';
  const r=await fetch('https://content.dropboxapi.com/2/files/upload', { method:'POST',
    headers:{ 'Authorization':'Bearer '+t.access_token, 'Content-Type':'application/octet-stream',
      'Dropbox-API-Arg':dbxArg({ path, mode, autorename:!!opts.autorename, mute:true }) }, body });
  if(r.status===409) return { conflict:true };
  if(r.status===401) return { signedOut:true };
  if(!r.ok) throw new Error('upload failed (HTTP '+r.status+')');
  let j={}; try{ j=await r.json(); }catch(e){}
  return { ok:true, path:j.path_display||path, rev:j.rev||null };
}

async function dbxDownload(){
  const g=await cloudGet(dbxPath());
  if(g.signedOut) return { connected:false, expired:!!g.expired, revoked:!!g.revoked };
  if(g.missing) return { connected:true, data:null, rev:null };   // no file yet
  const data = JSON.parse(await g.res.text());
  if(!validStore(data)) throw new Error('the Dropbox file isn\'t a library file — not touching it');
  if(!Array.isArray(data.imports)) data.imports = [];
  return { connected:true, data, rev:g.rev };
}
// The Dropbox copy is written neatly (indented, title and author first in each book) so a person can open it and read it.
const KEY_ORDER=['id','title','author','series','seriesNo','genre','room','bookcase','shelf','position','status','rating','loanedTo','loanedDate','collections','isbn','year','publisher','pages','format','about','subjects','notes','needsReview','coverUrl'];
function readableJSON(s){
  const tidy=b=>{ if(b.deleted) return b; const o={}; for(const k of KEY_ORDER) if(k in b) o[k]=b[k]; for(const k in b) if(!(k in o)) o[k]=b[k]; return o; };
  return JSON.stringify(Object.assign({}, s, { books:s.books.map(tidy) }), null, 2);
}
async function dbxUpload(s, rev){
  // With a rev: only succeeds if nobody else wrote the file since we read it.
  // Without one (first upload): 'add' fails rather than clobbering a file that appeared meanwhile.
  const r=await cloudPut(dbxPath(), readableJSON(s), { rev });
  if(r.ok) return { ok:true };
  if(r.conflict) return { ok:false, conflict:true };
  return { ok:false };
}

function b64url(bytes){ return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
async function dbxConnect(){
  const key = dbxAppKey();
  if(!key){ toast('Paste the Dropbox App key first'); $('dbx-appkey').focus(); return; }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  lsSet(DBX_VERIFIER_KEY, verifier);
  location.href = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({ client_id:key, response_type:'code',
    code_challenge:challenge, code_challenge_method:'S256', token_access_type:'offline', redirect_uri:redirectUri() });
}
async function dbxHandleRedirect(){
  const q = new URLSearchParams(location.search);
  if(!q.has('code') && !q.has('error')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if(q.has('error')){ toast('Dropbox connection cancelled'); return; }
  const verifier = lsGet(DBX_VERIFIER_KEY);
  if(!verifier){ toast('Dropbox sign-in expired — tap Connect again'); return; }
  try{
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({ grant_type:'authorization_code', code:q.get('code'), client_id:dbxAppKey(), code_verifier:verifier, redirect_uri:redirectUri() }) });
    const j = await r.json();
    if(!j.access_token) throw new Error(j.error_description || j.error || 'no token');
    lsSet(DBX_TOKENS_KEY, JSON.stringify({ access_token:j.access_token, refresh_token:j.refresh_token, expires_at:Date.now()+j.expires_in*1000 }));
    try{ localStorage.removeItem(DBX_VERIFIER_KEY); }catch(e){}
    toast('Dropbox connected');
  }catch(e){ toast('Dropbox connection failed: '+e.message); }
}
function dbxDisconnect(){
  if(friendCfg()){
    if(!confirm('Take this phone out of the library? Your books stay saved in the library for your other phones. To get back in you’ll need a new invite.')) return;
    try{ localStorage.removeItem(FRIEND_KEY); }catch(e){}
  } else {
    if(!confirm('Disconnect Dropbox on this device? Your books stay saved here and in Dropbox.')) return;
    try{ localStorage.removeItem(DBX_TOKENS_KEY); }catch(e){}
  }
  lastSyncAt=0; setSync('', 'Local only (Dropbox not connected)'); renderDbxCard();
}
function renderDbxCard(){
  const fr = friendCfg(), on = cloudOn();
  $('dbx-appkey').value = dbxAppKey();
  $('dbx-appkey-row').classList.toggle('hide', on || !!DEFAULT_DBX_APP_KEY || !!fr);
  $('btn-connect').classList.toggle('hide', on);
  $('btn-disconnect').classList.toggle('hide', !on);
  $('btn-disconnect').textContent = fr ? 'Remove this phone' : 'Disconnect';
  $('btn-sync').classList.toggle('hide', !on);
  $('btn-addphone').classList.toggle('hide', !fr);
  $('dbx-title').textContent = fr ? 'Sync' : 'Dropbox';
  document.querySelectorAll('.own-dbx').forEach(e=>e.classList.toggle('hide', !!fr));
  document.querySelectorAll('.friend-only').forEach(e=>e.classList.toggle('hide', !fr));
  $('dbx-redirect').textContent = redirectUri();
}
let syncing=false, syncAgain=false, pushTimer=null, lastSyncAt=0, lastSyncedSig=lsGet(SYNCED_KEY)||'';
function markDirty(){ if(cloudOn()) setSync('warn','Unsynced changes…'); }
function setSync(kind, text){
  $('sync-dot').className = 'sync-dot' + (kind?' '+kind:'');
  $('sync-text').textContent = text;
  const d = $('dbx-status');
  if(!cloudOn()) d.innerHTML = '<b>Not connected on this device.</b> Your catalog is saved on this device only until you connect Dropbox below, or run the setup again.';
  else d.textContent = text;
}
function schedulePush(){ if(!cloudOn()) return; clearTimeout(pushTimer); pushTimer=setTimeout(syncNow, 1500); }
async function syncNow(){
  if(!cloudOn()){ setSync('', 'Local only (Dropbox not connected)'); setTimeout(()=>autoLookup(false), 800); return; }
  if(syncing){ syncAgain=true; return; }
  syncing=true; setSync('warn','Syncing…');
  try{
    let done=false;
    for(let attempt=0; attempt<4 && !done; attempt++){
      const remote = await dbxDownload();
      if(!remote.connected){ setSync('err', remote.revoked ? 'This phone was taken out of the library — ask for a new invite' : remote.expired ? 'Dropbox sign-in expired — reconnect on Data & Sync' : 'Dropbox not connected'); return; }
      const merged = remote.data ? mergeStores(store, remote.data) : store;
      if(sig(merged)!==sig(store)){ stampFields(); store = merged; snapAll(); writeLocal(); refreshAll(); }
      if(remote.data && sig(merged)===sig(remote.data)){ done=true; break; }
      const up = await dbxUpload(merged, remote.rev);
      if(up.ok){ done=true; break; }
      if(!up.conflict) throw new Error('upload failed');
      // someone else saved in between — loop: re-download, re-merge, retry
    }
    if(done){
      lastSyncAt=Date.now(); lastSyncedSig=sig(store); lsSet(SYNCED_KEY, lastSyncedSig);
      setSync('ok','Synced ' + new Date(lastSyncAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}));
      setTimeout(migrateCovers, 3000); setTimeout(fillPendingIsbns, 1500);
    } else setSync('err','Sync kept conflicting — try again');
  }catch(e){ if(navigator.onLine===false) setSync('warn','Offline — changes are saved on this phone and sync when you’re back online'); else setSync('err','Sync failed: '+e.message); }
  finally{
    syncing=false;
    if(syncAgain){ syncAgain=false; syncNow(); }
    else setTimeout(()=>autoLookup(false), 800);   // new books from another device or from Claude get covers too
  }
}
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && Date.now()-lastSyncAt>15000) syncNow(); });
