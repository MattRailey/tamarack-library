/* Railey Library — photos.js
   Sending shelf and title-page photos to the Dropbox photo inbox for Claude.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Photos for Claude — shelf / spine / title-page pictures go to
   <library folder>/photos/inbox/, labeled with where they were taken.
   ============================================================ */
function openPhotos(){
  const L=ui.phLoc||{};
  $('ph-room').value=L.room||roomPick(); $('ph-case').value=L.bookcase||$('f-case').value||''; $('ph-shelf').value=L.shelf||'';
  $('ph-kind').value=L.kind||'shelf'; $('ph-note').value=''; $('ph-status').textContent='';
  $('ph-bg').classList.add('open'); lockPage(); renderRetry();
}
$('btn-photos').onclick=openPhotos;
$('ph-close').onclick=()=>{ $('ph-bg').classList.remove('open'); unlockPage(); };
$('ph-take').onclick=async()=>{ if(!cloudOn()){ toast('Connect Dropbox first (Epilogue → Data & Sync) so photos can reach the folder'); return; } $('ph-file').click(); };
$('ph-file').onchange=async e=>{
  const files=[...e.target.files]; e.target.value=''; if(!files.length) return;
  const loc={ room:$('ph-room').value.trim(), bookcase:$('ph-case').value.trim(), shelf:$('ph-shelf').value.trim(), kind:$('ph-kind').value };
  ui.phLoc=loc; lsSet(UI_KEY, JSON.stringify(ui));
  await sendToInbox(files, loc, $('ph-note').value.trim(), $('ph-status'), $('ph-sent'));
  $('ph-note').value='';
};
/* Size and quality: whole-shelf and spine photos keep 3600 px on the long side at high quality, so a spine
   in a 20-book shot is still ~150–200 px wide and its small print stays readable. One book: 1800 px is plenty. */
const PHOTO_SIZE={ shelf:[3600,0.9], spines:[3600,0.9], 'new-books':[3600,0.9], book:[1800,0.85], other:[2600,0.85] };
async function sendToInbox(files, loc, note, statusEl, listEl){
  if(!cloudOn()){ toast('Connect Dropbox first (Epilogue → Data & Sync) so photos can reach the folder'); return 0; }
  const slug=s=>String(s||'').replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
  const d=new Date(), stamp=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+String(d.getSeconds()).padStart(2,'0');
  const base=[stamp, slug(loc.room)||'no-room', slug(loc.bookcase)||'no-bookcase', loc.shelf?'shelf-'+slug(loc.shelf):'', loc.kind, note?slug(note):''].filter(Boolean).join(' ');
  // numbered 01, 02 … so the photos sort in the order they were taken (10 no longer lands before 2)
  const width=Math.max(2, String(files.length).length);
  const [max, q]=PHOTO_SIZE[loc.kind]||PHOTO_SIZE.other;
  let ok=0, fail=0;
  for(let i=0;i<files.length;i++){
    statusEl.textContent='Sending '+(i+1)+' of '+files.length+'…';
    const path=dbxFolder()+'/photos/inbox/'+base+(files.length>1?' '+String(i+1).padStart(width,'0'):'')+'.jpg';
    let blob=null;
    try{
      blob=await shrinkPhoto(files[i], max, q);
      if(!(await putPhoto(path, blob, true))) throw new Error('upload failed');
      ok++;
      const url=URL.createObjectURL(blob);
      listEl && listEl.insertAdjacentHTML('afterbegin','<div class="ph-item"><img src="'+url+'" alt=""><span>✓ '+esc([loc.room,loc.bookcase,loc.shelf?'Shelf '+loc.shelf:''].filter(Boolean).join(' · ')||'Sent')+(note?' — '+esc(note):'')+'</span></div>');
    }catch(err){ fail++; if(blob) await queuePhoto(path, blob); }
  }
  if(note){
    // keep the note with the photos as a small text file too
    const np=dbxFolder()+'/photos/inbox/'+base+' NOTE.txt', nb=new Blob([note+'\n\n'+JSON.stringify(loc)]);
    try{ if(!(await putPhoto(np, nb, true))) await queuePhoto(np, nb); }catch(e){ await queuePhoto(np, nb); }
  }
  statusEl.textContent = fail ? ok+' sent. '+fail+' didn’t go through — they’re saved on this phone and will send on their own when the signal is back, or tap “Send them now”.'
                              : ok+' photo'+(ok===1?'':'s')+' sent to the inbox. Add more, or close when you’re done.';
  renderRetry();
  return ok;
}
// First try: on a name clash keep both (two batches in the same second). A retry sends to the exact same name and
// never makes a copy: if the earlier try did arrive (the reply was lost), the name is taken and that counts as sent.
async function putPhoto(path, blob, first){
  const r=await cloudPut(path, blob, { autorename:!!first });
  return r.ok || (!first && r.conflict);
}

/* ---- Photos waiting to send: kept on the phone (IndexedDB) until they reach the inbox ---- */
const PQ='photoq:';
async function idbKeysWith(prefix){ const db=await idb(); return new Promise((res,rej)=>{ const q=db.transaction(IDB_OS).objectStore(IDB_OS).getAllKeys(); q.onsuccess=()=>res(q.result.filter(k=>String(k).startsWith(prefix))); q.onerror=()=>rej(q.error); }); }
async function idbDel(k){ const db=await idb(); return new Promise((res,rej)=>{ const t=db.transaction(IDB_OS,'readwrite'); t.objectStore(IDB_OS).delete(k); t.oncomplete=()=>res(true); t.onerror=()=>rej(t.error); }); }
async function queuePhoto(path, blob){ try{ await idbPut(PQ+path, { path, blob, at:Date.now() }); }catch(e){} }
// only this library's waiting photos (libraries never mix)
async function queuedPhotos(){ try{ return (await idbKeysWith(PQ+dbxFolder()+'/')).sort(natCmp); }catch(e){ return []; } }
let _retrying=false;
async function retryPhotos(quiet){
  if(_retrying || !cloudOn() || navigator.onLine===false) return;
  const keys=await queuedPhotos(); if(!keys.length) return;
  _retrying=true; let sent=0;
  try{
    for(const k of keys){
      let it=null; try{ it=await idbGet(k); }catch(e){}
      if(!it){ await idbDel(k).catch(()=>{}); continue; }
      try{ if(await putPhoto(it.path, it.blob, false)){ await idbDel(k); sent++; } }catch(e){ break; }   // still no signal: try later
    }
  }finally{ _retrying=false; }
  const left=(await queuedPhotos()).length;
  if(sent && !quiet) toast(sent+' waiting photo'+(sent===1?'':'s')+' sent'+(left?' — '+left+' still waiting':''));
  renderRetry();
}
async function renderRetry(){
  const n=(await queuedPhotos()).filter(k=>k.endsWith('.jpg')).length;
  $('ph-retry').classList.toggle('hide', !n);
  $('ph-retry-n').textContent = n+' photo'+(n===1?'':'s')+' waiting to send';
}
$('ph-retry-btn').onclick=()=>retryPhotos(false);
window.addEventListener('online', ()=>setTimeout(()=>retryPhotos(true), 2000));

// from the scanner: a full-resolution photo of the shelf, labeled with the room/bookcase/shelf typed above
$('sc-shelfphoto').onclick=async()=>{
  if(!cloudOn()){ toast('Connect Dropbox first (Epilogue → Data & Sync) so photos can reach the folder'); return; }
  camHold=Date.now(); stopCamera(); $('sc-file').click();
};
$('sc-file').onchange=async e=>{
  const files=[...e.target.files]; e.target.value='';
  if(files.length){
    /* "Scan a stack": a photo of new books, where they go not known yet (Claude adds them with no shelf) */
    const pile=scanMode && scanMode.kind==='many';
    const loc={ room:$('sc-room').value.trim(), bookcase:$('sc-case').value.trim(), shelf:$('sc-shelf').value.trim(), kind:pile?'new-books':'shelf' };
    const where=[loc.room,loc.bookcase,loc.shelf?'Shelf '+loc.shelf:''].filter(Boolean).join(' · ');
    const note=pile ? 'New books'+(where?', going to '+where:', not shelved yet (add them with no shelf)') : '';
    const ok=await sendToInbox(files, loc, note, $('sc-phstatus'), null);
    if(ok) $('sc-phstatus').textContent = pile
      ? '✓ Stack photo sent to photos/inbox'+(where?' ('+where+')':' (no shelf yet)')+'. Claude reads the titles and adds them. Take another, or keep scanning.'
      : '✓ Shelf photo sent to photos/inbox'+(where?' ('+where+')':'')+'. Take another, or keep scanning.';
  }
  camHold=0;
  if($('scan-bg').classList.contains('open')) startCamera();
};
