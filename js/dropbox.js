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
async function dbxDownload(){
  const t = await dbxToken();
  if(!t) return { connected:false };
  const r = await fetch('https://content.dropboxapi.com/2/files/download', { method:'POST',
    headers:{ 'Authorization':'Bearer '+t.access_token, 'Dropbox-API-Arg':dbxArg({path:dbxPath()}) } });
  if(r.status===409) return { connected:true, data:null, rev:null };   // no file yet
  if(r.status===401) return { connected:false, expired:true };
  if(!r.ok) throw new Error('download failed (HTTP '+r.status+')');
  let rev = null;
  try{ rev = JSON.parse(r.headers.get('Dropbox-API-Result')||'{}').rev || null; }catch(e){}
  const data = JSON.parse(await r.text());
  if(!validStore(data)) throw new Error('the Dropbox file isn\'t a library file — not touching it');
  if(!Array.isArray(data.imports)) data.imports = [];
  return { connected:true, data, rev };
}
// The Dropbox copy is written neatly (indented, title and author first in each book) so a person can open it and read it.
const KEY_ORDER=['id','title','author','series','seriesNo','genre','room','bookcase','shelf','position','status','rating','loanedTo','loanedDate','collections','isbn','year','publisher','pages','format','about','subjects','notes','needsReview','coverUrl'];
function readableJSON(s){
  const tidy=b=>{ if(b.deleted) return b; const o={}; for(const k of KEY_ORDER) if(k in b) o[k]=b[k]; for(const k in b) if(!(k in o)) o[k]=b[k]; return o; };
  return JSON.stringify(Object.assign({}, s, { books:s.books.map(tidy) }), null, 2);
}
async function dbxUpload(s, rev){
  const t = await dbxToken();
  if(!t) return { ok:false };
  // With a rev: only succeeds if nobody else wrote the file since we read it.
  // Without one (first upload): 'add' fails rather than clobbering a file that appeared meanwhile.
  const mode = rev ? { '.tag':'update', update:rev } : 'add';
  const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method:'POST',
    headers:{ 'Authorization':'Bearer '+t.access_token, 'Content-Type':'application/octet-stream',
      'Dropbox-API-Arg':dbxArg({ path:dbxPath(), mode, autorename:false, mute:true }) },
    body: readableJSON(s) });
  if(r.ok) return { ok:true };
  if(r.status===409) return { ok:false, conflict:true };
  throw new Error('upload failed (HTTP '+r.status+')');
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
  if(!confirm('Disconnect Dropbox on this device? Your books stay saved here and in Dropbox.')) return;
  try{ localStorage.removeItem(DBX_TOKENS_KEY); }catch(e){}
  lastSyncAt=0; setSync('', 'Local only (Dropbox not connected)'); renderDbxCard();
}
function renderDbxCard(){
  const on = !!dbxTokens();
  $('dbx-appkey').value = dbxAppKey();
  $('dbx-appkey-row').classList.toggle('hide', on || !!DEFAULT_DBX_APP_KEY);
  $('btn-connect').classList.toggle('hide', on);
  $('btn-disconnect').classList.toggle('hide', !on);
  $('btn-sync').classList.toggle('hide', !on);
  $('dbx-redirect').textContent = redirectUri();
}
let syncing=false, syncAgain=false, pushTimer=null, lastSyncAt=0, lastSyncedSig=lsGet(SYNCED_KEY)||'';
function markDirty(){ if(dbxTokens()) setSync('warn','Unsynced changes…'); }
function setSync(kind, text){
  $('sync-dot').className = 'sync-dot' + (kind?' '+kind:'');
  $('sync-text').textContent = text;
  const d = $('dbx-status');
  if(!dbxTokens()) d.innerHTML = '<b>Not connected on this device.</b> Your catalog is saved on this device only until you connect Dropbox below.';
  else d.textContent = text;
}
function schedulePush(){ if(!dbxTokens()) return; clearTimeout(pushTimer); pushTimer=setTimeout(syncNow, 1500); }
async function syncNow(){
  if(!dbxTokens()){ setSync('', 'Local only (Dropbox not connected)'); setTimeout(()=>autoLookup(false), 800); return; }
  if(syncing){ syncAgain=true; return; }
  syncing=true; setSync('warn','Syncing…');
  try{
    let done=false;
    for(let attempt=0; attempt<4 && !done; attempt++){
      const remote = await dbxDownload();
      if(!remote.connected){ setSync('err', remote.expired ? 'Dropbox sign-in expired — reconnect on Data & Sync' : 'Dropbox not connected'); return; }
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
