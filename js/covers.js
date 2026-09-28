/* Railey Library — covers.js
   Cover pictures: cloth-colour fallbacks, cached cover blobs, Dropbox-stored cover photos.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Covers
   ============================================================ */
function hue(s){ let h=0; for(const c of String(s)) h=(h*31+c.charCodeAt(0))>>>0; return h; }
const CLOTH=['#7d3328','#2e4a3b','#3a4a63','#6a4c2f','#5b3f5e','#8a5a2b','#35544f','#6d2f3a','#4a5a33','#7a6a3a'];
function initials(t){ return normKey(t).split(' ').filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('') || '?'; }
/* Cover photos live as files in Dropbox (<library folder>/covers/) and the book stores 'dbx:<path>'.
   Each device downloads a photo once and keeps it in IndexedDB. */
const coverBlobs=new Map(), coverLoading=new Set();
async function saveCoverFile(blob, id){
  try{
    const t=await dbxToken(); if(!t) return null;
    const path=dbxFolder()+'/covers/'+String(id).replace(/[^\w-]/g,'')+'-'+Date.now().toString(36)+'.jpg';
    const r=await fetch('https://content.dropboxapi.com/2/files/upload',{ method:'POST', headers:{ 'Authorization':'Bearer '+t.access_token, 'Content-Type':'application/octet-stream',
      'Dropbox-API-Arg':dbxArg({ path, mode:'add', autorename:true, mute:true }) }, body:blob });
    if(!r.ok) return null;
    const j=await r.json(); const saved=j.path_display||path;
    coverBlobs.set(saved, URL.createObjectURL(blob)); try{ await idbPut('cover:'+saved, blob); }catch(e){}
    return saved;
  }catch(e){ return null; }
}
async function loadCover(path){
  if(coverBlobs.has(path) || coverLoading.has(path)) return;
  coverLoading.add(path);
  try{
    let blob=null; try{ blob=await idbGet('cover:'+path); }catch(e){}
    if(!blob){ const t=await dbxToken(); if(t){ const r=await fetch('https://content.dropboxapi.com/2/files/download',{ method:'POST', headers:{ 'Authorization':'Bearer '+t.access_token, 'Dropbox-API-Arg':dbxArg({path}) } }); if(r.ok){ blob=await r.blob(); try{ await idbPut('cover:'+path, blob); }catch(e){} } } }
    if(blob){ const u=URL.createObjectURL(blob); coverBlobs.set(path,u); document.querySelectorAll('img[data-dbx]').forEach(im=>{ if(im.dataset.dbx===path) im.src=u; }); }
  }finally{ coverLoading.delete(path); }
}
// photos taken before this change were stored inside the catalog — move them out when Dropbox is connected
let _coverMigrating=false;
async function migrateCovers(){
  if(_coverMigrating || !dbxTokens()) return; _coverMigrating=true;
  try{
    let n=0;
    for(const b of store.books.filter(x=>!x.deleted && String(x.coverUrl||'').startsWith('data:')).slice(0,40)){
      const blob=await (await fetch(b.coverUrl)).blob(); const path=await saveCoverFile(blob, b.id); if(!path) break;
      const cur=byId(b.id); if(cur && cur.coverUrl===b.coverUrl){ cur.coverUrl='dbx:'+path; cur.updatedAt=Date.now(); n++; }
    }
    if(n) commit();
  }catch(e){} finally{ _coverMigrating=false; }
}
function coverUrl(b, size){
  if(String(b.coverUrl||'').startsWith('dbx:')){ const p=b.coverUrl.slice(4); if(coverBlobs.has(p)) return coverBlobs.get(p); loadCover(p); return ''; }
  if(b.coverUrl) return (size==='L' && !b.coverUrl.startsWith('data:')) ? b.coverUrl.replace(/-[SM]\.jpg$/,'-L.jpg') : b.coverUrl;
  const isbn = String(b.isbn||'').replace(/[^0-9Xx]/g,'');
  if(isbn.length===10 || isbn.length===13) return 'https://covers.openlibrary.org/b/isbn/'+isbn+'-'+(size||'M')+'.jpg?default=false';
  return '';
}
function webCover(b){ const u=coverUrl(b,'L'); return /^https?:/.test(u) ? u.replace(/\?default=false$/,'') : ''; }
function coverHTML(b, size){
  const ph = '<div class="ph" style="background-color:'+CLOTH[hue(b.title)%CLOTH.length]+'">'+esc(initials(b.title))+'</div>';
  const u = coverUrl(b, size);
  if(!u && String(b.coverUrl||'').startsWith('dbx:')) return '<img alt="" data-dbx="'+esc(b.coverUrl.slice(4))+'" data-ph="'+esc(ph)+'" onerror="if(this.parentNode)this.parentNode.innerHTML=this.dataset.ph" style="background:'+CLOTH[hue(b.title)%CLOTH.length]+'">';
  if(!u) return ph;
  return '<img loading="lazy" alt="" src="'+esc(u)+'" onerror="if(this.parentNode)this.parentNode.innerHTML=this.dataset.ph" data-ph="'+esc(ph)+'">';
}
